/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { Lazyvimium } = ChromeUtils.importESModule(
  "resource:///modules/lazyvimium/Lazyvimium.sys.mjs"
);
const { CustomizableUI } = ChromeUtils.importESModule(
  "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs"
);

const PREF = "lazyvimium.enabled";

function statusline() {
  return document.getElementById("lazyvimium-statusline");
}

const ITEM = "lazyvimium-appmenu-vim-mode";

function menuItem() {
  return document.getElementById(ITEM);
}

async function openAppMenu() {
  const shown = BrowserTestUtils.waitForEvent(PanelUI.panel, "ViewShown");
  PanelUI.show();
  await shown;
}

async function closeAppMenu() {
  const hidden = BrowserTestUtils.waitForEvent(PanelUI.panel, "popuphidden");
  PanelUI.hide();
  await hidden;
}

registerCleanupFunction(() => {
  Services.prefs.clearUserPref(PREF);
  document.documentElement.removeAttribute("zen-welcome-stage");
});

const OLD_WIDGET = "lazyvimium-vim-mode-button";
const SINGLE_TOOLBAR = "zen.view.use-single-toolbar";

add_task(async function test_switch_is_a_row_of_the_app_menu() {
  ok(
    !CustomizableUI.getPlacementOfWidget(OLD_WIDGET),
    "no widget in the toolbars, not even one saved by an older profile"
  );
  await openAppMenu();
  const item = menuItem();
  ok(item, "the app menu has the row");
  Assert.equal(item.getAttribute("label"), "Vim mode");
  Assert.equal(item.getAttribute("role"), "menuitemcheckbox");
  Assert.equal(item.getAttribute("aria-checked"), "true", "on by default");
  Assert.equal(
    item.nextElementSibling.id,
    "appMenu-settings-button",
    "right above Settings"
  );
  const row = item.getBoundingClientRect();
  const track = item
    .querySelector(".lazyvimium-agent-switch")
    .getBoundingClientRect();
  const label = item
    .querySelector(".toolbarbutton-text")
    .getBoundingClientRect();
  ok(row.height < 50, "the row is as tall as the rows around it");
  ok(track.left >= label.right, "its switch comes after its label");
  ok(row.right - track.right < 24, "at the end of the row");
  await closeAppMenu();

  await openAppMenu();
  Assert.equal(
    document.querySelectorAll(`#${ITEM}`).length,
    1,
    "opening the menu again adds no second row"
  );
  await closeAppMenu();
});

add_task(async function test_switch_turns_vim_mode_off_and_on() {
  const defaults = Services.prefs.getDefaultBranch("");
  ok(
    defaults.getBoolPref("zen.view.compact.hide-toolbar"),
    "vim mode's compact layout is the default while it is on"
  );

  await openAppMenu();
  const knobOffset = () =>
    new DOMMatrix(
      getComputedStyle(
        menuItem().querySelector(".lazyvimium-agent-switch"),
        "::before"
      ).transform
    ).m41;
  await TestUtils.waitForCondition(
    () => knobOffset() == 16,
    "while on, the knob is at the far end of the track"
  );
  menuItem().doCommand();
  ok(!Services.prefs.getBoolPref(PREF), "a click turns vim mode off");
  Assert.equal(menuItem().getAttribute("aria-checked"), "false");
  Assert.equal(PanelUI.panel.state, "open", "the menu stays to show it");
  await TestUtils.waitForCondition(
    () => knobOffset() == 0,
    "and it slides back to the start"
  );
  Assert.equal(statusline().style.display, "none", "no mode indicator");
  ok(
    !document.documentElement.hasAttribute("lazyvimium-mode"),
    "nor a mode color on the window"
  );
  ok(
    !defaults.getBoolPref("zen.view.compact.hide-toolbar"),
    "and Zen's own layout defaults are back"
  );

  menuItem().doCommand();
  ok(Services.prefs.getBoolPref(PREF), "another click turns it back on");
  Assert.equal(menuItem().getAttribute("aria-checked"), "true");
  Assert.equal(statusline().style.display, "flex");
  ok(defaults.getBoolPref("zen.view.compact.hide-toolbar"));
  await closeAppMenu();
});

