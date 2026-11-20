// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The agent's side of the handoff around a CAPTCHA, after dev's
// "hand the tab back and forth" work. The agent is told to end its turn on
// a CAPTCHA (BROWSER_INSTRUCTIONS); this module is what tells it to carry
// on. A turn of the agent's own that ends while a CAPTCHA holds its tab up
// stopped on it, so the tab is held. Once the watch says the CAPTCHA is
// cleared (solved, or gone from the page for a moment), and nothing else
// is running on the conversation, the agent gets a turn with the user's
// request restated and carries on from where it stopped.
//
// It only watches and sends that turn. It never opens, labels, shoots or
// solves a CAPTCHA: that is the CAPTCHA subagent's work, and the subagent's
// isolated turns are not the agent's and are ignored here. If the subagent
// hands the work back itself, that turn is the agent at work again and the
// hold is dropped, so the agent is never sent back twice.

import { ZendiaAgents } from "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs";
import { continuePrompt } from "resource:///modules/zendia/agent/ZendiaAgentWork.sys.mjs";
import { ZendiaCaptchaWatch } from "resource:///modules/zendia/captcha/ZendiaCaptchaWatch.sys.mjs";
import { ZendiaCaptcha } from "resource:///modules/zendia/core/ZendiaCaptcha.sys.mjs";
import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";

// zendia.agent.handoff: whether the agent is told to carry on once a
// CAPTCHA that stopped it is cleared.
export const PREF_HANDOFF = "zendia.agent.handoff";

// How long a CAPTCHA must stay gone from the page to count as cleared: a
// widget drawn again (a retry, a re-render) is gone for less.
const GONE_SETTLE_MS = 2000;
// How long the conversation must stay idle before the carry-on, so the
// subagent finishes its last look and a hand back it sends goes first.
const IDLE_SETTLE_MS = 3000;

function say(text) {
  if (Services.prefs.getBoolPref("zendia.captcha.agent.debug", false)) {
    dump(`Zendia handoff: ${text}\n`);
  }
}

/**
 * @param {string} state One of ZendiaCaptcha.STATES.
 * @param {object} [record] The watch's merged finding.
 * @returns {boolean} Whether the page is through the CAPTCHA.
 */
export function clearedState(state, record = null) {
  if (state == "solved") {
    return true;
  }
  return state == "none" && !record?.detections?.length;
}

/**
 * The turn that tells the agent to carry on.
 *
 * @param {{title: string, url: string, request: string, how: string}} options
 * @returns {string}
 */
export function carryOnPrompt({ title, url, request, how }) {
  return [
    `The browser's CAPTCHA assistant reports back: the CAPTCHA that stopped you on the tab "${title}" (${url}) is cleared now: ${how}.`,
    `The request you were working on, in the user's words: "${request}"`,
    "Observe the tab again and carry on with that request from where the CAPTCHA stopped you, by the same rules as before. If it is already done, say so in one sentence and do nothing more. Should a CAPTCHA stop you again, say so in one sentence and end your turn: the assistant shows it to the user and reports back once it is cleared.",
  ].join("\n\n");
}

class ZendiaAgentHandoffService {
  #initialized = false;
  // Per tab, what the watch last said: {state, how, record}.
  #states = new WeakMap();
  // The tabs whose agent stopped on the CAPTCHA.
  #held = new WeakSet();
  // Per tab, the timer that waits out a CAPTCHA gone from the page.
  #gone = new WeakMap();
  // Per tab, whether the CAPTCHA counts as cleared now.
  #cleared = new WeakSet();
  #followed = new WeakSet();
  #pending = new WeakSet();

  init() {
    if (
      this.#initialized ||
      !Services.prefs.getBoolPref(PREF_HANDOFF, true)
    ) {
      return;
    }
    this.#initialized = true;
    ZendiaCaptchaWatch.onDetect((browser, record) => {
      try {
        this.#onState(browser, record);
      } catch (e) {
        console.error("Zendia: agent handoff failed", e);
      }
    });
    ZendiaAgents.onConversation((browser, conversation) =>
      this.#follow(conversation)
    );
  }

