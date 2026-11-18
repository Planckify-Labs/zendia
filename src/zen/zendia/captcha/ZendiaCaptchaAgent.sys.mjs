// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The CAPTCHA subagent: it works on its own, and only after the agent.
// When the watch (ZendiaCaptchaWatch) finds a challenge on a tab, the
// finding waits for the agent's work there: a running turn is waited out,
// and a tab the agent never worked on is waited for its first turn — a
// page that is only opened stays quiet. Once the agent is done, the
// subagent opens the challenge from its checkbox where there is one,
// photographs it for the chat and for the agent, asks the agent to say
// what the challenge asks, and brings the tab to the front so the user can
// complete it. Solving stays the user's part, as it is for the agent.
//
// The summary is a turn of the same agent the user talks to, with the same
// tools. The picture in the chat is the service's own, for a model cannot
// put the image a tool handed it back into a page it writes; the same
// picture is attached to the turn, cut to the challenge, and page_screenshot
// is the agent's way to look again.

import { ZendiaAgents } from "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs";
import { pageFromArgs } from "resource:///modules/zendia/agent/ZendiaAgentUi.sys.mjs";
import { ZendiaCaptchaWatch } from "resource:///modules/zendia/captcha/ZendiaCaptchaWatch.sys.mjs";

// The module scope has no timers of its own this early in the startup.
const { clearTimeout, setTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs",
);

// zendia.captcha.agent: whether a found challenge is summarized in the chat.
export const PREF_AGENT = "zendia.captcha.agent";
// zendia.captcha.agent.debug: say each step of a delivery on stdout.
export const PREF_DEBUG = "zendia.captcha.agent.debug";

function say(text) {
  if (Services.prefs.getBoolPref(PREF_DEBUG, false)) {
    dump(`Zendia: CAPTCHA subagent: ${text}\n`);
  }
}

// The screenshot's size, after ZendiaAgentTools' #screenshot; a picture too
// big for a panel page is retaken at the fallback width once. The agent
// gets the first one as a file, whatever its size.
const SHOT_MAX_WIDTH = 1280;
const SHOT_FALLBACK_WIDTH = 640;
const SHOT_QUALITY = 0.8;
// A challenge is drawn at least this many times its CSS size, so a small
// widget's words stay readable; never taller than this.
const SHOT_MIN_SCALE = 2;
const SHOT_MAX_HEIGHT = 1600;
// The room the shot leaves around the challenge, in the page's pixels.
const SHOT_PADDING = 12;
// How long asking the page where the challenge is may take before the whole
// page is shot instead.
const RECT_TIMEOUT_MS = 2000;
// How long an opening challenge may take to show and draw, checked in
// steps; an invisible pass draws nothing, and the wait ends with the poll.
const CHALLENGE_DRAW_MS = 8000;
const CHALLENGE_POLL_MS = 300;
// A challenge is open when it is this big: the services' popups are
// 300x260 and up, a checkbox widget or the collapsed frame the popup opens
// from is smaller.
const CHALLENGE_MIN_WIDTH = 260;
const CHALLENGE_MIN_HEIGHT = 260;
// How long what a click opened in the page may take to come up and stop
// moving before it is shot.
const OPENED_SETTLE_MS = 1000;
const OPENED_PICTURELESS_MS = 3000;

// About how wide a page in the panel is, for the page's height guess.
const PANEL_WIDTH = 380;

// How long waiting for the agent goes on without news before the state is
// looked at again: a closed tab never sends news.
const IDLE_POLL_MS = 2000;

// How often a summary the user's own turn preempted is tried again.
const SEND_TRIES = 3;

// Text the service wrote cannot break out of the page's markup.
function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

