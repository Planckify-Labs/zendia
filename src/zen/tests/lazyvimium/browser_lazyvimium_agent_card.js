/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// The composer's model chip and its card, and what the panel shows while the
// agent works, with a fake Claude that saves its arguments.

const { Lazyvimium } = ChromeUtils.importESModule(
  "resource:///modules/lazyvimium/Lazyvimium.sys.mjs"
);
const { LazyvimiumAgents } = ChromeUtils.importESModule(
  "resource:///modules/lazyvimium/agent/LazyvimiumAgents.sys.mjs"
);
const { railFraction, formatTokens, searchModels, effortLabel } =
  ChromeUtils.importESModule(
    "resource:///modules/lazyvimium/ui/LazyvimiumAgentModelCard.sys.mjs"
  );
const { followStep, runwayHeight } = ChromeUtils.importESModule(
  "resource:///modules/lazyvimium/ui/LazyvimiumAgentFollow.sys.mjs"
);

const dock = () => Lazyvimium.agentDockFor(window);
const dockElement = () => document.getElementById("lazyvimium-agent-dock");
const $ = selector => dockElement().querySelector(selector);
const card = () => document.getElementById("lazyvimium-model-card");
const inCard = selector => card()?.querySelector(selector);

// Each line of `body` runs in the fake agent, after it saved its arguments.
async function fakeAgent(body) {
  const dir = await IOUtils.createUniqueDirectory(
    PathUtils.tempDir,
    "lzv-card-agent"
  );
  const script = PathUtils.join(dir, "claude");
  await IOUtils.writeUTF8(
    script,
    `#!/bin/sh
printf '%s\\n' "$@" > '${dir}/args'
echo '{"type":"system","subtype":"init","session_id":"c-1"}'
${body}
echo '{"type":"result","is_error":false,"result":"done","session_id":"c-1"}'
`
  );
  await IOUtils.setPermissions(script, 0o755);
  const agent = { id: "claude", name: "Fake Claude", path: script };
  const original = LazyvimiumAgents.defaultAgent;
  LazyvimiumAgents.defaultAgent = async () => agent;
  registerCleanupFunction(async () => {
    LazyvimiumAgents.defaultAgent = original;
    await IOUtils.remove(dir, { recursive: true });
  });
  return dir;
}

const say = text =>
  `echo '{"type":"assistant","message":{"content":[{"type":"text","text":"${text}"}]}}'`;
const useTool = name =>
  `echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"${name}","input":{}}]}}'`;
// An answer tall enough to scroll, as JSON escapes inside say().
const paragraphs = count =>
  Array.from({ length: count }, (_, i) => `line ${i}`).join("\\n\\n");

function clearPicks() {
  for (const pref of ["model", "effort", "context"]) {
    Services.prefs.clearUserPref(`lazyvimium.agent.${pref}.claude`);
  }
}

async function openDock(body = say("ok")) {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "data:text/html,<title>Shop</title><p>shop"
  );
  const dir = await fakeAgent(body);
  clearPicks();
  await dock().open(tab.linkedBrowser);
  return { tab, dir };
}

async function closeDock(tab) {
  dock().close();
  await TestUtils.waitForCondition(() => dockElement().hidden, "closed");
  LazyvimiumAgents.reset(tab.linkedBrowser);
  BrowserTestUtils.removeTab(tab);
  clearPicks();
}

async function openCard() {
  $(".lazyvimium-agent-model").click();
  await TestUtils.waitForCondition(() => card(), "the card opens");
}

function key(name, options = {}) {
  EventUtils.synthesizeKey(name, options, window);
}

function send(text) {
  const input = $(".lazyvimium-agent-input");
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
  key("KEY_Enter");
}

function pickSonnet() {
  Services.prefs.setStringPref("lazyvimium.agent.model.claude", "sonnet");
}

