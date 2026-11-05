/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { Lazyvimium } = ChromeUtils.importESModule(
  "resource:///modules/lazyvimium/Lazyvimium.sys.mjs"
);
const { CustomizableUI } = ChromeUtils.importESModule(
  "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs"
);

const WIDGET = "lazyvimium-chat-button";
const FOOT = "zen-sidebar-foot-buttons";
const CREATE = "zen-create-new-button";
const SINGLE_TOOLBAR = "zen.view.use-single-toolbar";
const VIM = "lazyvimium.enabled";

function widget() {
  return document.getElementById(WIDGET);
}

function topBarChat() {
  return document.getElementById("lazyvimium-chat-topbar");
}

function topBarBox() {
  return document.getElementById("lazyvimium-chat-topbar-box");
}

function wrapper() {
  return document.getElementById("zen-appcontent-navbar-wrapper");
}

function dock() {
  return Lazyvimium.agentDockFor(window);
}

function putBackInTheFootRow() {
  CustomizableUI.addWidgetToArea(
    WIDGET,
    FOOT,
    CustomizableUI.getWidgetIdsInArea(FOOT).indexOf(CREATE)
  );
}

async function setCompact(on) {
  const root = document.documentElement;
  // Zen ignores the change while it animates the last one.
  const animated = () => !root.hasAttribute("zen-compact-animating");
  await TestUtils.waitForCondition(animated, "compact mode is at rest");
  gZenCompactModeManager.preference = on;
  await TestUtils.waitForCondition(
    () => gZenCompactModeManager.preference == on && animated(),
    `compact mode is ${on ? "on" : "off"}`
  );
}

async function setSingleToolbar(on) {
  if (on) {
    Services.prefs.clearUserPref(SINGLE_TOOLBAR);
  } else {
    Services.prefs.setBoolPref(SINGLE_TOOLBAR, false);
  }
  await TestUtils.waitForCondition(
    () => document.documentElement.hasAttribute("zen-single-toolbar") == on,
    `the ${on ? "single toolbar" : "multiple toolbars"}`
  );
}

// The top bar follows the layout through observers, a microtask away.
async function settled() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function closeDock() {
  dock().close();
  await TestUtils.waitForCondition(() => !dock().isOpen, "the panel closed");
}

// The mouse at the top edge brings the compact top bar down.
async function showTopBar() {
  wrapper().setAttribute("zen-has-hover", "true");
  await TestUtils.waitForCondition(
    () => wrapper().getBoundingClientRect().height >= 30,
    "the top bar came down"
  );
  await new Promise(resolve => setTimeout(resolve, 400));
}

add_setup(async function () {
  const wasCompact = gZenCompactModeManager.preference;
  registerCleanupFunction(async () => {
    Services.prefs.clearUserPref(VIM);
    Services.prefs.clearUserPref(SINGLE_TOOLBAR);
    document.documentElement.removeAttribute("zen-welcome-stage");
    wrapper().removeAttribute("zen-has-hover");
    await setCompact(wasCompact);
    dock().close();
  });
});

add_task(async function test_chat_has_a_home_in_either_layout() {
  ok(
    Services.prefs.getBoolPref(SINGLE_TOOLBAR),
    "Zen starts with its single toolbar"
  );
  const foot = CustomizableUI.getWidgetIdsInArea(FOOT);
  Assert.equal(
    foot.indexOf(WIDGET) + 1,
    foot.indexOf(CREATE),
    "there Chat is right before +, below the sidebar"
  );
  Assert.equal(
    widget().localName,
    "toolbarbutton",
    "a toolbarbutton, which the toolbar's keys reach"
  );
  Assert.equal(widget().getAttribute("label"), "Chat", "named Chat");

  await setSingleToolbar(false);
  ok(
    CustomizableUI.getWidgetIdsInArea(CustomizableUI.AREA_NAVBAR).includes(
      WIDGET
    ),
    "with multiple toolbars it is in the top bar"
  );
  await setSingleToolbar(true);
  Assert.equal(
    CustomizableUI.getPlacementOfWidget(WIDGET)?.area,
    FOOT,
    "and back"
  );

  CustomizableUI.addWidgetToArea(WIDGET, "zen-sidebar-top-buttons");
  await setSingleToolbar(false);
  Assert.equal(
    CustomizableUI.getPlacementOfWidget(WIDGET)?.area,
    "zen-sidebar-top-buttons",
    "a place the user picked is left alone"
  );
  await setSingleToolbar(true);
  putBackInTheFootRow();
});

