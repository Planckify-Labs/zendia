// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// What the agents panel (ZendiaAgentsPanel) says of each conversation: the
// group it sits in, a line of what it is doing, and the order of the rows.
// Nothing here touches the browser, so it is tested on its own.

/**
 * The panel's groups, top to bottom: what waits on the user, what works,
 * what finished since the user last looked, and the rest.
 */
export const ROSTER_GROUPS = ["attention", "working", "done", "idle"];

export const GROUP_TITLES = {
  attention: "Needs you",
  working: "Working",
  done: "Finished",
  idle: "Idle",
};

// How much of a line the panel shows.
const LINE_MAX = 140;

/**
 * One line of text: Markdown marks, newlines and runs of spaces gone, cut
 * at max with an ellipsis.
 *
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function oneLine(text, max = LINE_MAX) {
  const line = String(text ?? "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/**
 * What the user asked of the conversation: its first request, which names it
 * in the panel, or the work list's goal.
 *
 * @param {object} conversation
 * @returns {string} Empty when the user never asked anything.
 */
export function titleOf(conversation) {
  const request = conversation.messages.find(m => m.type == "user")?.text;
  return oneLine(request || conversation.work?.goal || "", 90);
}

// What the agent last said, after the user's last request.
function lastAnswer(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type == "user") {
      return "";
    }
    if (message.type == "agent" && message.text.trim()) {
      return oneLine(message.text);
    }
  }
  return "";
}

// The step running now, else the last one of the turn.
function currentStep(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.type == "user") {
      return null;
    }
    if (message.type == "step") {
      return message;
    }
  }
  return null;
}

// The state of a conversation whose turn runs.
function runningState(conversation) {
  const { messages, work } = conversation;
  if (conversation.stoppedByUser) {
    return {
      group: "working",
      kind: "stopping",
      label: "Stopping",
      detail: work ? work.progress() : "",
    };
  }
  if (conversation.run?.turn?.isolated) {
    return {
      group: "working",
      kind: "captcha-solving",
      label: "Working on a CAPTCHA",
      detail: work ? work.progress() : "",
    };
  }
  const step = currentStep(messages);
  const doing =
    step?.status == "running"
      ? oneLine(step.text)
      : lastAnswer(messages) || (step ? oneLine(step.text) : "");
  return {
    group: "working",
    kind: conversation.run ? "working" : "starting",
    label: conversation.run ? "Working" : "Starting",
    detail: [work?.progress(), doing].filter(Boolean).join(" · "),
  };
}

/**
 * @typedef {object} RosterState
 * @property {"attention"|"working"|"done"|"idle"} group Where it sits.
 * @property {string} kind What it is about: confirm, captcha, blocked,
 *   paused, error, stopping, captcha-solving, working, starting, done,
 *   stopped, idle.
 * @property {string} label A few words: "Asks permission", "Working".
 * @property {string} detail One line under it, or "".
 */

/**
 * Where a conversation sits in the panel, and what its row says.
 *
 * @param {object} conversation A ZendiaAgentConversation, or anything with
 *   its messages, running, run, unseen, lastTurn, stoppedByUser, work and
 *   pendingConfirm.
 * @param {object} [options]
 * @param {boolean} [options.captchaHolds] A CAPTCHA holds its tab up now.
 * @returns {RosterState}
 */
export function stateOf(conversation, { captchaHolds = false } = {}) {
  const { messages, work } = conversation;
  const confirm = conversation.pendingConfirm;
  if (confirm) {
    return {
      group: "attention",
      kind: "confirm",
      label: "Asks permission",
      detail: oneLine(confirm.text),
    };
  }
  if (conversation.running) {
    return runningState(conversation);
  }
  if (captchaHolds) {
    return {
      group: "attention",
      kind: "captcha",
      label: "CAPTCHA to solve",
      detail: "It carries on once the CAPTCHA is solved",
    };
  }
  const blocked = work?.blocked ?? [];
  if (blocked.length) {
    return {
      group: "attention",
      kind: "blocked",
      label:
        blocked.length == 1
          ? "Blocked on you"
          : `${blocked.length} items blocked on you`,
      detail: oneLine(blocked[0].result || blocked[0].title),
    };
  }
  const turn = conversation.lastTurn;
  if (turn?.error && !conversation.stoppedByUser) {
    return {
      group: "attention",
      kind: "error",
      label: "Stopped with an error",
      detail: oneLine(turn.error),
    };
  }
  if (work?.paused) {
    return {
      group: "attention",
      kind: "paused",
      label: "Work list paused",
      detail: `${oneLine(work.paused)} (${work.progress()})`,
    };
  }
  if (conversation.stoppedByUser) {
    return {
      group: "idle",
      kind: "stopped",
      label: "Stopped",
      detail: work ? work.progress() : lastAnswer(messages),
    };
  }
  const answer = lastAnswer(messages);
  if (conversation.unseen && turn) {
    return {
      group: "done",
      kind: "done",
      label: "Finished",
      detail: [work?.progress(), answer].filter(Boolean).join(" · "),
    };
  }
  return {
    group: "idle",
    kind: "idle",
    label: "Idle",
    detail: [work?.progress(), answer].filter(Boolean).join(" · "),
  };
}

/**
 * The panel's rows in order: by group, then the newest conversation first.
 * The order within a group never follows activity, so rows hold still while
 * text streams into them.
 *
 * @template {{state: RosterState, conversation: {createdAt: number}}} T
 * @param {T[]} entries
 * @returns {T[]}
 */
export function sortRoster(entries) {
  const rank = group => ROSTER_GROUPS.indexOf(group);
  return [...entries].sort(
    (a, b) =>
      rank(a.state.group) - rank(b.state.group) ||
      b.conversation.createdAt - a.conversation.createdAt
  );
}

/**
 * The header's count: "2 working · 1 needs you".
 *
 * @param {{state: RosterState}[]} entries
 * @returns {string}
 */
export function summarize(entries) {
  const counts = {};
  for (const { state } of entries) {
    counts[state.group] = (counts[state.group] ?? 0) + 1;
  }
  const words = {
    attention: "needs you",
    working: "working",
    done: "finished",
    idle: "idle",
  };
  return ROSTER_GROUPS.filter(group => counts[group])
    .map(group => `${counts[group]} ${words[group]}`)
    .join(" · ");
}

/**
 * How long ago, or how long for: "now", "42s", "5m", "3h", "2d".
 *
 * @param {number} ms
 * @returns {string}
 */
export function shortDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 5) {
    return "now";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/**
 * The last few things that happened after the user's last request, for the
 * panel's peek: steps, the agent's words, notes and errors.
 *
 * @param {object[]} messages
 * @param {number} [count]
 * @returns {{type: string, status?: string, text: string}[]}
 */
export function recentActivity(messages, count = 6) {
  const start = messages.findLastIndex(m => m.type == "user");
  const shown = [];
  for (const message of messages.slice(start + 1)) {
    switch (message.type) {
      case "step":
        shown.push({
          type: "step",
          status: message.status,
          text: oneLine(message.text, 100),
        });
        break;
      case "agent":
        if (message.text.trim()) {
          shown.push({ type: "agent", text: oneLine(message.text, 220) });
        }
        break;
      case "tool":
        shown.push({ type: "tool", text: `used ${message.text}` });
        break;
      case "ui":
        if (message.status == "done" && message.text) {
          shown.push({ type: "ui", text: oneLine(message.text, 100) });
        }
        break;
      case "note":
      case "error":
        shown.push({ type: message.type, text: oneLine(message.text, 160) });
        break;
    }
  }
  return shown.slice(-count);
}