add_task(function test_the_card_pure_helpers() {
  is(railFraction(20, 230), 0, "the first stop is the thumb's inset");
  is(railFraction(210, 230), 1, "and the last one its other side");
  is(railFraction(-40, 230), 0, "a pointer past the end stays at the end");
  is(railFraction(500, 230), 1, "on both sides");
  is(formatTokens(200000), "200K", "thousands");
  is(formatTokens(1048576), "1M", "a binary million reads as a million");
  is(formatTokens(872000), "872K", "and no rounding up to a million");
  is(effortLabel("xhigh"), "X-High", "known levels have their own name");
  is(effortLabel("turbo"), "Turbo", "an unknown one is capitalised");
  const rows = [
    { id: "a", name: "Haiku", detail: "the small sonnet of models" },
    { id: "b", name: "My Sonnet" },
    { id: "c", name: "Sonnet" },
  ];
  Assert.deepEqual(
    searchModels(rows, "son").map(row => row.id),
    ["c", "b", "a"],
    "the name's start, then the name, then the description"
  );
  is(searchModels(rows, " ").length, 3, "an empty search keeps everything");
  is(searchModels(rows, "zzz").length, 0, "no match lists nothing");
});

add_task(function test_the_room_held_under_a_request() {
  is(runwayHeight(600, 100, 32), 532, "what the view has left, plus the lane");
  is(runwayHeight(600, 900, 32), 32, "a long answer needs only the lane");
  const step = followStep({ position: 0, velocity: 0, growth: 0 }, 100, 1);
  Assert.greater(step.position, 0, "the spring moves toward the end");
  Assert.lessOrEqual(step.position, 100, "and never past it");
});

add_task(async function test_the_chip_and_card_show_what_is_sent() {
  const { tab } = await openDock();
  pickSonnet();
  await openCard();

  is(
    inCard(".lazyvimium-model-effort").textContent,
    "Default",
    "until a level is picked the agent's own setting decides"
  );
  ok(
    inCard(".lazyvimium-effort").hasAttribute("unset"),
    "and the fill says so"
  );
  ok(
    $(".lazyvimium-agent-model-effort").hidden,
    "the chip shows no level it does not send"
  );
  is(
    inCard(".lazyvimium-effort").getAttribute("aria-valuemax"),
    "4",
    "Claude takes five levels"
  );

  key("KEY_ArrowRight");
  is(
    Services.prefs.getStringPref("lazyvimium.agent.effort.claude"),
    "high",
    "a key moves one level up from where the slider sat"
  );
  await TestUtils.waitForCondition(
    () => inCard(".lazyvimium-model-effort").dataset.rollText == "High",
    "the title rolls to the level"
  );
  await TestUtils.waitForCondition(
    () => $(".lazyvimium-agent-model-effort").dataset.rollText == "High",
    "and so does the chip"
  );
  ok(!$(".lazyvimium-agent-model-effort").hidden, "which now shows it");

  key("KEY_End");
  is(
    Services.prefs.getStringPref("lazyvimium.agent.effort.claude"),
    "max",
    "End goes to the last level"
  );
  key("KEY_ArrowRight");
  is(
    Services.prefs.getStringPref("lazyvimium.agent.effort.claude"),
    "max",
    "and the rail does not wrap"
  );

  inCard(".lazyvimium-effort").dispatchEvent(new MouseEvent("dblclick"));
  ok(
    !Services.prefs.prefHasUserValue("lazyvimium.agent.effort.claude"),
    "a double click gives the choice back to the agent's own setting"
  );

  key("KEY_Escape");
  ok(!card(), "Esc closes it");
  is(
    document.activeElement,
    $(".lazyvimium-agent-input"),
    "and the keys go back to the box"
  );
  await closeDock(tab);
});

add_task(async function test_dragging_commits_and_follows_the_pointer() {
  const { tab } = await openDock();
  pickSonnet();
  await openCard();
  const slider = inCard(".lazyvimium-effort");
  const rail = slider.getBoundingClientRect();
  const y = rail.height / 2;
  const at = fraction => 20 + fraction * (rail.width - 40);
  // Real input: pointer capture needs a pointer that is really down.
  const fire = (type, x) =>
    EventUtils.synthesizeMouse(slider, x, y, { type }, window);

  fire("mousedown", at(0));
  ok(slider.hasAttribute("dragging"), "pressing holds the thumb");
  is(
    Services.prefs.getStringPref("lazyvimium.agent.effort.claude"),
    "low",
    "a press picks the level under it"
  );
  fire("mousemove", at(0.6));
  is(
    Services.prefs.getStringPref("lazyvimium.agent.effort.claude"),
    "high",
    "the level changes during the drag, not on release"
  );
  is(
    parseFloat(slider.style.getPropertyValue("--lazyvimium-effort-f")).toFixed(
      1
    ),
    "0.6",
    "held, the thumb stays under the pointer, between stops"
  );
  fire("mouseup", at(0.6));
  ok(!slider.hasAttribute("dragging"), "letting go ends it");
  is(
    parseFloat(slider.style.getPropertyValue("--lazyvimium-effort-f")),
    0.5,
    "and it settles on the stop"
  );
  key("KEY_Escape");
  await closeDock(tab);
});

