/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { ZendiaWorkList, continuePrompt, workToolDefinitions, WORK_TOOLS } =
  ChromeUtils.importESModule(
    "resource:///modules/zendia/agent/ZendiaAgentWork.sys.mjs"
  );
const { decideNext, roundBudget } = ChromeUtils.importESModule(
  "resource:///modules/zendia/agent/ZendiaAgentLoop.sys.mjs"
);

function accounts() {
  return new ZendiaWorkList({
    goal: "Create 3 accounts",
    items: ["Account 1", "Account 2", "Account 3"],
    doneWhen: "the success message with the account config",
    request: "create 3 accounts use random data",
  });
}

const AGENT_TURN = { error: null, byUser: false };

add_task(function test_a_list_is_written_and_marked() {
  const work = accounts();
  Assert.deepEqual(
    work.items.map(item => item.id),
    ["w1", "w2", "w3"]
  );
  Assert.equal(work.progress(), "0 of 3 done");
  Assert.throws(
    () => work.update({ id: "w1", status: "done" }),
    /proves it done/,
    "done needs what the page showed"
  );
  Assert.throws(() => work.update({ id: "w9", status: "done", result: "x" }), /no item w9/);
  Assert.throws(() => work.update({ id: "w1", status: "pending" }), /status must be/);
  work.update({ id: "w1", status: "done", result: "user48213, valid 7 days" });
  Assert.equal(work.progress(), "1 of 3 done");
  Assert.equal(work.pending[0].id, "w2");
  Assert.ok(work.reply().includes('Next: w2 "Account 2"'));
  Assert.ok(work.text().includes("w1 done: Account 1: user48213"));
  const table = work.table();
  Assert.equal(table.id, "work-list");
  Assert.deepEqual(table.columns, ["#", "Item", "Status", "Result"]);
  Assert.equal(table.rows[0].cells[2], "done");
});

add_task(function test_items_carry_their_platform() {
  const work = new ZendiaWorkList({
    goal: "Apply to 10 jobs on 5 platforms",
    items: Array.from({ length: 10 }, (_, i) => ({
      title: `Job ${i + 1}`,
      group: ["LinkedIn", "Indeed", "Glassdoor", "Wellfound", "Jobstreet"][i % 5],
    })),
  });
  Assert.equal(work.items.length, 10);
  Assert.equal(work.items[6].group, "Indeed");
  Assert.ok(work.text().includes("Job 7 [Indeed]"));
  work.add([{ title: "Job 11", group: "Remotive" }]);
  Assert.equal(work.items.at(-1).id, "w11");
  Assert.throws(() => new ZendiaWorkList({ goal: "x", items: [] }), /needs items/);
});

add_task(function test_a_long_list_is_cut_to_what_comes_next() {
  const work = new ZendiaWorkList({
    goal: "Research 78 content types",
    items: Array.from({ length: 78 }, (_, i) => `Content type ${i + 1}`),
  });
  for (let i = 1; i <= 20; i++) {
    work.update({ id: `w${i}`, status: "done", result: `notes ${i}` });
  }
  const text = work.text();
  Assert.ok(text.includes("20 of 78 done"));
  Assert.ok(text.includes("Last finished (20 in all)"));
  Assert.ok(text.includes("w21 pending"));
  Assert.ok(!text.includes("w5 done"), "old items are left out");
  Assert.ok(!text.includes("w40 "), "far items are left out");
  Assert.ok(text.split("\n").length < 25);
});

add_task(function test_the_loop_goes_on_until_the_list_is_done() {
  const work = accounts();
  // The turn that wrote the list counts as progress.
  Assert.equal(decideNext(work, { error: null, byUser: true }).action, "continue");
  work.update({ id: "w1", status: "done", result: "user1 created" });
  Assert.equal(decideNext(work, AGENT_TURN).action, "continue");
  work.update({ id: "w2", status: "done", result: "user2 created" });
  work.update({ id: "w3", status: "failed", result: "username taken twice" });
  Assert.equal(decideNext(work, AGENT_TURN).action, "done");
});

add_task(function test_the_loop_stops_on_stalls_and_budget() {
  const work = accounts();
  Assert.equal(decideNext(work, AGENT_TURN).action, "continue");
  Assert.equal(decideNext(work, AGENT_TURN).action, "continue");
  Assert.equal(decideNext(work, AGENT_TURN).action, "continue");
  const stalled = decideNext(work, AGENT_TURN);
  Assert.equal(stalled.action, "stop");
  Assert.ok(stalled.reason.includes("3 turns in a row"));
  // The user says "continue": a fresh start.
  work.touched = true;
  work.update({ id: "w1", status: "done", result: "ok" });
  Assert.equal(decideNext(work, { error: null, byUser: true }).action, "continue");
  Assert.equal(roundBudget(work), 11);
  work.rounds = 11;
  work.update({ id: "w2", status: "done", result: "ok" });
  Assert.ok(decideNext(work, AGENT_TURN).reason.includes("used its 11 turns"));
});

add_task(function test_the_loop_waits_for_the_user_and_captchas() {
  const work = accounts();
  Assert.equal(
    decideNext(work, { ...AGENT_TURN, captchaHolds: true }).action,
    "wait",
    "the handoff carries on after a CAPTCHA"
  );
  work.touched = false;
  Assert.equal(
    decideNext(work, { error: null, byUser: true }).action,
    "wait",
    "a question beside the list does not restart it"
  );
  Assert.equal(decideNext(work, { error: "Stopped", byUser: false }).action, "stop");
  Assert.equal(decideNext(work, { ...AGENT_TURN, stoppedByUser: true }).action, "stop");
  work.update({ id: "w1", status: "blocked", result: "log in to the site" });
  Assert.equal(decideNext(work, AGENT_TURN).action, "continue", "others go on");
  work.update({ id: "w2", status: "done", result: "ok" });
  work.update({ id: "w3", status: "done", result: "ok" });
  Assert.equal(decideNext(work, AGENT_TURN).action, "wait", "only the user is left");
  Assert.equal(decideNext(null, AGENT_TURN).action, "wait");
});

add_task(function test_the_next_turn_restates_the_request_and_list() {
  const work = accounts();
  work.update({ id: "w1", status: "done", result: "user48213" });
  const prompt = continuePrompt(work);
  Assert.ok(prompt.includes('in the user\'s words: "create 3 accounts use random data"'));
  Assert.ok(prompt.includes('next pending item, w2 "Account 2"'));
  Assert.ok(prompt.includes("work_update"));
  Assert.ok(prompt.includes("end your turn"));
});

add_task(function test_the_tools_are_described() {
  Assert.deepEqual(
    workToolDefinitions().map(tool => tool.name),
    WORK_TOOLS
  );
});
