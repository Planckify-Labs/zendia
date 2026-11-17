/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { Zendia } = ChromeUtils.importESModule(
  "resource:///modules/zendia/Zendia.sys.mjs"
);
const { webChatMirror } = ChromeUtils.importESModule(
  "resource:///modules/zendia/webchat/ZendiaWebChatCookies.sys.mjs"
);

const PAGE = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com"
);
const OTHER = PAGE.replace("https://example.com", "https://example.org");
const CUSTOM = JSON.stringify([
  { id: "alpha", name: "Alpha", url: `${PAGE}file_webchat_page.html` },
  {
    id: "beta",
    name: "Beta",
    url: `${OTHER}file_webchat_page.html`,
    // Not example.org: its cookies are the browser's.
    hosts: ["beta.invalid"],
  },
]);

function dock() {
  return Zendia.webChatDockFor(window);
}

function root() {
  return document.getElementById("zendia-webchat-dock");
}

function stage() {
  return root().querySelector(".zendia-webchat-stage");
}

function shownBrowser() {
  return stage().querySelector("browser:not([hidden])");
}

function tabIds() {
  return [...root().querySelectorAll("[data-chat]")].map(
    tab => tab.dataset.chat
  );
}

async function loaded(browser, url) {
  await TestUtils.waitForCondition(
    () => browser.currentURI?.spec == url,
    `${url} is loaded`
  );
  await TestUtils.waitForCondition(async () => {
    const state = await SpecialPowers.spawn(
      browser,
      [],
      () => content.document.readyState
    ).catch(() => "");
    return state == "complete";
  }, `${url} is complete`);
}

function cookiesOf(host, name, container) {
  return Services.cookies.cookies.filter(
    cookie =>
      cookie.host == host &&
      cookie.name == name &&
      cookie.originAttributes.userContextId == container
  );
}

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["zendia.webchat.custom", CUSTOM],
      ["zendia.webchat.accounts", ""],
      ["zendia.webchat.layout", "float"],
      ["zendia.webchat.default", "alpha"],
    ],
  });
  Services.cookies.removeAll();
  registerCleanupFunction(() => {
    dock().close();
    Services.cookies.removeAll();
  });
});

add_task(async function test_the_panel_is_built_and_closed() {
  Assert.ok(dock(), "the window has a web chat panel");
  Assert.ok(root().hidden, "closed to begin with");
  Assert.equal(root().getAttribute("role"), "dialog");
  const ids = tabIds();
  Assert.ok(
    ids.includes("chatgpt") && ids.includes("claude"),
    "built-in sites"
  );
  Assert.ok(ids.includes("alpha") && ids.includes("beta"), "the user's sites");
  Assert.ok(
    document.querySelector(".zendia-webchat-remove"),
    "a site the user added can be taken off"
  );
  for (const name of ["reload", "open-tab", "accounts", "to-agent", "close"]) {
    Assert.ok(root().querySelector(`.${name}`), `the header has ${name}`);
  }
  Assert.ok(
    Zendia.agentDockFor(window).contains(
      document.querySelector("#zendia-agent-dock .web-chat")
    ),
    "and the agent's has a way over"
  );
  Assert.equal(
    root().querySelectorAll(".zendia-webchat-item > .zendia-webchat-remove")
      .length,
    2,
    "and only those"
  );
});

add_task(async function test_open_keeps_pages_and_isolates_accounts() {
  await dock().open({ id: "alpha" });
  Assert.ok(!root().hidden, "open");
  Assert.ok(dock().isOpen);
  Assert.equal(root().getAttribute("layout"), "float");
  const alpha = shownBrowser();
  Assert.ok(alpha, "a page for the picked site");
  const container = Number(alpha.getAttribute("usercontextid"));
  Assert.greater(container, 0, "in a container of its own");
  await loaded(alpha, `${PAGE}file_webchat_page.html`);
  Assert.equal(
    root().querySelector('[data-chat="alpha"] .zendia-webchat-label')
      .textContent,
    "Alpha",
    "the picked site's name is on the strip"
  );
  Assert.equal(
    root().querySelector('[data-chat="alpha"]').getAttribute("aria-selected"),
    "true"
  );

  info("The site's own cookies stay in the panel");
  await SpecialPowers.spawn(alpha, [], () => {
    content.document.cookie = "who=panel; path=/; Secure";
    content.window.marker = "kept";
  });
  await TestUtils.waitForCondition(
    () => cookiesOf("example.com", "who", container).length,
    "the cookie is in the panel's container"
  );
  Assert.equal(
    cookiesOf("example.com", "who", 0).length,
    0,
    "and not in the tabs'"
  );
  await BrowserTestUtils.withNewTab(
    `${PAGE}file_webchat_page.html`,
    async tab => {
      const seen = await SpecialPowers.spawn(
        tab,
        [],
        () => content.document.cookie
      );
      Assert.equal(seen, "", "a tab on the same site is another account");
    }
  );

  info("Another site: the first keeps its page");
  await dock().select("beta");
  const beta = shownBrowser();
  Assert.notEqual(beta, alpha, "its own browser");
  Assert.ok(alpha.hidden, "the first is only hidden");
  await dock().select("alpha");
  Assert.equal(shownBrowser(), alpha, "the same browser comes back");
  const marker = await SpecialPowers.spawn(
    alpha,
    [],
    () => content.window.marker
  );
  Assert.equal(marker, "kept", "the page was not reloaded");
});