add_task(async function test_the_thumb_eases_when_it_is_not_held() {
  const { tab } = await openDock();
  pickSonnet();
  await openCard();
  const slider = inCard(".lazyvimium-effort");
  const thumb = inCard(".lazyvimium-effort-thumb");
  const left = () => thumb.getBoundingClientRect().left;
  const from = left();
  key("KEY_End");
  await new Promise(resolve => requestAnimationFrame(resolve));
  await new Promise(resolve => requestAnimationFrame(resolve));
  const during = left();
  await TestUtils.waitForCondition(
    () => !slider.getAnimations().length,
    "the ease ends"
  );
  const to = left();
  Assert.greater(to, from, "the thumb moved");
  Assert.less(during, to, "and got there over time, not in one frame");
  key("KEY_Escape");
  await closeDock(tab);
});

add_task(async function test_the_context_window_is_a_real_choice_for_claude() {
  const { tab } = await openDock();
  pickSonnet();
  await openCard();
  const row = inCard(".lazyvimium-model-option[choice]");
  ok(row, "Claude's window can be chosen");
  is(
    row.querySelector(".lazyvimium-model-value").textContent,
    "1M",
    "its default is what the model has"
  );

  key("c");
  const menu = () => document.querySelector(".lazyvimium-model-card[submenu]");
  ok(menu(), "c opens the choices without a mouse");
  const choices = menu().querySelectorAll(".lazyvimium-model-choice");
  is(choices.length, 2, "two sizes");
  ok(choices[0].hasAttribute("selected"), "the default is checked");
  ok(
    choices[0].querySelector(".lazyvimium-model-tag"),
    "and tagged as the default"
  );

  key("j");
  key("KEY_Enter");
  ok(!menu(), "picking closes the choices");
  ok(card(), "and leaves the card open");
  is(
    Services.prefs.getStringPref("lazyvimium.agent.context.claude"),
    "200k",
    "the pick is kept"
  );

  key("c");
  key("KEY_Escape");
  ok(!menu(), "Esc closes only the choices");
  ok(card(), "the card stays");
  key("KEY_Escape");
  await closeDock(tab);
});

add_task(async function test_a_size_that_cannot_be_chosen_is_only_shown() {
  const { tab } = await openDock();
  Services.prefs.setStringPref("lazyvimium.agent.model.claude", "fixed");
  const modelsNow = LazyvimiumAgents.modelsNow;
  LazyvimiumAgents.modelsNow = () => [
    { id: "fixed", name: "Fixed", context: 200000 },
  ];
  registerCleanupFunction(() => {
    LazyvimiumAgents.modelsNow = modelsNow;
  });
  await openCard();
  ok(!inCard(".lazyvimium-effort"), "a model with no levels has no slider");
  ok(
    inCard(".lazyvimium-model-title").hasAttribute("single"),
    "and the header drops to its name"
  );
  ok(!inCard(".lazyvimium-model-option[choice]"), "nothing to open");
  is(
    inCard(".lazyvimium-model-value").textContent,
    "200K",
    "the size is still shown"
  );
  key("KEY_Escape");
  LazyvimiumAgents.modelsNow = modelsNow;
  await closeDock(tab);
});

