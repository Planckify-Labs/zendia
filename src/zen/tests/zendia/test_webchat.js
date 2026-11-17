/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const {
  ZENDIA_WEBCHATS,
  chatHosts,
  hostIsSite,
  idForUrl,
  parseChatUrl,
  parseCustom,
  webChats,
  withCustomSite,
  withoutCustomSite,
} = ChromeUtils.importESModule(
  "resource:///modules/zendia/webchat/ZendiaWebChats.sys.mjs"
);
const { ZendiaCookieMirror, cookieKey, isChatCookie, partitionSite } =
  ChromeUtils.importESModule(
    "resource:///modules/zendia/webchat/ZendiaWebChatCookies.sys.mjs"
  );
const {
  BROWSER,
  MAIN,
  accountsOf,
  addAccount,
  identityName,
  parseAccounts,
  removeAccount,
  selectAccount,
} = ChromeUtils.importESModule(
  "resource:///modules/zendia/webchat/ZendiaWebChatAccounts.sys.mjs"
);
const { webChatIcon, webChatIconIsMono } = ChromeUtils.importESModule(
  "resource:///modules/zendia/webchat/ZendiaWebChatIcons.sys.mjs"
);

const TABS = 0;
const CHAT = 7;
const FUTURE = Date.now() + 24 * 60 * 60 * 1000;

function ids(chats) {
  return chats.map(chat => chat.id);
}

add_task(function test_builtin_sites() {
  Assert.deepEqual(
    ids(webChats("")),
    [
      "chatgpt",
      "claude",
      "gemini",
      "kimi",
      "grok",
      "deepseek",
      "perplexity",
      "copilot",
    ],
    "the built-in sites, in the strip's order"
  );
  for (const chat of ZENDIA_WEBCHATS) {
    Assert.ok(parseChatUrl(chat.url), `${chat.id} has an https address`);
    Assert.ok(chat.hosts.length, `${chat.id} has hosts of its own`);
    Assert.ok(webChatIcon(chat).startsWith("data:image/svg+xml"), chat.id);
  }
  Assert.ok(webChatIconIsMono("chatgpt"));
  Assert.ok(!webChatIconIsMono("gemini"));
  Assert.ok(
    webChatIcon({ id: "chatgpt" }).includes("%238b8b93"),
    "a one-shape logo is gray in a picker"
  );
  Assert.ok(
    !webChatIcon({ id: "chatgpt" }, { mask: true }).includes("%238b8b93"),
    "and black as a mask"
  );
});

add_task(function test_custom_entries() {
  const json = JSON.stringify([
    { id: "mistral", name: "Le Chat", url: "https://chat.mistral.ai/" },
    { id: "grok", hidden: true },
    { id: "claude", url: "https://claude.ai/new?model=x", name: "Claude AI" },
    { id: "bad id", url: "https://example.com/" },
    { id: "http", url: "http://example.com/" },
    { id: "js", url: "javascript:alert(1)" },
    { id: "mistral", url: "https://duplicate.example/" },
    "nonsense",
    { id: "color", url: "https://c.example/", color: "red" },
  ]);
  const chats = webChats(json);
  Assert.deepEqual(ids(chats), [
    "chatgpt",
    "claude",
    "gemini",
    "kimi",
    "deepseek",
    "perplexity",
    "copilot",
    "mistral",
    "color",
  ]);
  const claude = chats.find(chat => chat.id == "claude");
  Assert.equal(claude.name, "Claude AI", "an entry changes a built-in site");
  Assert.equal(claude.url, "https://claude.ai/new?model=x");
  Assert.ok(claude.hosts.includes("claude.ai"), "keeping its own hosts");
  const mistral = chats.find(chat => chat.id == "mistral");
  Assert.ok(mistral.custom);
  Assert.deepEqual(mistral.hosts, ["chat.mistral.ai"]);
  Assert.equal(
    chats.find(chat => chat.id == "color").color,
    undefined,
    "a color is #rrggbb"
  );
  Assert.deepEqual(parseCustom("{not json"), []);
  Assert.deepEqual(parseCustom('{"id": "a"}'), [], "an array is expected");
});