add_task(async function test_onboarding_looks_like_plain_zen() {
  const root = document.documentElement;
  root.setAttribute("zen-welcome-stage", "true");
  await TestUtils.waitForCondition(
    () => statusline().style.display == "none",
    "no mode indicator during the onboarding"
  );
  ok(!root.hasAttribute("lazyvimium-mode"), "and no mode color");

  gBrowser.selectedBrowser.focus();
  EventUtils.synthesizeKey(" ");
  EventUtils.synthesizeKey("e");
  await new Promise(resolve => setTimeout(resolve, 300));
  ok(
    !Lazyvimium.explorerFor(window).isOpen,
    "vim mode's keys wait until the onboarding is over"
  );

  root.removeAttribute("zen-welcome-stage");
  await TestUtils.waitForCondition(
    () => statusline().style.display == "flex",
    "the mode indicator comes back after it"
  );
  ok(root.hasAttribute("lazyvimium-mode"));
});

// Once the menu closes the keys are vim mode's again: Space after it is
// <leader>, not another click on the row.
add_task(async function test_turning_vim_on_leaves_the_keys_to_vim() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "data:text/html,<title>switch</title>"
  );
  Services.prefs.setBoolPref(PREF, false);
  await openAppMenu();
  EventUtils.synthesizeMouseAtCenter(menuItem(), {});
  await TestUtils.waitForCondition(
    () => Services.prefs.getBoolPref(PREF),
    "the click turns vim mode on"
  );
  await closeAppMenu();
  tab.linkedBrowser.focus();
  EventUtils.synthesizeKey(" ");
  EventUtils.synthesizeKey("e");
  await TestUtils.waitForCondition(
    () => Lazyvimium.explorerFor(window).isOpen,
    "<leader>e opens the explorer"
  );
  ok(Services.prefs.getBoolPref(PREF), "and Space left vim mode on");
  Lazyvimium.explorerFor(window).close();
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_sidebar_toggle_keeps_the_single_toolbar() {
  const expanded = "zen.view.sidebar-expanded";
  registerCleanupFunction(() => {
    Services.prefs.clearUserPref(expanded);
    Services.prefs.clearUserPref(SINGLE_TOOLBAR);
  });
  Services.prefs.setBoolPref(SINGLE_TOOLBAR, true);
  Services.prefs.setBoolPref(expanded, true);

  await Lazyvimium.run("zen.sidebar.toggle");
  ok(!Services.prefs.getBoolPref(expanded), "the sidebar collapses");
  await Lazyvimium.run("zen.sidebar.toggle");
  ok(Services.prefs.getBoolPref(expanded), "and expands again");
  ok(
    Services.prefs.getBoolPref(SINGLE_TOOLBAR),
    "with the URL bar still in the sidebar"
  );
});

add_task(async function test_layout_reset_returns_to_the_defaults() {
  const prefs = [
    [SINGLE_TOOLBAR, false],
    ["zen.view.compact.hide-tabbar", false],
    ["zen.view.compact.hide-toolbar", false],
    ["zen.view.sidebar-expanded", false],
  ];
  const defaults = Services.prefs.getDefaultBranch("");
  for (const [name, value] of prefs) {
    Services.prefs.setBoolPref(name, value);
  }

  await Lazyvimium.run("zen.layout.reset");
  for (const [name] of prefs) {
    ok(
      !Services.prefs.prefHasUserValue(name),
      `${name} is back to its default`
    );
    Assert.equal(
      Services.prefs.getBoolPref(name),
      defaults.getBoolPref(name),
      `${name} reads its default`
    );
  }
  await TestUtils.waitForCondition(
    () => !document.documentElement.hasAttribute("zen-compact-animating"),
    "compact mode settles"
  );
});
