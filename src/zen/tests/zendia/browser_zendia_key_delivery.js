/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Keys have to work wherever the focus happens to be, and whatever the page
// that was left had focused.

const { Zendia } = ChromeUtils.importESModule(
  "resource:///modules/zendia/Zendia.sys.mjs"
);

const PAGE = "data:text/html,<!doctype html><body style='height:6000px'>x";
const FIELD = `data:text/html,<!doctype html><input id="f" value="abc"><p>x</p>`;
const LINK =
  "data:text/html," +
  encodeURIComponent(
    `<!doctype html><a href="#a">first</a> <a href="#b">second</a>`
  );

// The key that moves from a tab to the one beside it, wherever Zen put it.
function keyFrom(from, to) {
  const tabs = gBrowser.visibleTabs;
  const next = tabs[(tabs.indexOf(from) + 1) % tabs.length];
  return next == to ? "J" : "K";
}

async function openTab(url = PAGE) {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);
  registerCleanupFunction(() => {
    if (gBrowser.tabs.includes(tab)) {
      BrowserTestUtils.removeTab(tab);
    }
  });
  tab.linkedBrowser.focus();
  return tab;
}

function modeOf(browser) {
  return Zendia.stateFor(browser).mode;
}

function selected(tab, message) {
  return TestUtils.waitForCondition(() => gBrowser.selectedTab == tab, message);
}

function focusedInPage(browser) {
  return SpecialPowers.spawn(
    browser,
    [],
    () => content.document.activeElement?.localName
  );
}

async function splitInTwo(url = PAGE) {
  const left = await openTab(url);
  const right = await openTab(url);
  gZenViewSplitter.splitTabs([left, right], "vsep", 1);
  await TestUtils.waitForCondition(() => right.splitView, "split");
  await TestUtils.waitForCondition(
    () =>
      left.linkedBrowser.getBoundingClientRect().right <=
      right.linkedBrowser.getBoundingClientRect().left + 1,
    "the panes sit side by side"
  );
  return { left, right };
}

function unsplit(...tabs) {
  gZenViewSplitter.unsplitCurrentView();
  for (const tab of tabs) {
    BrowserTestUtils.removeTab(tab);
  }
}

add_task(async function test_tab_keys_leave_the_empty_tab() {
  const first = await openTab();
  const last = await openTab();
  const tabs = gBrowser.visibleTabs;
  const empty = gZenWorkspaces._emptyTab;
  ok(!tabs.includes(empty), "Zen's empty tab is off the list of tabs");

  gBrowser.selectedTab = empty;
  empty.linkedBrowser.focus();
  await selected(empty, "on the empty tab");
  EventUtils.synthesizeKey("J", { shiftKey: true });
  await selected(tabs[0], "<S-j> goes to the first tab");

  gBrowser.selectedTab = empty;
  empty.linkedBrowser.focus();
  await selected(empty, "back on the empty tab");
  EventUtils.synthesizeKey("K", { shiftKey: true });
  await selected(tabs.at(-1), "<S-k> goes to the last tab");

  BrowserTestUtils.removeTab(first);
  BrowserTestUtils.removeTab(last);
});

