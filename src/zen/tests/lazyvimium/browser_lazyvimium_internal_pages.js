/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

function statuslineText() {
  return document.getElementById("lazyvimium-statusline")?.textContent ?? "";
}

function type(keys) {
  for (const key of keys) {
    EventUtils.synthesizeKey(key, { shiftKey: key != key.toLowerCase() });
  }
}

// How far the page, or the pane it scrolls in, is scrolled.
const scrolled = browser =>
  SpecialPowers.spawn(browser, [], () => {
    let most = content.scrollY;
    for (const element of content.document.querySelectorAll("*")) {
      most = Math.max(most, element.scrollTop);
    }
    return most;
  });

// The labels `s` puts on the page.
const labelsShown = browser =>
  SpecialPowers.spawn(
    browser,
    [],
    () =>
      [...content.document.documentElement.querySelectorAll("div > span")]
        .map(span => span.textContent)
        .filter(text => text && !text.includes(" ")).length
  );

async function focusPage(browser) {
  browser.focus();
  await SpecialPowers.spawn(browser, [], () => {
    content.document.activeElement?.blur();
    content.focus();
  });
}

// Keys that need no room to scroll: modes and jump labels.
async function checkModesAndLabels(browser, label) {
  await focusPage(browser);
  type("i");
  await TestUtils.waitForCondition(
    () => statuslineText().includes("INSERT"),
    `${label}: i is insert mode`
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    () => statuslineText().includes("NORMAL"),
    `${label}: <Esc> is normal mode`
  );
  type("s");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(browser)) > 0,
    `${label}: s labels the controls`
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    async () => !(await labelsShown(browser)),
    `${label}: <Esc> drops the labels`
  );
}

// Visual mode labels the words on screen to put the cursor on one.
async function checkVisual(browser, label) {
  await focusPage(browser);
  type("v");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(browser)) > 0,
    `${label}: v labels the words`
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    async () => !(await labelsShown(browser)),
    `${label}: <Esc> drops the labels`
  );
}

async function checkScrolling(browser, label) {
  await focusPage(browser);
  // Some pages fill in after they load.
  await TestUtils.waitForCondition(async () => {
    type("G");
    return (await scrolled(browser)) > 0;
  }, `${label}: G scrolls`);
  type("gg");
  await TestUtils.waitForCondition(
    async () => (await scrolled(browser)) == 0,
    `${label}: gg scrolls back`
  );
}

async function inTab(url, check) {
  const tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, url);
  try {
    await check(tab.linkedBrowser, url);
    ok(true, `${url} takes the keys`);
  } catch (e) {
    ok(false, `${url}: ${e}`);
  } finally {
    BrowserTestUtils.removeTab(tab);
  }
}

add_task(async function test_keys_work_on_internal_pages() {
  for (const url of [
    "about:preferences",
    "about:addons",
    "about:config",
    "about:support",
    "about:about",
  ]) {
    await inTab(url, checkModesAndLabels);
    await inTab(url, checkVisual);
  }
  // These are longer than the window.
  for (const url of ["about:preferences", "about:support"]) {
    await inTab(url, checkScrolling);
  }
});

add_task(async function test_keys_reach_into_shadow_roots() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "data:text/html," +
      encodeURIComponent(`<!doctype html>
        <body style="font: 20px sans-serif">
          <p>light words</p><div id="open"></div><div id="closed"></div>
          <script>
            for (const [id, mode, text] of [
              ["open", "open", "shadow words"],
              ["closed", "closed", "hidden words"],
            ]) {
              const root = document.getElementById(id).attachShadow({ mode });
              root.innerHTML = "<p>" + text + "</p><button>" + id + "</button>";
            }
          </script>
        </body>`)
  );
  const browser = tab.linkedBrowser;
  await focusPage(browser);

  type("s");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(browser)) == 2,
    "s labels the buttons in shadow roots, closed ones too"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    async () => !(await labelsShown(browser)),
    "<Esc> drops the labels"
  );

  type("v");
  // Three paragraphs and six words.
  await TestUtils.waitForCondition(
    async () => (await labelsShown(browser)) >= 9,
    "v labels the words in shadow roots"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    async () => !(await labelsShown(browser)),
    "<Esc> drops the labels"
  );

  // Only the closed root has "hidd".
  type("S");
  type("hidd");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(browser)) == 1,
    "S finds a word in a closed shadow root"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_keys_work_on_extension_pages() {
  const extension = ExtensionTestUtils.loadExtension({
    manifest: { options_ui: { page: "page.html", open_in_tab: true } },
    files: {
      "page.html": `<!doctype html><meta charset="utf-8">
        <body><button>options</button><div style="height: 4000px"></div></body>`,
    },
  });
  await extension.startup();
  const url = `moz-extension://${extension.uuid}/page.html`;
  await inTab(url, checkModesAndLabels);
  await inTab(url, checkScrolling);
  await extension.unload();
});

