// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The CAPTCHA subagent: it works on its own, and only after the agent.
// When the watch (ZendiaCaptchaWatch) finds a challenge on a tab, the
// finding waits for the agent's work there: a running turn is waited out,
// and a tab the agent never worked on is waited for its first turn — a
// page that is only opened stays quiet. Once the agent is done, the
// subagent opens the challenge from its checkbox where there is one,
// photographs it for the chat, asks the agent to say what the challenge
// asks, and brings the tab to the front so the user can complete it.
// Solving stays the user's part, as it is for the agent.
//
// The summary is a turn of the same agent the user talks to, with the same
// tools; page_screenshot is how it looks at the challenge. The picture in
// the chat is the service's own, for a model cannot put the image a tool
// handed it back into a page it writes.

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
// big for a panel page is retaken at the fallback width once.
const SHOT_MAX_WIDTH = 1280;
const SHOT_FALLBACK_WIDTH = 640;
const SHOT_QUALITY = 0.8;
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

  // A finding on a page the user must do something about: a frame or a
  // widget asks. Script, token and honeypot findings alone are invisible
  // checks (a scored reCAPTCHA, a sensor), and opening the tab for one
  // would cry wolf.
  #onDetect(browser, record) {
    const asks = record.detections.some(
      ({ signal }) => signal == "frame" || signal == "widget",
    );
    if (!asks || !browser.isConnected || this.#opening.has(browser)) {
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
    await this.#prepareChallenge(browser);
    await this.#showShot(browser, conversation, record);
    const prompt = this.#prompt(record);
    const echo = `CAPTCHA on this tab: ${record.text}. You complete the challenge; the assistant only looks at it.`;
    for (let tries = 0; tries < SEND_TRIES; tries++) {
      const before = conversation.messages.length;
      await conversation.send(prompt, [], { echo });
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

  // The screenshot of the challenge as a page in the chat: the picture
  // says what the text of a finding cannot.
  async #showShot(browser, conversation, record) {
    for (const maxWidth of [SHOT_MAX_WIDTH, SHOT_FALLBACK_WIDTH]) {
      const shot = await this.#screenshot(browser, maxWidth).catch(() => null);
      if (!shot) {
        return;
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
        return;
      } catch (e) {
        // pageFromArgs refuses a page over 512 KB: once more, smaller.
        if (maxWidth == SHOT_FALLBACK_WIDTH) {
          console.error("Zendia: CAPTCHA screenshot too big for the panel", e);
        }
      }
    }
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
  // it is, and the challenge waited on until it is open, its size says so,
  // and drawn. An invisible pass, and a widget that never comes, end the
  // wait with the poll.
  async #prepareChallenge(browser) {
    const top = browser.browsingContext;
    if (!top) {
      return;
    }
    this.#opening.add(browser);
    try {
      const deadline = Date.now() + CHALLENGE_DRAW_MS;
      // The frames whose checkbox this delivery already clicked: the
      // spinner after a click is not clicked again.
      const clicked = new Set();
      const timeout = new Promise((resolve) =>
        setTimeout(resolve, RECT_TIMEOUT_MS),
      );
      while (Date.now() < deadline) {
        const area = await this.#challengeRect(browser);
        const open =
          area?.challenge &&
          area.width >= CHALLENGE_MIN_WIDTH &&
          area.height >= CHALLENGE_MIN_HEIGHT;
        const drawn = open ? await this.#challengeDrawn(browser) : false;
        say(
          `poll: challenge=${!!area?.challenge} size=${area ? `${Math.round(area.width)}x${Math.round(area.height)}` : "-"} open=${open} drawn=${drawn} left=${deadline - Date.now()}ms`,
        );
        if (open && drawn) {
          return;
        }
        if (await this.#passed(browser)) {
          say("an invisible pass: nothing to show");
          return;
        }
        for (const context of this.#contextsOf(top)) {
          if (clicked.has(context.id)) {
            continue;
          }
          try {
            const answer = await Promise.race([
              context.currentWindowGlobal
                .getActor("ZendiaCaptchaWatch")
                .sendQuery("Zendia:CaptchaWatch:Open"),
              timeout,
            ]);
            if (answer?.opened) {
              say(`clicked the ${answer.name} checkbox in frame ${context.id}`);
              clicked.add(context.id);
            }
          } catch {
            // The frame is navigating, or has no actor yet.
          }
        }
        await new Promise((resolve) => setTimeout(resolve, CHALLENGE_POLL_MS));
      }
    } finally {
      // The rescan the opening brings can lag the poll: keep the findings
      // it reports the same finding's a moment longer.
      setTimeout(() => this.#opening.delete(browser), CHALLENGE_DRAW_MS);
    }
  }

  // Whether a checkbox frame of the tab says the check passed, so no
  // challenge will open. Asking never clicks (peek).
  async #passed(browser) {
    const top = browser.browsingContext;
    if (!top) {
      return false;
    }
    const timeout = new Promise((resolve) =>
      setTimeout(resolve, RECT_TIMEOUT_MS),
    );
    for (const context of this.#contextsOf(top)) {
      try {
        const answer = await Promise.race([
          context.currentWindowGlobal
            .getActor("ZendiaCaptchaWatch")
            .sendQuery("Zendia:CaptchaWatch:Open", { peek: true }),
          timeout,
        ]);
        if (answer?.passed) {
          return true;
        }
      } catch {
        // The frame is navigating, or has no actor yet.
      }
    }
    return false;
  }

  // Whether a challenge frame of the tab says it is drawn: its document
  // complete, its pictures loaded.
  async #challengeDrawn(browser) {
    const top = browser.browsingContext;
    if (!top) {
      return false;
    }
    const timeout = new Promise((resolve) =>
      setTimeout(resolve, RECT_TIMEOUT_MS),
    );
    for (const context of this.#contextsOf(top)) {
      try {
        const answer = await Promise.race([
          context.currentWindowGlobal
            .getActor("ZendiaCaptchaWatch")
            .sendQuery("Zendia:CaptchaWatch:Drawn"),
          timeout,
        ]);
        if (answer?.drawn) {
          return true;
        }
      } catch {
        // The frame is navigating, or has no actor yet.
      }
    }
    return false;
  }

  // Where the challenge is and in which frame of the tab, so the shot is
  // of it rather than the whole page; asking scrolls it into view. Every
  // frame is asked: a CAPTCHA may sit in a sub-frame the top page cannot
  // see into. The frame that asks for clicks wins over a service's plainer
  // frame, and a frame over a page's own widget. Null when no frame
  // answers in time.
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
    const found = answers.filter(Boolean);
    const picked =
      found.find((answer) => answer.challenge) ??
      found.find((answer) => answer.frame) ??
      found[0] ??
      null;
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
    const scale = Math.min(
      window.devicePixelRatio,
      maxWidth / (rect?.width ?? viewWidth),
    );
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
      width: shotWidth,
      height: shotHeight,
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

  // The turn the agent gets: look at the challenge, say what it asks.
  #prompt(record) {
    return [
      `You are the browser's CAPTCHA assistant. The watch layer found a CAPTCHA on the tab you work on: ${record.text}. Page: ${record.url}.`,
      `The user has the tab in front of them and was just shown a screenshot of it in the panel. Where the challenge opens from a checkbox, it was clicked for them already, so the challenge is open and waiting. They complete it themselves: never click, fill, press or scroll the challenge, and never navigate the tab away.`,
      `Do exactly this:
1. Call page_screenshot to look at the challenge (page_observe if your model cannot see images).
2. Answer in at most three short sentences: which service the challenge is from, what it asks the user to do (pick images, slide a piece into place, press and hold, check a box), and where on the page it sits. If the check looks invisible or already passed, say that instead.`,
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