add_task(async function test_keys_with_the_focus_in_the_browser_ui() {
  const other = await openTab();
  const tab = await openTab();

  const key = keyFrom(tab, other);

  Services.focus.clearFocus(window);
  is(Services.focus.focusedElement, null, "nothing has focus");
  EventUtils.synthesizeKey(key, { shiftKey: true });
  await selected(other, "a key with nothing focused reaches the keymap");

  gBrowser.selectedTab = tab;
  await selected(tab, "back");
  tab.focus();
  is(Services.focus.focusedElement, tab, "a sidebar tab has focus");
  EventUtils.synthesizeKey(key, { shiftKey: true });
  await selected(other, "a key with a sidebar tab focused too");
  await TestUtils.waitForCondition(
    () => Services.focus.focusedElement == other.linkedBrowser,
    "the page has the focus back"
  );

  BrowserTestUtils.removeTab(other);
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_sequence_started_in_the_browser_ui() {
  const tab = await openTab();
  await SpecialPowers.spawn(tab.linkedBrowser, [], () =>
    content.scrollTo(0, 500)
  );

  Services.focus.clearFocus(window);
  EventUtils.synthesizeKey("g");
  EventUtils.synthesizeKey("g");
  await SpecialPowers.spawn(tab.linkedBrowser, [], () =>
    ContentTaskUtils.waitForCondition(() => !content.scrollY, "gg scrolled up")
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_browser_ui_fields_keep_their_keys() {
  const tab = await openTab();
  const scrolled = () =>
    SpecialPowers.spawn(tab.linkedBrowser, [], () => content.scrollY);

  gURLBar.focus();
  EventUtils.synthesizeKey("j");
  await TestUtils.waitForCondition(() => gURLBar.value.endsWith("j"), "typed");
  is(await scrolled(), 0, "the page did not scroll");
  ok(gURLBar.focused, "the urlbar kept the focus");
  gURLBar.handleRevert();
  gURLBar.blur();

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_unmapped_keys_leave_the_focus_alone() {
  const tab = await openTab();

  tab.focus();
  EventUtils.synthesizeKey("KEY_ArrowDown");
  isnot(
    Services.focus.focusedElement,
    tab.linkedBrowser,
    "a key the keymap does not have stays where it was typed"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_panes_are_reached_in_normal_mode() {
  const { left, right } = await splitInTwo(FIELD);

  gBrowser.selectedTab = left;
  await selected(left, "on the left pane");
  await BrowserTestUtils.synthesizeMouseAtCenter("#f", {}, left.linkedBrowser);
  await TestUtils.waitForCondition(
    () => modeOf(left.linkedBrowser) == "i",
    "the click on the field is insert mode"
  );

  gBrowser.selectedTab = right;
  await selected(right, "on the right pane");
  right.linkedBrowser.focus();
  await TestUtils.waitForCondition(
    () => modeOf(right.linkedBrowser) == "n",
    "the other pane is in normal mode"
  );

  // The left pane kept its field focused: this is where <C-l> used to focus
  // the urlbar and <C-h> to delete a character.
  EventUtils.synthesizeKey("h", { ctrlKey: true });
  await selected(left, "<C-h> goes to the left pane");
  await SpecialPowers.spawn(left.linkedBrowser, [], () =>
    ContentTaskUtils.waitForCondition(
      () => content.document.activeElement?.localName != "input",
      "the field lost the focus"
    )
  );
  await TestUtils.waitForCondition(
    () => modeOf(left.linkedBrowser) == "n",
    "the pane is reached in normal mode"
  );

  EventUtils.synthesizeKey("l", { ctrlKey: true });
  await selected(right, "<C-l> goes back");
  ok(!gURLBar.focused, "the urlbar did not take <C-l>");
  is(
    await SpecialPowers.spawn(
      left.linkedBrowser,
      [],
      () => content.document.getElementById("f").value
    ),
    "abc",
    "nothing was deleted from the field"
  );

  unsplit(left, right);
});

add_task(async function test_tabs_are_reached_in_normal_mode() {
  const field = await openTab(FIELD);
  await BrowserTestUtils.synthesizeMouseAtCenter("#f", {}, field.linkedBrowser);
  await TestUtils.waitForCondition(
    () => modeOf(field.linkedBrowser) == "i",
    "insert mode"
  );

  const page = await openTab();
  const there = keyFrom(page, field);
  const back = there == "J" ? "K" : "J";

  EventUtils.synthesizeKey(there, { shiftKey: true });
  await selected(field, "the key goes to the tab with the field");
  await TestUtils.waitForCondition(
    () => modeOf(field.linkedBrowser) == "n",
    "the tab is reached in normal mode"
  );
  EventUtils.synthesizeKey(back, { shiftKey: true });
  await selected(page, "the next key moves on instead of being typed");
  is(
    await SpecialPowers.spawn(
      field.linkedBrowser,
      [],
      () => content.document.getElementById("f").value
    ),
    "abc",
    "nothing was typed into the field"
  );

  BrowserTestUtils.removeTab(field);
  BrowserTestUtils.removeTab(page);
});

add_task(async function test_a_clicked_tab_keeps_its_field() {
  const field = await openTab(FIELD);
  await BrowserTestUtils.synthesizeMouseAtCenter("#f", {}, field.linkedBrowser);
  await TestUtils.waitForCondition(
    () => modeOf(field.linkedBrowser) == "i",
    "insert mode"
  );
  const page = await openTab();

  gBrowser.selectedTab = field;
  await selected(field, "back on the tab, not by a key");
  is(
    await focusedInPage(field.linkedBrowser),
    "input",
    "the user goes on typing where they were"
  );

  BrowserTestUtils.removeTab(field);
  BrowserTestUtils.removeTab(page);
});

add_task(async function test_a_chord_ends_a_jump_and_runs() {
  const { left, right } = await splitInTwo(LINK);
  const count = () =>
    SpecialPowers.spawn(
      right.linkedBrowser,
      [],
      () => content.document.documentElement.children.length
    );
  const before = await count();

  EventUtils.synthesizeKey("s");
  await TestUtils.waitForCondition(
    async () => (await count()) > before,
    "the labels are drawn"
  );
  EventUtils.synthesizeKey("h", { ctrlKey: true });
  await selected(left, "<C-h> reached the keymap through the labels");
  await TestUtils.waitForCondition(
    async () => (await count()) == before,
    "the labels are gone"
  );

  unsplit(left, right);
});

add_task(async function test_a_click_ends_a_jump() {
  const tab = await openTab(LINK);
  const count = () =>
    SpecialPowers.spawn(
      tab.linkedBrowser,
      [],
      () => content.document.documentElement.children.length
    );
  const before = await count();

  EventUtils.synthesizeKey("s");
  await TestUtils.waitForCondition(
    async () => (await count()) > before,
    "the labels are drawn"
  );
  await BrowserTestUtils.synthesizeMouseAtPoint(
    300,
    300,
    {},
    tab.linkedBrowser
  );
  await TestUtils.waitForCondition(
    async () => (await count()) == before,
    "the click took the labels away"
  );

  BrowserTestUtils.removeTab(tab);
});