add_task(async function test_the_model_list_searches_and_picks() {
  const { tab } = await openDock();
  await openCard();
  inCard(".lazyvimium-model-title").click();
  const search = () => inCard(".lazyvimium-model-search");
  ok(search(), "the name opens the list");
  is(document.activeElement, search(), "with the keys in the search box");

  EventUtils.sendString("hai", window);
  await TestUtils.waitForCondition(
    () => card().querySelectorAll(".lazyvimium-model-row").length == 1,
    "typing narrows the list"
  );
  is(search().value, "hai", "the letters reach the box, not vim mode");
  key("KEY_Backspace");
  key("KEY_Backspace");
  key("KEY_Backspace");
  await TestUtils.waitForCondition(
    () => card().querySelectorAll(".lazyvimium-model-row").length > 1,
    "clearing the box lists them all"
  );
  const rows = () => [...card().querySelectorAll(".lazyvimium-model-row")];
  const active = () => rows().findIndex(row => row.hasAttribute("active"));
  const before = active();
  const other = rows()[before == 0 ? 1 : 0];
  other.dispatchEvent(new MouseEvent("mouseenter"));
  is(active(), before, "a list opening under the pointer keeps its highlight");
  other.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  is(active(), rows().indexOf(other), "moving the mouse takes it");
  EventUtils.sendString("hai", window);
  await TestUtils.waitForCondition(
    () => card().querySelectorAll(".lazyvimium-model-row").length == 1,
    "and typing narrows it again"
  );
  ok(
    inCard(".lazyvimium-model-detail").textContent.startsWith("haiku"),
    "the line under the list names the highlighted model"
  );
  ok(
    !inCard(".lazyvimium-model-row").hasAttribute("title"),
    "with no system tooltip, which ignores the theme"
  );
  key("KEY_Enter");
  is(
    Services.prefs.getStringPref("lazyvimium.agent.model.claude"),
    "haiku",
    "Enter picks the row"
  );
  ok(card(), "the card stays open");
  ok(inCard(".lazyvimium-effort"), "on its first page");
  await TestUtils.waitForCondition(
    () => $(".lazyvimium-agent-model-name").dataset.rollText == "Haiku",
    "the chip follows the pick"
  );

  key("j");
  ok(search(), "j opens the list from the first page");
  key("KEY_Escape");
  ok(!search(), "Esc steps back to the first page");
  ok(card(), "before it closes the card");
  key("KEY_Escape");
  await closeDock(tab);
});

add_task(async function test_a_click_outside_closes_and_the_chip_toggles() {
  const { tab } = await openDock();
  await openCard();
  $(".lazyvimium-agent-model").click();
  await TestUtils.waitForCondition(() => !card(), "the chip closes it again");

  await openCard();
  EventUtils.synthesizeMouseAtCenter($(".lazyvimium-agent-log"), {}, window);
  await TestUtils.waitForCondition(() => !card(), "a click outside closes it");
  ok(!dockElement().hidden, "and the panel stays");
  await closeDock(tab);
});

add_task(async function test_the_levels_reach_the_agent() {
  const { tab, dir } = await openDock();
  const args = async () =>
    (await IOUtils.readUTF8(PathUtils.join(dir, "args"))).split("\n");
  const turn = async text => {
    const conversation = LazyvimiumAgents.conversationFor(tab.linkedBrowser);
    send(text);
    await TestUtils.waitForCondition(
      () => conversation.startedAt && !conversation.running,
      "the turn ends"
    );
    return args();
  };
  await LazyvimiumAgents.models(
    (await LazyvimiumAgents.agents()).find(agent => agent.id == "claude") ?? {
      id: "claude",
      path: "",
    }
  );
  pickSonnet();

  let line = await turn("first");
  ok(!line.includes("--effort"), "nothing picked, nothing overridden");
  ok(!line.includes("--autocompact"), "the default window needs no flag");

  Services.prefs.setStringPref("lazyvimium.agent.effort.claude", "xhigh");
  Services.prefs.setStringPref("lazyvimium.agent.context.claude", "200k");
  line = await turn("second");
  is(line[line.indexOf("--effort") + 1], "xhigh", "a picked level is sent");
  is(
    line[line.indexOf("--autocompact") + 1],
    "200k",
    "and a picked window, as a compaction limit"
  );
  await closeDock(tab);
});

