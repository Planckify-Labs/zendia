// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The CAPTCHA subagent: it works on its own, and only after the agent.
// The watch (ZendiaCaptchaWatch) reads every CAPTCHA live — a box to tick,
// a challenge open, a check running, solved — and says so each time it
// changes, with no reload. A CAPTCHA that asks the user waits for the
// agent's work on the tab: a running turn is waited out, and a tab the
// agent never worked on is waited for its first turn — a page that is
// only opened stays quiet. Once the agent is done, the subagent reads the
// state again: one solved meanwhile is left alone. One that still asks is
// opened from its checkbox where there is one, labeled for the keys,
// photographed for the chat and for the agent, and the agent asked for
// the steps that complete it (the keys to type, read off the labels in
// the picture), the tab brought to the front so the user can follow them.
// Solving stays the user's part, as it is for the agent: the steps say
// what to look for, never the answer.
//
// The agent and the subagent hand the tab back and forth: a turn of the
// agent's that ends while a CAPTCHA holds its tab up stopped on it, and
// once the CAPTCHA is cleared (solved, or gone with the page that held
// it), the subagent reports back and the agent carries on with the
// user's request.
//
// The summary is a turn of the same agent the user talks to, with the same
// tools. The picture in the chat is the service's own, for a model cannot
// put the image a tool handed it back into a page it writes; the same
// picture is attached to the turn, cut to the challenge, and page_screenshot
// is the agent's way to look again.

import { ZendiaAgents } from "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs";
import { pageFromArgs } from "resource:///modules/zendia/agent/ZendiaAgentUi.sys.mjs";
import { ZendiaCaptchaWatch } from "resource:///modules/zendia/captcha/ZendiaCaptchaWatch.sys.mjs";
import { ZendiaCaptcha } from "resource:///modules/zendia/core/ZendiaCaptcha.sys.mjs";

// The module scope has no timers of its own this early in the startup.
import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";

// zendia.captcha.agent: whether a found challenge is summarized in the chat.
export const PREF_AGENT = "zendia.captcha.agent";
// zendia.captcha.agent.labels: whether the challenge is labeled for the
// keys (as `s` labels a page) before it is shot, so the shot shows the
// labels and the user finishes by typing them.
export const PREF_LABELS = "zendia.captcha.agent.labels";
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
// The room the shot leaves around the challenge, in the page's pixels (the
// page side leaves the room around each part, inside the challenge).
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
const OPENED_PICTURELESS_MS = 6000;
// How long the jump labels have to be painted before the shot: the action
// that draws them returns with them in the page, this covers the paint.
const LABELS_SETTLE_MS = 150;
// How long the parts may wait for the last of their pictures to be drawn
// and to hold still, and how far apart the looks for the latter are.
const PARTS_DRAW_MS = 5000;
const PARTS_STILL_MS = 250;

// About how wide a page in the panel is, for the page's height guess.
const PANEL_WIDTH = 380;

// How long waiting for the agent goes on without news before the state is
// looked at again: a closed tab never sends news.
const IDLE_POLL_MS = 2000;

// How often a summary the user's own turn preempted is tried again.
const SEND_TRIES = 3;

// How long a check that runs on its own (Turnstile's spinner) is given to
// pass or ask before it is shot as it is.
const CHECKING_WAIT_MS = 15000;
// How long a CAPTCHA must stay gone from the page to count as cleared: a
// widget drawn again (a retry, a re-render) is gone for less.
const GONE_SETTLE_MS = 2000;

// Text the service wrote cannot break out of the page's markup.
function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// The keys of a labeled CAPTCHA, for the agent to build the user's steps
// from: the jump's (ZendiaJumpContent's PURPOSE_KEYS and picks) and the
// virtual cursor's (ZendiaPointerContent's PointerPad), with the recipes
// they make for each kind of challenge. `key` is what labels a CAPTCHA
// again once the labels are left.
function keysReference(key) {
  return `Labels (what is on screen now):
- Type a tag: click that tile, button or field. The tags stay up for the next pick.
- A slider's handle, a puzzle piece or a "press and hold" button: its tag grabs it, the mouse held down. Typing a tag's last letter as a capital holds anything else.
- \`Enter\`: the challenge's Verify, Next, Skip or Submit button.
- \`Tab\`: into the answer field, to type the characters or what the audio says; \`Esc\` back out, then \`Enter\`.
- \`Ctrl+R\` a new challenge, \`Ctrl+A\` the audio challenge (or back to images), \`Ctrl+P\` play the audio.
- \`.\`: the virtual cursor over the challenge, for what no tag names: a point to click in a picture. \`,\`: the same, holding the mouse down after its first jump, to drag from that point.
- \`Esc\`: leave the labels${key ? `; \`${key}\` labels the CAPTCHA again` : ""}.
The virtual cursor (an arrow with a grid of tags over the picture; a tag on a whole picture opens it too):
- Type a grid tag: the cursor jumps there; its last letter as a capital clicks there.
- \`h\` \`j\` \`k\` \`l\` move it 2px, \`H\` \`J\` \`K\` \`L\` 10px, the arrows 1px; a count first repeats it (\`12l\`).
- \`Space\` clicks, or lets go while holding. \`v\` presses and holds, or lets go.
- \`Enter\` lets go while holding; otherwise it presses the challenge's Verify button.
- \`Tab\` switches the tags: grid, ruler, none. \`Esc\` puts a drag back, or returns to the labels.
Recipes:
- Pick images: type the tag on each matching tile, then \`Enter\`.
- Type characters: \`Tab\`, type them, \`Esc\`, \`Enter\`.
- Audio: \`Ctrl+A\`, \`Ctrl+P\` to listen, \`Tab\`, type what is said, \`Esc\`, \`Enter\`.
- Slide a piece to a gap: type the handle's tag; a ruler of one-letter tags lies over the piece's row; type the letter under the gap, nudge with \`h\`/\`l\` (\`H\`/\`L\` for more) until the piece fits, then \`Space\`.
- Rotate: type the rotate button's tag until the picture is upright, then \`Enter\`.
- Click points or icons in order: \`.\`, then for each in turn a grid tag near it, \`h\`\`j\`\`k\`\`l\` onto it, \`Space\`; then \`Enter\`.
- Press and hold: type the button's tag, wait while it fills, then \`Space\` when it is done.
- A checkbox: type its tag.`;
}

