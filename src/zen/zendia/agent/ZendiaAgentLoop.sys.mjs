// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The loop that keeps the agent on its work list. An agent CLI runs one
// turn and stops whenever it thinks it should, often after the first of
// many items, to report or to ask whether to go on. After the Ralph loop
// and the harness of Anthropic's long-running agents, the browser starts
// the next turn itself, with the list restated (ZendiaAgentWork), until
// every item is done, failed or waits on the user. After Magentic-One's
// progress ledger, a turn that finishes no item is a stall, and three in a
// row stop the loop rather than spend turns going round in circles.
//
// The loop only ever starts a turn of the agent's own. It waits while a
// CAPTCHA holds the tab up: the CAPTCHA subagent and the handoff
// (ZendiaAgentHandoff) own that stretch, and the turn the handoff sends to
// carry on is a turn like any other here once it ends.

import { ZendiaAgents } from "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs";
import { continuePrompt } from "resource:///modules/zendia/agent/ZendiaAgentWork.sys.mjs";
import { ZendiaCaptchaWatch } from "resource:///modules/zendia/captcha/ZendiaCaptchaWatch.sys.mjs";
import { ZendiaCaptcha } from "resource:///modules/zendia/core/ZendiaCaptcha.sys.mjs";
import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";

// zendia.agent.loop: whether the agent is kept on its work list.
export const PREF_LOOP = "zendia.agent.loop";
// zendia.agent.loop.stalls: how many turns in a row may finish no item.
export const PREF_STALLS = "zendia.agent.loop.stalls";

// How long after a turn the next one waits, so whatever else answers the
// end of a turn (the CAPTCHA subagent, the handoff) goes first.
const NEXT_TURN_MS = 1500;
const DEFAULT_STALLS = 3;
// The turns a list may take: twice its items and a few more, so a list
// that keeps failing cannot run for ever.
const ROUNDS_PER_ITEM = 2;
const EXTRA_ROUNDS = 5;
const MAX_ROUNDS = 400;

/**
 * @param {ZendiaWorkList} work
 * @returns {number} How many turns the loop may start for the list.
 */
export function roundBudget(work) {
  return Math.min(
    MAX_ROUNDS,
    work.items.length * ROUNDS_PER_ITEM + EXTRA_ROUNDS
  );
}

/**
 * What the loop does after a turn of the agent's own. Counts the turn
 * against the list's budget and stalls.
 *
 * @param {ZendiaWorkList|null} work
 * @param {object} turn
 * @param {string|null} turn.error How the turn ended, null when well.
 * @param {boolean} turn.byUser A request the user typed.
 * @param {boolean} [turn.stoppedByUser]
 * @param {boolean} [turn.discarded]
 * @param {boolean} [turn.captchaHolds] A CAPTCHA holds the tab up.
 * @param {number} [turn.maxStalls]
 * @returns {{action: "continue"|"wait"|"stop"|"done", reason: string}}
 */
export function decideNext(
  work,
  {
    error,
    byUser,
    stoppedByUser = false,
    discarded = false,
    captchaHolds = false,
    maxStalls = DEFAULT_STALLS,
  }
) {
  if (!work) {
    return { action: "wait", reason: "no work list" };
  }
  if (discarded || stoppedByUser) {
    return { action: "stop", reason: "stopped by the user" };
  }
  if (error) {
    return { action: "stop", reason: `the turn failed: ${error}` };
  }
  if (byUser) {
    // The user is talking: a fresh start for the budget.
    work.rounds = 0;
    work.stalls = 0;
    if (!work.touched) {
      // A question beside the list: answered, and the list waits.
      return { action: "wait", reason: "the user asked something else" };
    }
  }
  const final = work.finalCount;
  if (final > work.lastFinal) {
    work.stalls = 0;
  } else {
    work.stalls++;
  }
  work.lastFinal = final;
  work.rounds++;
  if (work.complete) {
    return { action: "done", reason: "every item is finished" };
  }
  if (!work.pending.length) {
    return { action: "wait", reason: "the rest waits on the user" };
  }
  if (captchaHolds) {
    return { action: "wait", reason: "a CAPTCHA holds the tab up" };
  }
  if (work.stalls >= maxStalls) {
    return {
      action: "stop",
      reason: `no item was finished in ${work.stalls} turns in a row`,
    };
  }
  if (work.rounds > roundBudget(work)) {
    return {
      action: "stop",
      reason: `the list used its ${roundBudget(work)} turns`,
    };
  }
  return { action: "continue", reason: "items are pending" };
}

function say(text) {
  if (Services.prefs.getBoolPref("zendia.agent.log.stdout", false)) {
    dump(`Zendia loop: ${text}\n`);
  }
}

class ZendiaAgentLoopService {
  #initialized = false;
  #followed = new WeakSet();

  init() {
    if (this.#initialized || !Services.prefs.getBoolPref(PREF_LOOP, true)) {
      return;
    }
    this.#initialized = true;
    ZendiaAgents.onConversation((browser, conversation) =>
      this.#follow(conversation)
    );
  }

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
      if (!running) {
        this.#afterTurn(conversation);
      }
    });
  }

  #captchaHolds(conversation) {
    const state = ZendiaCaptchaWatch.lastFor(conversation.browser)?.state;
    return !!state && ZendiaCaptcha.holdsUp(state);
  }

  #afterTurn(conversation) {
    const turn = conversation.lastTurn;
    // The CAPTCHA subagent's isolated turns are not the agent's.
    if (!turn || turn.isolated || !conversation.work) {
      return;
    }
    const work = conversation.work;
    const { action, reason } = decideNext(work, {
      ...turn,
      stoppedByUser: conversation.stoppedByUser,
      discarded: conversation.discarded,
      captchaHolds: this.#captchaHolds(conversation),
      maxStalls: Services.prefs.getIntPref(PREF_STALLS, DEFAULT_STALLS),
    });
    say(`${action}: ${reason} (${work.progress()})`);
    if (action == "stop" && !conversation.discarded && !turn.error) {
      if (!conversation.stoppedByUser && !work.complete) {
        work.paused = reason;
      }
      if (!conversation.stoppedByUser) {
        conversation.note(
          `Work list paused: ${reason} (${work.progress()}). Say "continue" to go on.`
        );
      }
      return;
    }
    if (action != "continue") {
      return;
    }
    setTimeout(() => {
      if (
        conversation.discarded ||
        conversation.running ||
        conversation.stoppedByUser ||
        conversation.work != work ||
        !work.pending.length ||
        this.#captchaHolds(conversation)
      ) {
        return;
      }
      const next = work.pending[0];
      conversation
        .send(continuePrompt(work), [], {
          echo: `Next: ${next.title} (${work.progress()})`,
        })
        .catch(e => console.error("Zendia: work loop failed", e));
    }, NEXT_TURN_MS);
  }
}

export const ZendiaAgentLoop = new ZendiaAgentLoopService();
