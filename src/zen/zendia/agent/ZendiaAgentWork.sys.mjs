// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The work list of a request that asks for many of something: "create 3
// accounts", "research 78 content types on the feed", "apply to 10 jobs on
// at least 5 platforms". After the task and progress ledgers of
// Magentic-One and the feature list of Anthropic's long-running harness:
// the agent writes the request down as items, marks each one done with
// what the page showed, and the loop (ZendiaAgentLoop) restates the list
// at the start of every turn it sends, so the work survives a turn that
// stops early, a CAPTCHA, or a context that was compacted.
//
// Nothing here touches a page. It is data, the agent's tools on it, and
// the text the agent and the panel are shown.

export const WORK_TOOLS = ["work_plan", "work_update"];

// The states an item is in. Final ones need nothing more; blocked waits
// on the user.
export const ITEM_STATES = ["pending", "done", "failed", "skipped", "blocked"];
const FINAL = new Set(["done", "failed", "skipped"]);

const MAX_ITEMS = 500;
const MAX_TITLE = 200;
const MAX_RESULT = 600;
const MAX_GOAL = 400;
// How many items the agent is shown in full each turn; a longer list is
// shown as counts, the next pending items and the last done.
const LIST_IN_FULL = 40;
const SHOW_NEXT = 10;
const SHOW_DONE = 5;