add_task(function test_adding_and_removing_a_site() {
  Assert.equal(withCustomSite("", "http://insecure.example"), null);
  Assert.equal(withCustomSite("", "not a url at all"), null);
  const added = withCustomSite("", "chat.mistral.ai");
  Assert.equal(added.chat.id, "chat-mistral-ai");
  Assert.equal(added.chat.name, "Mistral");
  Assert.deepEqual(added.chat.hosts, ["chat.mistral.ai"]);
  Assert.ok(ids(webChats(added.json)).includes("chat-mistral-ai"));
  const again = withCustomSite(added.json, "https://chat.mistral.ai/x");
  Assert.equal(again.chat.id, "chat-mistral-ai-2", "ids stay different");
  Assert.equal(
    ids(webChats(withoutCustomSite(again.json, "chat-mistral-ai"))).filter(id =>
      id.startsWith("chat-mistral")
    ).length,
    1
  );
  Assert.equal(
    idForUrl(new URL("https://www.example.com/"), new Set(["example-com"])),
    "example-com-2"
  );
});

add_task(function test_hosts() {
  Assert.ok(hostIsSite(".claude.ai", "claude.ai"));
  Assert.ok(hostIsSite("api.claude.ai", "claude.ai"));
  Assert.ok(!hostIsSite("notclaude.ai", "claude.ai"));
  Assert.ok(!hostIsSite("claude.ai.evil.example", "claude.ai"));
  const hosts = chatHosts(webChats(""));
  Assert.ok(hosts.includes("gemini.google.com"));
  Assert.ok(
    !hosts.includes("google.com"),
    "Google's sign-in is not a chat site's own"
  );
});

add_task(function test_chat_cookies() {
  const hosts = chatHosts(webChats(""));
  const cookie = (host, originAttributes = {}) => ({
    host,
    path: "/",
    name: "n",
    originAttributes,
  });
  Assert.ok(isChatCookie(cookie(".claude.ai"), hosts));
  Assert.ok(isChatCookie(cookie("auth.openai.com"), hosts));
  Assert.ok(isChatCookie(cookie("gemini.google.com"), hosts));
  Assert.ok(!isChatCookie(cookie(".google.com"), hosts), "Google's login");
  Assert.ok(!isChatCookie(cookie("accounts.google.com"), hosts));
  Assert.ok(!isChatCookie(cookie("github.com"), hosts));
  Assert.ok(
    isChatCookie(
      cookie("stripe.com", { partitionKey: "(https,claude.ai)" }),
      hosts
    ),
    "a third party's cookie kept for a chat site's page is the chat site's"
  );
  Assert.ok(
    !isChatCookie(
      cookie("stripe.com", { partitionKey: "(https,example.org)" }),
      hosts
    )
  );
  Assert.equal(partitionSite("(https,claude.ai,8443)"), "claude.ai");
  Assert.equal(partitionSite(""), "");
  Assert.notEqual(
    cookieKey(cookie("a.com", { partitionKey: "(https,b.com)" })),
    cookieKey(cookie("a.com")),
    "a partitioned cookie is another cookie"
  );
});

function setCookie(host, name, value, container, extra = {}) {
  Services.cookies.add(
    host,
    "/",
    name,
    value,
    true,
    extra.httpOnly ?? false,
    false,
    FUTURE,
    { userContextId: container },
    Ci.nsICookie.SAMESITE_LAX,
    Ci.nsICookie.SCHEME_HTTPS
  );
}

function valueIn(container, host, name) {
  const found = Services.cookies.cookies.find(
    cookie =>
      cookie.name == name &&
      cookie.host == host &&
      cookie.originAttributes.userContextId == container
  );
  return found ? found.value : null;
}

function newMirror(storePath = null) {
  return new ZendiaCookieMirror({
    targets: [CHAT],
    source: TABS,
    hosts: () => chatHosts(webChats("")),
    storePath,
    yieldEvery: 2,
    flushDelay: 1,
  });
}