// The kinds of a service's frame that never ask the user: a scored or
// invisible check, a proof of work.
const SILENT_KINDS = new Set(["score", "invisible", "proof-of-work"]);

// Whether a finding shows the user a CAPTCHA: a service's frame that is
// shown and can ask, a widget the page drew, or a challenge it draws. A
// script, a token or a trap field alone shows nothing.
function asksOnPage(record) {
  return !!record?.detections?.some(
    ({ signal, hidden, kind }) =>
      !hidden &&
      (signal == "widget" ||
        signal == "own" ||
        (signal == "frame" && !SILENT_KINDS.has(kind)))
  );
}

// The page a tab shows, without its fragment.
function pageOf(browser) {
  return browser.currentURI?.specIgnoringRef ?? browser.currentURI?.spec ?? "";
}

// What is up on the user's screen, by what #labelChallenge labeled.
const LABELED_NOW = {
  captcha:
    "Small letter tags sit on its tiles, buttons and fields, and the keys of the labels below work now.",
  cursor:
    "Nothing in it takes a tag (a picture drawn in a canvas, a button that answers no clicks), so the virtual cursor is open over it already, with its grid of letter tags: the cursor's keys below work now, and `Esc` leaves it.",
  page: "Every link, button and field of the page has a letter tag, the challenge's among them: the first tag typed in the challenge keeps the tags up for the next, and only from then on do `Enter`, `Tab`, the Ctrl keys, `.` and `,` work. Have the first step type a tag of the challenge (its tile, field or handle).",
};

class ZendiaCaptchaAgentService {
  #initialized = false;
  // Per tab, the round of its CAPTCHA asking the user: from the state that
  // first asks (a box to tick, a challenge open) until it is cleared
  // (solved, or gone). Each round is shot once, however often the
  // challenge is closed and opened again inside it; a CAPTCHA that asks
  // again once cleared (expired, or a new one) is a new round, on the same
  // page with no reload. {shot, cleared, record}.
  #rounds = new WeakMap();
  // Per tab, what the watch last said the CAPTCHA is at: {state, how,
  // record}.
  #states = new WeakMap();
  // The tabs whose agent stopped on the CAPTCHA: a turn of its work ended
  // while one held the tab up. Told to carry on once it is cleared.
  #held = new WeakSet();
  // The tabs the subagent is on, those to look at again once it is done,
  // and those the button asked for.
  #working = new WeakSet();
  #again = new WeakSet();
  #forced = new WeakSet();
  // The tabs whose challenge the subagent is opening and shooting: a pass
  // that seems to come and go while it clicks is the same round's.
  #delivering = new WeakSet();
  // The conversations followed for the end of their turns, and those
  // running a turn of the subagent's own (the guide), which is no work of
  // the agent's.
  #followed = new WeakSet();
  #side = new WeakSet();
  // Per tab, the page whose CAPTCHA was last shot: one that asks again
  // there (expired, reset) pulls the tab to the front only when the agent
  // waits on it or the user is on it already.
  #shotOn = new WeakMap();
  // Per tab, where in a sub-frame the challenge was last seen while it was
  // made ready, for a shot when it no longer answers.
  #lastFrame = new WeakMap();

  init() {
    if (this.#initialized || !Services.prefs.getBoolPref(PREF_AGENT, true)) {
      return;
    }
    this.#initialized = true;
    ZendiaCaptchaWatch.onDetect((browser, record) => {
      try {
        this.#onState(browser, record);
      } catch (e) {
        console.error("Zendia: CAPTCHA subagent failed", e);
      }
    });
    // A CAPTCHA found before the tab had a conversation waits for the
    // first turn of the one that starts.
    ZendiaAgents.onConversation((browser, conversation) => {
      this.#follow(conversation);
      if (this.#states.has(browser)) {
        this.#schedule(browser);
      }
    });
  }