add_task(async function test_other_sites_use_the_browsers_logins() {
  const tabs = gBrowser.selectedTab.userContextId ?? 0;
  Services.cookies.add(
    "example.org",
    "/",
    "login",
    "from-the-tabs",
    true,
    false,
    false,
    Date.now() + 86400000,
    { userContextId: tabs },
    Ci.nsICookie.SAMESITE_LAX,
    Ci.nsICookie.SCHEME_HTTPS
  );
  await dock().select("beta");
  await webChatMirror().settled();
  const beta = shownBrowser();
  await loaded(beta, `${OTHER}file_webchat_page.html`);
  const seen = await SpecialPowers.spawn(
    beta,
    [],
    () => content.document.cookie
  );
  Assert.equal(seen, "login=from-the-tabs", "a login of the browser is here");

  info("A logout in a tab is a logout here");
  Services.cookies.remove("example.org", "login", "/", {
    userContextId: tabs,
  });
  await webChatMirror().settled();
  Assert.equal(
    await SpecialPowers.spawn(beta, [], () => content.document.cookie),
    "",
    "and it follows"
  );
});

add_task(async function test_a_page_can_ask_for_the_microphone() {
  // Dictation: the page asks, and the prompt must be where the user can see
  // it, as for a tab, or the page waits for ever.
  await SpecialPowers.pushPrefEnv({
    set: [
      // Prompts are shown, with fake devices to give.
      ["media.navigator.permission.fake", true],
      ["media.navigator.permission.force", false],
      ["media.navigator.streams.fake", true],
      ["media.audio_loopback_dev", ""],
      ["media.video_loopback_dev", ""],
    ],
  });
  await dock().open({ id: "alpha" });
  const browser = shownBrowser();
  await loaded(browser, `${PAGE}file_webchat_page.html`);
  // As the page asks, not as the test's own privileged code.
  await SpecialPowers.spawn(browser, [], () => {
    content.wrappedJSObject.eval(`
      window.state = "pending";
      navigator.mediaDevices.getUserMedia({ audio: true }).then(
        stream => {
          window.state = "allowed";
          window.stream = stream;
        },
        error => {
          window.state = error.name;
        }
      );
    `);
  });
  const popups = window.PopupNotifications;
  await TestUtils.waitForCondition(
    () => popups.getNotification("webRTC-shareDevices", browser),
    "the page's prompt is made"
  );
  await TestUtils.waitForCondition(
    () => popups.panel.state == "open",
    "and shown"
  );
  Assert.equal(
    popups.panel.anchorNode?.id,
    "zendia-webchat-anchor",
    "at the web chat panel"
  );
  popups.panel.firstElementChild.button.click();
  const tracks = await SpecialPowers.spawn(browser, [], async () => {
    while (content.wrappedJSObject.state == "pending") {
      await new Promise(resolve => content.setTimeout(resolve, 50));
    }
    const { state, stream } = content.wrappedJSObject;
    const count = state == "allowed" ? stream.getAudioTracks().length : state;
    stream?.getTracks().forEach(track => track.stop());
    return count;
  });
  Assert.equal(tracks, 1, "allowed: the page has the microphone");
  // The prompt leaves "always ask" for the site: not for the next test.
  Services.perms.removeFromPrincipal(
    Services.scriptSecurityManager.createContentPrincipalFromOrigin(
      "https://example.com"
    ),
    "microphone"
  );
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_sites_are_added_and_taken_off() {
  const input = root().querySelector(".zendia-webchat-add-input");
  root().querySelector(".zendia-webchat-add-button").click();
  Assert.ok(!input.closest(".zendia-webchat-add").hidden, "the address row");
  input.value = "not an address with spaces";
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  Assert.ok(input.hasAttribute("invalid"), "refused");
  // A test server's address, as the network is the test's own.
  input.value = `https://example.net/${PAGE.split("example.com/")[1]}file_webchat_page.html`;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  await TestUtils.waitForCondition(
    () => tabIds().includes("example-net"),
    "the site is on the strip"
  );
  Assert.ok(root().querySelector(".zendia-webchat-add").hidden, "row closed");
  await dock().select("alpha");
  root()
    .querySelector('[data-chat="example-net"]')
    .parentElement.querySelector(".zendia-webchat-remove")
    .click();
  await TestUtils.waitForCondition(
    () => !tabIds().includes("example-net"),
    "and taken off"
  );
  Assert.equal(shownBrowser().currentURI.spec.includes("example.com"), true);
});

function menu() {
  return root().querySelector(".zendia-webchat-menu");
}

function menuRow(label) {
  return [...menu().querySelectorAll(".zendia-webchat-menu-main")].find(
    row => row.textContent == label
  );
}

async function openMenu() {
  if (menu().hidden) {
    root().querySelector(".accounts").click();
  }
  await TestUtils.waitForCondition(() => !menu().hidden, "the menu is open");
}

add_task(async function test_accounts() {
  await dock().open({ id: "alpha" });
  const first = shownBrowser();
  await loaded(first, `${PAGE}file_webchat_page.html`);
  const firstContainer = Number(first.getAttribute("usercontextid"));
  // The strip is drawn again when the accounts change.
  const alphaTab = () => root().querySelector('[data-chat="alpha"]');
  Assert.ok(
    !alphaTab().hasAttribute("data-multiple"),
    "one account: no choice yet"
  );

  info("Add a new account");
  await openMenu();
  Assert.equal(
    menuRow("Account 1").getAttribute("aria-checked"),
    "true",
    "the first account is in use"
  );
  Assert.ok(menuRow("Same as regular browsing"), "the browser's state is here");
  Assert.ok(
    menuRow("Refresh logins from browser"),
    "and a way to copy the browser's logins again"
  );
  menuRow("Add new account").click();
  await TestUtils.waitForCondition(
    () => shownBrowser() != first,
    "the new account has a page of its own"
  );
  const second = shownBrowser();
  const secondContainer = Number(second.getAttribute("usercontextid"));
  Assert.greater(secondContainer, 0, "in a container");
  Assert.notEqual(secondContainer, firstContainer, "of its own");
  Assert.ok(first.hidden, "the first account's page is kept");
  Assert.ok(menu().hidden, "the menu is put away");
  Assert.ok(alphaTab().hasAttribute("data-multiple"), "now there is a choice");
  Assert.equal(
    alphaTab().querySelector(".zendia-webchat-account").textContent,
    "Account 2",
    "and the strip says which"
  );
  await loaded(second, `${PAGE}file_webchat_page.html`);
  Assert.equal(
    await SpecialPowers.spawn(second, [], () => content.document.cookie),
    "",
    "it is signed in as nobody the first account is"
  );
  await SpecialPowers.spawn(second, [], () => {
    content.document.cookie = "who=second; path=/; Secure";
  });
  await TestUtils.waitForCondition(
    () => cookiesOf("example.com", "who", secondContainer).length,
    "the second account keeps its own cookie"
  );
  Assert.equal(
    cookiesOf("example.com", "who", firstContainer)[0]?.value,
    "panel",
    "and the first keeps its own"
  );

  info("The name on the strip opens the menu to switch");
  alphaTab().click();
  await TestUtils.waitForCondition(() => !menu().hidden, "menu opens");
  menuRow("Account 1").click();
  await TestUtils.waitForCondition(
    () => shownBrowser() == first,
    "the first account's page comes back"
  );
  Assert.equal(
    await SpecialPowers.spawn(first, [], () => content.window.marker),
    "kept",
    "as it was left"
  );

  info("The browser's own state of the site is a choice, not an account");
  await openMenu();
  menuRow("Same as regular browsing").click();
  await TestUtils.waitForCondition(
    () => shownBrowser() != first && shownBrowser() != second,
    "a page in the browser's container"
  );
  const browserPage = shownBrowser();
  Assert.equal(
    Number(browserPage.getAttribute("usercontextid") || 0),
    gBrowser.selectedTab.userContextId ?? 0,
    "the tabs' container"
  );
  Assert.equal(
    alphaTab().querySelector(".zendia-webchat-account").textContent,
    "Browser"
  );
  await openMenu();
  Assert.equal(
    menuRow("Same as regular browsing").getAttribute("aria-checked"),
    "true"
  );
  Assert.equal(menuRow("Account 1").getAttribute("aria-checked"), "false");
  Assert.ok(
    !menuRow("Refresh logins from browser"),
    "nothing is copied for the browser's own state"
  );

  info("An account can be taken off, with what it kept");
  menu()
    .querySelector('[data-account="a2"] + .zendia-webchat-menu-remove')
    .click();
  await TestUtils.waitForCondition(
    () => !second.isConnected,
    "its page is gone"
  );
  await TestUtils.waitForCondition(
    () => !cookiesOf("example.com", "who", secondContainer).length,
    "and its cookies"
  );
  Assert.equal(
    JSON.parse(Services.prefs.getStringPref("zendia.webchat.accounts"))?.alpha
      ?.accounts?.length ?? 0,
    0,
    "it is off the site"
  );
  Services.prefs.clearUserPref("zendia.webchat.accounts");
});

add_task(async function test_layout_follows_its_pref() {
  await SpecialPowers.pushPrefEnv({
    set: [["zendia.webchat.layout", "slide"]],
  });
  Assert.equal(
    root().getAttribute("layout"),
    "slide",
    "layout follows its pref"
  );
  await SpecialPowers.popPrefEnv();

  dock().close();
  await TestUtils.waitForCondition(() => root().hidden, "closed");
  Assert.ok(!dock().isOpen);
});

add_task(async function test_other_buffers_close_a_floating_panel() {
  await dock().open({ id: "alpha" });
  Assert.ok(dock().isOpen);
  const explorer = Zendia.explorerFor(window);
  explorer.open();
  Assert.ok(!dock().isOpen, "the explorer takes the keys: the panel goes");
  explorer.close();
});