add_task(async function test_the_row_below_the_sidebar_keeps_its_buttons() {
  await setCompact(false);
  const foot = document.getElementById(FOOT);
  const switcher = document.getElementById("zen-workspaces-button");
  const create = document.getElementById(CREATE);
  const chatLabel = widget().querySelector(".toolbarbutton-text");
  const fitsTheRow = what => {
    const row = foot.getBoundingClientRect();
    const box = create.getBoundingClientRect();
    ok(
      box.left >= row.left - 1 && box.right <= row.right + 1,
      `${what}: + stays inside the row`
    );
  };

  await TestUtils.waitForCondition(
    () => foot.getBoundingClientRect().width > 0,
    "the row is laid out"
  );
  fitsTheRow("with one space");
  ok(chatLabel.getBoundingClientRect().width > 0, "and Chat keeps its name");

  const spaces = [];
  registerCleanupFunction(async () => {
    for (const uuid of spaces) {
      await gZenWorkspaces.removeWorkspace(uuid);
    }
  });
  for (const name of ["second", "third"]) {
    const space = await gZenWorkspaces.createAndSaveWorkspace(
      name,
      undefined,
      true
    );
    spaces.push(space.uuid);
  }
  await TestUtils.waitForCondition(
    () => !switcher.hasAttribute("dont-show"),
    "the space switcher is in the row"
  );
  await TestUtils.waitForCondition(
    () => switcher.getBoundingClientRect().width >= 36,
    "Chat leaves the space switcher its room"
  );
  fitsTheRow("with three spaces");
  ok(chatLabel.getBoundingClientRect().width > 0, "and keeps its name");

  for (const uuid of spaces.splice(0)) {
    await gZenWorkspaces.removeWorkspace(uuid);
  }
  await TestUtils.waitForCondition(
    () => switcher.hasAttribute("dont-show"),
    "one space again"
  );

  Services.prefs.setBoolPref("zen.view.sidebar-expanded", false);
  await TestUtils.waitForCondition(
    () => chatLabel.getBoundingClientRect().width == 0,
    "on a collapsed sidebar Chat keeps only its icon"
  );
  Assert.equal(
    widget().getBoundingClientRect().width,
    30,
    "a small pill rather than a wide one"
  );
  Services.prefs.clearUserPref("zen.view.sidebar-expanded");
  await TestUtils.waitForCondition(
    () => chatLabel.getBoundingClientRect().width > 0,
    "and expanded again, its name is back"
  );
});

add_task(async function test_a_click_opens_and_closes_the_panel() {
  await setCompact(false);
  ok(!dock().isOpen, "the panel starts closed");
  widget().doCommand();
  await TestUtils.waitForCondition(() => dock().isOpen, "a click opens it");
  Assert.equal(widget().getAttribute("aria-pressed"), "true", "it shows open");
  Assert.equal(widget().getAttribute("tooltiptext"), "Close chat");

  widget().doCommand();
  await TestUtils.waitForCondition(() => !dock().isOpen, "another closes it");
  Assert.equal(widget().getAttribute("aria-pressed"), "false");
  ok(
    widget().getAttribute("tooltiptext").includes("<leader>aa"),
    "the tooltip teaches the key"
  );
});

add_task(async function test_chat_works_with_vim_mode_off() {
  await setCompact(false);
  Services.prefs.setBoolPref(VIM, false);
  await settled();
  ok(
    !widget().getAttribute("tooltiptext").includes("<leader>"),
    "no key in the tooltip, since none works now"
  );
  widget().doCommand();
  await TestUtils.waitForCondition(
    () => dock().isOpen,
    "with no keys left, the button still opens the panel"
  );
  await closeDock();
  Services.prefs.clearUserPref(VIM);
});

add_task(async function test_chat_comes_down_with_the_compact_top_bar() {
  await setCompact(false);
  await settled();
  ok(topBarBox().hidden, "the sidebar shows Chat, with no top bar to be in");

  await setCompact(true);
  await settled();
  ok(wrapper().hasAttribute("should-hide"), "compact mode has its top bar");
  ok(!topBarBox().hidden, "and Chat is in it");
  Assert.equal(
    topBarBox().nextElementSibling,
    document.querySelector(
      "#zen-appcontent-navbar-container > .titlebar-buttonbox-container"
    ),
    "right before the window buttons"
  );
  Assert.equal(
    getComputedStyle(topBarBox().nextElementSibling).marginLeft,
    "0px",
    "and next to them, not sharing the free space with them"
  );

  await showTopBar();
  EventUtils.synthesizeMouseAtCenter(topBarChat(), {});
  await TestUtils.waitForCondition(
    () => dock().isOpen,
    "a real click reaches it there"
  );
  Assert.equal(topBarChat().getAttribute("aria-pressed"), "true");
  EventUtils.synthesizeMouseAtCenter(topBarChat(), {});
  await TestUtils.waitForCondition(
    () => !dock().isOpen,
    "and closes the panel"
  );
  wrapper().removeAttribute("zen-has-hover");
});

add_task(async function test_multiple_toolbars_need_no_second_button() {
  await setSingleToolbar(false);
  await setCompact(true);
  await settled();
  ok(topBarBox().hidden, "the widget is in the top bar already");
  ok(!widget().hidden, "so it stays");
  ok(wrapper().contains(widget()), "which compact mode brings down as well");
  await setSingleToolbar(true);
});