add_task(async function test_mirror() {
  Services.cookies.removeAll();
  setCookie(".google.com", "SID", "g1", TABS, { httpOnly: true });
  setCookie("github.com", "session", "gh1", TABS);
  setCookie(".claude.ai", "sessionKey", "tab-account", TABS);
  setCookie(".claude.ai", "sessionKey", "chat-account", CHAT);
  setCookie("stale.example", "old", "x", CHAT);

  const mirror = newMirror();
  await mirror.start();
  await mirror.settled();
  registerCleanupFunction(() => mirror.stop());

  Assert.equal(valueIn(CHAT, ".google.com", "SID"), "g1", "login copied");
  const copied = Services.cookies.cookies.find(
    cookie =>
      cookie.name == "SID" && cookie.originAttributes.userContextId == CHAT
  );
  Assert.ok(copied.isHttpOnly && copied.isSecure, "with its flags");
  Assert.equal(valueIn(CHAT, "github.com", "session"), "gh1");
  Assert.equal(
    valueIn(CHAT, ".claude.ai", "sessionKey"),
    "chat-account",
    "a chat site's own cookie stays the panel's"
  );
  Assert.equal(
    valueIn(TABS, ".claude.ai", "sessionKey"),
    "tab-account",
    "and the tabs' too"
  );
  Assert.equal(
    valueIn(CHAT, "stale.example", "old"),
    null,
    "what the tabs do not have is taken out"
  );

  info("A login in a tab reaches the panel");
  setCookie("gitlab.com", "session", "gl1", TABS);
  await mirror.settled();
  Assert.equal(valueIn(CHAT, "gitlab.com", "session"), "gl1");

  info("A change in a tab reaches the panel");
  setCookie("github.com", "session", "gh2", TABS);
  await mirror.settled();
  Assert.equal(valueIn(CHAT, "github.com", "session"), "gh2");

  info("A logout in a tab reaches the panel");
  Services.cookies.remove("github.com", "session", "/", {
    userContextId: TABS,
  });
  await mirror.settled();
  Assert.equal(valueIn(CHAT, "github.com", "session"), null);

  info("A chat site's cookie in a tab never reaches the panel");
  setCookie(".claude.ai", "other", "t", TABS);
  await mirror.settled();
  Assert.equal(valueIn(CHAT, ".claude.ai", "other"), null);

  info("What the panel changed stays as it left it");
  setCookie(".google.com", "SID", "g-panel", CHAT);
  Assert.ok(
    mirror.isOwned(".google.com", CHAT),
    "the account has the whole site, not the one cookie"
  );
  setCookie(".google.com", "SID", "g2", TABS);
  await mirror.settled();
  Assert.equal(
    valueIn(CHAT, ".google.com", "SID"),
    "g-panel",
    "another Google account picked in the panel stays picked"
  );
  setCookie("panel-only.example", "p", "1", CHAT);
  await mirror.settled();
  Assert.equal(
    valueIn(CHAT, "panel-only.example", "p"),
    "1",
    "a login made in the panel is kept"
  );

  info("Sync logins gives everything back to the browser's");
  await mirror.resync();
  Assert.equal(valueIn(CHAT, ".google.com", "SID"), "g2");
  Assert.equal(valueIn(CHAT, "panel-only.example", "p"), null);
  Assert.equal(valueIn(CHAT, ".claude.ai", "sessionKey"), "chat-account");

  mirror.stop();
  setCookie("late.example", "l", "1", TABS);
  await mirror.settled();
  Assert.equal(valueIn(CHAT, "late.example", "l"), null, "stopped");
});

add_task(async function test_owned_cookies_are_kept() {
  Services.cookies.removeAll();
  const path = PathUtils.join(do_get_profile().path, "webchat-owned.json");
  setCookie(".google.com", "SID", "g1", TABS);

  let mirror = newMirror(path);
  await mirror.start();
  await mirror.settled();
  setCookie(".google.com", "SID", "picked-in-panel", CHAT);
  await mirror.flushStore();
  mirror.stop();

  mirror = newMirror(path);
  await mirror.start();
  await mirror.settled();
  Assert.equal(
    valueIn(CHAT, ".google.com", "SID"),
    "picked-in-panel",
    "a restart does not take the panel's choice back"
  );
  mirror.stop();
  await IOUtils.remove(path, { ignoreAbsent: true });
});