add_task(async function test_the_working_row_starts_ticks_and_leaves() {
  const { tab } = await openDock(`sleep 1\n${say("done")}`);
  const conversation = LazyvimiumAgents.conversationFor(tab.linkedBrowser);
  send("go");
  // It joins the log with the first message.
  await TestUtils.waitForCondition(
    () => $(".lazyvimium-agent-working[shown]"),
    "the working row shows"
  );
  const working = $(".lazyvimium-agent-working");
  await TestUtils.waitForCondition(
    () => /…$/.test($(".lazyvimium-agent-working-word").dataset.rollText ?? ""),
    "with a word"
  );
  await TestUtils.waitForCondition(
    () => /\d+s/.test($(".lazyvimium-agent-working-clock").textContent),
    "and a clock once the agent runs"
  );
  ok(
    $(".lazyvimium-agent-foot").contains(working),
    "it sits in the lane at the end"
  );
  is(
    $(".lazyvimium-agent-log").lastElementChild,
    $(".lazyvimium-agent-foot"),
    "and the lane is the log's last row"
  );

  await TestUtils.waitForCondition(
    () => !conversation.running,
    "the turn ends"
  );
  await TestUtils.waitForCondition(
    () => !working.hasAttribute("shown"),
    "the row goes"
  );
  Assert.greaterOrEqual(
    $(".lazyvimium-agent-foot").getBoundingClientRect().height,
    32,
    "and its lane stays, so nothing moves"
  );
  await closeDock(tab);
});

add_task(async function test_steps_share_a_group_that_folds_itself() {
  const { tab } = await openDock(
    `${useTool("Read")}\nsleep 0.4\n${useTool("Grep")}\nsleep 0.4\n${say("done")}`
  );
  const conversation = LazyvimiumAgents.conversationFor(tab.linkedBrowser);
  send("go");
  await TestUtils.waitForCondition(
    () => $(".lazyvimium-agent-group[live]"),
    "a live group shows"
  );
  const group = $(".lazyvimium-agent-group");
  ok(group.hasAttribute("open"), "open while it works");
  await TestUtils.waitForCondition(
    () => group.querySelectorAll('[type="tool"]').length == 2,
    "both steps land in the one group"
  );
  await TestUtils.waitForCondition(
    () => /Grep/.test(group.textContent),
    "its title says what it does now"
  );

  await TestUtils.waitForCondition(
    () => !conversation.running,
    "the turn ends"
  );
  await TestUtils.waitForCondition(
    () => !group.hasAttribute("live"),
    "the group settles"
  );
  ok(!group.hasAttribute("open"), "and folds itself");
  const title = group.querySelector(".lazyvimium-agent-group-title");
  await TestUtils.waitForCondition(
    () => /^Worked for \d+s · 2 steps$/.test(title.dataset.rollText),
    `it says what it came to: ${title.dataset.rollText}`
  );

  group.querySelector(".lazyvimium-agent-group-head").click();
  ok(group.hasAttribute("open"), "a click opens it again");
  const input = $(".lazyvimium-agent-input");
  input.focus();
  send("again");
  await TestUtils.waitForCondition(
    () => !conversation.running,
    "the turn ends"
  );
  ok(group.hasAttribute("open"), "what the reader chose outlasts a redraw");
  await closeDock(tab);
});

add_task(async function test_a_request_rises_and_the_answer_has_room() {
  const long = paragraphs(60);
  // Slower than the glide, to see the room held before the answer fills it.
  const { tab } = await openDock(`sleep 1\n${say(long)}\nsleep 0.2`);
  const log = $(".lazyvimium-agent-log");
  const conversation = LazyvimiumAgents.conversationFor(tab.linkedBrowser);
  send("first");
  await TestUtils.waitForCondition(
    () => !conversation.running,
    "the turn ends"
  );
  await TestUtils.waitForCondition(
    () => log.scrollHeight > log.clientHeight,
    "the answer is taller than the view"
  );

  send("second");
  await TestUtils.waitForCondition(() => {
    const rows = log.querySelectorAll('[type="user"]');
    return rows.length == 2;
  }, "the request is drawn");
  const prompt = [...log.querySelectorAll('[type="user"]')].at(-1);
  await TestUtils.waitForCondition(() => {
    const top =
      prompt.getBoundingClientRect().top - log.getBoundingClientRect().top;
    return top >= 0 && top < 40;
  }, "it rises to the top of the view");
  Assert.greater(
    $(".lazyvimium-agent-foot").getBoundingClientRect().height,
    32,
    "with the room under it held open"
  );
  await TestUtils.waitForCondition(
    () => !conversation.running,
    "the turn ends"
  );
  await TestUtils.waitForCondition(
    () => [...log.querySelectorAll('[type="agent"]')].length == 2,
    "the second answer is drawn"
  );
  await new Promise(resolve => setTimeout(resolve, 500));
  const top =
    prompt.getBoundingClientRect().top - log.getBoundingClientRect().top;
  Assert.less(
    Math.abs(top),
    40,
    "an answer that lands whole is read from its start, not its end"
  );
  await closeDock(tab);
});

