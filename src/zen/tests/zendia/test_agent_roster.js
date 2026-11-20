/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const {
  oneLine,
  recentActivity,
  shortDuration,
  sortRoster,
  stateOf,
  summarize,
  titleOf,
} = ChromeUtils.importESModule(
  "resource:///modules/zendia/agent/ZendiaAgentRoster.sys.mjs"
);
const { ZendiaWorkList } = ChromeUtils.importESModule(
  "resource:///modules/zendia/agent/ZendiaAgentWork.sys.mjs"
);

// Just enough of a ZendiaAgentConversation.
function conversation(messages = [], fields = {}) {
  return {
    messages,
    running: false,
    run: null,
    unseen: false,
    lastTurn: null,
    stoppedByUser: false,
    work: null,
    createdAt: 0,
    get pendingConfirm() {
      return (
        this.messages.findLast(
          m => m.type == "confirm" && m.status == "pending"
        ) ?? null
      );
    },
    ...fields,
  };
}

const ASKED = { type: "user", text: "Find me a flight to **Lisbon**\nin May" };
const TURN = { isolated: false, byUser: true, error: null };

add_task(function test_a_row_is_named_by_the_first_request() {
  Assert.equal(
    titleOf(conversation([ASKED, { type: "user", text: "cheaper" }])),
    "Find me a flight to Lisbon in May"
  );
  Assert.equal(titleOf(conversation()), "");
  Assert.equal(oneLine("x".repeat(200), 10), `${"x".repeat(9)}…`);
  Assert.equal(oneLine("- [a link](https://x) and `code`"), "a link and code");
});

add_task(function test_a_permission_waits_on_the_user_even_mid_turn() {
  const state = stateOf(
    conversation(
      [ASKED, { type: "confirm", status: "pending", text: "Pay €120?" }],
      { running: true, run: {} }
    )
  );
  Assert.equal(state.group, "attention");
  Assert.equal(state.kind, "confirm");
  Assert.equal(state.detail, "Pay €120?");
});

add_task(function test_a_running_turn_says_what_it_does() {
  const steps = [
    ASKED,
    { type: "step", status: "done", text: "Opened google.com/flights" },
    { type: "step", status: "running", text: "Typing Lisbon" },
  ];
  let state = stateOf(conversation(steps, { running: true, run: {} }));
  Assert.equal(state.group, "working");
  Assert.equal(state.kind, "working");
  Assert.equal(state.detail, "Typing Lisbon");

  state = stateOf(conversation([ASKED], { running: true }));
  Assert.equal(state.kind, "starting", "no run yet: it is getting ready");

  state = stateOf(
    conversation(steps, { running: true, run: {}, stoppedByUser: true })
  );
  Assert.equal(state.kind, "stopping", "stopped, until its process exits");
  Assert.equal(state.group, "working");

  state = stateOf(
    conversation([ASKED], { running: true, run: { turn: { isolated: true } } })
  );
  Assert.equal(state.kind, "captcha-solving");
});

add_task(function test_what_holds_a_finished_turn_up() {
  const finished = { lastTurn: TURN, unseen: true };
  Assert.equal(
    stateOf(conversation([ASKED], finished), { captchaHolds: true }).kind,
    "captcha"
  );
  Assert.equal(
    stateOf(conversation([ASKED], { lastTurn: { ...TURN, error: "exit 1" } }))
      .kind,
    "error"
  );
  Assert.equal(
    stateOf(
      conversation([ASKED], {
        lastTurn: { ...TURN, error: "killed" },
        stoppedByUser: true,
      })
    ).kind,
    "stopped",
    "a turn the user stopped is no error"
  );

  const work = new ZendiaWorkList({
    goal: "Apply to 3 jobs",
    items: ["Job 1", "Job 2", "Job 3"],
  });
  work.update({ id: "w1", status: "done", result: "applied" });
  work.update({ id: "w2", status: "blocked", result: "Log in to Indeed" });
  let state = stateOf(conversation([ASKED], { ...finished, work }));
  Assert.equal(state.kind, "blocked");
  Assert.equal(state.detail, "Log in to Indeed");

  work.update({ id: "w2", status: "failed", result: "closed" });
  work.paused = "no item was finished in 3 turns in a row";
  state = stateOf(conversation([ASKED], { ...finished, work }));
  Assert.equal(state.kind, "paused");
  Assert.ok(state.detail.includes("1 of 3 done"));
});

add_task(function test_finished_until_looked_at() {
  const messages = [ASKED, { type: "agent", text: "## Found 3 flights" }];
  let state = stateOf(conversation(messages, { lastTurn: TURN, unseen: true }));
  Assert.equal(state.group, "done");
  Assert.equal(state.detail, "Found 3 flights");
  state = stateOf(conversation(messages, { lastTurn: TURN }));
  Assert.equal(state.group, "idle");
});

add_task(function test_rows_hold_their_place_within_a_group() {
  const entry = (group, createdAt) => ({
    state: { group },
    conversation: { createdAt },
  });
  const sorted = sortRoster([
    entry("idle", 5),
    entry("working", 1),
    entry("attention", 2),
    entry("working", 3),
  ]);
  Assert.deepEqual(
    sorted.map(e => `${e.state.group}:${e.conversation.createdAt}`),
    ["attention:2", "working:3", "working:1", "idle:5"]
  );
  Assert.equal(summarize(sorted), "1 needs you · 2 working · 1 idle");
});

add_task(function test_peek_and_clock() {
  const messages = [
    { type: "user", text: "old" },
    { type: "agent", text: "old answer" },
    ASKED,
    { type: "step", status: "done", text: "Opened" },
    { type: "tool", text: "work_plan" },
    { type: "agent", text: "" },
    { type: "ui", status: "draft", text: "" },
    { type: "note", text: "CAPTCHA cleared" },
  ];
  Assert.deepEqual(
    recentActivity(messages).map(item => item.type),
    ["step", "tool", "note"],
    "only what came after the last request"
  );
  Assert.equal(recentActivity(messages, 1)[0].text, "CAPTCHA cleared");
  Assert.equal(shortDuration(2000), "now");
  Assert.equal(shortDuration(42000), "42s");
  Assert.equal(shortDuration(5 * 60000), "5m");
  Assert.equal(shortDuration(3 * 3600000), "3h");
  Assert.equal(shortDuration(72 * 3600000), "3d");
});