add_task(async function test_source_follows_the_tab_in_front() {
  Services.cookies.removeAll();
  setCookie("one.example", "a", "1", TABS);
  setCookie("two.example", "b", "2", 3);
  const mirror = newMirror();
  await mirror.start();
  await mirror.settled();
  Assert.equal(valueIn(CHAT, "one.example", "a"), "1");
  mirror.setSource(3);
  await mirror.settled();
  Assert.equal(valueIn(CHAT, "two.example", "b"), "2");
  Assert.equal(
    valueIn(CHAT, "one.example", "a"),
    null,
    "the other container's logins give way"
  );
  mirror.setSource(CHAT);
  Assert.equal(mirror.source, 3, "the panel's own container is no source");
  mirror.stop();
});

add_task(function test_accounts_of_a_site() {
  const first = accountsOf("", "chatgpt");
  Assert.deepEqual(first.accounts, [{ id: MAIN, name: "Account 1" }]);
  Assert.equal(first.active, MAIN);
  Assert.ok(!first.multiple, "one account is no choice");

  const added = addAccount("", "chatgpt");
  Assert.equal(added.account.id, "a2");
  Assert.equal(added.account.name, "Account 2");
  let json = added.json;
  let state = accountsOf(json, "chatgpt");
  Assert.equal(state.active, "a2", "a new account is the one in use");
  Assert.ok(state.multiple);
  Assert.equal(state.label, "Account 2");
  Assert.ok(!accountsOf(json, "claude").multiple, "each site has its own");

  json = addAccount(json, "chatgpt").json;
  Assert.equal(accountsOf(json, "chatgpt").accounts.length, 3);

  json = selectAccount(json, "chatgpt", MAIN);
  Assert.equal(accountsOf(json, "chatgpt").active, MAIN);
  json = selectAccount(json, "chatgpt", BROWSER);
  state = accountsOf(json, "chatgpt");
  Assert.equal(state.active, BROWSER);
  Assert.equal(state.label, "Browser");
  Assert.equal(
    selectAccount(json, "chatgpt", "a9"),
    json,
    "an account that is not there cannot be used"
  );

  json = removeAccount(json, "chatgpt", "a2");
  Assert.deepEqual(
    accountsOf(json, "chatgpt").accounts.map(account => account.id),
    [MAIN, "a3"]
  );
  Assert.equal(removeAccount(json, "chatgpt", MAIN), json, "the first stays");
  json = removeAccount(selectAccount(json, "chatgpt", "a3"), "chatgpt", "a3");
  state = accountsOf(json, "chatgpt");
  Assert.equal(state.active, MAIN, "the first is used when its user is gone");
  Assert.ok(!state.multiple);
  Assert.equal(json, "{}", "nothing is kept for a site as it began");

  Assert.deepEqual(parseAccounts("{bad json"), {});
  Assert.deepEqual(
    accountsOf('{"x": {"active": "evil", "accounts": [{"id": "../a"}]}}', "x")
      .accounts,
    [{ id: MAIN, name: "Account 1" }],
    "what is not an account is left out"
  );
  Assert.equal(identityName("claude", MAIN), "zendia-webchat");
  Assert.equal(identityName("claude", "a2"), "zendia-webchat:claude:a2");
});