class ZendiaCaptchaAgentService {
  #initialized = false;
  // The newest finding of each tab that waits for its summary; older ones
  // are not worth catching up on.
  #pending = new WeakMap();
  // The tabs the subagent is on, so a finding there queues instead of
  // starting a second summary.
  #working = new WeakSet();
  // The conversations already watched for their first turn.
  #watched = new WeakSet();
  // The tabs whose challenge the subagent is opening itself: the findings
  // the opening brings are the same finding's, not new ones.
  #opening = new WeakSet();
  // Per tab, where in a sub-frame the challenge was last seen while it was
  // made ready, for a shot when it no longer answers.
  #lastFrame = new WeakMap();
  // Per tab, the page and what of it was summarized already, so a
  // challenge that is closed and opened again, or hidden and shown, is not
  // summarized again on the same page.
  #delivered = new WeakMap();

  init() {
    if (this.#initialized || !Services.prefs.getBoolPref(PREF_AGENT, true)) {
      return;
    }
    this.#initialized = true;
    ZendiaCaptchaWatch.onDetect((browser, record) => {
      try {
        this.#onDetect(browser, record);
      } catch (e) {
        console.error("Zendia: CAPTCHA subagent failed", e);
      }
    });
    // A finding that came before the tab had a conversation waits for the
    // first turn of the one that starts.
    ZendiaAgents.onConversation((browser, conversation) => {
      if (this.#pending.has(browser)) {
        this.#watchForTurn(browser, conversation);
      }
    });
  }