function clean(value, max) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export class ZendiaWorkList {
  /**
   * @param {object} options
   * @param {string} options.goal The request, in the agent's words.
   * @param {Array<string|{title: string, group?: string}>} options.items
   * @param {string} [options.doneWhen] What on a page shows an item done.
   * @param {string} [options.request] The user's request, in their words.
   */
  constructor({ goal, items, doneWhen = "", request = "" }) {
    this.goal = clean(goal, MAX_GOAL);
    this.doneWhen = clean(doneWhen, MAX_RESULT);
    this.request = clean(request, 2000);
    this.items = [];
    this.add(items);
    if (!this.items.length) {
      throw new Error("work_plan needs items: one for each unit of work.");
    }
    // The loop's bookkeeping.
    this.rounds = 0;
    this.stalls = 0;
    // -1 so the turn that wrote the list counts as progress.
    this.lastFinal = -1;
    // Whether a work tool was called in the turn running now.
    this.touched = true;
    // Why the loop stopped short of the end, until the next turn of the
    // user's: the agents panel shows the list as waiting on them.
    this.paused = null;
  }

  /**
   * @param {Array<string|{title: string, group?: string}>} items
   * @returns {object[]} The items added.
   */
  add(items) {
    if (!Array.isArray(items)) {
      throw new Error("items must be an array of item titles.");
    }
    const added = [];
    for (const item of items) {
      if (this.items.length >= MAX_ITEMS) {
        throw new Error(`A work list holds at most ${MAX_ITEMS} items.`);
      }
      const title = clean(typeof item == "object" ? item?.title : item, MAX_TITLE);
      if (!title) {
        continue;
      }
      const group =
        typeof item == "object" ? clean(item?.group, MAX_TITLE) : "";
      const entry = {
        id: `w${this.items.length + 1}`,
        title,
        group,
        status: "pending",
        result: "",
      };
      this.items.push(entry);
      added.push(entry);
    }
    return added;
  }

  /**
   * @param {{id: string, status: string, result?: string}} args
   * @returns {object} The item.
   */
  update({ id, status, result = "" }) {
    const item = this.items.find(entry => entry.id == String(id ?? "").trim());
    if (!item) {
      throw new Error(
        `There is no item ${id}. The items are ${this.items[0].id} to ${this.items.at(-1).id}.`
      );
    }
    status = String(status ?? "").trim();
    if (!ITEM_STATES.includes(status) || status == "pending") {
      throw new Error("status must be done, failed, skipped or blocked.");
    }
    result = clean(result, MAX_RESULT);
    if (status != "skipped" && !result) {
      throw new Error(
        status == "done"
          ? "Say in result what the page showed that proves it done (a confirmation, an id, the saved entry)."
          : status == "blocked"
            ? "Say in result what the user must do."
            : "Say in result why it failed."
      );
    }
    item.status = status;
    item.result = result;
    this.touched = true;
    return item;
  }

  count(status) {
    return this.items.filter(item => item.status == status).length;
  }

  /** How many items need nothing more. */
  get finalCount() {
    return this.items.filter(item => FINAL.has(item.status)).length;
  }

  get pending() {
    return this.items.filter(item => item.status == "pending");
  }

  get blocked() {
    return this.items.filter(item => item.status == "blocked");
  }

  /** Whether every item is done, failed or skipped. */
  get complete() {
    return this.finalCount == this.items.length;
  }

  /** "2 of 3 done", with failures and blocks when there are any. */
  progress() {
    const parts = [`${this.count("done")} of ${this.items.length} done`];
    for (const status of ["failed", "skipped", "blocked"]) {
      const n = this.count(status);
      if (n) {
        parts.push(`${n} ${status}`);
      }
    }
    return parts.join(", ");
  }

  #line(item) {
    const group = item.group ? ` [${item.group}]` : "";
    const result = item.result ? `: ${item.result}` : "";
    return `- ${item.id} ${item.status}: ${item.title}${group}${result}`;
  }

  /** The list as the agent reads it, long ones cut to what matters next. */
  text() {
    const head = `Work list for "${this.goal}": ${this.progress()}.${
      this.doneWhen ? ` An item is done when: ${this.doneWhen}.` : ""
    }`;
    if (this.items.length <= LIST_IN_FULL) {
      return [head, ...this.items.map(item => this.#line(item))].join("\n");
    }
    const lines = [head];
    const done = this.items.filter(item => FINAL.has(item.status));
    if (done.length) {
      lines.push(`Last finished (${done.length} in all):`);
      lines.push(...done.slice(-SHOW_DONE).map(item => this.#line(item)));
    }
    if (this.blocked.length) {
      lines.push("Waiting on the user:");
      lines.push(...this.blocked.map(item => this.#line(item)));
    }
    const pending = this.pending;
    if (pending.length) {
      lines.push(`Next (${pending.length} pending in all):`);
      lines.push(...pending.slice(0, SHOW_NEXT).map(item => this.#line(item)));
    }
    return lines.join("\n");
  }

  /** What a work tool returns to the agent. */
  reply() {
    const next = this.pending[0];
    if (next) {
      return `${this.progress()}. Next: ${next.id} "${next.title}"${
        next.group ? ` [${next.group}]` : ""
      }. Go on with it now; do not stop to ask the user whether to continue.`;
    }
    if (this.blocked.length) {
      return `${this.progress()}. Every other item is finished; the rest waits on the user. Tell them what to do for each and end your turn.`;
    }
    return `${this.progress()}. Every item is finished: answer the user with what was done, in a few sentences.`;
  }

  /** The panel's table, drawn like a ui_table result. */
  table() {
    return {
      kind: "table",
      id: "work-list",
      title: `Work: ${this.goal} (${this.progress()})`.slice(0, 120),
      columns: ["#", "Item", "Status", "Result"],
      rows: this.items.map(item => ({
        cells: [
          item.id,
          item.group ? `${item.title} [${item.group}]` : item.title,
          item.status,
          item.result,
        ],
        tab: null,
        url: null,
      })),
      note: "",
    };
  }
}

/**
 * The MCP tool descriptions.
 *
 * @returns {object[]}
 */
export function workToolDefinitions() {
  return [
    {
      name: "work_plan",
      description:
        'Write down a request that asks for several of something as a work list, before you start: one item for each unit of work. "Create 3 accounts" is 3 items; "research 78 content types on the feed" is 78; "apply to 10 jobs on at least 5 platforms" is 10 items, each with the platform as its group, at least 5 groups. The browser shows the list to the user and keeps you working through it turn after turn until every item is done, failed or waits on the user. Call it again to replace the list, or with append true to add items you found.',
      inputSchema: {
        type: "object",
        properties: {
          goal: {
            type: "string",
            description: "The request in a short sentence",
          },
          items: {
            type: "array",
            description:
              'The items, in order: titles such as "Account 1", or {"title", "group"} with group naming the site or platform',
            items: {
              anyOf: [
                { type: "string" },
                {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    group: { type: "string" },
                  },
                  required: ["title"],
                },
              ],
            },
          },
          done_when: {
            type: "string",
            description:
              'What a page shows when an item is done, such as "the success message with the account config"',
          },
          append: {
            type: "boolean",
            description: "Add the items to the list instead of replacing it",
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
    },
    {
      name: "work_update",
      description:
        "Mark an item of the work list once you know how it ended, before you take the next one. done needs result: what the page showed that proves it (a confirmation, an id, the saved entry), read in this turn. failed says why; blocked says what the user must do (a login, a payment, a code sent to them) and the list goes on without it until they answer; skipped is for an item that turned out not to apply.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The item's id, such as w2" },
          status: {
            type: "string",
            enum: ["done", "failed", "skipped", "blocked"],
          },
          result: { type: "string" },
        },
        required: ["id", "status"],
        additionalProperties: false,
      },
    },
  ];
}

export const WORK_INSTRUCTIONS = `Work lists, for requests that ask for many of something:
- When the request asks for several of something (a number of accounts, items to research, applications across sites, every entry of a list), call work_plan first with one item per unit of work, then work through the items one at a time. For "apply to 10 jobs on at least 5 platforms", that is 10 items with the platform as each one's group, at least 5 groups.
- After each item, read the page for its result and call work_update before you take the next. After a submit, the result can show above or below where you are: read the outline or the whole page before you decide it did not work. Mark done only with what the page showed in this turn.
- Do as many items as you can in a turn. Do not stop to ask the user whether to go on: the browser starts your next turn with the list until every item is done, failed or waits on the user. Mark an item blocked, with what they must do, only for what only the user can do (a login, a password, a payment, a code sent to them), and go on with the other items.`;

/**
 * The turn that keeps the agent on its list.
 *
 * @param {ZendiaWorkList} work
 * @returns {string}
 */
export function continuePrompt(work) {
  const next = work.pending[0];
  return [
    work.request
      ? `The request you are working on, in the user's words: "${work.request}"`
      : null,
    work.text(),
    next
      ? `Carry on with the next pending item, ${next.id} "${next.title}"${
          next.group ? ` [${next.group}]` : ""
        }, by the same rules as before: observe the tab first, as it may have changed. Read each item's result on the page and call work_update before you take the next, and do as many as you can in this turn. If an item cannot be done, mark it failed with why and move on. Should a CAPTCHA stop you, say so in one sentence and end your turn: you are told to carry on once it is cleared.`
      : "Every item is finished: answer the user with what was done, in a few sentences.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