// A page that is long, with text, a control and a field.
const PARITY_PAGE = `<!doctype html><meta charset="utf-8">
  <body style="margin: 0; font: 20px sans-serif">
    <p id="words">alpha beta gamma</p>
    <button>Press</button> <input id="field">
    <div style="height: 6000px"></div>
  </body>`;

// The scroll once a key has moved it away from where it was, and stopped.
async function scrollAfter(browser, press, before, label) {
  press();
  await TestUtils.waitForCondition(
    async () => (await scrolled(browser)) != before,
    `${label}: scrolls`
  );
  let last = -1;
  await TestUtils.waitForCondition(async () => {
    const now = await scrolled(browser);
    const same = now === last;
    last = now;
    return same;
  }, `${label}: stops scrolling`);
  return last;
}

// Every scrolling key, as on a regular page.
async function checkScrollKeys(browser, label) {
  await focusPage(browser);
  let at = await scrolled(browser);
  for (const [name, press] of [
    ["j", () => type("j")],
    ["<C-d>", () => EventUtils.synthesizeKey("d", { ctrlKey: true })],
    ["<C-f>", () => EventUtils.synthesizeKey("f", { ctrlKey: true })],
  ]) {
    const next = await scrollAfter(browser, press, at, `${label} ${name}`);
    Assert.greater(next, at, `${label}: ${name} scrolls down`);
    at = next;
  }
  for (const [name, press] of [
    ["k", () => type("k")],
    ["<C-u>", () => EventUtils.synthesizeKey("u", { ctrlKey: true })],
    ["<C-b>", () => EventUtils.synthesizeKey("b", { ctrlKey: true })],
  ]) {
    const next = await scrollAfter(browser, press, at, `${label} ${name}`);
    Assert.less(next, at, `${label}: ${name} scrolls up`);
    at = next;
  }
  at = await scrollAfter(browser, () => type("G"), at, `${label} G`);
  Assert.greater(at, 1000, `${label}: G goes to the bottom`);
  at = await scrollAfter(browser, () => type("gg"), at, `${label} gg`);
  Assert.less(at, 5, `${label}: gg goes to the top`);
}

const labelTexts = browser =>
  SpecialPowers.spawn(browser, [], () =>
    [...content.document.documentElement.querySelectorAll("div > span")]
      .map(span => span.textContent)
      .filter(text => text && !text.includes(" "))
  );

// Labels, then text jumps, visual motions and a yank into the ring.
async function checkVisualKeys(browser, label, { isPopup = false } = {}) {
  await focusPage(browser);
  // <Esc> closes a popup's panel as well as dropping the labels, so a popup
  // goes on without it; its labels are checked in the tests for them.
  if (!isPopup) {
    for (const keys of ["s", "v"]) {
      type(keys);
      await TestUtils.waitForCondition(
        async () => (await labelsShown(browser)) > 0,
        `${label}: ${keys} shows labels`
      );
      EventUtils.synthesizeKey("KEY_Escape");
      await TestUtils.waitForCondition(
        async () => !(await labelsShown(browser)),
        `${label}: <Esc> drops them`
      );
    }
    // The labels went, visual mode stays until the next <Esc>.
    EventUtils.synthesizeKey("KEY_Escape");
  }

  const { yankRing } = ChromeUtils.importESModule(
    "resource:///modules/lazyvimium/plugins/LazyvimiumYank.sys.mjs"
  );
  (await yankRing({ persist: false })).clear();
  const before = await labelTexts(browser);
  type("Salph");
  await TestUtils.waitForCondition(
    async () => (await labelTexts(browser)).length == before.length + 1,
    `${label}: S labels the word`
  );
  const fresh = [...(await labelTexts(browser))];
  for (const old of before) {
    fresh.splice(fresh.indexOf(old), 1);
  }
  type(fresh[0]);
  // The cursor is on the word: `e` grows the selection to its end, `y` yanks.
  await TestUtils.waitForCondition(async () => {
    type("e");
    return SpecialPowers.spawn(
      browser,
      [],
      () => content.getSelection().toString().length > 0
    );
  }, `${label}: e selects`);
  type("y");
  await TestUtils.waitForCondition(
    async () =>
      (await yankRing({ persist: false })).at(0)?.text.includes("alpha"),
    `${label}: y puts the selection in the yank ring`
  );
}

