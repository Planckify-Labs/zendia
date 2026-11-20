// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The CAPTCHA subagent: it works on its own, and only after the agent.
// When the watch (ZendiaCaptchaWatch) finds a challenge on a tab, the
// finding waits for the agent's work there: a running turn is waited out,
// and a tab the agent never worked on is waited for its first turn — a
// page that is only opened stays quiet. Once the agent is done, the
// subagent opens the challenge from its checkbox where there is one,
// labels it for the keys, photographs it for the chat and for the agent,
// asks the agent for the steps that complete it (the keys to type, read
// off the labels in the picture), and brings the tab to the front so the
// user can follow them. Solving stays the user's part, as it is for the
// agent: the steps say what to look for, never the answer.
//
// The summary is a turn of the same agent the user talks to, with the same
// tools. The picture in the chat is the service's own, for a model cannot
// put the image a tool handed it back into a page it writes; the same
// picture is attached to the turn, cut to the challenge, and page_screenshot
// is the agent's way to look again.
//
// The turn that works the challenge is sealed off from where it came from.
// The boundary (ZendiaCaptchaBoundary) keeps the tab, the finding and the
// shot in a vault under a handle, and hands the turn a sterile task
// instead: the same pictures under neutral names, the same ask with no
// service in it, and no address, page text or kind of check anywhere. What
// comes back is how it ended, never what it was. The user's own view — the
// panel's line, the picture in the chat — names the challenge as it always
// did; only the subagent works blind. zendia.captcha.agent.isolate turns
// the boundary off; where a task cannot be sealed, nothing is sent at all,
// and the challenge stays the user's.

import {
  agentColor,
  ZendiaAgents,
} from "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs";
import { pageFromArgs } from "resource:///modules/zendia/agent/ZendiaAgentUi.sys.mjs";
import { getCaptchaBoundary } from "resource:///modules/zendia/captcha/ZendiaCaptchaBoundary.sys.mjs";
import { ZendiaCaptchaWatch } from "resource:///modules/zendia/captcha/ZendiaCaptchaWatch.sys.mjs";
import {
  STERILE_FILE_NAMES,
  sterileSaid,
  sterileSolvePrompt,
  sterileStatusPrompt,
} from "resource:///modules/zendia/captcha/ZendiaSterileChallenge.sys.mjs";
import { ZendiaCaptcha } from "resource:///modules/zendia/core/ZendiaCaptcha.sys.mjs";
import { ZendiaKeys } from "resource:///modules/zendia/core/ZendiaKeys.sys.mjs";
import { PREF_STEAL_FOCUS } from "resource:///modules/zendia/core/ZendiaShared.sys.mjs";

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
// zendia.captcha.agent.isolate: whether the subagent is handed a sterile
// task, with the page and its service left behind in the vault.
export const PREF_ISOLATE = "zendia.captcha.agent.isolate";

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
// How long the labels may take to be up again before a shot, and how many
// times a challenge is labeled before it is shot without them.
const LABELS_WAIT_MS = 1500;
const LABEL_TRIES = 2;
// How long the parts may wait for the last of their pictures to be drawn
// and to hold still, and how far apart the looks for the latter are.
const PARTS_DRAW_MS = 5000;
const PARTS_STILL_MS = 250;

// About how wide a page in the panel is, for the page's height guess.
const PANEL_WIDTH = 380;

// Set by `npm run dev:captcha`: the chat shows a card with the screenshot
// of the challenge and what was found of it. Otherwise there is no card,
// only the agent's text in the chat.
const ENV_DEBUG = "ZENDIA_CAPTCHA_DEBUG";

/**
 * @returns {boolean} Whether the CAPTCHA debugging views show: the card
 *   with the screenshot, what the challenge asks, the header's button.
 */
export function captchaDebug() {
  return !!Services.env.get(ENV_DEBUG);
}

// How long waiting for the agent goes on without news before the state is
// looked at again: a closed tab never sends news.
const IDLE_POLL_MS = 2000;

// How often a summary the user's own turn preempted is tried again.
const SEND_TRIES = 3;

// The pace of the keys the subagent presses when it works a challenge: a gap
// between keys for a pick to register and the labels to redraw, and a settle
// after the last before it looks again.
const KEY_GAP_MS = 90;
const KEY_SETTLE_MS = 500;

// How many times the subagent is sent back to the challenge before it is
// left for the user: each turn loops on its own, this covers a turn that
// stops early with the challenge still there, so a reload or a second
// challenge is worked too. A pause between turns lets a reload settle.
const SOLVE_ATTEMPTS = 3;
const RETRY_GAP_MS = 600;

// How many times the end of an agent's turn sends the subagent back to a
// challenge that still asks (unticked, expired, failed) with no news from
// the page in between. A turn the user typed starts the count again, and so
// does the challenge clearing, so a page the subagent cannot get through
// does not keep the agent and the subagent handing it back and forth.
const TURN_END_ROUNDS = 2;