add_task(async function test_accounts_have_containers_of_their_own() {
  Services.cookies.removeAll();
  const SECOND = 8;
  setCookie(".google.com", "SID", "g1", TABS);
  setCookie(".claude.ai", "sessionKey", "one", CHAT);
  setCookie(".claude.ai", "sessionKey", "two", SECOND);

  const mirror = newMirror();
  await mirror.start();
  await mirror.settled();
  mirror.addTarget(SECOND);
  await mirror.settled();
  Assert.deepEqual(mirror.targets.sort(), [CHAT, SECOND]);
  Assert.equal(valueIn(CHAT, ".google.com", "SID"), "g1");
  Assert.equal(valueIn(SECOND, ".google.com", "SID"), "g1", "in each");
  Assert.equal(valueIn(CHAT, ".claude.ai", "sessionKey"), "one");
  Assert.equal(valueIn(SECOND, ".claude.ai", "sessionKey"), "two");

  info("A login in a tab reaches every account");
  setCookie("github.com", "session", "gh", TABS);
  await mirror.settled();
  Assert.equal(valueIn(CHAT, "github.com", "session"), "gh");
  Assert.equal(valueIn(SECOND, "github.com", "session"), "gh");

  info("What one account changed is its own, not the other's");
  setCookie(".google.com", "SID", "picked", SECOND);
  setCookie(".google.com", "SID", "g2", TABS);
  await mirror.settled();
  Assert.equal(valueIn(CHAT, ".google.com", "SID"), "g2");
  Assert.equal(valueIn(SECOND, ".google.com", "SID"), "picked");

  info("An account taken off is no longer kept in step");
  mirror.removeTarget(SECOND);
  setCookie("later.example", "l", "1", TABS);
  await mirror.settled();
  Assert.equal(valueIn(CHAT, "later.example", "l"), "1");
  Assert.equal(valueIn(SECOND, "later.example", "l"), null);
  mirror.stop();
});

add_task(async function test_a_login_is_never_mixed() {
  Services.cookies.removeAll();
  const google = (name, value, container) =>
    setCookie(".google.com", name, value, container);
  google("SID", "a-sid", TABS);
  google("__Secure-1PSIDTS", "a-ts", TABS);
  google("SIDCC", "a-cc", TABS);
  const mirror = newMirror();
  await mirror.start();
  await mirror.settled();
  Assert.equal(valueIn(CHAT, ".google.com", "SID"), "a-sid", "copied");

  info("The panel's page renews two of the cookies, as Google does");
  google("SIDCC", "panel-cc", CHAT);
  google("__Secure-1PSIDTS", "panel-ts", CHAT);

  info("The browser signs in again, and all three change");
  google("SID", "b-sid", TABS);
  google("__Secure-1PSIDTS", "b-ts", TABS);
  google("SIDCC", "b-cc", TABS);
  await mirror.settled();
  Assert.equal(
    valueIn(CHAT, ".google.com", "SID"),
    "a-sid",
    "the new login's cookie is not put among the panel's renewed ones"
  );
  Assert.equal(valueIn(CHAT, ".google.com", "SIDCC"), "panel-cc");
  Assert.equal(valueIn(CHAT, ".google.com", "__Secure-1PSIDTS"), "panel-ts");

  info("Refreshing copies the browser's login, all of it");
  await mirror.resync();
  Assert.equal(valueIn(CHAT, ".google.com", "SID"), "b-sid");
  Assert.equal(valueIn(CHAT, ".google.com", "SIDCC"), "b-cc");
  Assert.equal(valueIn(CHAT, ".google.com", "__Secure-1PSIDTS"), "b-ts");
  mirror.stop();
});

add_task(async function test_an_old_store_makes_the_logins_whole_again() {
  Services.cookies.removeAll();
  const path = PathUtils.join(do_get_profile().path, "webchat-old-owned.json");
  // What the first version kept: single cookies, no version.
  await IOUtils.writeJSON(path, {
    owned: [`${CHAT}\u0001.google.com\u0000/\u0000SIDCC\u0000\u0000`],
  });
  setCookie(".google.com", "SID", "browser-sid", TABS);
  setCookie(".google.com", "SIDCC", "browser-cc", TABS);
  // A panel with a login of another time: its renewed cookie, and the
  // browser's login over its other.
  setCookie(".google.com", "SID", "browser-sid", CHAT);
  setCookie(".google.com", "SIDCC", "old-panel-cc", CHAT);
  setCookie(".google.com", "LEFTOVER", "x", CHAT);

  const mirror = newMirror(path);
  await mirror.start();
  await mirror.settled();
  Assert.equal(
    valueIn(CHAT, ".google.com", "SIDCC"),
    "browser-cc",
    "no single cookie is the panel's any more"
  );
  Assert.equal(valueIn(CHAT, ".google.com", "LEFTOVER"), null);
  mirror.stop();
  await IOUtils.remove(path, { ignoreAbsent: true });
});