  // Whether the agent worked the tab: asked something, or asking now. A
  // turn's request is pushed as a user message when it starts, so a
  // running turn counts.
  #worked(conversation) {
    return (
      !!conversation &&
      conversation.messages.some((message) => message.type == "user")
    );
  }

  // A finding on a page the user must do something about: a frame, a
  // widget or a challenge the page draws itself that is shown. Script,
  // token and honeypot findings alone are invisible checks (a scored
  // reCAPTCHA, a sensor), and so are hidden frames (a closed challenge, an
  // invisible mode's helper); opening the tab for one would cry wolf. What
  // was summarized on this page already is not again.
  #onDetect(browser, record) {
    const asking = new Set(
      record.detections
        .filter(
          ({ signal, hidden }) =>
            (signal == "frame" || signal == "widget" || signal == "own") &&
            !hidden,
        )
        .map(({ signal, name, kind }) => `${signal}:${name ?? ""}:${kind ?? ""}`),
    );
    if (!asking.size || !browser.isConnected) {
      return;
    }
    let delivered = this.#delivered.get(browser);
    if (delivered?.url != record.url) {
      delivered = { url: record.url, keys: new Set() };
      this.#delivered.set(browser, delivered);
    }
    const fresh = [...asking].filter((key) => !delivered.keys.has(key));
    for (const key of asking) {
      delivered.keys.add(key);
    }
    if (!fresh.length || this.#opening.has(browser)) {
      return;
    }
    this.#pending.set(browser, record);
    say(`detected: ${record.signature}`);
    const conversation = ZendiaAgents.conversationFor(browser);
    if (this.#worked(conversation)) {
      this.#pump(browser);
    } else if (conversation) {
      this.#watchForTurn(browser, conversation);
    }
    // Without a conversation the finding rests until one starts.
  }

  /**
   * The button's way to test the subagent on a tab: the finding the watch
   * has for it is delivered now, whether the agent worked the tab before
   * or not.
   *
   * @param {Element} browser
   * @returns {Promise<boolean>} False when the watch found nothing on the
   *   tab, or no agent is installed to summarize it.
   */
  async runNow(browser) {
    const record = ZendiaCaptchaWatch.lastFor(browser);
    if (!record || !browser.isConnected) {
      return false;
    }
    const conversation = await ZendiaAgents.open(browser);
    if (!conversation) {
      return false;
    }
    this.#pending.set(browser, record);
    this.#pump(browser, { force: true });
    return true;
  }

  // Work off what waits on the tab, one finding at a time. Forced, the
  // worked gate is skipped: the button asked for it.
  #pump(browser, { force = false } = {}) {
    if (this.#working.has(browser)) {
      return;
    }
    this.#working.add(browser);
    (async () => {
      try {
        let record;
        while ((record = this.#pending.get(browser)) && browser.isConnected) {
          this.#pending.delete(browser);
          await this.#deliver(browser, record, force);
        }
      } finally {
        this.#working.delete(browser);
      }
    })().catch((e) => console.error("Zendia: CAPTCHA subagent failed", e));
  }

  // A finding whose tab has a conversation but no turn yet is delivered
  // once the first turn ends: the conversation's changes say when.
  #watchForTurn(browser, conversation) {
    if (this.#watched.has(conversation)) {
      return;
    }
    this.#watched.add(conversation);
    const off = conversation.subscribe(() => {
      if (!browser.isConnected || !this.#pending.has(browser)) {
        off();
        return;
      }
      if (!this.#worked(conversation)) {
        return;
      }
      // send() marks the turn running a few statements after its request is
      // pushed and the listeners fired: wait the statements out, then the
      // turn itself.
      setTimeout(() => {
        off();
        this.#pump(browser);
      }, 0);
    });
  }

  // One summary: the agent's turn once the agent is done with the tab, the
  // tab in front for the challenge, its picture and the finding's line in
  // the chat. Forced (the button), the worked gate is skipped.
  async #deliver(browser, record, force = false) {
    const conversation = ZendiaAgents.conversationFor(browser);
    if (!conversation) {
      return;
    }
    if (!this.#worked(conversation) && !force) {
      // The conversation was reset while the finding waited: wait for the
      // first turn of the new one.
      this.#pending.set(browser, record);
      this.#watchForTurn(browser, conversation);
      return;
    }
    if (!(await this.#idle(conversation, browser))) {
      return;
    }
    // To the front first: a background tab's browser has no size to
    // capture, and the user is handed the challenge anyway.
    this.#toFront(browser);
    const shot = await this.captureChallenge(browser).catch(() => null);
    const shown = await this.#showShot(browser, conversation, record, shot);
    // The picture goes to the agent too, at its full size whatever the
    // panel took: the cropped challenge, sharper than a shot of the whole
    // tab, is what it should read. Not to a model known to be blind to
    // pictures: it reads the page instead.
    const inputs = ZendiaAgents.inputsOf?.(conversation.agent?.id);
    const sees = !inputs || inputs.includes("image");
    const picture = sees ? (shot ?? shown) : null;
    const prompt = this.#prompt(record, picture);
    const files = picture
      ? [{ name: "captcha-challenge.jpg", bytes: picture.bytes }]
      : [];
    const echo = `CAPTCHA on this tab: ${record.text}. You complete the challenge; the assistant only looks at it.`;
    for (let tries = 0; tries < SEND_TRIES; tries++) {
      const before = conversation.messages.length;
      await conversation.send(prompt, files, { echo });
      if (conversation.messages.length > before) {
        return;
      }
      // The user's own request went first; the summary follows it.
      if (!(await this.#idle(conversation, browser))) {
        return;
      }
    }
  }

  // Once the agent is done with the tab: a turn of the user's or one of
  // this subagent's. False when the tab went away first.
  async #idle(conversation, browser) {
    while (browser.isConnected && conversation.running) {
      await new Promise((resolve) => {
        let off = () => {};
        const timer = setTimeout(() => {
          off();
          resolve();
        }, IDLE_POLL_MS);
        off = conversation.subscribe(() => {
          if (!conversation.running) {
            clearTimeout(timer);
            off();
            resolve();
          }
        });
      });
    }
    return browser.isConnected;
  }

  /**
   * The challenge of a tab as the subagent photographs it: made ready
   * (waited for, opened from its checkbox, waited on until drawn), then
   * shot, cut to the challenge where a frame of the tab says where it is.
   * The tab must be in front: a background tab has nothing drawn.
   *
   * @param {Element} browser
   * @param {number} [maxWidth]
   * @returns {Promise<{data: string, bytes: Uint8Array, width: number,
   *   height: number, cropped: boolean}|null>} The JPEG, as base64 and as
   *   bytes, and its size; null when the tab has nothing to shoot.
   */
  async captureChallenge(browser, maxWidth = SHOT_MAX_WIDTH) {
    await this.#prepareChallenge(browser);
    return this.#screenshot(browser, maxWidth);
  }

  // The screenshot of the challenge as a page in the chat: the picture
  // says what the text of a finding cannot. A picture too big for a panel
  // page is retaken smaller. The shot shown, or null.
  async #showShot(browser, conversation, record, shot) {
    for (const maxWidth of [SHOT_MAX_WIDTH, SHOT_FALLBACK_WIDTH]) {
      if (maxWidth != SHOT_MAX_WIDTH) {
        shot = await this.#screenshot(browser, maxWidth).catch(() => null);
      }
      if (!shot) {
        return null;
      }
      try {
        conversation.showPage(
          pageFromArgs({
            title: `CAPTCHA: ${record.text.slice(0, 80)}`,
            height: Math.round((shot.height * PANEL_WIDTH) / shot.width) + 44,
            css: "figure { margin: 0; } img { border: 0.5px solid var(--color-border-tertiary); border-radius: 8px; } figcaption { margin-top: 6px; }",
            html: `<figure><img src="data:image/jpeg;base64,${shot.data}" alt="The challenge on the page"><figcaption>${escapeHtml(record.text)}</figcaption></figure>`,
          }),
        );
        return shot;
      } catch (e) {
        // pageFromArgs refuses a page over 512 KB: once more, smaller.
        if (maxWidth == SHOT_FALLBACK_WIDTH) {
          console.error("Zendia: CAPTCHA screenshot too big for the panel", e);
        }
      }
    }
    return null;
  }

  // The tab's frames that can be asked, top first, each once.
  #contextsOf(top) {
    return [top, ...(top.getAllBrowsingContextsInSubtree() ?? [])].filter(
      (context, index, all) =>
        context.currentWindowGlobal &&
        all.findIndex((other) => other.id == context.id) == index,
    );
  }

  // The challenge, made ready for the shot: the widget is waited for if it
  // is not there yet (some pages draw it late), its checkbox clicked once
  // it is — a service's checkbox frame, a checkbox the page draws itself,
  // the opener of a service widget drawn in the page (Lemin, GeeTest, AWS
  // WAF's Begin) — and the challenge waited on until it is open, its size
  // says so, and drawn. What a click opens in the page that is no
  // challenge frame is shot once the shot has moved to it and holds still.
  // A challenge with nothing to open (a slider, a managed check) is shot
  // once it is drawn and holds still between two looks. An invisible pass,
  // and a widget that never comes, end the wait with the poll.
  async #prepareChallenge(browser) {
    const top = browser.browsingContext;
    if (!top) {
      return;
    }
    this.#opening.add(browser);
    this.#lastFrame.delete(browser);
    try {
      const deadline = Date.now() + CHALLENGE_DRAW_MS;
      // The frames whose checkbox this delivery already clicked: the
      // spinner after a click is not clicked again.
      const clicked = new Set();
      // Whether a checkbox was seen, so a challenge may still open; and
      // where the shot was when one was clicked, and when: what a click
      // opens in the page (a popup, a puzzle) is no frame that asks for
      // clicks, and is known by the shot moving to it.
      let checkbox = false;
      let clickedFrom = null;
      let clickedAt = 0;
      let last = null;
      while (Date.now() < deadline) {
        const area = await this.#challengeRect(browser);
        const open =
          area?.challenge &&
          area.fullWidth >= CHALLENGE_MIN_WIDTH &&
          area.fullHeight >= CHALLENGE_MIN_HEIGHT;
        const drawn = area ? await this.#drawn(area) : false;
        if (area && area.context != top) {
          this.#lastFrame.set(browser, area);
        }
        const place = area
          ? [
              area.context.id,
              area.left,
              area.top,
              area.width,
              area.height,
              area.pictures ?? 0,
            ]
              .map((value) => Math.round(value))
              .join()
          : null;
        const still = !!place && place == last;
        last = place;
        say(
          `poll: challenge=${!!area?.challenge} size=${area ? `${Math.round(area.fullWidth)}x${Math.round(area.fullHeight)}` : "-"} open=${open} drawn=${drawn} still=${still} left=${deadline - Date.now()}ms`,
        );
        if (open && drawn) {
          return;
        }
        const peek = await this.#peek(browser);
        if (peek.passed) {
          say("an invisible pass: nothing to show");
          return;
        }
        checkbox ||= peek.checkbox;
        // A challenge frame still opening is waited on; anything else that
        // is drawn and holds still is what there is to shoot.
        const settled =
          area && !open && !(area.challenge && area.frame) && drawn && still;
        if (settled && !checkbox) {
          say("nothing to open: the challenge is shot as it is");
          return;
        }
        // What a click opened in the page is shot once its puzzle is past
        // its spinner: a picture of it is up, loaded, and holds still. A
        // puzzle drawn with no picture element (a CSS background) is given
        // a little longer instead.
        if (
          settled &&
          clicked.size &&
          place != clickedFrom &&
          Date.now() - clickedAt >= OPENED_SETTLE_MS &&
          (area.pictures !== 0 ||
            Date.now() - clickedAt >= OPENED_PICTURELESS_MS)
        ) {
          say("the click opened the challenge in the page");
          return;
        }
        await this.#eachFrame(
          browser,
          "Zendia:CaptchaWatch:Open",
          null,
          (answer, context) => {
            if (clicked.has(context.id) || !answer?.opened) {
              return false;
            }
            say(`clicked the ${answer.name} checkbox in frame ${context.id}`);
            clicked.add(context.id);
            clickedFrom = place;
            clickedAt = Date.now();
            return false;
          },
          (context) => !clicked.has(context.id),
        );
        await new Promise((resolve) => setTimeout(resolve, CHALLENGE_POLL_MS));
      }
    } finally {
      // The rescan the opening brings can lag the poll: keep the findings
      // it reports the same finding's a moment longer.
      setTimeout(() => this.#opening.delete(browser), CHALLENGE_DRAW_MS);
    }
  }

  // Ask the tab's frames one after another, those `only` lets through,
  // until `stop` says so of an answer. A frame that does not answer in
  // time, navigates or has no actor is passed over.
  async #eachFrame(browser, name, data, stop, only = () => true) {
    const top = browser.browsingContext;
    if (!top) {
      return;
    }
    const timeout = new Promise((resolve) =>
      setTimeout(resolve, RECT_TIMEOUT_MS),
    );
    for (const context of this.#contextsOf(top)) {
      if (!only(context)) {
        continue;
      }
      try {
        const answer = await Promise.race([
          context.currentWindowGlobal
            .getActor("ZendiaCaptchaWatch")
            .sendQuery(name, data),
          timeout,
        ]);
        if (stop(answer, context)) {
          return;
        }
      } catch {
        // The frame is navigating, or has no actor yet.
      }
    }
  }

  // What the checkbox frames of the tab say, without a click: whether the
  // check passed, so no challenge will open, and whether a checkbox is
  // there to open one.
  async #peek(browser) {
    const result = { passed: false, checkbox: false };
    await this.#eachFrame(
      browser,
      "Zendia:CaptchaWatch:Open",
      { peek: true },
      (answer) => {
        result.checkbox ||= !!answer?.checkbox;
        result.passed ||= !!answer?.passed;
        return result.passed;
      },
    );
    return result;
  }

  // Whether what the shot is of is drawn. A frame is asked itself, from
  // inside: its document complete, the pictures it shows loaded. A frame
  // that cannot be asked (nothing loaded in it yet) is not drawn; a widget
  // or challenge of the page itself said so with its place.
  async #drawn(area) {
    if (!area.frame) {
      return !!area.drawn;
    }
    const context =
      area.frameId != null ? BrowsingContext.get(area.frameId) : null;
    const actor = context?.currentWindowGlobal?.getActor("ZendiaCaptchaWatch");
    if (!actor) {
      return false;
    }
    try {
      const answer = await Promise.race([
        actor.sendQuery("Zendia:CaptchaWatch:Drawn", { any: true }),
        new Promise((resolve) => setTimeout(resolve, RECT_TIMEOUT_MS)),
      ]);
      return !!answer?.drawn;
    } catch {
      return false;
    }
  }

  // Where the challenge is and in which frame of the tab, so the shot is
  // of it rather than the whole page; asking scrolls it into view. Every
  // frame is asked: a CAPTCHA may sit in a sub-frame the top page cannot
  // see into. The frame that asks for clicks wins over a service's plainer
  // frame, a frame over a page's widget, a widget over a challenge the
  // page draws itself; and what a page shows of a CAPTCHA's frame over
  // what that frame shows inside it. Of the same rank, the bigger. Null
  // when no frame answers in time.
  async #challengeRect(browser) {
    const top = browser.browsingContext;
    if (!top) {
      return null;
    }
    const contexts = this.#contextsOf(top);
    const timeout = new Promise((resolve) =>
      setTimeout(resolve, RECT_TIMEOUT_MS),
    );
    const answers = await Promise.all(
      contexts.map(async (context) => {
        try {
          const rect = await Promise.race([
            context.currentWindowGlobal
              .getActor("ZendiaCaptchaWatch")
              .sendQuery("Zendia:CaptchaWatch:Rect"),
            timeout,
          ]);
          return rect && { context, ...rect };
        } catch {
          // The frame is navigating, or has no actor yet.
          return null;
        }
      }),
    );
    const rank = (answer) => {
      let place = 2;
      if (answer.challenge) {
        place = 0;
      } else if (answer.frame) {
        place = 1;
      } else if (answer.own) {
        place = 3;
      }
      return (answer.inside ? 4 : 0) + place;
    };
    const size = (answer) =>
      (answer.fullWidth ?? answer.width) * (answer.fullHeight ?? answer.height);
    const found = answers
      .filter(Boolean)
      .sort((a, b) => rank(a) - rank(b) || size(b) - size(a));
    const picked = found[0] ?? null;
    say(
      `rect answers: ${JSON.stringify(
        found.map(({ context, ...rect }) => ({ context: context.id, ...rect })),
      )} -> ${picked ? JSON.stringify({ context: picked.context.id, challenge: picked.challenge }) : "none"}`,
    );
    return picked;
  }

  // What the tab shows, canvases and frames included, after
  // ZendiaAgentTools' #screenshot, with the picture's size kept. When a
  // frame of the tab says where the challenge is, only it, with a little
  // room around, taken from that frame's own global.
  async #screenshot(browser, maxWidth) {
    const window = this.#windowFor(browser);
    if (!window || !browser.isConnected) {
      return null;
    }
    // A freshly selected tab is drawn first.
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    let global = browser.browsingContext?.currentWindowGlobal;
    if (!global) {
      return null;
    }
    let viewWidth;
    let viewHeight;
    let rect = null;
    const area = await this.#challengeRect(browser);
    if (area) {
      global = area.context.currentWindowGlobal;
      if (!global) {
        // The frame with the challenge navigated away: no shot at all is
        // better than one of the wrong place.
        return null;
      }
      ({ viewWidth, viewHeight } = area);
      // drawSnapshot reads the document's coordinates, the rect the
      // viewport's: the frame's scroll moves between them on a scrolled
      // page.
      const scrollX = area.scrollX ?? 0;
      const scrollY = area.scrollY ?? 0;
      const left = Math.max(scrollX, area.left + scrollX - SHOT_PADDING);
      const top = Math.max(scrollY, area.top + scrollY - SHOT_PADDING);
      const right = Math.min(
        scrollX + viewWidth,
        area.left + scrollX + area.width + SHOT_PADDING,
      );
      const bottom = Math.min(
        scrollY + viewHeight,
        area.top + scrollY + area.height + SHOT_PADDING,
      );
      if (right > left && bottom > top) {
        rect = new window.DOMRect(left, top, right - left, bottom - top);
      }
    } else if (this.#lastFrame.get(browser)?.context.currentWindowGlobal) {
      // Nothing answers now, but the challenge was last seen in a sub-frame
      // (a click there replaced its widget with a puzzle the layer has no
      // name for): that frame, whole, is closer to it than the page.
      const last = this.#lastFrame.get(browser);
      global = last.context.currentWindowGlobal;
      ({ viewWidth, viewHeight } = last);
      rect = new window.DOMRect(
        last.scrollX ?? 0,
        last.scrollY ?? 0,
        viewWidth,
        viewHeight,
      );
    } else {
      ({ width: viewWidth, height: viewHeight } =
        browser.getBoundingClientRect());
    }
    if (!viewWidth || !viewHeight) {
      return null;
    }
    say(
      `shot: rect=${rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : "full page"} view=${Math.round(viewWidth)}x${Math.round(viewHeight)}`,
    );
    // A small widget is drawn bigger than the screen has it, so its words
    // stay readable to the agent; none wider than maxWidth, nor taller
    // than SHOT_MAX_HEIGHT.
    const scale = rect
      ? Math.min(
          Math.max(window.devicePixelRatio, SHOT_MIN_SCALE),
          maxWidth / rect.width,
          SHOT_MAX_HEIGHT / rect.height,
        )
      : Math.min(window.devicePixelRatio, maxWidth / viewWidth);
    const image = await global.drawSnapshot(rect, scale, "white");
    // Handing the bitmap to the canvas empties it.
    const { width: shotWidth, height: shotHeight } = image;
    const canvas = new window.OffscreenCanvas(shotWidth, shotHeight);
    canvas
      .getContext("bitmaprenderer", { alpha: false })
      .transferFromImageBitmap(image);
    const blob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: SHOT_QUALITY,
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return {
      data: window.btoa(binary),
      bytes,
      width: shotWidth,
      height: shotHeight,
      cropped: !!rect,
    };
  }

  // The tab with the challenge, in front, with its chat open beside it.
  // The keys stay on the page, where the challenge takes them.
  #toFront(browser) {
    const window = this.#windowFor(browser);
    const tab = window?.gBrowser?.getTabForBrowser(browser);
    if (!tab) {
      return;
    }
    window.gBrowser.selectedTab = tab;
    ZendiaAgents.zendia?.agentDockFor(window)?.open(browser, { focus: false });
  }

  // The turn the agent gets: look at the challenge, say what it asks. With
  // the picture attached, that is where it looks first: the challenge cut
  // from the page, sharper than a shot of the whole tab.
  #prompt(record, picture) {
    const look = picture?.cropped
      ? `1. Look at the attached picture first: it is the challenge cut from the page, drawn larger than on screen. Call page_screenshot only if you cannot view the picture or it does not show the challenge (page_observe if your model cannot see images).`
      : `1. Call page_screenshot to look at the challenge (page_observe if your model cannot see images).`;
    return [
      `You are the browser's CAPTCHA assistant. The watch layer found a CAPTCHA on the tab you work on: ${record.text}. Page: ${record.url}.`,
      `The user has the tab in front of them and was just shown a screenshot of it in the panel. Where the challenge opens from a checkbox, it was clicked for them already, so the challenge is open and waiting. They complete it themselves: never click, fill, press or scroll the challenge, and never navigate the tab away.`,
      `Do exactly this:
${look}
2. Answer in at most three short sentences: which service the challenge is from (or that the page draws it itself), what it asks the user to do (pick images, type the characters, slide a piece into place, press and hold, check a box), and where on the page it sits. If the check looks invisible, runs on its own (a progress bar, "Verifying"), or already passed, say that instead.`,
    ].join("\n\n");
  }

  // The window a tab's browser is in, found as the watch finds it: the
  // browser's own ownerGlobal is null under Fission, so the window mediator
  // it is.
  #windowFor(browser) {
    if (browser.ownerGlobal?.gBrowser) {
      return browser.ownerGlobal;
    }
    for (const window of Services.wm.getEnumerator("navigator:browser")) {
      if (window.gBrowser?.browsers?.includes(browser)) {
        return window;
      }
    }
    return null;
  }
}

export const ZendiaCaptchaAgent = new ZendiaCaptchaAgentService();