for (const [name, check] of [
  ["scroll keys", checkScrollKeys],
  ["visual keys", checkVisualKeys],
]) {
  add_task(async function () {
    info(name);
    await inTab("data:text/html," + encodeURIComponent(PARITY_PAGE), browser =>
      check(browser, "a regular page")
    );
    const extension = ExtensionTestUtils.loadExtension({
      manifest: { options_ui: { page: "page.html", open_in_tab: true } },
      files: { "page.html": PARITY_PAGE },
    });
    await extension.startup();
    await inTab(`moz-extension://${extension.uuid}/page.html`, browser =>
      check(browser, "an extension page")
    );
    await extension.unload();
  });
}

// The popup of an extension is a browser of its own, not a tab's.
add_task(async function test_keys_work_in_extension_popups() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["extensions.openPopupWithoutUserGesture.enabled", true],
      ["ui.popup.disable_autohide", true],
    ],
  });
  const extension = ExtensionTestUtils.loadExtension({
    manifest: { browser_action: { default_popup: "popup.html" } },
    background() {
      browser.test.onMessage.addListener(async () => {
        await browser.browserAction.openPopup();
        browser.test.sendMessage("opened");
      });
    },
    files: {
      "popup.html": `${PARITY_PAGE}<script src="popup.js"></script>`,
      // An extension page takes no inline handlers.
      "popup.js": `document.querySelector("button").onclick = () => {
        document.title = "pressed";
      };`,
    },
  });
  await extension.startup();
  extension.sendMessage("open");
  await extension.awaitMessage("opened");
  const popupBrowser = () =>
    document.querySelector('browser[webextension-view-type="popup"]');
  await TestUtils.waitForCondition(
    () => popupBrowser()?.browsingContext?.currentWindowGlobal,
    "the popup is open"
  );
  // It has to be loaded, and the panel open, for the keys to reach it.
  await TestUtils.waitForCondition(
    async () =>
      popupBrowser()?.closest("panel")?.state == "open" &&
      (await SpecialPowers.spawn(
        popupBrowser(),
        [],
        () => content.document.readyState == "complete"
      )),
    "the popup has loaded"
  );
  try {
    await checkScrollKeys(popupBrowser(), "an extension popup");
    // It was not opened from the keys, so no labels have its letters.
    await checkVisualKeys(popupBrowser(), "an extension popup", {
      isPopup: true,
    });
  } catch (e) {
    ok(false, `an extension popup: ${e}`);
  }
  await extension.unload();
});

const { Lazyvimium } = ChromeUtils.importESModule(
  "resource:///modules/lazyvimium/Lazyvimium.sys.mjs"
);
const { AppUiTestDelegate, AppUiTestInternals } = ChromeUtils.importESModule(
  "resource://testing-common/AppUiTestDelegate.sys.mjs"
);

const POPUP_NAME = "Popup Labels";

// A popup with a button and a field. It notes the keys that reach the page,
// and the button's press.
function loadPopupExtension() {
  return ExtensionTestUtils.loadExtension({
    useAddonManager: "temporary",
    manifest: {
      name: POPUP_NAME,
      browser_specific_settings: { gecko: { id: "popup-labels@example.com" } },
      browser_action: { default_popup: "popup.html" },
    },
    files: {
      "popup.html": `<!DOCTYPE html><meta charset="utf-8">
        <body style="margin:0;width:240px;height:120px">
        <button id="go" style="display:block">Go</button>
        <input id="field" style="display:block">
        <script src="popup.js"></script>`,
      "popup.js": `
        document.body.dataset.typed = "";
        addEventListener("keydown", event => {
          document.body.dataset.typed += event.key;
        });
        document.getElementById("go").onclick = () => {
          document.title = "pressed";
        };`,
    },
  });
}

// The popup's labels: the ones over its controls, and the ones `s` puts up,
// which are drawn alike.
const popupLabels = browser =>
  SpecialPowers.spawn(browser, [], () =>
    [...content.document.querySelectorAll("span[style*='ui-monospace']")].map(
      span => span.textContent
    )
  );

// What the page has seen: the keys that reached it and whether it was pressed.
const popupState = browser =>
  SpecialPowers.spawn(browser, [], () => ({
    typed: content.document.body.dataset.typed,
    pressed: content.document.title == "pressed",
  }));