add_task(async function test_an_answer_landing_during_the_glide_is_safe() {
  const { tab } = await openDock(say(paragraphs(60)));
  const conversation = LazyvimiumAgents.conversationFor(tab.linkedBrowser);
  const errors = [];
  const listener = {
    observe(message) {
      if (message.message?.includes("LazyvimiumAgentFollow")) {
        errors.push(message.message);
      }
    },
  };
  Services.console.registerListener(listener);
  send("first");
  await TestUtils.waitForCondition(
    () => !conversation.running,
    "the turn ends"
  );
  await new Promise(resolve => setTimeout(resolve, 500));
  Services.console.unregisterListener(listener);
  Assert.deepEqual(errors, [], "the glide outlives what it was gliding to");
  await closeDock(tab);
});

add_task(async function test_small_steps_up_reach_the_first_message() {
  // A long first answer, then a short one, which leaves the request resting
  // at the top with the end close by.
  const { tab } = await openDock(
    `if [ -f "$0.seen" ]; then ${say("short")}; else touch "$0.seen"; ${say(paragraphs(60))}; fi`
  );
  const log = $(".lazyvimium-agent-log");
  const conversation = LazyvimiumAgents.conversationFor(tab.linkedBrowser);
  const turn = async text => {
    send(text);
    await TestUtils.waitForCondition(
      () => !conversation.running,
      "the turn ends"
    );
    await new Promise(resolve => setTimeout(resolve, 500));
  };
  await turn("first");
  await turn("second");
  const first = log.querySelector('[type="user"]');
  const frames = async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
  };
  const start = log.scrollTop;
  Assert.greater(start, 200, "the conversation is scrolled down");

  // A notch of the wheel, then a pause to read, twice: the view stays exactly
  // where the reader put it. It neither drops the room it held, which would
  // jump it, nor goes back to the end.
  for (const top of [start - 30, start - 60]) {
    log.dispatchEvent(new WheelEvent("wheel", { deltaY: -30, bubbles: true }));
    log.scrollTop = top;
    await new Promise(resolve => setTimeout(resolve, 600));
    Assert.less(
      Math.abs(log.scrollTop - top),
      2,
      `a pause leaves the reader at ${top}, not ${log.scrollTop}`
    );
  }

  // What a trackpad, or a smooth wheel, does: many small steps.
  for (let top = start - 70; top > 0; top -= 10) {
    log.dispatchEvent(new WheelEvent("wheel", { deltaY: -10, bubbles: true }));
    log.scrollTop = top;
    await frames();
    Assert.lessOrEqual(
      log.scrollTop,
      top + 1,
      "each step up stays where the reader put it"
    );
  }
  log.scrollTop = 0;
  await frames();
  is(log.scrollTop, 0, "the top can be reached");
  const row = first.getBoundingClientRect();
  Assert.greaterOrEqual(
    row.top,
    log.getBoundingClientRect().top,
    "and the first message is in view"
  );

  // Coming back down, the end picks the reader up again.
  log.scrollTop = log.scrollHeight;
  await frames();
  await closeDock(tab);
});