  // Whether the agent worked the tab: asked something, or asking now. A
  // turn's request is pushed as a user message when it starts, so a
  // running turn counts.
  #worked(conversation) {
    return (
      !!conversation &&
      conversation.messages.some(message => message.type == "user")
    );
  }

  // The watch's word on a tab, live: a CAPTCHA that asks starts a round,
  // one that is solved or gone ends it. Script, token and honeypot findings
  // alone ask nothing (a scored reCAPTCHA, a sensor), and neither does a
  // hidden frame (a closed challenge, an invisible mode's helper): their
  // state is none or solved, and opening the tab for one would cry wolf.
  #onState(browser, record) {
    if (!browser.isConnected) {
      return;
    }
    const state = record.state ?? "none";
    this.#states.set(browser, { state, how: record.how ?? null, record });
    let round = this.#rounds.get(browser);
    if (round?.clearing && state != "none") {
      clearTimeout(round.clearing);
      round.clearing = null;
    }
    if (ZendiaCaptcha.asksUser(state)) {
      if (round?.cleared && this.#delivering.has(browser)) {
        // The subagent's own click flickered the state: the same round.
        round.cleared = false;
      } else if (!round || round.cleared) {
        round = { shot: false, cleared: false, record };
        this.#rounds.set(browser, round);
        say(`asks: ${record.text}, ${state} (${record.how ?? "-"})`);
      }
      round.record = record;
    } else if (state == "solved" && round && !round.cleared) {
      round.cleared = true;
      say(`cleared: ${record.how ?? state}`);
    } else if (
      this.#cleared(state, record) &&
      round &&
      !round.cleared &&
      !round.clearing
    ) {
      // Gone: once it stays gone. A widget that draws itself again (a
      // managed check that retries) is gone for a moment only.
      round.clearing = setTimeout(() => {
        round.clearing = null;
        const now = this.#states.get(browser);
        if (now && this.#cleared(now.state, now.record) && !round.cleared) {
          round.cleared = true;
          say(`cleared: ${record.how ?? state}`);
          if (ZendiaAgents.conversationFor(browser)) {
            this.#schedule(browser);
          }
        }
      }, GONE_SETTLE_MS);
    }
    const conversation = ZendiaAgents.conversationFor(browser);
    if (conversation) {
      this.#follow(conversation);
      this.#schedule(browser);
    }
    // Without a conversation the CAPTCHA rests until one starts.
  }

  // Whether a state clears the CAPTCHA: solved, or none with nothing on
  // the page that asks. A frame still loading reads as none for a moment
  // (an empty checkbox frame, a widget mid-render); while the page still
  // shows a CAPTCHA's frame, widget or challenge, that none is no pass.
  #cleared(state, record) {
    if (state == "solved") {
      return true;
    }
    return state == "none" && !asksOnPage(record);
  }

  // The ends of the agent's turns: one that ends while a CAPTCHA holds its
  // tab up stopped on it, and is told to carry on once it clears; one that
  // starts is the agent at work again. Each end lets the subagent run.
  #follow(conversation) {
    if (this.#followed.has(conversation)) {
      return;
    }
    this.#followed.add(conversation);
    let running = conversation.running;
    conversation.subscribe(() => {
      if (conversation.running == running) {
        return;
      }
      running = conversation.running;
      if (this.#side.has(conversation)) {
        return;
      }
      if (running) {
        for (const tab of conversation.tabs) {
          this.#held.delete(tab);
        }
        return;
      }
      const browser = conversation.browser;
      const last = this.#states.get(browser);
      if (
        last &&
        (ZendiaCaptcha.holdsUp(last.state) ||
          !this.#cleared(last.state, last.record))
      ) {
        say("the agent's turn ended on the CAPTCHA");
        this.#held.add(browser);
      }
      for (const tab of conversation.tabs) {
        if (this.#states.has(tab)) {
          this.#schedule(tab);
        }
      }
    });
  }

  /**
   * The button's way to run the subagent on a tab: the CAPTCHA the watch
   * has for it is shot now, whether the agent worked the tab before or
   * not, and whether it was shot before or not.
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
    this.#follow(conversation);
    this.#states.set(browser, {
      state: record.state ?? "none",
      how: record.how ?? null,
      record,
    });
    this.#rounds.set(browser, { shot: false, cleared: false, record });
    this.#schedule(browser, { force: true });
    return true;
  }

  // Run the subagent on a tab, one step at a time; what changes while a
  // step runs is looked at once it is done.
  #schedule(browser, { force = false } = {}) {
    if (force) {
      this.#forced.add(browser);
    }
    if (this.#working.has(browser)) {
      this.#again.add(browser);
      return;
    }
    this.#working.add(browser);
    (async () => {
      try {
        do {
          this.#again.delete(browser);
          await this.#step(browser);
        } while (this.#again.has(browser) && browser.isConnected);
      } finally {
        this.#working.delete(browser);
      }
    })().catch(e => console.error("Zendia: CAPTCHA subagent failed", e));
  }

  // What the subagent does for a tab now, always after the agent: a
  // running turn is waited out, and a tab the agent never worked on waits
  // for its first turn — a page that is only opened stays quiet. Then a
  // CAPTCHA that still asks, read live, is shot (once a round); and an
  // agent that stopped on it is told to carry on once it is cleared.
  async #step(browser) {
    const conversation = ZendiaAgents.conversationFor(browser);
    if (!conversation || !browser.isConnected) {
      return;
    }
    const forced = this.#forced.has(browser);
    if (!forced && !this.#worked(conversation)) {
      // The end of the first turn schedules the tab again (#follow).
      return;
    }
    if (!(await this.#idle(conversation, browser))) {
      return;
    }
    const round = this.#rounds.get(browser);
    if (round && !round.shot && !round.cleared) {
      // The watch's last word can be a moment old, and a check still
      // running is given its time.
      const live = await this.#settledState(browser);
      say(`live: ${live.state} (${live.how ?? "-"})`);
      const asks =
        ZendiaCaptcha.asksUser(live.state) ||
        (forced && !ZendiaCaptcha.isCleared(live.state));
      if (
        asks &&
        !forced &&
        this.#shotOn.get(browser) == pageOf(browser) &&
        !this.#held.has(browser) &&
        !this.#inFront(browser)
      ) {
        // Asks again on a page shot before, in a tab in the background
        // that nothing waits on: left for the user, not pulled forward.
        round.shot = true;
        say("asks again in the background: left for the user");
      } else if (asks) {
        round.shot = true;
        this.#forced.delete(browser);
        this.#shotOn.set(browser, pageOf(browser));
        await this.#deliver(browser, conversation, round.record, live);
      } else if (
        live.state == "solved" ||
        (forced && ZendiaCaptcha.isCleared(live.state))
      ) {
        round.cleared = true;
        if (forced) {
          this.#forced.delete(browser);
          conversation.note(
            `The CAPTCHA on this tab is solved (${live.how ?? "it is gone"}): nothing to do.`
          );
        }
      }
      // Still checking on its own: the watch says when it is done.
    }
    if (!this.#held.has(browser)) {
      return;
    }
    if (!(await this.#idle(conversation, browser))) {
      return;
    }
    const live = await this.#liveState(browser);
    // A turn of the user's ran meanwhile (the flag went with it), or the
    // CAPTCHA asks still: the watch says when it clears. Gone counts once
    // it stayed gone, which the round says (#onState).
    const latest = this.#rounds.get(browser);
    const gone =
      this.#cleared(live.state, this.#states.get(browser)?.record) &&
      (!latest || latest.cleared);
    if (!this.#held.has(browser) || !(live.state == "solved" || gone)) {
      return;
    }
    this.#held.delete(browser);
    await this.#carryOn(browser, conversation, live);
  }

  // Where the tab's CAPTCHA is at, asked of every frame now and merged:
  // the state that asks most of the user wins. What the watch last said
  // when no frame answers in time.
  async #liveState(browser) {
    let best = null;
    await this.#eachFrame(browser, "Zendia:CaptchaWatch:State", null, answer => {
      if (
        answer?.state &&
        ZendiaCaptcha.STATES.includes(answer.state) &&
        (!best ||
          (answer.state != best.state &&
            ZendiaCaptcha.stronger(best.state, answer.state) == answer.state))
      ) {
        best = { state: answer.state, how: answer.how ?? null };
      }
      return false;
    });
    const known = this.#states.get(browser);
    if (!best) {
      return known ?? { state: "none", how: null };
    }
    // The page's word now is newer than the watch's last: what is acted on
    // (a report back) is not undone by a report the frames sent before it.
    this.#states.set(browser, { ...best, record: known?.record ?? null });
    return best;
  }

  // The live state once a check that runs on its own is done, or its time
  // is up.
  async #settledState(browser) {
    const until = Date.now() + CHECKING_WAIT_MS;
    let live = await this.#liveState(browser);
    while (
      live.state == "checking" &&
      Date.now() < until &&
      browser.isConnected
    ) {
      await new Promise(resolve => setTimeout(resolve, CHALLENGE_POLL_MS));
      live = await this.#liveState(browser);
    }
    return live;
  }

  // One shot of a CAPTCHA that asks: the tab in front for it, its picture
  // and the finding's line in the chat, and a turn of the agent that tells
  // the user how to complete it. Unless the click on its checkbox passed
  // it: the chat says so, and an agent it stopped carries on.
  async #deliver(browser, conversation, record, live) {
    this.#delivering.add(browser);
    try {
      // To the front first: a background tab's browser has no size to
      // capture, and the user is handed the challenge anyway.
      this.#toFront(browser);
      const shot = await this.captureChallenge(browser).catch(() => null);
      if (shot?.state == "passed") {
        conversation.note(
          `The CAPTCHA on this tab passed once its checkbox was ticked: nothing for you to do.`
        );
        return;
      }
      await this.#guide(browser, conversation, record, live, shot);
    } finally {
      this.#delivering.delete(browser);
    }
  }

  // The shot in the chat and the agent's turn that tells the user how to
  // complete the challenge, a turn of the subagent's (#side): it is no work
  // on the user's request.
  async #guide(browser, conversation, record, live, shot) {
    const shown = await this.#showShot(browser, conversation, record, shot);
    // The picture goes to the agent too, at its full size whatever the
    // panel took: the cropped challenge, sharper than a shot of the whole
    // tab, is what it should read. Not to a model known to be blind to
    // pictures: it reads the page instead.
    const inputs = ZendiaAgents.inputsOf?.(conversation.agent?.id);
    const sees = !inputs || inputs.includes("image");
    const picture = sees ? (shot ?? shown) : null;
    const parts = picture?.parts?.area ? picture.parts : null;
    const said = shot?.parts?.instruction?.text ?? null;
    const prompt = this.#prompt(record, picture, parts, said, {
      labeled: shot?.labeled || false,
      state: shot?.state ?? null,
      live,
      held: this.#held.has(browser),
    });
    let files = [];
    if (parts) {
      files = [{ name: "captcha-challenge-area.jpg", bytes: parts.area.bytes }];
      // The instruction's words are in the request; its picture goes too
      // only where it shows what words cannot: an example to match, icons
      // to click in order.
      if (parts.instruction?.shot && parts.instruction.pictures) {
        files.push({
          name: "captcha-instruction-example.jpg",
          bytes: parts.instruction.shot.bytes,
        });
      }
    } else if (picture) {
      files = [{ name: "captcha-challenge.jpg", bytes: picture.bytes }];
    }
    const echo = `CAPTCHA on this tab: ${record.text}${live?.how ? ` (${live.how})` : ""}.${said ? ` It asks: "${said}"` : ""} You complete the challenge; the assistant tells you how.`;
    await this.#sendSide(conversation, browser, prompt, files, echo);
  }

  // A request of the subagent's, sent as a turn of the agent's once it is
  // idle; a request of the user's that went first is waited out.
  async #sendSide(conversation, browser, prompt, files, echo) {
    this.#side.add(conversation);
    try {
      for (let tries = 0; tries < SEND_TRIES; tries++) {
        const before = conversation.messages.length;
        await conversation.send(prompt, files, { echo });
        if (conversation.messages.length > before) {
          return true;
        }
        if (!(await this.#idle(conversation, browser))) {
          return false;
        }
      }
      return false;
    } finally {
      this.#side.delete(conversation);
    }
  }

  // The report back: the CAPTCHA that stopped the agent is cleared, and it
  // carries on with the user's request. A turn of its work, not a side
  // one: should it stop on a CAPTCHA again, the round goes on from there.
  async #carryOn(browser, conversation, live) {
    const request = conversation.messages.findLast(
      message => message.type == "user"
    )?.text;
    // A conversation reset since: no request is left to carry on.
    if (!request) {
      return;
    }
    const how =
      live.how ?? (live.state == "none" ? "it is gone from the page" : "it passed");
    const title = browser.contentTitle || browser.currentURI?.spec || "";
    const prompt = [
      `The browser's CAPTCHA assistant reports back: the CAPTCHA that stopped you on the tab "${title}" (${browser.currentURI?.spec}) is cleared now: ${how}.`,
      `The request you were working on, in the user's words: "${request}"`,
      `Observe the tab again and carry on with that request from where the CAPTCHA stopped you, by the same rules as before. If it is already done, say so in one sentence and do nothing more. Should a CAPTCHA stop you again, say so in one sentence and end your turn: the assistant shows it to the user and reports back once it is cleared.`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const echo = `CAPTCHA cleared (${how}). The agent carries on with your request.`;
    say(`carry on: ${how}`);
    // Sent only if the agent is idle: a request of the user's that went
    // first is the agent at work again, with nothing left to carry on.
    await conversation.send(prompt, [], { echo });
  }

  // Once the agent is done with the tab: a turn of the user's or one of
  // this subagent's. False when the tab went away first.
  async #idle(conversation, browser) {
    while (browser.isConnected && conversation.running) {
      await new Promise(resolve => {
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
   * shot, cut to the challenge where a frame of the tab says where it is,
   * and cut again into the area to act on and its instruction.
   * The tab must be in front: a background tab has nothing drawn.
   *
   * @param {Element} browser
   * @param {number} [maxWidth]
   * @returns {Promise<{data: string, bytes: Uint8Array, width: number,
   *   height: number, cropped: boolean, parts: object|null}|null>} The
   *   JPEG, as base64 and as bytes, and its size; with its parts where the
   *   challenge has pictures: the area to act on, shot alone, and the
   *   instruction, its words and its shot. Null when the tab has nothing
   *   to shoot.
   */
  async captureChallenge(browser, maxWidth = SHOT_MAX_WIDTH) {
    const state = await this.#prepareChallenge(browser);
    // Only a challenge that is there to act on is labeled for the keys: an
    // invisible pass or a finished check has nothing to label, and one
    // that never came (a frame still blank when the wait ran out) would be
    // labeled empty. Anything else is labeled first, so the shot shows the
    // labels the user finishes by.
    const labeled =
      ["open", "settled", "clicked"].includes(state) &&
      (await this.#labelChallenge(browser));
    const shot = await this.#screenshot(browser, maxWidth, !!labeled);
    if (shot) {
      shot.labeled = labeled;
      shot.state = state;
    }
    if (shot?.area) {
      shot.parts = await this.#shootParts(
        browser,
        shot.area,
        maxWidth,
        !!labeled
      ).catch(e => {
        console.error("Zendia: CAPTCHA subagent could not cut the parts", e);
        return null;
      });
    }
    return shot;
  }

  // The screenshot of the challenge as a page in the chat: the picture
  // says what the text of a finding cannot. Where the challenge came apart,
  // its instruction in words above the area to act on, shot alone: the
  // instruction is read, not shown again. A page too big for the panel is
  // the whole challenge again, retaken smaller. The shot shown, or null.
  async #showShot(browser, conversation, record, shot) {
    const parts = shot?.parts;
    if (parts?.area) {
      const said = parts.instruction;
      const tall = picture =>
        Math.round((picture.height * PANEL_WIDTH) / picture.width);
      try {
        conversation.showPage(
          pageFromArgs({
            title: `CAPTCHA: ${record.text.slice(0, 80)}`,
            height:
              tall(parts.area) +
              (said?.text ? 28 * Math.ceil(said.text.length / 40) : 0) +
              44,
            css: "figure { margin: 0; } img { display: block; width: 100%; border: 0.5px solid var(--color-border-tertiary); border-radius: 8px; } .ask { margin: 0 0 8px; font-weight: 600; } figcaption { margin-top: 6px; }",
            html: `<figure>${said?.text ? `<p class="ask">${escapeHtml(said.text)}</p>` : ""}<img src="data:image/jpeg;base64,${parts.area.data}" alt="The part of the challenge to act on"><figcaption>${escapeHtml(record.text)}</figcaption></figure>`,
          })
        );
        return shot;
      } catch {
        // Over 512 KB: the whole challenge, smaller, below.
      }
    }
    for (const maxWidth of [SHOT_MAX_WIDTH, SHOT_FALLBACK_WIDTH]) {
      if (maxWidth != SHOT_MAX_WIDTH) {
        shot = await this.#screenshot(browser, maxWidth, !!shot?.labeled).catch(
          () => null
        );
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
          })
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
        all.findIndex(other => other.id == context.id) == index
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
  //
  // @returns {Promise<string>} How the wait ended: "open", "settled" or
  //   "clicked" — the challenge is there to act on; "passed" — the check
  //   went by itself, nothing to act on; "failed" — a managed check failed
  //   or expired, to be tried again; "timeout" — it never said.
  async #prepareChallenge(browser) {
    const top = browser.browsingContext;
    if (!top) {
      return "timeout";
    }
    this.#lastFrame.delete(browser);
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
            .map(value => Math.round(value))
            .join()
        : null;
      const still = !!place && place == last;
      last = place;
      say(
        `poll: challenge=${!!area?.challenge} size=${area ? `${Math.round(area.fullWidth)}x${Math.round(area.fullHeight)}` : "-"} open=${open} drawn=${drawn} still=${still} left=${deadline - Date.now()}ms`
      );
      if (open && drawn) {
        return "open";
      }
      const peek = await this.#peek(browser);
      if (peek.passed) {
        say("an invisible pass: nothing to show");
        return "passed";
      }
      if (peek.failed) {
        say("the check failed or expired: shot as it is");
        return "failed";
      }
      checkbox ||= peek.checkbox;
      // A challenge frame still opening is waited on; anything else that
      // is drawn and holds still is what there is to shoot.
      const settled =
        area && !open && !(area.challenge && area.frame) && drawn && still;
      if (settled && !checkbox) {
        say("nothing to open: the challenge is shot as it is");
        return "settled";
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
        return "clicked";
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
        context => !clicked.has(context.id)
      );
      await new Promise(resolve => setTimeout(resolve, CHALLENGE_POLL_MS));
    }
    return "timeout";
  }

  // The challenge labeled for the keys, as `gc` labels it: only the
  // CAPTCHA's controls take labels, they stay while it is solved, and the
  // keys of every challenge (Enter, Tab, Ctrl with a letter, `.` for the
  // cursor) work from the first key, so the shot shows the labels the
  // guide names and the user finishes by typing them. What has nothing to
  // label (a canvas) gets the cursor's grid instead, and a challenge the
  // jump cannot find (the watch saw it where the jump does not look) the
  // page's labels, as `s` draws them. The labels are drawn in the top page;
  // the shot is taken there when this returns what was labeled: "captcha",
  // "cursor" or "page". False when the keys are not running (the jump
  // plugin off, the pref off): the shot is taken as before.
  async #labelChallenge(browser) {
    if (!Services.prefs.getBoolPref(PREF_LABELS, true)) {
      return false;
    }
    const zendia = ZendiaAgents.zendia;
    if (!zendia || !browser.isConnected) {
      return false;
    }
    let labeled;
    try {
      labeled = await zendia.run("jump.captcha", { orPage: true }, { browser });
    } catch (e) {
      say(`labels failed: ${e}`);
      return false;
    }
    // A page that answers nothing labeled the CAPTCHA, as before it said.
    labeled = ["captcha", "cursor", "page"].includes(labeled)
      ? labeled
      : "captcha";
    say(`labeled: ${labeled}`);
    // The labels are in the page once the action returns; this covers the
    // paint before the shot.
    await new Promise(resolve => setTimeout(resolve, LABELS_SETTLE_MS));
    return browser.isConnected && labeled;
  }

  // Ask the tab's frames one after another, those `only` lets through,
  // until `stop` says so of an answer. A frame that does not answer in
  // time, navigates or has no actor is passed over.
  async #eachFrame(browser, name, data, stop, only = () => true) {
    const top = browser.browsingContext;
    if (!top) {
      return;
    }
    const timeout = new Promise(resolve =>
      setTimeout(resolve, RECT_TIMEOUT_MS)
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
    const result = { passed: false, failed: false, checkbox: false };
    await this.#eachFrame(
      browser,
      "Zendia:CaptchaWatch:Open",
      { peek: true },
      answer => {
        result.checkbox ||= !!answer?.checkbox;
        // A managed check that failed or expired comes to nothing more
        // either: shot as it is, for the user to try it again.
        result.failed ||= !!answer?.done;
        result.passed ||= !!answer?.passed;
        return result.passed || result.failed;
      }
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
    // A frame whose box still fades in is not drawn, however ready it is.
    if (area.arriving) {
      return false;
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
        new Promise(resolve => setTimeout(resolve, RECT_TIMEOUT_MS)),
      ]);
      return !!answer?.drawn;
    } catch {
      return false;
    }
  }

  // Where the challenge is and in which frame of the tab, so the shot is
  // of it rather than the whole page; asking scrolls it into view, unless
  // `stay` asks it not to: the jump labels are drawn already, and a
  // scroll would move them off what they name. Every frame is asked: a
  // CAPTCHA may sit in a sub-frame the top page cannot see into. The
  // frame that asks for clicks wins over a service's plainer frame, a
  // frame over a page's widget, a widget over a challenge the page draws
  // itself; and what a page shows of a CAPTCHA's frame over what that
  // frame shows inside it. Of the same rank, the bigger. Null when no
  // frame answers in time.
  async #challengeRect(browser, stay = false) {
    const top = browser.browsingContext;
    if (!top) {
      return null;
    }
    const contexts = this.#contextsOf(top);
    const timeout = new Promise(resolve =>
      setTimeout(resolve, RECT_TIMEOUT_MS)
    );
    const answers = await Promise.all(
      contexts.map(async context => {
        try {
          const rect = await Promise.race([
            context.currentWindowGlobal
              .getActor("ZendiaCaptchaWatch")
              .sendQuery("Zendia:CaptchaWatch:Rect", { stay }),
            timeout,
          ]);
          return rect && { context, ...rect };
        } catch {
          // The frame is navigating, or has no actor yet.
          return null;
        }
      })
    );
    const rank = answer => {
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
    const size = answer =>
      (answer.fullWidth ?? answer.width) * (answer.fullHeight ?? answer.height);
    const found = answers
      .filter(Boolean)
      .sort((a, b) => rank(a) - rank(b) || size(b) - size(a));
    const picked = found[0] ?? null;
    say(
      `rect answers: ${JSON.stringify(
        found.map(({ context, ...rect }) => ({ context: context.id, ...rect }))
      )} -> ${picked ? JSON.stringify({ context: picked.context.id, challenge: picked.challenge }) : "none"}`
    );
    return picked;
  }

  // What the tab shows, canvases and frames included, after
  // ZendiaAgentTools' #screenshot, with the picture's size kept. When a
  // frame of the tab says where the challenge is, only it, with a little
  // room around, taken from that frame's own global. Labeled, the labels
  // are drawn in the top page: the shot is taken from the top global
  // instead, of the challenge's rect moved up the frames to it, and the
  // page is not scrolled again — the labels would move off what they
  // name.
  async #screenshot(browser, maxWidth, labeled = false) {
    const window = this.#windowFor(browser);
    if (!window || !browser.isConnected) {
      return null;
    }
    // A freshly selected tab is drawn first.
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    let global = browser.browsingContext?.currentWindowGlobal;
    if (!global) {
      return null;
    }
    let viewWidth;
    let viewHeight;
    let rect = null;
    const area = await this.#challengeRect(browser, labeled);
    if (area && labeled) {
      const moved = await this.#inTopDocument(
        window,
        area.context,
        area,
        area,
        SHOT_PADDING
      );
      if (moved) {
        rect = moved.rect;
        ({ viewWidth, viewHeight } = moved);
      } else {
        // A frame on the way up did not answer: the labels are in the top
        // page, so the whole view is the next best shot of them.
        ({ width: viewWidth, height: viewHeight } =
          browser.getBoundingClientRect());
      }
    } else if (area) {
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
      rect = this.#inDocument(window, area, area, SHOT_PADDING);
    } else if (
      !labeled &&
      this.#lastFrame.get(browser)?.context.currentWindowGlobal
    ) {
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
        viewHeight
      );
    } else {
      ({ width: viewWidth, height: viewHeight } =
        browser.getBoundingClientRect());
    }
    if (!viewWidth || !viewHeight) {
      return null;
    }
    say(
      `shot: rect=${rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : "full page"} view=${Math.round(viewWidth)}x${Math.round(viewHeight)}`
    );
    const scale = rect
      ? this.#scaleFor(window, rect, maxWidth)
      : Math.min(window.devicePixelRatio, maxWidth / viewWidth);
    const shot = await this.#encode(window, global, rect, scale);
    return shot && { ...shot, cropped: !!rect, area };
  }

  // A part of a frame drawn as a JPEG, as base64 and as bytes, with its
  // size. drawSnapshot reads the frame's document coordinates.
  async #encode(window, global, rect, scale) {
    const image = await global.drawSnapshot(rect, scale, "white");
    // Handing the bitmap to the canvas empties it.
    const { width, height } = image;
    const canvas = new window.OffscreenCanvas(width, height);
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
    return { data: window.btoa(binary), bytes, width, height };
  }

  // The scale a part is drawn at: bigger than the screen has a small one,
  // so its words stay readable to the agent; none wider than maxWidth,
  // nor taller than SHOT_MAX_HEIGHT.
  #scaleFor(window, rect, maxWidth) {
    return Math.min(
      Math.max(window.devicePixelRatio, SHOT_MIN_SCALE),
      maxWidth / rect.width,
      SHOT_MAX_HEIGHT / rect.height
    );
  }

  // A rect of a frame's viewport, with room around, in the frame's
  // document coordinates and inside its view; null when nothing is left.
  #inDocument(window, rect, view, padding) {
    const scrollX = view.scrollX ?? 0;
    const scrollY = view.scrollY ?? 0;
    const left = Math.max(scrollX, rect.left + scrollX - padding);
    const top = Math.max(scrollY, rect.top + scrollY - padding);
    const right = Math.min(
      scrollX + view.viewWidth,
      rect.left + scrollX + rect.width + padding
    );
    const bottom = Math.min(
      scrollY + view.viewHeight,
      rect.top + scrollY + rect.height + padding
    );
    return right > left && bottom > top
      ? new window.DOMRect(left, top, right - left, bottom - top)
      : null;
  }

  // A rect of a frame moved up the frames to the top page, where the jump
  // labels are drawn: each frame above answers where the one below sits in
  // it (its embedder's box and border), to the top, whose scroll and view
  // the document coordinates and the shot's bounds come from. `view` is
  // the rect's own window's scroll and view, for when it is the top's
  // already. Null when a frame on the way answers nothing.
  async #inTopDocument(window, context, rect, view, padding) {
    let { left, top, width, height } = rect;
    while (context.parent) {
      let box = null;
      try {
        box = await Promise.race([
          context.parent.currentWindowGlobal
            ?.getActor("ZendiaCaptchaWatch")
            .sendQuery("Zendia:CaptchaWatch:Embedder", {
              childId: context.id,
            }),
          new Promise(resolve => setTimeout(resolve, RECT_TIMEOUT_MS)),
        ]);
      } catch {
        box = null;
      }
      if (!box) {
        return null;
      }
      // A frame drawn scaled shows its document at that scale, and what of
      // it is outside the frame's box is not shown at all.
      const scaleX = box.scaleX ?? 1;
      const scaleY = box.scaleY ?? 1;
      left = box.left + (box.clientLeft + left) * scaleX;
      top = box.top + (box.clientTop + top) * scaleY;
      width *= scaleX;
      height *= scaleY;
      if (box.width && box.height) {
        const right = Math.min(left + width, box.left + box.width);
        const bottom = Math.min(top + height, box.top + box.height);
        left = Math.max(left, box.left);
        top = Math.max(top, box.top);
        width = right - left;
        height = bottom - top;
        if (width <= 0 || height <= 0) {
          return null;
        }
      }
      view = box;
      context = context.parent;
    }
    const moved = this.#inDocument(
      window,
      { left, top, width, height },
      view,
      padding
    );
    return (
      moved && {
        rect: moved,
        viewWidth: view.viewWidth,
        viewHeight: view.viewHeight,
      }
    );
  }

  // The challenge in its two parts, each drawn alone: the area to act on
  // (the grid, the puzzle) and its instruction, with the instruction's
  // words read from its text. Asked of the frame the challenge is drawn
  // in: a CAPTCHA's own frame, or the page that drew it. Labeled, the
  // area is shot from the top page instead, where the labels are drawn,
  // its rect moved up the frames; the frame's own shot is the fallback.
  // Null when the challenge has no pictures to tell them apart by (a
  // checkbox, a check running on its own).
  async #shootParts(browser, area, maxWidth, labeled = false) {
    const window = this.#windowFor(browser);
    const context =
      area.frame && area.frameId != null
        ? BrowsingContext.get(area.frameId)
        : area.context;
    const global = context?.currentWindowGlobal;
    const actor = global?.getActor("ZendiaCaptchaWatch");
    if (!window || !actor) {
      return null;
    }
    const ask = (name, data) =>
      Promise.race([
        actor.sendQuery(name, data),
        new Promise(resolve => setTimeout(resolve, RECT_TIMEOUT_MS)),
      ]).catch(() => null);
    // The parts are shot drawn: a CAPTCHA's own frame says so of all its
    // pictures, the example in its instruction too, which can come after
    // the grid. A page that drew it said so with the challenge's place.
    for (
      const until = Date.now() + PARTS_DRAW_MS;
      Date.now() < until;
      await new Promise(resolve => setTimeout(resolve, CHALLENGE_POLL_MS / 2))
    ) {
      const answer = await ask("Zendia:CaptchaWatch:Drawn", { any: true });
      if (!answer || answer.drawn) {
        break;
      }
    }
    let parts = await ask("Zendia:CaptchaWatch:Parts");
    // And holding still: two looks a moment apart find every picture in
    // the same place, so tiles a script slides in are not shot halfway.
    // A challenge still loading its task (a loader over it, its pieces
    // still coming) is waited out the same way.
    for (
      const until = Date.now() + PARTS_DRAW_MS;
      parts && Date.now() < until;
    ) {
      await new Promise(resolve => setTimeout(resolve, PARTS_STILL_MS));
      const again = await ask("Zendia:CaptchaWatch:Parts");
      if (!again || (again.still == parts.still && !again.loading)) {
        parts = again ?? parts;
        break;
      }
      parts = again;
    }
    let areaRect =
      parts?.area && this.#inDocument(window, parts.area, parts, 0);
    // Labeled, the area's shot is taken from the top page, where the
    // labels are drawn; a frame on the way up that answers nothing leaves
    // the frame's own shot.
    let areaGlobal = global;
    if (areaRect && labeled) {
      const moved = await this.#inTopDocument(
        window,
        context,
        parts.area,
        parts,
        0
      );
      if (moved) {
        areaRect = moved.rect;
        areaGlobal = browser.browsingContext?.currentWindowGlobal ?? global;
      }
    }
    if (!areaRect) {
      return null;
    }
    const shot = await this.#encode(
      window,
      areaGlobal,
      areaRect,
      this.#scaleFor(window, areaRect, maxWidth)
    );
    let instruction = null;
    if (parts.instruction?.text) {
      const rect =
        parts.instruction.rect &&
        this.#inDocument(window, parts.instruction.rect, parts, 0);
      instruction = {
        text: parts.instruction.text,
        pictures: parts.instruction.pictures ?? 0,
        shot: rect
          ? await this.#encode(
              window,
              global,
              rect,
              this.#scaleFor(window, rect, maxWidth)
            )
          : null,
      };
    }
    say(
      `parts: area=${Math.round(areaRect.width)}x${Math.round(areaRect.height)} instruction=${JSON.stringify(instruction?.text ?? null)}`
    );
    return { area: shot, instruction };
  }

  // Whether the tab is the one shown in its window.
  #inFront(browser) {
    return this.#windowFor(browser)?.gBrowser?.selectedBrowser == browser;
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

  // The key that labels a CAPTCHA, as the user's keymap has it: `gc` by
  // default, or what they moved it to; null when nothing does.
  #captchaKey() {
    const keymap = ZendiaAgents.zendia?.keymap;
    try {
      return (
        keymap?.list("n").find(mapping => mapping.rhs == "jump.captcha")?.lhs ??
        null
      );
    } catch {
      return null;
    }
  }

  // The turn the agent gets: look at the challenge, tell the user how to
  // complete it, step by step. With the pictures attached, that is where it
  // looks first: the area to act on and the instruction, each cut from the
  // page, sharper than a shot of the whole tab; or the whole challenge,
  // where it did not come apart. The instruction's words, read from the
  // page, go in the request. A labeled challenge is on the user's screen
  // with key labels on it: the steps are the keys they type, from the
  // reference of the jump and the cursor, and `labeled` says which are up
  // (#labelChallenge). Unlabeled, they are the mouse's. `state` is how
  // the wait for the challenge ended (#prepareChallenge): one that never
  // showed, or passed by itself, has no steps to give. `live` is what the
  // page said the CAPTCHA is at before it was opened, and `held` whether
  // it stopped the agent's work, which waits for the report back.
  #prompt(
    record,
    picture,
    parts,
    said,
    { labeled = false, state = null, live = null, held = false } = {}
  ) {
    let look = `1. Call page_screenshot to look at the challenge (page_observe if your model cannot see images).`;
    if (parts) {
      look = `1. Look at the attached pictures first, each cut from the page and drawn larger than on screen: captcha-challenge-area.jpg is only the part of the challenge to act on (its images, puzzle or distorted text)${parts.instruction?.shot && parts.instruction.pictures ? `; captcha-instruction-example.jpg is the instruction's own picture (an example to match, icons to click in order)` : ""}. Call page_screenshot only if you cannot view them or they do not show the challenge (page_observe if your model cannot see images).`;
    } else if (picture?.cropped) {
      look = `1. Look at the attached picture first: it is the challenge cut from the page, drawn larger than on screen. Call page_screenshot only if you cannot view the picture or it does not show the challenge (page_observe if your model cannot see images).`;
    }
    const key = this.#captchaKey();
    return [
      `You are the browser's CAPTCHA assistant. The watch layer found a CAPTCHA on the tab you work on: ${record.text}. Page: ${record.url}.${live?.how ? ` Read live from the page: ${live.how}.` : ""}`,
      held
        ? "It stopped your work on the user's request. Do not carry on with that request in this turn: once the CAPTCHA is cleared, you are told to carry on."
        : null,
      said
        ? `The challenge's instruction, read from its own text: "${said}" Quote it as it is; do not guess another.`
        : null,
      `The user has the tab in front of them and was just shown a screenshot of it in the panel. Where the challenge opens from a checkbox, it was clicked for them already, so the challenge is open and waiting. They complete it themselves, by hand: never click, fill, press or scroll the challenge, and never navigate the tab away. Your part is to tell them how.`,
      state == "passed"
        ? "The check went through by itself while it was being opened: there is likely nothing left for the user to do."
        : null,
      state == "failed"
        ? "The check failed or expired (the widget says so): give no steps to solve it. Say so in one sentence, and tell the user to try it again with the widget's own retry link, or by reloading the page if it has none."
        : null,
      state == "timeout"
        ? `The challenge had not shown when it was shot (it may still be loading, or open only once something on the page is clicked). If the picture shows none, say so in one sentence: it has not loaded yet${key ? `, and \`${key}\` labels it for the keys once it shows` : ""}. Give no steps for a challenge you cannot see.`
        : null,
      labeled
        ? `The challenge on their screen is labeled for the keys, and the labels are in the pictures. ${LABELED_NOW[labeled] ?? LABELED_NOW.captcha} These are the keys, exactly as they work; use no others:\n${keysReference(key)}`
        : null,
      !labeled && state != "passed" && state != "failed"
        ? `The challenge is not labeled for the keys: tell them where to click or drag with the mouse.${key ? ` In a last step, tell them \`${key}\` labels it so it can be done from the keyboard.` : ""}`
        : null,
      `Do exactly this:
${look}
2. Write one sentence: which service the challenge is from (or that the page draws it itself) and what it asks${said ? ", in the instruction's own words" : ""}.
3. Then a numbered list of the steps to complete this challenge, as it is on screen, at most six, one short line each, keys in backticks. Fit them to its kind (pick images, type characters, an audio challenge, slide a piece to a gap, rotate, click points in order, press and hold, a checkbox).${labeled ? ' Name a label only when you can read it in the picture (the slider\'s handle, the rotate button), and otherwise say which tag to type ("the tag on each tile that shows…").' : ""} End with how to submit it and what to do if it asks again or the challenge is too hard to read (a new challenge, the audio one).
4. Do not give the answer itself: not which tiles match, what the characters say, where the gap is or which way is upright. Say what to look for; the user decides.
If the check looks invisible, runs on its own (a progress bar, "Verifying"), or already passed, say that in one sentence instead, with no steps.`,
    ]
      .filter(Boolean)
      .join("\n\n");
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