add_task(async function test_one_chat_at_a_time() {
  await setCompact(true);
  await settled();
  ok(!topBarBox().hidden, "the compact top bar has Chat");
  ok(widget().hidden, "so the row below the sidebar has none");

  await setCompact(false);
  await settled();
  ok(topBarBox().hidden, "compact mode off: no top bar to come down");
  ok(!widget().hidden, "so the row below the sidebar has it back");

  await setCompact(true);
  await settled();
  for (const [pref, set, what] of [
    [
      "zen.view.experimental-no-window-controls",
      name => Services.prefs.setBoolPref(name, true),
      "with no window controls",
    ],
    [
      "browser.tabs.inTitlebar",
      name => Services.prefs.setIntPref(name, 0),
      "with the system's title bar",
    ],
  ]) {
    set(pref);
    await settled();
    ok(topBarBox().hidden, `${what} the top bar never opens`);
    ok(!widget().hidden, "and Chat stays below the sidebar, within reach");
    Services.prefs.clearUserPref(pref);
    await settled();
    ok(widget().hidden, "until the top bar is back");
  }

  CustomizableUI.addWidgetToArea(WIDGET, "zen-sidebar-top-buttons");
  await settled();
  ok(!widget().hidden, "a place the user picked is left alone");
  putBackInTheFootRow();
  await settled();
  ok(widget().hidden, "and in its home it gives way again");
});

add_task(async function test_the_top_bar_button_follows_the_widget() {
  await setCompact(true);
  await settled();
  const root = document.documentElement;
  root.setAttribute("zen-welcome-stage", "true");
  await settled();
  ok(topBarBox().hidden, "the onboarding looks like plain Zen");
  root.removeAttribute("zen-welcome-stage");
  await settled();
  ok(!topBarBox().hidden, "and it is back after it");

  CustomizableUI.removeWidgetFromArea(WIDGET);
  await settled();
  ok(topBarBox().hidden, "taken out of the toolbars, Chat goes for good");
  putBackInTheFootRow();
  await settled();
  ok(!topBarBox().hidden, "put back, it returns");
});

add_task(async function test_the_toolbars_keys_press_chat() {
  await setCompact(true);
  await settled();
  await showTopBar();
  const toolbar = Lazyvimium.toolbarFor(window);
  await toolbar.open({ at: topBarChat() });
  ok(toolbar.items().includes(topBarChat()), "Chat is one of the items");
  Assert.equal(toolbar.item, topBarChat(), "the cursor goes to it");
  toolbar.activate();
  await TestUtils.waitForCondition(() => dock().isOpen, "<CR> opens the panel");
  await closeDock();
  wrapper().removeAttribute("zen-has-hover");
});

add_task(async function test_the_explorers_keys_press_chat() {
  await setCompact(false);
  const explorer = Lazyvimium.explorerFor(window);
  explorer.open();
  await TestUtils.waitForCondition(() => explorer.isOpen, "the explorer");
  const buttons = explorer.footerButtons();
  ok(buttons.includes(widget()), "Chat is a button at the sidebar's foot");

  explorer.moveTo(-1);
  explorer.move(1);
  ok(explorer.onFooter, "the cursor reaches the foot");
  explorer.moveOnFooter(
    buttons.indexOf(widget()) - buttons.indexOf(explorer.footerButton)
  );
  Assert.equal(explorer.footerButton, widget(), "and goes to Chat");
  explorer.pressFooter();
  await TestUtils.waitForCondition(() => dock().isOpen, "<CR> opens the panel");
  await closeDock();
  explorer.close();
});

add_task(async function test_chat_shows_the_agent_working() {
  await setCompact(true);
  await settled();
  const color = "rgb(1, 2, 3)";
  Object.defineProperty(dock(), "status", {
    configurable: true,
    get: () => ({
      open: false,
      running: true,
      unseen: false,
      color,
      name: "Agent",
    }),
  });
  registerCleanupFunction(() => delete dock().status);
  Lazyvimium.run("agent.stop");
  document.documentElement.setAttribute("zen-welcome-stage", "true");
  await settled();
  document.documentElement.removeAttribute("zen-welcome-stage");
  await settled();
  for (const button of [widget(), topBarChat()]) {
    ok(button.hasAttribute("running"), `${button.id} shows it`);
    Assert.equal(
      button.style.getPropertyValue("--lazyvimium-agent-color"),
      color,
      "in the agent's color"
    );
    ok(
      button.getAttribute("tooltiptext").startsWith("Agent is working"),
      "and says so"
    );
  }
  delete dock().status;
  document.documentElement.setAttribute("zen-welcome-stage", "true");
  await settled();
  document.documentElement.removeAttribute("zen-welcome-stage");
  await settled();
  ok(!widget().hasAttribute("running"), "until it stops");
});