// The label drawn over the button, found by where it is.
const buttonLabel = browser =>
  SpecialPowers.spawn(browser, [], () => {
    const rect = content.document.getElementById("go").getBoundingClientRect();
    const label = [
      ...content.document.querySelectorAll("span[style*='ui-monospace']"),
    ].find(span => {
      const at = span.getBoundingClientRect();
      return (
        at.left >= rect.left &&
        at.left <= rect.right &&
        at.top >= rect.top &&
        at.top <= rect.bottom
      );
    });
    return label?.textContent ?? null;
  });

const popupButton = extension =>
  AppUiTestInternals.getBrowserActionWidget(extension.id)
    .forWindow(window)
    .node.querySelector(".unified-extensions-item-action-button");

// Wait for the popup to be on screen and loaded, so keys reach it.
async function popupReady(browser) {
  await TestUtils.waitForCondition(
    async () =>
      browser.closest("panel")?.state == "open" &&
      (await SpecialPowers.spawn(
        browser,
        [],
        () => content.document.readyState == "complete"
      )),
    "the popup has loaded"
  );
  return browser;
}

// <leader>x and a pick: the keys press the extension's button.
async function pickWithKeys() {
  const row = () =>
    [...document.querySelectorAll(".lazyvimium-picker-item")].find(item =>
      item
        .querySelector(".lazyvimium-picker-label")
        .textContent.includes(POPUP_NAME)
    );
  const done = Lazyvimium.run("extensions.pick");
  await TestUtils.waitForCondition(row, "the picker lists the extension");
  row().click();
  await done;
}

async function openWithKeys(extension) {
  const shown = AppUiTestDelegate.awaitExtensionPanel(window, extension.id);
  await pickWithKeys();
  return popupReady(await shown);
}

// A click on the toolbar button, as the mouse does it.
async function openWithMouse(extension) {
  const shown = AppUiTestDelegate.awaitExtensionPanel(window, extension.id);
  await AppUiTestDelegate.clickBrowserAction(window, extension.id);
  return popupReady(await shown);
}

// The pointer on the button, which makes the browser load the popup before
// anything opens it.
async function hover(extension) {
  await AppUiTestInternals.showBrowserAction(window, extension.id);
  popupButton(extension).dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true })
  );
  const preloaded = () =>
    document.querySelector(
      'browser.webextension-preload-browser[webextension-view-type="popup"]'
    );
  await TestUtils.waitForCondition(async () => {
    const browser = preloaded();
    return (
      browser?.browsingContext?.currentWindowGlobal &&
      (await SpecialPowers.spawn(
        browser,
        [],
        () => content.document.readyState == "complete"
      ))
    );
  }, "the popup is preloaded");
  // Its load has been seen by the actor by now.
  await new Promise(resolve => setTimeout(resolve, 500));
}

async function closePopup(extension, browser) {
  const panel = browser.closest("panel");
  const hidden = BrowserTestUtils.waitForEvent(panel, "popuphidden");
  await AppUiTestDelegate.closeBrowserAction(window, extension.id);
  await hidden;
}

// Labels would have been drawn within a second of the load.
const settle = () => new Promise(resolve => setTimeout(resolve, 1200));

async function checkHasLabels(browser, label) {
  await TestUtils.waitForCondition(
    async () => (await popupLabels(browser)).length == 2,
    `${label}: the button and the field have labels`
  );
  Assert.deepEqual(
    await popupLabels(browser),
    ["a", "d"],
    `${label}: they are letters vim leaves free`
  );
}

async function checkNoLabels(browser, label) {
  await settle();
  Assert.deepEqual(await popupLabels(browser), [], `${label}: no labels`);
  // The letter that would have been the button's label goes to the page.
  const before = (await popupState(browser)).typed;
  type("a");
  await TestUtils.waitForCondition(
    async () => (await popupState(browser)).typed == before + "a",
    `${label}: a reaches the page`
  );
  Assert.ok(
    !(await popupState(browser)).pressed,
    `${label}: a does not press the button`
  );
}

// The page loads again inside the same opening of the popup.
async function reload(browser) {
  await SpecialPowers.spawn(browser, [], () => {
    content.document.documentElement.dataset.old = "1";
    content.location.reload();
  });
  await TestUtils.waitForCondition(
    () =>
      SpecialPowers.spawn(
        browser,
        [],
        () =>
          content.document.readyState == "complete" &&
          !content.document.documentElement.dataset.old
      ),
    "the popup has reloaded"
  );
}