// The named keys the subagent may press, to the tokens the keys take, so it
// can write them as the labels reference names them ("Enter", "Ctrl+R")
// rather than in vim notation. A label's letters and the cursor moves (h, H,
// ., ,) are already their own tokens and parse as they are.
const NAMED_KEY_TOKENS = {
  enter: "<CR>",
  return: "<CR>",
  cr: "<CR>",
  tab: "<Tab>",
  esc: "<Esc>",
  escape: "<Esc>",
  space: "<Space>",
  backspace: "<BS>",
  bs: "<BS>",
  delete: "<Del>",
  up: "<Up>",
  down: "<Down>",
  left: "<Left>",
  right: "<Right>",
  "ctrl+r": "<C-r>",
  "ctrl-r": "<C-r>",
  "ctrl+a": "<C-a>",
  "ctrl-a": "<C-a>",
  "ctrl+p": "<C-p>",
  "ctrl-p": "<C-p>",
};

// One item the subagent passed to type_keys to the tokens it stands for: a
// named key, or a run of label letters and moves parsed as they are written.
function keyTokensOf(item) {
  const text = String(item ?? "").trim();
  if (!text) {
    return [];
  }
  const named = NAMED_KEY_TOKENS[text.toLowerCase()];
  if (named) {
    return [named];
  }
  try {
    return ZendiaKeys.parse(text);
  } catch {
    return [];
  }
}

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
- \`Esc\`: leave the labels${key ? `; \`${key}\` labels the challenge again` : ""}.
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
- Slide a piece to a gap: type the handle's tag (the arrow or bright knob at the track's start) to grab it — the mouse is now held down. The handle does not have to be beside the picture; its track can sit below it. Then LOOK AGAIN: only now does a ruler of one-letter tags appear across the piece's row, one tag per stop. The ruler only gets the piece CLOSE, not exact: type the tag nearest the gap to drag the piece there, look again, and nudge one step at a time with \`h\`/\`l\` (\`H\`/\`L\` for bigger steps, a count like \`3l\` to repeat), looking again after each nudge, until the piece sits squarely inside the gap; then \`Space\` to drop it. Never guess a ruler tag before you have looked and seen it, and never let go until the piece lines up — a drop even a little off fails.
- Rotate: type the rotate button's tag until the picture is upright, then \`Enter\`.
- Click points or icons in order: \`.\`, then for each in turn a grid tag near it, \`h\`\`j\`\`k\`\`l\` onto it, \`Space\`; then \`Enter\`.
- Press and hold: type the button's tag, wait while it fills, then \`Space\` when it is done.
- A checkbox: type its tag.`;
}