add_task(async function test_each_level_has_its_own_color() {
  const { tab } = await openDock();
  pickSonnet();
  await openCard();
  const fill = inCard(".lazyvimium-effort-fill");
  const slider = inCard(".lazyvimium-effort");
  const color = () =>
    slider.style.getPropertyValue("--lazyvimium-effort-color");
  const seen = new Set();
  key("KEY_Home");
  for (const level of ["low", "medium", "high", "xhigh", "max"]) {
    is(
      Services.prefs.getStringPref("lazyvimium.agent.effort.claude"),
      level,
      `on ${level}`
    );
    ok(
      color().includes(`--lazyvimium-effort-${level}`),
      "the fill takes that level's role"
    );
    ok(
      getComputedStyle(document.documentElement)
        .getPropertyValue(`--lazyvimium-effort-${level}`)
        .trim(),
      "which the theme defines"
    );
    seen.add(
      getComputedStyle(document.documentElement)
        .getPropertyValue(`--lazyvimium-effort-${level}`)
        .trim()
    );
    key("KEY_ArrowRight");
  }
  is(seen.size, 5, "and no two levels share a color");
  ok(fill, "the fill is there");
  key("KEY_Escape");
  await closeDock(tab);
});

add_task(async function test_the_chip_sits_by_send_and_the_card_opens_up() {
  const { tab } = await openDock();
  const chip = $(".lazyvimium-agent-model");
  ok(
    $(".lazyvimium-agent-composer-bar").contains(chip),
    "the chip is in the composer's bar"
  );
  ok(chip.querySelector(".lazyvimium-agent-logo"), "with the agent's mark");
  // The panel is still sliding in, and the chip with it.
  await TestUtils.waitForCondition(
    () => !dockElement().getAnimations().length,
    "the panel settles"
  );
  await openCard();
  is(card().getAttribute("placement"), "above", "the card opens over it");
  await TestUtils.waitForCondition(
    () => !card().getAnimations().length,
    "the card settles"
  );
  const rect = card().getBoundingClientRect();
  const chipRect = chip.getBoundingClientRect();
  Assert.less(
    Math.abs(rect.right - chipRect.right),
    1,
    "their right edges line up"
  );
  Assert.less(rect.bottom, chipRect.top, "and it clears the chip");
  key("KEY_Escape");
  await closeDock(tab);
});

add_task(async function test_a_long_name_keeps_the_level_readable() {
  const { tab } = await openDock();
  const modelsNow = LazyvimiumAgents.modelsNow;
  LazyvimiumAgents.modelsNow = () => [
    {
      id: "sonnet",
      name: "Beam Free",
      efforts: ["low", "medium", "high"],
      defaultEffort: "medium",
    },
  ];
  registerCleanupFunction(() => {
    LazyvimiumAgents.modelsNow = modelsNow;
  });
  pickSonnet();
  Services.prefs.setStringPref("lazyvimium.agent.effort.claude", "medium");
  await openCard();
  key("KEY_Escape");
  const chip = $(".lazyvimium-agent-model");
  const effort = $(".lazyvimium-agent-model-effort");
  await TestUtils.waitForCondition(
    () =>
      effort.dataset.rollText == "Medium" &&
      !chip.querySelector(".lazyvimium-roll-glyph"),
    "the chip comes to rest"
  );
  Assert.lessOrEqual(
    effort.scrollWidth,
    effort.clientWidth,
    "the level is not cut off"
  );
  LazyvimiumAgents.modelsNow = modelsNow;
  await closeDock(tab);
});

add_task(async function test_scrolling_up_lets_go_and_the_button_comes_back() {
  const long = paragraphs(80);
  const { tab } = await openDock(say(long));
  const log = $(".lazyvimium-agent-log");
  const jump = $(".lazyvimium-agent-jump");
  const conversation = LazyvimiumAgents.conversationFor(tab.linkedBrowser);
  send("go");
  await TestUtils.waitForCondition(
    () => !conversation.running,
    "the turn ends"
  );
  await TestUtils.waitForCondition(
    () => log.scrollHeight - log.clientHeight > 700,
    "there is far to scroll"
  );
  ok(!jump.hasAttribute("shown"), "no button at the end");

  log.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
  log.scrollTop = 0;
  await TestUtils.waitForCondition(
    () => jump.hasAttribute("shown"),
    "far from the end the button shows"
  );
  await new Promise(resolve => requestAnimationFrame(resolve));
  is(log.scrollTop, 0, "and nothing pulls the reader back");

  jump.click();
  await TestUtils.waitForCondition(
    () => log.scrollHeight - log.clientHeight - log.scrollTop < 2,
    "the button goes to the end"
  );
  await TestUtils.waitForCondition(
    () => !jump.hasAttribute("shown"),
    "and hides"
  );
  await closeDock(tab);
});