add_task(async function test_popup_labels_follow_how_it_was_opened() {
  await SpecialPowers.pushPrefEnv({
    set: [["ui.popup.disable_autohide", true]],
  });
  const extension = loadPopupExtension();
  await extension.startup();

  // The keys: labels at once, a label presses its control.
  let browser = await openWithKeys(extension);
  await checkHasLabels(browser, "opened with the keys");
  await focusPage(browser);
  type("a");
  await TestUtils.waitForCondition(
    async () => (await popupState(browser)).pressed,
    "a label presses its control"
  );
  // A page that loads again in the same popup keeps them.
  await reload(browser);
  await checkHasLabels(browser, "opened with the keys, reloaded");
  await closePopup(extension, browser);

  // The mouse: none, and every letter is the page's.
  browser = await openWithMouse(extension);
  await focusPage(browser);
  await checkNoLabels(browser, "opened with the mouse");
  await reload(browser);
  await checkNoLabels(browser, "opened with the mouse, reloaded");
  await closePopup(extension, browser);

  // The mark of the keys is spent on one opening: the mouse that follows
  // gets none, and the keys after it get them again.
  browser = await openWithKeys(extension);
  await checkHasLabels(browser, "opened with the keys again");
  await closePopup(extension, browser);
  browser = await openWithMouse(extension);
  await checkNoLabels(browser, "opened with the mouse after the keys");
  await closePopup(extension, browser);
  await extension.unload();
});

add_task(async function test_s_labels_a_popup_opened_with_the_mouse() {
  await SpecialPowers.pushPrefEnv({
    set: [["ui.popup.disable_autohide", true]],
  });
  const extension = loadPopupExtension();
  await extension.startup();

  const browser = await openWithMouse(extension);
  // The popup took the focus on its own, so the key gets to it.
  await TestUtils.waitForCondition(
    () => SpecialPowers.spawn(browser, [], () => content.document.hasFocus()),
    "the popup has the focus"
  );
  await checkNoLabels(browser, "before s");
  type("s");
  await TestUtils.waitForCondition(
    async () => (await popupLabels(browser)).length > 0,
    "s labels the controls of the popup"
  );
  const label = await buttonLabel(browser);
  ok(label, "the button has a label");
  type(label);
  await TestUtils.waitForCondition(
    async () => (await popupState(browser)).pressed,
    "typing the label presses the button"
  );
  await closePopup(extension, browser);
  await extension.unload();
});

add_task(async function test_a_popup_loaded_by_hover_follows_its_opening() {
  await SpecialPowers.pushPrefEnv({
    set: [["ui.popup.disable_autohide", true]],
  });
  const extension = loadPopupExtension();
  await extension.startup();

  // The pointer is on the button, and it is the mouse that opens it.
  await hover(extension);
  let browser = await openWithMouse(extension);
  await checkNoLabels(browser, "preloaded, opened with the mouse");
  await closePopup(extension, browser);

  // The pointer is on the button, and the keys open it.
  await hover(extension);
  browser = await openWithKeys(extension);
  await checkHasLabels(browser, "preloaded, opened with the keys");
  await closePopup(extension, browser);

  // The keys leave nothing for a later mouse to find.
  await hover(extension);
  browser = await openWithMouse(extension);
  await checkNoLabels(browser, "preloaded, opened with the mouse after");
  await closePopup(extension, browser);
  await extension.unload();
});

add_task(async function test_a_press_that_opens_nothing_leaves_no_mark() {
  await SpecialPowers.pushPrefEnv({
    set: [["ui.popup.disable_autohide", true]],
  });
  const extension = loadPopupExtension();
  await extension.startup();

  // The keys press the button of a popup that is open: it closes, and the
  // mouse that opens it next is not the keys.
  let browser = await openWithKeys(extension);
  const hidden = BrowserTestUtils.waitForEvent(
    browser.closest("panel"),
    "popuphidden"
  );
  await pickWithKeys();
  await hidden;
  browser = await openWithMouse(extension);
  await checkNoLabels(
    browser,
    "opened with the mouse after the keys closed it"
  );
  await closePopup(extension, browser);

  // <Esc> closes a popup that has labels, as it does any other.
  browser = await openWithKeys(extension);
  await checkHasLabels(browser, "opened with the keys");
  await focusPage(browser);
  const closed = BrowserTestUtils.waitForEvent(
    browser.closest("panel"),
    "popuphidden"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await closed;
  ok(true, "<Esc> closes the popup");
  await extension.unload();
});