  #onState(browser, record) {
    if (!browser.isConnected) {
      return;
    }
    const state = record.state ?? "none";
    this.#states.set(browser, { state, how: record.how ?? null, record });
    clearTimeout(this.#gone.get(browser));
    this.#gone.delete(browser);
    if (state == "solved") {
      this.#cleared.add(browser);
    } else if (clearedState(state, record)) {
      // Gone: once it stays gone.
      this.#gone.set(
        browser,
        setTimeout(() => {
          this.#gone.delete(browser);
          const now = this.#states.get(browser);
          if (now && clearedState(now.state, now.record)) {
            this.#cleared.add(browser);
            this.#maybeCarryOn(browser);
          }
        }, GONE_SETTLE_MS)
      );
      return;
    } else {
      this.#cleared.delete(browser);
    }
    const conversation = ZendiaAgents.conversationFor(browser);
    if (conversation) {
      this.#follow(conversation);
    }
    this.#maybeCarryOn(browser);
  }

  // The ends of the agent's own turns. The subagent's isolated turns run on
  // the same conversation and are skipped.
  #follow(conversation) {
    if (this.#followed.has(conversation)) {
      return;
    }
    this.#followed.add(conversation);
    let running = conversation.running;
    let isolated = conversation.run?.turn?.isolated ?? null;
    conversation.subscribe(() => {
      if (conversation.run) {
        const now = !!conversation.run.turn?.isolated;
        if (isolated === null && !now) {
          // A turn of the agent's own started: it is at work again.
          for (const tab of conversation.tabs) {
            this.#held.delete(tab);
          }
        }
        isolated = now;
      }
      if (conversation.running == running) {
        return;
      }
      running = conversation.running;
      if (running) {
        return;
      }
      const ended = isolated;
      isolated = null;
      if (ended === false) {
        const browser = conversation.browser;
        const last = this.#states.get(browser);
        if (
          last &&
          (ZendiaCaptcha.holdsUp(last.state) ||
            !clearedState(last.state, last.record))
        ) {
          say("the agent's turn ended on the CAPTCHA");
          this.#held.add(browser);
          this.#cleared.delete(browser);
        }
      }
      for (const tab of conversation.tabs) {
        this.#maybeCarryOn(tab);
      }
    });
  }

  #maybeCarryOn(browser) {
    if (
      !this.#held.has(browser) ||
      !this.#cleared.has(browser) ||
      this.#pending.has(browser)
    ) {
      return;
    }
    const conversation = ZendiaAgents.conversationFor(browser);
    if (!conversation || conversation.running) {
      // The end of the running turn looks again (#follow).
      return;
    }
    this.#pending.add(browser);
    setTimeout(() => {
      this.#pending.delete(browser);
      this.#carryOn(browser).catch(e =>
        console.error("Zendia: agent handoff failed", e)
      );
    }, IDLE_SETTLE_MS);
  }

  async #carryOn(browser) {
    const conversation = ZendiaAgents.conversationFor(browser);
    if (
      !browser.isConnected ||
      !conversation ||
      conversation.discarded ||
      conversation.running ||
      conversation.stoppedByUser ||
      !this.#held.has(browser) ||
      !this.#cleared.has(browser)
    ) {
      return;
    }
    const request = conversation.messages.findLast(
      message => message.type == "user"
    )?.text;
    this.#held.delete(browser);
    if (!request) {
      return;
    }
    const last = this.#states.get(browser);
    const how =
      last?.how ??
      (last?.state == "solved" ? "it passed" : "it is gone from the page");
    say(`carry on: ${how}`);
    const title = browser.contentTitle || browser.currentURI?.spec || "";
    const url = browser.currentURI?.spec ?? "";
    const work = conversation.work;
    await conversation.send(
      work?.pending.length
        ? `The browser's CAPTCHA assistant reports back: the CAPTCHA that stopped you on the tab "${title}" (${url}) is cleared now: ${how}.\n\n${continuePrompt(work)}`
        : carryOnPrompt({ title, url, request, how }),
      [],
      { echo: `CAPTCHA cleared (${how}). The agent carries on with your request.` }
    );
  }
}

export const ZendiaAgentHandoff = new ZendiaAgentHandoffService();
