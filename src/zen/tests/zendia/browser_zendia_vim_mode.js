/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { Zendia } = ChromeUtils.importESModule(
  "resource:///modules/zendia/Zendia.sys.mjs"
);
const { CustomizableUI } = ChromeUtils.importESModule(
  "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs"
);

const PREF = "zendia.enabled";

function statusline() {
  return document.getElementById("zendia-statusline");
}

const ITEM = "zendia-appmenu-vim-mode";

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

const OLD_WIDGET = "zendia-vim-mode-button";
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
    .querySelector(".zendia-agent-switch")
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
        menuItem().querySelector(".zendia-agent-switch"),
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
    !document.documentElement.hasAttribute("zendia-mode"),
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
  ok(!root.hasAttribute("zendia-mode"), "and no mode color");

  gBrowser.selectedBrowser.focus();
  EventUtils.synthesizeKey(" ");
  EventUtils.synthesizeKey("e");
  await new Promise(resolve => setTimeout(resolve, 300));
  ok(
    !Zendia.explorerFor(window).isOpen,
    "vim mode's keys wait until the onboarding is over"
  );

  root.removeAttribute("zen-welcome-stage");
  await TestUtils.waitForCondition(
    () => statusline().style.display == "flex",
    "the mode indicator comes back after it"
  );
  ok(root.hasAttribute("zendia-mode"));
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
    () => Zendia.explorerFor(window).isOpen,
    "<leader>e opens the explorer"
  );
  ok(Services.prefs.getBoolPref(PREF), "and Space left vim mode on");
  Zendia.explorerFor(window).close();
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

  await Zendia.run("zen.sidebar.toggle");
  ok(!Services.prefs.getBoolPref(expanded), "the sidebar collapses");
  await Zendia.run("zen.sidebar.toggle");
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

  await Zendia.run("zen.layout.reset");
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

add_task(
  async function test_the_mode_indicator_shows_the_mascot_and_the_mode() {
    const indicator = statusline();
    await TestUtils.waitForCondition(
      () => indicator.style.display == "flex",
      "the mode indicator is shown"
    );
    Assert.equal(indicator.getAttribute("mode"), "n", "It is in NORMAL mode");
    Assert.equal(
      indicator.getAttribute("aria-label"),
      "NORMAL",
      "and names it for screen readers"
    );
    ok(
      !indicator.querySelector(".zendia-statusline-mode"),
      "with no tag of text: the mascot alone shows the mode"
    );
    const mascot = indicator.querySelector("svg.zendia-mascot");
    Assert.equal(
      mascot.querySelectorAll("path").length,
      12,
      "The ring has an arc for each mode, each over its ink edge"
    );
    Assert.greater(
      mascot.querySelectorAll("polygon, polyline").length,
      5,
      "The mascot and its face are drawn"
    );
    Assert.greater(
      mascot.getBoundingClientRect().width,
      20,
      "The mascot can be seen"
    );
  }
);

add_task(async function test_the_mode_indicator_steps_aside_from_the_pointer() {
  const indicator = statusline();
  const home = indicator.getBoundingClientRect();
  ok(!indicator.hasAttribute("aside"), "It starts in its corner");
  EventUtils.synthesizeMouseAtPoint(
    home.x + home.width / 2,
    home.y + home.height / 2,
    { type: "mousemove" },
    window
  );
  await TestUtils.waitForCondition(
    () => indicator.hasAttribute("aside"),
    "with the pointer on it, it steps aside"
  );
  await TestUtils.waitForCondition(() => {
    const now = indicator.getBoundingClientRect();
    return Math.abs(now.x - home.x) > home.width;
  }, "far enough to uncover where it stood");

  // The pointer still where it stood: it stays away.
  EventUtils.synthesizeMouseAtPoint(
    home.x + home.width / 2 + 2,
    home.y + home.height / 2,
    { type: "mousemove" },
    window
  );
  ok(indicator.hasAttribute("aside"), "It waits while the pointer is there");

  EventUtils.synthesizeMouseAtPoint(
    window.innerWidth / 2,
    window.innerHeight / 3,
    { type: "mousemove" },
    window
  );
  await TestUtils.waitForCondition(
    () => !indicator.hasAttribute("aside"),
    "and comes back once the pointer has left"
  );
  await TestUtils.waitForCondition(() => {
    const now = indicator.getBoundingClientRect();
    return Math.abs(now.x - home.x) < 2;
  }, "to the corner it came from");
});