// What a later look hands the subagent when the boundary is on: the same
// bytes under a neutral name, and the same ask with no service's name in it.
const STERILE_LOOK = Object.freeze({
  names: STERILE_FILE_NAMES,
  serviceNames: ZendiaCaptcha.NAMES,
});

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
  // The tabs whose challenge the user took over from the subagent (<Esc> on
  // its labels, or labels of their own): its work there ends, and it does
  // not label the challenge again over them.
  #dismissed = new WeakSet();
  // The conversations whose turn ends are followed.
  #followed = new WeakSet();
  // Per tab, how many turn ends sent the subagent back to the same
  // challenge (TURN_END_ROUNDS).
  #rounds = new WeakMap();

  init() {
    if (this.#initialized || !Services.prefs.getBoolPref(PREF_AGENT, true)) {
      return;
    }
    this.#initialized = true;
    Services.obs.addObserver(
      browser => this.#onDismissed(browser),
      "zendia-agent-capture-dismissed"
    );
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
      this.#followTurns(conversation);
      if (this.#pending.has(browser)) {
        this.#watchForTurn(browser, conversation);
      }
    });
  }

  // The user took the challenge over: the subagent's turn stops, nothing
  // more is labeled or pressed there, and the chat says whose it is now.
  #onDismissed(browser) {
    if (!this.#working.has(browser)) {
      return;
    }
    this.#dismissed.add(browser);
    this.#pending.delete(browser);
    const conversation = ZendiaAgents.conversationFor(browser);
    if (conversation?.running) {
      conversation.stop();
    }
    conversation?.note(
      "You took the verification challenge over; the agent left it to you."
    );
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

  // What of a finding the user must do something about: a frame, a widget
  // or a challenge the page draws itself that is shown. Script, token and
  // honeypot findings alone are invisible checks (a scored reCAPTCHA, a
  // sensor), and so are hidden frames (a closed challenge, an invisible
  // mode's helper); opening the tab for one would cry wolf.
  #asking(record) {
    return new Set(
      (record?.detections ?? [])
        .filter(
          ({ signal, hidden }) =>
            (signal == "frame" || signal == "widget" || signal == "own") &&
            !hidden
        )
        .map(
          ({ signal, name, kind }) => `${signal}:${name ?? ""}:${kind ?? ""}`
        )
    );
  }

  // A finding that asks is worked once. What was worked on this page
  // already is not again while it stays the same challenge: shown and
  // hidden, or opened from its checkbox. Once it passes, or nothing of it
  // asks any more (the page took it down, moved on to a screen without it),
  // that challenge is over, and the next ask on the same page (an expiry, a
  // form shown again) is a new one, worked live.
  #onDetect(browser, record) {
    const asking = this.#asking(record);
    if (record.state == "solved" || !asking.size) {
      this.#delivered.delete(browser);
      this.#rounds.delete(browser);
      return;
    }
    if (!browser.isConnected) {
      return;
    }
    let delivered = this.#delivered.get(browser);
    if (delivered?.url != record.url) {
      delivered = { url: record.url, keys: new Set() };
      this.#delivered.set(browser, delivered);
    }
    const fresh = [...asking].filter(key => !delivered.keys.has(key));
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
          // A finding that waited on other work may be over by now: passed,
          // or taken down. The button works whatever the watch has.
          const now = ZendiaCaptchaWatch.lastFor(browser);
          if (
            !force &&
            (!now || now.state == "solved" || !this.#asking(now).size)
          ) {
            say("the finding cleared while it waited");
            continue;
          }
          await this.#deliver(browser, record, force);
        }
      } finally {
        this.#working.delete(browser);
      }
    })().catch(e => console.error("Zendia: CAPTCHA subagent failed", e));
  }

  // The ends of the agent's own turns. A challenge that still asks once
  // one ends (the subagent gave it up, its answer expired with no state
  // change the watch could tell, or it was met while the subagent was busy)
  // is worked again, as the agent cannot get through it itself.
  #followTurns(conversation) {
    if (this.#followed.has(conversation)) {
      return;
    }
    this.#followed.add(conversation);
    let running = conversation.running;
    const off = conversation.subscribe(() => {
      if (conversation.discarded) {
        off();
        return;
      }
      if (conversation.running == running) {
        return;
      }
      running = conversation.running;
      if (!running) {
        this.#afterTurn(conversation);
      }
    });
  }

  #afterTurn(conversation) {
    const turn = conversation.lastTurn;
    const browser = conversation.browser;
    // The subagent's own isolated turns are its work, not the agent's.
    if (
      !turn ||
      turn.isolated ||
      turn.error ||
      conversation.stoppedByUser ||
      !browser?.isConnected ||
      !this.#current(browser, conversation)
    ) {
      return;
    }
    // Already on it, or about to be: a finding that came during the turn
    // waits on the turn's end in #deliver.
    if (
      this.#working.has(browser) ||
      this.#pending.has(browser) ||
      this.#opening.has(browser)
    ) {
      return;
    }
    if (turn.byUser) {
      this.#rounds.delete(browser);
    } else if (this.#dismissed.has(browser)) {
      // The user took this challenge over: only their own request sends
      // the subagent back to it.
      return;
    }
    const record = ZendiaCaptchaWatch.lastFor(browser);
    if (
      !record ||
      !ZendiaCaptcha.asksUser(record.state) ||
      !this.#asking(record).size
    ) {
      return;
    }
    const rounds = this.#rounds.get(browser) ?? 0;
    if (rounds >= TURN_END_ROUNDS) {
      say(`still ${record.state} after the agent's turn, left to the user`);
      return;
    }
    this.#rounds.set(browser, rounds + 1);
    say(`still ${record.state} after the agent's turn: working it again`);
    this.#pending.set(browser, record);
    this.#pump(browser);
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

  // The subagent's work on a tab: the tab in front for the challenge, its
  // picture in the chat, and a solve turn sent back to it until it is gone
  // or it has had its tries. Forced (the button), the worked gate is skipped.
  async #deliver(browser, record, force = false) {
    this.#dismissed.delete(browser);
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
    // To the front when the user is there to follow it; otherwise the
    // challenge is worked in the background, its labels in the agent's own
    // color, and only what cannot even be photographed there waits for the
    // user to bring the tab forward themselves.
    const inFront = this.#toFront(browser);
    const color = agentColor(conversation.agent?.id);
    // Not to a model known to be blind to pictures: it cannot work a visual
    // task, and only says so.
    const inputs = ZendiaAgents.inputsOf?.(conversation.agent?.id);
    const sees = !inputs || inputs.includes("image");
    const isolate = Services.prefs.getBoolPref(PREF_ISOLATE, true);
    const sterile = isolate ? STERILE_LOOK : null;
    // The chat keeps one message of the subagent's, its latest words, over
    // every pass; under ZENDIA_CAPTCHA_DEBUG each of its words and steps.
    const answer = captchaDebug() ? null : { message: null };
    for (
      let attempt = 0;
      attempt < SOLVE_ATTEMPTS && browser.isConnected;
      attempt++
    ) {
      // A new chat started over this one, or the user took the challenge
      // over: the work here ends with it, and nothing more is sent.
      if (
        !this.#current(browser, conversation) ||
        this.#dismissed.has(browser)
      ) {
        this.#endCapture(browser);
        return;
      }
      const shot = await this.captureChallenge(
        browser,
        SHOT_MAX_WIDTH,
        color
      ).catch(() => null);
      // In a tab that was never shown, some widgets (hCaptcha's) do not
      // even load: there is no shot, or the challenge never came. It waits
      // for the user's own switch, never for a stolen one.
      if ((!shot || shot.state == "timeout") && !inFront && attempt == 0) {
        conversation.note(
          "A verification challenge on this tab does not load while the tab is in the background. Switch to the tab yourself to load it, or let agents bring tabs forward (zendia.agent.stealFocus)."
        );
        this.#endCapture(browser);
        return;
      }
      const picture = sees ? shot : null;
      const parts = picture?.parts?.area ? picture.parts : null;
      const said = shot?.parts?.instruction?.text ?? null;
      // The picture in the chat, the first time only; after that the labels
      // on the user's screen update live. This is the user's own view of the
      // challenge, where it is named: only the subagent works blind.
      if (attempt == 0) {
        await this.#showShot(browser, conversation, record, shot);
      }
      // With the boundary on, this pass is a dispatch of its own: what the
      // subagent gets is the sterile task, and nothing else is to be had.
      const dispatch = isolate
        ? this.#dispatch(browser, record, shot, sees)
        : null;
      // Fail safe, not fail open: with no sterile task there is nothing to
      // send, and the page is never sent in its place. The user keeps the
      // challenge and the picture of it in the chat, which is where they
      // were anyway.
      if (isolate && !dispatch) {
        this.#endCapture(browser);
        return;
      }
      const handle = dispatch?.handle ?? null;
      const task = dispatch?.task ?? null;
      // The subagent works the challenge itself when it is under the keys:
      // its controls are labeled ("captcha") or the cursor is on it
      // ("cursor"), there is an area to act on, and it is there to act on.
      const canAct =
        sees &&
        !!parts &&
        (shot?.labeled == "captcha" || shot?.labeled == "cursor") &&
        ["open", "settled", "clicked"].includes(shot?.state);
      // A later pass that finds nothing to act on: the challenge is solved
      // and gone, so there is nothing left to do or say. The agent that was
      // working the tab is sent back to its task, unless this was the test
      // button (force) or the user stopped by hand.
      if (!canAct && attempt > 0) {
        this.#endCapture(browser);
        // Nothing left to act on is the work done, as far as the boundary
        // ever hears of it.
        this.#settle(handle, "ok");
        if (
          !force &&
          !conversation.stoppedByUser &&
          this.#current(browser, conversation)
        ) {
          this.#handBack(conversation);
        }
        return;
      }
      const files = this.#filesFor(task, parts, picture);
      // Whether this turn actually moved the challenge: a key or text that
      // took. A turn that only looked and gave up (no field to type in, an
      // audio it cannot do) made no progress, and is not sent back in.
      let progressed = false;
      const act = canAct
        ? {
            type: async keys => {
              const result = await this.#typeKeys(browser, keys);
              progressed ||= result.ok;
              return result;
            },
            text: async text => {
              const result = await this.#typeText(browser, text);
              progressed ||= result.ok;
              return result;
            },
            look: () => this.#relook(browser, sterile),
          }
        : null;
      const prompt = this.#promptFor({
        task,
        act,
        said,
        shot,
        pictureName: files[0]?.name ?? null,
        sees,
      });
      // What the panel says of the request: nothing, but under
      // ZENDIA_CAPTCHA_DEBUG, where it says what the challenge asks.
      let echo = false;
      if (captchaDebug()) {
        echo = "Still working on it…";
        if (attempt == 0) {
          echo = said
            ? `Challenge: "${said}"`
            : "A verification challenge needs your attention.";
        }
      }
      let ran = false;
      try {
        ran = await this.#sendSolve(conversation, browser, prompt, files, {
          echo,
          act,
          answer,
        });
      } finally {
        // The labels come off once the turn is over, so the next pass labels
        // afresh and the user is not left with stale ones.
        if (act) {
          this.#endCapture(browser);
        }
      }
      // Go round again only to carry on work that is actually moving: not
      // after a one-off status turn, a turn that never ran, a turn that made
      // no progress (it gave up), or one the user stopped by hand. Whichever
      // way this pass ends, its dispatch is settled here and nowhere else.
      if (!ran) {
        this.#settle(handle, "fail");
        return;
      }
      if (!act || !progressed) {
        // A status turn, or one that gave up: the challenge is the user's
        // now, and the boundary hears that and no more.
        this.#settle(handle, "escalate");
        return;
      }
      if (conversation.stoppedByUser) {
        this.#settle(handle, "fail");
        return;
      }
      this.#settle(handle, "ok");
      await new Promise(resolve => setTimeout(resolve, RETRY_GAP_MS));
    }
  }

  // One dispatch: the tab, the finding and the shot go into the vault under
  // a handle of their own, and what comes back out is the sterile task the
  // subagent works — a task, not a challenge, with no page, service or
  // address on it. A fresh handle each pass, so a spent or expired one is
  // never used twice and two passes over one challenge cannot be tied to
  // each other. Null when no sterile task could be made: that is the end of
  // the work, never a reason to hand the page over instead.
  #dispatch(browser, record, shot, sees) {
    const boundary = getCaptchaBoundary();
    let handle = null;
    let task = null;
    try {
      handle = boundary.open({ browser, record, shot });
      task = boundary.task(handle, {
        serviceNames: STERILE_LOOK.serviceNames,
        sees,
      });
    } catch (e) {
      say(`isolation unavailable: ${e}`);
    }
    if (!task) {
      this.#settle(handle, "escalate");
      return null;
    }
    say(`task ${task.id}: ${task.capability} (${task.signature})`);
    return { handle, task };
  }

  // The pictures a turn is given: the sterile task's, or the challenge's own
  // under their own names where the boundary is off.
  #filesFor(task, parts, picture) {
    if (task) {
      return task.files;
    }
    if (parts) {
      const files = [{ name: "challenge-area.jpg", bytes: parts.area.bytes }];
      // The instruction's words are in the request; its picture goes too
      // only where it shows what words cannot: an example to match, icons
      // to click in order.
      if (parts.instruction?.shot && parts.instruction.pictures) {
        files.push({
          name: "challenge-instruction-example.jpg",
          bytes: parts.instruction.shot.bytes,
        });
      }
      return files;
    }
    return picture ? [{ name: "challenge.jpg", bytes: picture.bytes }] : [];
  }

  // The turn a pass sends: the sterile one where the boundary is on and the
  // agent's own where it is off; the solve turn where there is work to do
  // (act), and the one-line status turn where there is not.
  #promptFor({ task, act, said, shot, pictureName, sees }) {
    if (task) {
      return act
        ? sterileSolvePrompt({
            said: task.said,
            nowLine: LABELED_NOW[shot.labeled] ?? LABELED_NOW.captcha,
            keysReference: keysReference(null),
            fileNames: STERILE_FILE_NAMES,
          })
        : sterileStatusPrompt({
            pictureName,
            said: task.said,
            state: task.state,
            sees,
          });
    }
    return act
      ? this.#solvePrompt(said, shot.labeled)
      : this.#statusPrompt(pictureName, said, shot?.state ?? null, sees);
  }

  // How a dispatch ended, said to the boundary and to nothing else: the
  // handle is spent with it, so the tab and the finding behind it cannot be
  // opened again by a later turn. Without a handle (the boundary is off)
  // there is nothing to settle.
  #settle(handle, status) {
    if (!handle) {
      return;
    }
    try {
      getCaptchaBoundary().resolve(handle, status);
    } catch (e) {
      say(`could not settle the task: ${e}`);
    }
  }

  // Send one turn, giving way to a user turn that preempts it; whether it ran.
  // Each is a session of its own (isolated): it resumes nothing, and what
  // it did is not resumed by the next.
  async #sendSolve(conversation, browser, prompt, files, options) {
    for (let tries = 0; tries < SEND_TRIES; tries++) {
      if (!this.#current(browser, conversation)) {
        return false;
      }
      if (
        await conversation.send(prompt, files, { ...options, isolated: true })
      ) {
        return true;
      }
      // The user's own request went first; the summary follows it.
      if (!(await this.#idle(conversation, browser))) {
        return false;
      }
    }
    return false;
  }

  // Press a run of keys in the live jump session the shot labeled, as a
  // keyboard would: the subagent types the labels it reads off the picture to
  // pick tiles, move the cursor, slide a piece, or press a button. Returns
  // whether any key was taken, so the subagent hears when its labels are gone.
  async #typeKeys(browser, keys) {
    const items = Array.isArray(keys) ? keys : [keys];
    const tokens = items.flatMap(keyTokensOf);
    if (!tokens.length) {
      return { ok: false, detail: "No keys to press." };
    }
    let took = 0;
    for (const token of tokens) {
      if (!browser.isConnected) {
        break;
      }
      const actor =
        browser.browsingContext?.currentWindowGlobal?.getActor("ZendiaKeys");
      if (!actor) {
        break;
      }
      let consumed = false;
      try {
        consumed = await Promise.race([
          actor.sendQuery("Zendia:FeedToken", { token }),
          new Promise(resolve =>
            setTimeout(() => resolve(false), RECT_TIMEOUT_MS)
          ),
        ]);
      } catch {
        consumed = false;
      }
      if (consumed) {
        took++;
      }
      await new Promise(resolve => setTimeout(resolve, KEY_GAP_MS));
    }
    await new Promise(resolve => setTimeout(resolve, KEY_SETTLE_MS));
    if (!took) {
      return {
        ok: false,
        detail:
          "The keys did nothing: the task is over, or its labels are not up.",
      };
    }
    // When some keys were taken and others not, the labels changed partway
    // (a pick redrew the challenge), so the later keys — often the verify
    // key — never landed. Say so, so the subagent looks again and re-presses
    // rather than believing it submitted.
    const partial =
      took < tokens.length
        ? ` Only the first ${took} of ${tokens.length} registered; the rest did nothing, so the challenge changed before them and they did not land — look again and press them again if still needed.`
        : "";
    return {
      ok: true,
      detail: `Pressed ${ZendiaKeys.format(tokens)}.${partial} Look again to see what changed.`,
    };
  }

  // Type text into the challenge's answer field, for a task solved by reading
  // its characters: the subagent reads them off the picture and types them
  // here, then presses the verify key. Only a field in the page itself can be
  // filled; a cross-process frame's cannot, and the subagent is told so.
  async #typeText(browser, text) {
    const value = String(text ?? "").trim();
    if (!value) {
      return { ok: false, detail: "No text to type." };
    }
    try {
      const filled = await ZendiaAgents.zendia?.run(
        "captcha.fill",
        { text: value },
        { browser }
      );
      if (filled) {
        await new Promise(resolve => setTimeout(resolve, KEY_SETTLE_MS));
        return {
          ok: true,
          detail: `Typed "${value}". Press Enter to submit, then look again.`,
        };
      }
    } catch (e) {
      say(`type text failed: ${e}`);
    }
    return {
      ok: false,
      detail:
        "There is no answer field here that can be typed into — this part cannot be done.",
    };
  }

  // A fresh picture of the challenge for the subagent between its moves, with
  // the labels the live session keeps on it, and what it asks now, so a
  // changed challenge is read from the latest picture, not the first. It is
  // not labeled again: that would start a second session over the keys'.
  async #relook(browser, sterile = null, maxWidth = SHOT_MAX_WIDTH) {
    if (!browser.isConnected) {
      return null;
    }
    this.#toFront(browser);
    const shot = await this.#screenshot(browser, maxWidth, true).catch(
      () => null
    );
    // No challenge located: it is solved and gone, or no longer where it was.
    // The whole tab is not the subagent's to see, so there is nothing to show.
    if (!shot?.area) {
      return null;
    }
    const parts = await this.#shootParts(
      browser,
      shot.area,
      maxWidth,
      true
    ).catch(() => null);
    const bytes = parts?.area?.bytes ?? shot.bytes;
    if (!bytes) {
      return null;
    }
    const said = parts?.instruction?.text ?? null;
    return {
      name: sterile ? sterile.names.area : "challenge-area.jpg",
      bytes,
      said: sterile ? sterileSaid(said, sterile.serviceNames) || null : said,
    };
  }

  // End the live jump session the solving used, so its labels do not linger
  // on the user's screen once the subagent is done.
  #endCapture(browser) {
    try {
      browser.browsingContext?.currentWindowGlobal
        ?.getActor("ZendiaKeys")
        ?.sendAsyncMessage("Zendia:EndCapture");
    } catch {
      // The tab is gone; nothing to clear.
    }
  }

  // Once the subagent has cleared the challenge, the agent is sent back to
  // the work the user asked for: a normal turn that resumes its session (the
  // isolated solve turns left the resume id alone), so a page that stopped
  // on a challenge does not strand the task. It is told nothing of what the
  // subagent did, only that the way is clear. Fired off, not waited on, so
  // the delivery finishes; a new challenge the carried-on work meets is found
  // and worked as any other.
  #handBack(conversation) {
    if (conversation.discarded) {
      return;
    }
    conversation
      .send(
        "The step that was holding up the page is done and the page is ready now. Pick the task you were asked to do back up and carry it through to the end; if anything still needs the user, tell them.",
        [],
        { echo: "Carrying on with the task…", isolated: false }
      )
      .catch(e => say(`hand back failed: ${e}`));
  }

  // Whether the conversation is still the tab's: a new chat (the panel's
  // new chat button) discards it, and the subagent sends it nothing more.
  #current(browser, conversation) {
    return (
      !!conversation &&
      !conversation.discarded &&
      ZendiaAgents.conversationFor(browser) === conversation
    );
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
   * A tab in the background is shot too, where it was drawn once.
   *
   * @param {Element} browser
   * @param {number} [maxWidth]
   * @param {string} [color] The driving agent's color, for its labels.
   * @returns {Promise<{data: string, bytes: Uint8Array, width: number,
   *   height: number, cropped: boolean, parts: object|null}|null>} The
   *   JPEG, as base64 and as bytes, and its size; with its parts where the
   *   challenge has pictures: the area to act on, shot alone, and the
   *   instruction, its words and its shot. Null when the tab has nothing
   *   to shoot.
   */
  async captureChallenge(browser, maxWidth = SHOT_MAX_WIDTH, color = null) {
    const state = await this.#prepareChallenge(browser);
    // Only a challenge that is there to act on is labeled for the keys: an
    // invisible pass or a finished check has nothing to label, and one
    // that never came (a frame still blank when the wait ran out) would be
    // labeled empty. Anything else is labeled first, so the shot shows the
    // labels the user finishes by.
    const labeled =
      ["open", "settled", "clicked"].includes(state) &&
      (await this.#labelChallenge(browser, color));
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

  // Under ZENDIA_CAPTCHA_DEBUG only, the screenshot of the challenge as a
  // page in the chat. Where the challenge came apart,
  // its instruction in words above the area to act on, shot alone: the
  // instruction is read, not shown again. A page too big for the panel is
  // the whole challenge again, retaken smaller. The shot shown, or null.
  async #showShot(browser, conversation, record, shot) {
    if (!captchaDebug()) {
      return null;
    }
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
  //   went by itself, nothing to act on; "timeout" — it never said.
  async #prepareChallenge(browser) {
    const top = browser.browsingContext;
    if (!top) {
      return "timeout";
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
    } finally {
      // The rescan the opening brings can lag the poll: keep the findings
      // it reports the same finding's a moment longer.
      setTimeout(() => this.#opening.delete(browser), CHALLENGE_DRAW_MS);
    }
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
  async #labelChallenge(browser, color = null) {
    if (!Services.prefs.getBoolPref(PREF_LABELS, true)) {
      return false;
    }
    const zendia = ZendiaAgents.zendia;
    if (!zendia || !browser.isConnected) {
      return false;
    }
    let labeled = false;
    // Labeled once more if the first try threw or drew no labels: a frame
    // that navigated as it was asked, a challenge redrawn in between.
    for (let tries = 0; tries < LABEL_TRIES && browser.isConnected; tries++) {
      try {
        labeled = await zendia.run(
          "jump.captcha",
          // The agent's own labels: its color, and driven by its tokens,
          // so the user's keys are never swallowed into its session.
          { orPage: true, agentDriven: true, color },
          { browser }
        );
      } catch (e) {
        console.error("Zendia: CAPTCHA subagent could not label", e);
        say(`labels failed: ${e}`);
        labeled = false;
        await new Promise(resolve => setTimeout(resolve, LABELS_SETTLE_MS));
        continue;
      }
      // A page that answers nothing labeled the CAPTCHA, as before it said.
      labeled = ["captcha", "cursor", "page"].includes(labeled)
        ? labeled
        : "captcha";
      // The labels are in the page once the action returns; this covers
      // the paint before the shot, and says they are there.
      await new Promise(resolve => setTimeout(resolve, LABELS_SETTLE_MS));
      const tags = await this.#awaitLabels(browser);
      if (labeled == "cursor" || tags === null || tags.length) {
        break;
      }
      say(`labeled ${labeled}, but no labels are on screen`);
      labeled = false;
      // The jump that drew nothing is ended, not left to draw over the
      // next one later.
      this.#endCapture(browser);
    }
    say(`labeled: ${labeled}`);
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
    const result = { passed: false, checkbox: false };
    await this.#eachFrame(
      browser,
      "Zendia:CaptchaWatch:Open",
      { peek: true },
      answer => {
        result.checkbox ||= !!answer?.checkbox;
        // A managed check that failed or expired comes to nothing more:
        // shot as it is, like a pass.
        result.passed ||= !!answer?.passed || !!answer?.done;
        return result.passed;
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
        const tags = await this.#awaitLabels(browser);
        rect = this.#takeInLabels(window, moved.rect, moved, tags);
        ({ viewWidth, viewHeight } = moved);
      } else {
        // A frame on the way up did not answer: the labels are in the top
        // page, so the whole view is the next best shot of them.
        ({ width: viewWidth, height: viewHeight } =
          await this.#viewSize(browser));
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
        await this.#viewSize(browser));
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

  // The size of the tab's view: its browser's box, or, for a tab in the
  // background whose browser is not laid out, its own window's, asked for.
  async #viewSize(browser) {
    const rect = browser.getBoundingClientRect();
    if (rect.width && rect.height) {
      return { width: rect.width, height: rect.height };
    }
    try {
      const size = await browser.browsingContext?.currentWindowGlobal
        ?.getActor("ZendiaKeys")
        .sendQuery("Zendia:ViewSize");
      return { width: size?.width ?? 0, height: size?.height ?? 0 };
    } catch {
      return { width: 0, height: 0 };
    }
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
        scrollX: view.scrollX ?? 0,
        scrollY: view.scrollY ?? 0,
      }
    );
  }

  // Where the jump labels are on the user's screen now, each with the rect
  // of what it names, in the top page's viewport: null when the cursor has
  // the keys (its tags lie inside what it is over) or the page cannot say,
  // none when no labels are up.
  async #labelsOnScreen(browser) {
    try {
      const answer = await Promise.race([
        browser.browsingContext?.currentWindowGlobal
          ?.getActor("ZendiaKeys")
          .sendQuery("Zendia:CaptureLabels"),
        new Promise(resolve =>
          setTimeout(() => resolve(null), RECT_TIMEOUT_MS)
        ),
      ]);
      return Array.isArray(answer) ? answer : null;
    } catch {
      return null;
    }
  }

  // The labels, once they are up: a jump that stays reads its challenge
  // again as it changes, and a read that found it between two drawings
  // leaves no labels until the next. Waited for a while; none, if they
  // never came back.
  async #awaitLabels(browser, wait = LABELS_WAIT_MS) {
    const until = Date.now() + wait;
    for (;;) {
      const tags = await this.#labelsOnScreen(browser);
      if (tags === null || tags.length || Date.now() >= until) {
        return tags;
      }
      await new Promise(resolve => setTimeout(resolve, LABELS_SETTLE_MS));
    }
  }

  // A rect of the top page's document grown to take in the labels of what
  // it shows: a label sits at the corner of what it names, and a picture
  // bigger than the part shot (hCaptcha's canvas, under its instruction
  // too) has its label outside that part. Only the labels of what the rect
  // shows; kept inside the view.
  #takeInLabels(window, rect, view, tags) {
    if (!rect || !tags?.length) {
      return rect;
    }
    const scrollX = view.scrollX ?? 0;
    const scrollY = view.scrollY ?? 0;
    let left = rect.left - scrollX;
    let top = rect.top - scrollY;
    let right = left + rect.width;
    let bottom = top + rect.height;
    const meets = box =>
      box.left < right &&
      box.left + box.width > left &&
      box.top < bottom &&
      box.top + box.height > top;
    const shown = tags.filter(({ target }) => target && meets(target));
    // A little room around each label, for its shadow and a rounding of
    // the crop.
    const room = 3;
    for (const { tag } of shown) {
      left = Math.min(left, tag.left - room);
      top = Math.min(top, tag.top - room);
      right = Math.max(right, tag.left + tag.width + room);
      bottom = Math.max(bottom, tag.top + tag.height + room);
    }
    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(view.viewWidth ?? right, right);
    bottom = Math.min(view.viewHeight ?? bottom, bottom);
    return right > left && bottom > top
      ? new window.DOMRect(
          left + scrollX,
          top + scrollY,
          right - left,
          bottom - top
        )
      : rect;
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
        // The labels may have gone between two readings of the challenge
        // while its pictures were waited for: they are waited back, and
        // the part grows to take in the labels of what it shows.
        const tags = await this.#awaitLabels(browser);
        if (tags && !tags.length) {
          say("parts: no labels on screen for the shot");
        }
        areaRect = this.#takeInLabels(window, moved.rect, moved, tags);
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

  // The tab with the challenge, in front, with its chat open beside it.
  // The keys stay on the page, where the challenge takes them. A tab that
  // is not in front already comes forward only when the user lets agents
  // decide (zendia.agent.stealFocus). Returns whether the tab is in front; a
  // challenge is worked in the background where it can be, never by
  // stealing the user's view, cursor or window.
  #toFront(browser) {
    const window = this.#windowFor(browser);
    const tab = window?.gBrowser?.getTabForBrowser(browser);
    if (!tab) {
      return false;
    }
    if (window.gBrowser.selectedTab != tab) {
      // Another tab in front is the user's view, whether they are in this
      // window or not: it is never switched from under them.
      if (!Services.prefs.getBoolPref(PREF_STEAL_FOCUS, false)) {
        return false;
      }
      window.gBrowser.selectedTab = tab;
    }
    ZendiaAgents.zendia?.agentDockFor(window)?.open(browser, { focus: false });
    return true;
  }

  // The turn the subagent gets when it works the challenge itself: the task's
  // picture is on the user's screen with the keys' labels on it, and the
  // subagent reads the labels, presses them or types the answer, and looks
  // again, until the task is done. It is told nothing of where the challenge
  // is from. `said` is what it asks at the start; the picture is the truth,
  // and look_again gives what it asks after each move, since it can change.
  #solvePrompt(said, labeled) {
    const nowLine = LABELED_NOW[labeled] ?? LABELED_NOW.captcha;
    return [
      said
        ? `At the start it asks: "${said}" — but the picture is the truth, and it can change.`
        : null,
      `A picture of the task is on the user's screen with small key labels on it, and you do it yourself. ${nowLine}`,
      `These are the keys, exactly as they work; use no others:\n${keysReference(null)}`,
      `Pass type_keys a list of keys in order: a tile's letters typed together like "ac", a move like "h", "H" or ".", or a named key exactly as above ("Enter", "Tab", "Ctrl+R", "Ctrl+A", "Ctrl+P", "Space"). Pass type_text the characters to put in an answer field.
Work it on your own, and do not stop until it is finished:
1. First see the task: call picture_view on challenge-area.jpg (or open the file you were given). Only after you have truly tried and got no image may you say you cannot see it, in one short line, and stop.
2. Read what it asks and the labels off the picture, and make the move for its kind: pick images (type each matching tile's letters, then verify); slide a piece to a gap; rotate; click points in order; press and hold; a checkbox — all with type_keys. If it shows characters to copy, read them and put them in with type_text, then verify. A slider or drag puzzle takes two looks: first type the handle's tag alone to grab it (its track may be below the picture, not beside it), then call look_again — only then does a ruler of tags appear across the row. The ruler only gets the piece CLOSE, not exact: type the tag nearest the gap, then look_again and nudge one step at a time with \`h\`/\`l\` (\`H\`/\`L\` for bigger steps), looking again after each nudge, until the piece's shape sits squarely inside the gap. Only then \`Space\`. Never drop right after the ruler jump without first looking and correcting the fit with nudges; the exact fit is what passes, and the ruler alone rarely lands it. Do not guess the ruler before you have looked.
3. After each press the labels change, and new ones often appear — a ruler across a slider's row once you grab, the next button or field, the tiles of the next step. So call look_again after every move: it returns a fresh picture with the labels that are on screen now, and what it asks now. Read the labels off that latest picture and choose your next key from what you see there, never from a label you remember or guess — if you expected a new label and do not see it yet, look_again once more before pressing. When one task is complete, submit with the verify key; if another appears, solve that one too.
4. Keep looking and acting until the task is finished (it is gone, or it says it passed). If a picture is too blurred or it keeps refusing, get a fresh one with the new-task key and carry on.
Do not press \`Esc\` to leave — that drops your control; use it only to cancel a drag under the cursor. If type_text reports there is no field it can fill, or the task needs listening to audio, that part cannot be done: say so in one short line and stop. Do not name or guess what this is or where it is from, do not explain it, and do not write steps for the user — just do it yourself. When it is finished, or you are truly stuck, answer in one short line that says only that.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  // The turn the subagent gets when there is nothing for it to work: it could
  // not act (a check that passed on its own, one that never showed, a picture
  // it cannot see). It does not advise the user; it only says in one line
  // whether anything is left, and names nothing.
  #statusPrompt(pictureName, said, state, sees) {
    if (!sees) {
      return "You were given a picture you may not be able to see. Say in one short line that you cannot see it. Do not guess what it shows, do not name it, and do not write steps.";
    }
    const note =
      state == "passed"
        ? "It may already be done."
        : state == "timeout"
          ? "It may not have loaded yet, or it opens only once something on the page is used."
          : "There may be nothing here to act on.";
    return [
      said ? `The task says: "${said}"` : null,
      pictureName ? `Look at ${pictureName}. ${note}` : note,
      "Say in one short line whether anything still needs doing. Do not name or guess what this is or where it is from, do not explain it, and do not write steps for the user.",
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
