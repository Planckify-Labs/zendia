/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const PAGE = `<body style="height: 6000px; margin: 0">
  <input id="field">
  <p>zendia</p>
</body>`;

async function openPage(body = PAGE) {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "data:text/html," + encodeURIComponent(`<!doctype html>${body}`)
  );
  registerCleanupFunction(() => {
    if (gBrowser.tabs.includes(tab)) {
      BrowserTestUtils.removeTab(tab);
    }
  });
  tab.linkedBrowser.focus();
  await SpecialPowers.spawn(tab.linkedBrowser, [], () => {
    content.document.activeElement?.blur();
    content.focus();
  });
  return tab;
}

function scrollY(browser) {
  return SpecialPowers.spawn(browser, [], () => content.scrollY);
}

function statuslineText() {
  return document.getElementById("zendia-statusline")?.textContent ?? "";
}

add_task(async function test_actor_matches_web_pages() {
  const tab = await openPage();
  ok(
    tab.linkedBrowser.browsingContext.currentWindowGlobal.getActor(
      "ZendiaKeys"
    ),
    "the key actor runs in web content processes"
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_window_frame_follows_mode() {
  const tab = await openPage();
  const colors = () =>
    ["zen-browser-background", "zen-toolbar-background"]
      .map(id => getComputedStyle(document.getElementById(id), "::after"))
      .map(style => style.backgroundColor)
      .join("|");

  await TestUtils.waitForCondition(
    () => statuslineText().includes("NORMAL"),
    "normal mode"
  );
  is(
    document.documentElement.style.getPropertyValue("--zendia-mode-background"),
    gZenThemePicker.getGradient([{ c: [252, 167, 234] }]),
    "normal mode colors the window through Zen's theme gradient"
  );
  const normal = colors();

  await BrowserTestUtils.synthesizeMouseAtCenter(
    "#field",
    {},
    tab.linkedBrowser
  );
  await TestUtils.waitForCondition(
    () => colors() != normal,
    "the frame and the sidebar change color in insert mode"
  );

  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    () => colors() == normal,
    "<Esc> brings the normal mode color back"
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_j_scrolls_an_inner_pane() {
  const tab = await openPage(
    `<body style="margin: 0; overflow: hidden">
       <div id="pane" style="height: 300px; overflow: auto">
         <div style="height: 3000px"></div>
       </div>
     </body>`
  );
  EventUtils.synthesizeKey("j");
  await TestUtils.waitForCondition(
    () =>
      SpecialPowers.spawn(
        tab.linkedBrowser,
        [],
        () => content.document.getElementById("pane").scrollTop > 0
      ),
    "j scrolls the pane when the document cannot scroll"
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_j_gg_G_scroll() {
  const tab = await openPage();
  const browser = tab.linkedBrowser;

  EventUtils.synthesizeKey("j");
  await TestUtils.waitForCondition(
    async () => (await scrollY(browser)) > 0,
    "j scrolls down"
  );

  EventUtils.synthesizeKey("G", { shiftKey: true });
  await TestUtils.waitForCondition(
    async () => (await scrollY(browser)) > 3000,
    "G goes to the bottom"
  );

  EventUtils.synthesizeKey("g");
  EventUtils.synthesizeKey("g");
  await TestUtils.waitForCondition(
    async () => (await scrollY(browser)) == 0,
    "gg goes to the top"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_insert_mode_follows_focus() {
  const tab = await openPage();
  const browser = tab.linkedBrowser;

  await BrowserTestUtils.synthesizeMouseAtCenter("#field", {}, browser);
  await TestUtils.waitForCondition(
    () => statuslineText().includes("INSERT"),
    "clicking into a text field enters insert mode"
  );

  EventUtils.synthesizeKey("j");
  await TestUtils.waitForCondition(
    () =>
      SpecialPowers.spawn(
        browser,
        [],
        () => content.document.getElementById("field").value == "j"
      ),
    "j types into the field in insert mode"
  );
  is(await scrollY(browser), 0, "and does not scroll");

  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    () => statuslineText().includes("NORMAL"),
    "<Esc> returns to normal mode"
  );
  const focused = await SpecialPowers.spawn(
    browser,
    [],
    () => content.document.activeElement?.id ?? ""
  );
  isnot(focused, "field", "<Esc> leaves the field");

  EventUtils.synthesizeKey("j");
  await TestUtils.waitForCondition(
    async () => (await scrollY(browser)) > 0,
    "j scrolls again in normal mode"
  );

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_unmapped_keys_reach_the_page() {
  const tab = await openPage();
  const browser = tab.linkedBrowser;
  await SpecialPowers.spawn(browser, [], () => {
    content.wrappedJSObject.seen = [];
    content.addEventListener("keydown", e =>
      content.wrappedJSObject.seen.push(e.key)
    );
  });

  EventUtils.synthesizeKey("q");
  EventUtils.synthesizeKey("j");
  await TestUtils.waitForCondition(
    async () => (await scrollY(browser)) > 0,
    "j was handled"
  );
  const seen = await SpecialPowers.spawn(browser, [], () =>
    Array.from(content.wrappedJSObject.seen)
  );
  Assert.deepEqual(seen, ["q"], "the page sees q but not j");

  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_shift_j_k_switch_tabs() {
  const first = await openPage();
  const second = await openPage();
  const tabs = gBrowser.visibleTabs;
  const index = tabs.indexOf(second);
  const previous = tabs[(index - 1 + tabs.length) % tabs.length];

  EventUtils.synthesizeKey("K", { shiftKey: true });
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab == previous,
    "<S-k> selects the previous visible tab"
  );

  previous.linkedBrowser.focus();
  EventUtils.synthesizeKey("J", { shiftKey: true });
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab == second,
    "<S-j> comes back"
  );

  BrowserTestUtils.removeTab(first);
  BrowserTestUtils.removeTab(second);
});

add_task(async function test_tab_keys_treat_a_split_as_one_tab() {
  const opened = [];
  for (let i = 0; i < 4; i++) {
    opened.push(await openPage());
  }
  const [left, right] = opened.slice(1, 3);
  gZenViewSplitter.splitTabs([left, right], "vsep", 1);
  await TestUtils.waitForCondition(
    () => right.splitView && gBrowser.selectedTab == right,
    "split"
  );
  const tabs = gBrowser.visibleTabs;
  const first = Math.min(tabs.indexOf(left), tabs.indexOf(right));
  const before = tabs[first - 1];
  const after = tabs[first + 2];
  gBrowser.selectedTab = before;
  before.linkedBrowser.focus();

  const press = async (key, tab, message) => {
    EventUtils.synthesizeKey(key, { shiftKey: true });
    await TestUtils.waitForCondition(
      () => gBrowser.selectedTab == tab,
      message
    );
    tab.linkedBrowser.focus();
  };
  await press("J", right, "<S-j> goes to the split, on the pane used last");
  await press("J", after, "<S-j> again leaves the split for the next tab");
  await press("K", right, "<S-k> comes back to the split");
  await press("K", before, "and <S-k> again skips its other pane");

  pressLeader("`");
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab == right,
    "<leader>` goes back to the split, on the pane used last"
  );
  right.linkedBrowser.focus();
  EventUtils.synthesizeKey("h", { ctrlKey: true });
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab == left,
    "<C-h> moves to the other pane"
  );
  left.linkedBrowser.focus();
  pressLeader("`");
  await TestUtils.waitForCondition(
    () => gBrowser.selectedTab == before,
    "<leader>` leaves the split for the tab before it, not the other pane"
  );

  gZenViewSplitter.unsplitCurrentView();
  for (const tab of opened) {
    BrowserTestUtils.removeTab(tab);
  }
});

// APZ scrolls <Space>, PageDown and the arrows asynchronously unless the
// focused page has a key listener that could cancel them (see
// HasNonPassiveNonSystemGroupListenersForUntrustedKeyEvents). Synthesized
// keys bypass APZ, so check that the page carries such a listener instead.
add_task(async function test_page_keeps_apz_from_scrolling_mapped_keys() {
  const tab = await openPage();
  const hasListener = await SpecialPowers.spawn(tab.linkedBrowser, [], () =>
    Services.els
      .getListenerInfoFor(content.window)
      .some(
        info =>
          info.type == "keydown" &&
          info.allowsUntrusted &&
          !info.inSystemEventGroup
      )
  );
  ok(hasListener, "APZ sees a key listener on the page and defers to it");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_pending_keys_show_in_statusline() {
  const tab = await openPage();
  EventUtils.synthesizeKey("3");
  EventUtils.synthesizeKey(" ");
  EventUtils.synthesizeKey("b");
  await TestUtils.waitForCondition(
    () => statuslineText().includes("3<Space>b +buffer"),
    "the count, the keys and the which-key group are shown"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    () => !statuslineText().includes("<Space>"),
    "<Esc> clears them"
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_slash_opens_find_in_page() {
  const tab = await openPage();
  EventUtils.synthesizeKey("/");
  await TestUtils.waitForCondition(
    () => gBrowser.getCachedFindBar(tab)?.hidden === false,
    "/ opens the find bar"
  );
  gBrowser.getCachedFindBar(tab).close(true);
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_leader_comma_lists_tabs() {
  const { UrlbarShared } = ChromeUtils.importESModule(
    "chrome://browser/content/urlbar/UrlbarShared.mjs"
  );
  const tab = await openPage();
  EventUtils.synthesizeKey(" ");
  EventUtils.synthesizeKey(",");
  await TestUtils.waitForCondition(
    () => gURLBar.searchMode?.source == UrlbarShared.RESULT_SOURCE.TABS,
    "<leader>, opens the urlbar searching open tabs"
  );
  gURLBar.searchMode = null;
  gURLBar.handleRevert();
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_gi_focuses_the_first_input() {
  const tab = await openPage();
  EventUtils.synthesizeKey("g");
  EventUtils.synthesizeKey("i");
  await TestUtils.waitForCondition(
    () =>
      SpecialPowers.spawn(
        tab.linkedBrowser,
        [],
        () => content.document.activeElement?.id == "field"
      ),
    "gi focuses the input"
  );
  await TestUtils.waitForCondition(
    () => statuslineText().includes("INSERT"),
    "and enters insert mode"
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_p_opens_the_clipboard_url() {
  const tab = await openPage();
  const url = "https://example.com/browser/";
  SpecialPowers.clipboardCopyString(url);
  const loaded = BrowserTestUtils.browserLoaded(tab.linkedBrowser, false, url);
  EventUtils.synthesizeKey("p");
  await loaded;
  is(tab.linkedBrowser.currentURI.spec, url, "p opens the clipboard URL here");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_p_refuses_non_web_urls() {
  const tab = await openPage();
  const before = tab.linkedBrowser.currentURI.spec;
  SpecialPowers.clipboardCopyString("javascript:document.title='pwned'");
  EventUtils.synthesizeKey("p");
  EventUtils.synthesizeKey("j");
  await TestUtils.waitForCondition(
    async () => (await scrollY(tab.linkedBrowser)) > 0,
    "the next key still works"
  );
  is(tab.linkedBrowser.currentURI.spec, before, "nothing was loaded");
  const title = await SpecialPowers.spawn(
    tab.linkedBrowser,
    [],
    () => content.document.title
  );
  isnot(title, "pwned", "the javascript: URL did not run");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_autofocus_does_not_trap_keys_in_insert_mode() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "data:text/html," +
      encodeURIComponent(
        `<!doctype html>
         <body style="height: 6000px">
           <input id="search" autofocus>
           <script>
             window.seen = [];
             addEventListener("keydown", e =>
               seen.push((e.ctrlKey ? "C-" : "") + e.key));
           </script>
         </body>`
      )
  );
  registerCleanupFunction(() => {
    if (gBrowser.tabs.includes(tab)) {
      BrowserTestUtils.removeTab(tab);
    }
  });
  tab.linkedBrowser.focus();

  await TestUtils.waitForCondition(
    () => statuslineText().includes("NORMAL"),
    "a page focusing a field on load does not put it in insert mode"
  );
  EventUtils.synthesizeKey("k", { accelKey: true });
  EventUtils.synthesizeKey("j");
  await TestUtils.waitForCondition(
    async () => (await scrollY(tab.linkedBrowser)) > 0,
    "j scrolls, so the page is in normal mode"
  );
  const seen = await SpecialPowers.spawn(tab.linkedBrowser, [], () =>
    Array.from(content.wrappedJSObject.seen)
  );
  Assert.deepEqual(
    seen,
    [],
    "<C-k> and j never reach the page, so Firefox's Ctrl+K does not run"
  );

  await SpecialPowers.spawn(tab.linkedBrowser, [], () =>
    content.document.getElementById("search").focus()
  );
  await TestUtils.waitForCondition(
    () => statuslineText().includes("INSERT"),
    "focusing the field later still enters insert mode"
  );
  BrowserTestUtils.removeTab(tab);
});

function picker() {
  return document.getElementById("zendia-picker");
}

function pressLeader(keys) {
  EventUtils.synthesizeKey(" ");
  for (const key of keys) {
    EventUtils.synthesizeKey(key);
  }
}

add_task(async function test_split_picker_offers_url_and_tabs() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.theme.acrylic-urlbar", true]],
  });
  const first = await openPage();
  const second = await openPage();

  pressLeader("|");
  await TestUtils.waitForCondition(() => picker(), "<leader>| opens a picker");
  const rows = [...picker().querySelectorAll(".zendia-picker-item")];
  is(
    rows[0].querySelector(".zendia-picker-label").textContent,
    "Open URL…",
    "the first choice opens the urlbar for the new pane"
  );
  is(rows[0].querySelector(".zendia-picker-key").textContent, "/");
  // Headless runs on software WebRender, where Zen marks the window
  // zen-no-acrylic and keeps its glass opaque; check both states.
  const root = document.documentElement;
  const noAcrylic = root.getAttribute("zen-no-acrylic");
  root.removeAttribute("zen-no-acrylic");
  ok(
    getComputedStyle(picker()).backdropFilter.includes("blur(40px)"),
    "the picker has Zen's glass where Zen has acrylic"
  );
  root.setAttribute("zen-no-acrylic", "true");
  is(
    getComputedStyle(picker()).backdropFilter,
    "none",
    "and stays opaque, like the urlbar, where Zen has none"
  );
  if (noAcrylic === null) {
    root.removeAttribute("zen-no-acrylic");
  }

  const row = rows.find(
    r => r.querySelector(".zendia-picker-label").textContent == first.label
  );
  ok(row, "the other tab is offered");
  EventUtils.synthesizeKey(row.querySelector(".zendia-picker-key").textContent);
  await TestUtils.waitForCondition(
    () => first.splitView && second.splitView,
    "picking a tab splits it next to the current one"
  );
  ok(!picker(), "the picker is gone");

  EventUtils.synthesizeKey(" ");
  EventUtils.synthesizeKey("w");
  EventUtils.synthesizeKey("d");
  await TestUtils.waitForCondition(
    () => !first.splitView && !second.splitView,
    "<leader>wd closes the pane, which unsplits a two-pane split"
  );
  ok(
    gBrowser.tabs.includes(first) && gBrowser.tabs.includes(second),
    "both tabs are still open"
  );

  BrowserTestUtils.removeTab(first);
  BrowserTestUtils.removeTab(second);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_leader_wo_unsplits() {
  const first = await openPage();
  const second = await openPage();
  gZenViewSplitter.splitTabs([second, first], "vsep", 0);
  await TestUtils.waitForCondition(() => second.splitView, "split");
  second.linkedBrowser.focus();

  pressLeader("wo");
  await TestUtils.waitForCondition(
    () => !first.splitView && !second.splitView,
    "<leader>wo leaves only the current pane"
  );
  BrowserTestUtils.removeTab(first);
  BrowserTestUtils.removeTab(second);
});

add_task(async function test_split_divides_only_the_current_pane() {
  const left = await openPage(`<title>left</title>${PAGE}`);
  const right = await openPage(`<title>right</title>${PAGE}`);
  const below = await openPage(`<title>below</title>${PAGE}`);
  gZenViewSplitter.splitTabs([left, right], "vsep", 1);
  await TestUtils.waitForCondition(
    () => right.splitView && gBrowser.selectedTab == right,
    "two panes side by side"
  );
  right.linkedBrowser.focus();

  pressLeader("-");
  await TestUtils.waitForCondition(() => picker(), "<leader>- opens a picker");
  const row = [...picker().querySelectorAll(".zendia-picker-item")].find(
    r => r.querySelector(".zendia-picker-label").textContent == "below"
  );
  EventUtils.synthesizeKey(row.querySelector(".zendia-picker-key").textContent);
  await TestUtils.waitForCondition(
    () => below.splitView && gBrowser.selectedTab == below,
    "the picked tab joins the split and gets the focus"
  );

  const { layoutTree } = gZenViewSplitter._data[gZenViewSplitter.currentView];
  is(layoutTree.direction, "row", "the panes are still side by side");
  is(layoutTree.children[0].tab, left, "the left pane is untouched");
  const column = layoutTree.children[1];
  is(column.direction, "column", "the right pane is divided");
  Assert.deepEqual(
    column.children.map(node => node.tab),
    [right, below],
    "with the picked tab below the current one"
  );

  gZenViewSplitter.unsplitCurrentView();
  for (const tab of [left, right, below]) {
    BrowserTestUtils.removeTab(tab);
  }
});

add_task(async function test_escape_dismisses_the_picker() {
  const first = await openPage();
  const second = await openPage();
  pressLeader("-");
  await TestUtils.waitForCondition(() => picker(), "<leader>- opens a picker");
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !picker(), "<Esc> dismisses it");
  ok(!second.splitView, "nothing was split");
  await TestUtils.waitForCondition(
    () => !document.querySelector(".zendia-picker"),
    "its fade ends and takes the box with it"
  );

  EventUtils.synthesizeKey("j");
  await TestUtils.waitForCondition(
    async () => (await scrollY(second.linkedBrowser)) > 0,
    "keys go back to the page"
  );
  BrowserTestUtils.removeTab(first);
  BrowserTestUtils.removeTab(second);
});

add_task(async function test_leader_oh_opens_library_history() {
  const tab = await openPage();
  pressLeader("oh");
  await TestUtils.waitForCondition(() => {
    const library = customElements.get("zen-library");
    return (
      library?.isLibrarySlightlyOpen &&
      document.querySelector("zen-library").activeTab == "history"
    );
  }, "<leader>oh opens the library on History");
  const library = customElements.get("zen-library");
  library.toggle("history");
  await TestUtils.waitForCondition(
    () => !library.isLibrarySlightlyOpen,
    "the library closes again"
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_split_open_url_uses_an_empty_pane() {
  const first = await openPage();
  const second = await openPage();
  pressLeader("|");
  await TestUtils.waitForCondition(() => picker(), "the picker opens");
  EventUtils.synthesizeKey("/");
  await TestUtils.waitForCondition(
    () => gURLBar.focused && gZenViewSplitter.currentView >= 0,
    "/ splits with an empty pane and opens the urlbar for it"
  );
  ok(second.splitView, "the current tab is one side of the split");

  EventUtils.synthesizeKey("KEY_Escape");
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    () => !second.splitView && gZenViewSplitter.currentView < 0,
    "dismissing the urlbar removes the empty pane again"
  );
  BrowserTestUtils.removeTab(first);
  BrowserTestUtils.removeTab(second);
});

const FORM = `<body style="margin: 0; height: 4000px">
  <form>
    <input id="name" style="position: absolute; top: 40px; left: 10px">
    <input id="email" style="position: absolute; top: 40px; left: 300px">
    <input type="checkbox" id="agree" style="position: absolute; top: 90px">
    <textarea id="message" style="position: absolute; top: 140px"></textarea>
    <input id="hidden" style="position: absolute; top: 200px; display: none">
    <input id="below" style="position: absolute; top: 3000px">
  </form>
</body>`;

function focusedField(browser) {
  return SpecialPowers.spawn(
    browser,
    [],
    () => content.document.activeElement?.id ?? ""
  );
}

async function waitForField(browser, id, message) {
  await TestUtils.waitForCondition(
    async () => (await focusedField(browser)) == id,
    message
  );
}

add_task(async function test_i_and_field_jumps() {
  const tab = await openPage(FORM);
  const browser = tab.linkedBrowser;

  EventUtils.synthesizeKey("1");
  EventUtils.synthesizeKey("i");
  await waitForField(browser, "name", "1i enters the top-left visible field");
  await TestUtils.waitForCondition(
    () => statuslineText().includes("INSERT"),
    "in insert mode"
  );

  EventUtils.synthesizeKey("j", { ctrlKey: true });
  await waitForField(browser, "email", "<C-j> goes right along the row");
  EventUtils.synthesizeKey("j", { ctrlKey: true });
  await waitForField(
    browser,
    "message",
    "then down, skipping checkboxes and hidden fields"
  );
  EventUtils.synthesizeKey("j", { ctrlKey: true });
  await waitForField(browser, "below", "and on to fields below the fold");
  ok((await scrollY(browser)) > 0, "which scrolls them into view");
  EventUtils.synthesizeKey("j", { ctrlKey: true });
  await waitForField(browser, "name", "<C-j> wraps around");
  EventUtils.synthesizeKey("k", { ctrlKey: true });
  await waitForField(browser, "below", "<C-k> goes back");
  EventUtils.synthesizeKey("k", { ctrlKey: true });
  await waitForField(browser, "message", "and back again");
  EventUtils.sendString("hello");

  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    () => statuslineText().includes("NORMAL"),
    "<Esc> leaves the field"
  );
  EventUtils.synthesizeKey("g");
  EventUtils.synthesizeKey("i");
  await waitForField(browser, "message", "gi returns to the last used field");
  const caret = await SpecialPowers.spawn(browser, [], () => {
    const field = content.document.getElementById("message");
    return [field.value, field.selectionStart];
  });
  Assert.deepEqual(caret, ["hello", 5], "with the caret after the text");

  EventUtils.synthesizeKey("KEY_Escape");
  EventUtils.synthesizeKey("]");
  EventUtils.synthesizeKey("i");
  await TestUtils.waitForCondition(
    async () => (await focusedField(browser)) != "",
    "]i jumps to a field from normal mode"
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_shift_i_and_i_without_fields_pass_keys() {
  const tab = await openPage(
    `<body style="height: 6000px">
       <script>
         window.seen = [];
         addEventListener("keydown", e => seen.push(e.key));
       </script>
     </body>`
  );
  const browser = tab.linkedBrowser;

  EventUtils.synthesizeKey("i");
  await TestUtils.waitForCondition(
    () => statuslineText().includes("INSERT"),
    "i on a page without fields still enters insert mode"
  );
  EventUtils.synthesizeKey("j");
  EventUtils.synthesizeKey("KEY_Escape");
  EventUtils.synthesizeKey("I", { shiftKey: true });
  await TestUtils.waitForCondition(
    () => statuslineText().includes("INSERT"),
    "I enters insert mode without a field"
  );
  EventUtils.synthesizeKey("k");
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    () => statuslineText().includes("NORMAL"),
    "<Esc> returns to normal mode"
  );
  const seen = await SpecialPowers.spawn(browser, [], () =>
    Array.from(content.wrappedJSObject.seen)
  );
  Assert.deepEqual(seen, ["j", "k"], "insert mode passes keys to the page");
  is(await scrollY(browser), 0, "and they did not scroll");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_insert_mode_editing_keys() {
  const tab = await openPage(
    `<body>
       <input id="field" value="hello world">
       <script>
         window.inputs = 0;
         document.getElementById("field")
           .addEventListener("input", () => inputs++);
       </script>
     </body>`
  );
  const browser = tab.linkedBrowser;
  const value = () =>
    SpecialPowers.spawn(
      browser,
      [],
      () => content.document.getElementById("field").value
    );
  const waitForValue = (expected, message) =>
    TestUtils.waitForCondition(
      async () => (await value()) == expected,
      message
    );

  EventUtils.synthesizeKey("g");
  EventUtils.synthesizeKey("i");
  await TestUtils.waitForCondition(
    () => statuslineText().includes("INSERT"),
    "in the field"
  );

  EventUtils.synthesizeKey("w", { accelKey: true });
  await waitForValue("hello ", "<C-w> deletes the word before the cursor");
  ok(gBrowser.tabs.includes(tab), "and does not close the tab");

  EventUtils.synthesizeKey("u", { ctrlKey: true });
  await waitForValue("", "<C-u> deletes to the start of the line");

  EventUtils.sendString("abc");
  EventUtils.synthesizeKey("h", { ctrlKey: true });
  await waitForValue("ab", "<C-h> deletes the char before the cursor");

  EventUtils.synthesizeKey("z", { accelKey: true });
  await waitForValue("abc", "the edits are undoable like typing");
  const inputs = await SpecialPowers.spawn(
    browser,
    [],
    () => content.wrappedJSObject.inputs
  );
  ok(inputs >= 3, "the page saw input events for the edits");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_ctrl_w_outside_a_field_still_closes_the_tab() {
  const tab = await openPage();
  const closed = BrowserTestUtils.waitForTabClosing(tab);
  EventUtils.synthesizeKey("w", { accelKey: true });
  await closed;
  ok(!gBrowser.tabs.includes(tab), "Ctrl+W keeps its browser meaning");
});

add_task(async function test_the_grid_picker_glides_between_tiles() {
  const { ZendiaPicker } = ChromeUtils.importESModule(
    "resource:///modules/zendia/ui/ZendiaPicker.sys.mjs"
  );
  const tab = await openPage();
  const picked = ZendiaPicker.open(window, {
    title: "Tiles",
    layout: "grid",
    items: ["One", "Two", "Three", "Four"].map(label => ({
      label,
      icon: "chrome://browser/skin/zen-icons/selectable/star.svg",
      color: "#d97757",
    })),
  });
  const root = picker();
  const list = root.querySelector(".zendia-picker-list");
  is(getComputedStyle(list).display, "grid", "the tiles sit in a grid");
  const rows = [...root.querySelectorAll(".zendia-picker-item")];
  is(rows[1].offsetTop, rows[0].offsetTop, "the first tiles share a line");
  ok(rows[3].offsetTop > rows[0].offsetTop, "the fourth starts the next one");

  EventUtils.synthesizeKey("j");
  ok(rows[1].hasAttribute("selected"), "j moves to the next tile");
  const cursor = root.querySelector(".zendia-picker-cursor");
  ok(
    cursor.style.transform.includes(`${rows[1].offsetLeft}px`),
    "the highlight follows it sideways"
  );
  EventUtils.synthesizeKey("KEY_ArrowRight");
  ok(rows[2].hasAttribute("selected"), "so does the right arrow");
  EventUtils.synthesizeKey("KEY_Enter");
  ok(!picker(), "a pick closes it at once");
  ok(root.inert, "and the fading box takes no input");
  is(await picked, 2, "the pick does not wait for the fade");

  const next = ZendiaPicker.open(window, {
    title: "Next",
    items: [{ label: "Only" }],
  });
  is(
    document.querySelectorAll(".zendia-picker").length,
    1,
    "a new picker never shares the window with a fading one"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await next;
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_the_urlbar_is_thin_glass_that_opens_in_motion() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.theme.acrylic-urlbar", true]],
  });
  const root = document.documentElement;
  const noAcrylic = root.getAttribute("zen-no-acrylic");
  root.removeAttribute("zen-no-acrylic");
  // Firefox stops this animation in a remote controlled window, as this one.
  const remote = root.getAttribute("remotecontrol");
  root.removeAttribute("remotecontrol");
  const tab = await openPage();
  const background = gURLBar.querySelector(".urlbar-background");
  gURLBar.setAttribute("breakout-extend", "");
  gURLBar.setAttribute("zen-floating-urlbar", "true");
  ok(background.getAnimations().length, "the pane animates in");
  const style = getComputedStyle(background);
  ok(
    style.backdropFilter.includes("contrast(0.6)"),
    "it takes the shared glass over Zen's"
  );
  const alpha = Number(style.backgroundColor.match(/, ([\d.]+)\)$/)?.[1]);
  ok(alpha < 0.7, `the page shows through the tint (${alpha})`);
  gURLBar.removeAttribute("zen-floating-urlbar");
  gURLBar.removeAttribute("breakout-extend");
  if (noAcrylic !== null) {
    root.setAttribute("zen-no-acrylic", noAcrylic);
  }
  if (remote !== null) {
    root.setAttribute("remotecontrol", remote);
  }
  BrowserTestUtils.removeTab(tab);
});

function whichKey() {
  const popup = document.getElementById("zendia-which-key");
  return popup && !popup.hidden && !popup.hasAttribute("leaving")
    ? popup
    : null;
}

function whichKeyRows() {
  return [...whichKey().querySelectorAll(".zendia-which-key-item")].map(row => [
    row.querySelector(".zendia-which-key-key").textContent,
    row.querySelector(".zendia-which-key-desc").textContent,
  ]);
}

add_task(async function test_which_key_fades_out() {
  await SpecialPowers.pushPrefEnv({ set: [["zendia.timeoutlen", 50]] });
  const tab = await openPage();
  EventUtils.synthesizeKey(" ");
  await TestUtils.waitForCondition(() => whichKey(), "which-key shows");
  const popup = whichKey();
  let fades;
  const leaving = BrowserTestUtils.waitForMutationCondition(
    popup,
    { attributes: true },
    () => {
      if (!popup.hasAttribute("leaving")) {
        return false;
      }
      fades = popup.getAnimations().length;
      return true;
    }
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await leaving;
  ok(fades, "it fades out");
  ok(!whichKey(), "and counts as closed from the start of the fade");
  await TestUtils.waitForCondition(() => popup.hidden, "then it is gone");
  ok(!popup.hasAttribute("leaving"), "with nothing left over");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_which_key_popup() {
  await SpecialPowers.pushPrefEnv({ set: [["zendia.timeoutlen", 50]] });
  const tab = await openPage();

  EventUtils.synthesizeKey(" ");
  await TestUtils.waitForCondition(
    () => whichKey(),
    "the popup shows after the leader, though timeoutlen has long passed"
  );
  is(whichKey().querySelector(".zendia-which-key-title").textContent, "SPC");
  const rows = whichKeyRows();
  ok(
    rows.some(([key, desc]) => key == "e" && desc == "Explorer"),
    "mappings show their desc"
  );
  ok(
    rows.some(([key, desc]) => key == "b" && desc == "+buffer"),
    "groups show their name with a +"
  );
  const firstGroup = rows.findIndex(([, desc]) => desc.startsWith("+"));
  ok(
    rows.slice(firstGroup).every(([, desc]) => desc.startsWith("+")),
    "groups come after mappings, as in which-key"
  );

  EventUtils.synthesizeKey("b");
  await TestUtils.waitForCondition(
    () =>
      whichKey()
        ?.querySelector(".zendia-which-key-title")
        .textContent.includes("+buffer"),
    "the popup follows into the group"
  );
  ok(
    whichKeyRows().some(([key, desc]) => key == "d" && desc == "Delete Tab"),
    "and lists its keys"
  );

  EventUtils.synthesizeKey("KEY_Backspace");
  await TestUtils.waitForCondition(
    () =>
      whichKey()?.querySelector(".zendia-which-key-title").textContent == "SPC",
    "<BS> goes back up one level"
  );

  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !whichKey(), "<Esc> closes it");
  BrowserTestUtils.removeTab(tab);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_leader_question_mark_shows_all_keys() {
  const tab = await openPage();
  EventUtils.synthesizeKey(" ");
  EventUtils.synthesizeKey("?", { shiftKey: true });
  await TestUtils.waitForCondition(
    () =>
      whichKey()?.querySelector(".zendia-which-key-title").textContent ==
      "Keymaps",
    "<leader>? lists every normal mode key"
  );
  ok(
    whichKeyRows().some(([key, desc]) => key == "j" && desc == "Scroll Down"),
    "including plain keys"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => !whichKey(), "the next key closes it");
  BrowserTestUtils.removeTab(tab);
});

async function setCompactMode(value) {
  const settled = () =>
    !document.documentElement.hasAttribute("zen-compact-animating");
  await TestUtils.waitForCondition(settled, "compact mode settles");
  gZenCompactModeManager.preference = value;
  await TestUtils.waitForCondition(
    () => gZenCompactModeManager.preference == value && settled(),
    `compact mode is ${value}`
  );
}

function sidebarShown() {
  return gZenCompactModeManager.isSidebarPotentiallyOpen();
}

add_task(function test_vim_mode_defaults_to_compact_mode_hiding_both() {
  const defaults = Services.prefs.getDefaultBranch("");
  for (const name of [
    "zen.view.compact.enable-at-startup",
    "zen.view.compact.hide-tabbar",
    "zen.view.compact.hide-toolbar",
  ]) {
    ok(defaults.getBoolPref(name), `${name} defaults to true in vim mode`);
  }
});

add_task(async function test_boot_keeps_the_sidebar_hidden_on_the_empty_tab() {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["zen.view.compact.enable-at-startup", true],
      ["zen.view.compact.hide-tabbar", true],
      ["zen.view.compact.hide-toolbar", true],
    ],
  });
  const tabsBefore = [...gBrowser.tabs];
  const win = await BrowserTestUtils.openNewBrowserWindow();
  await win.gZenStartup.promiseInitialized;
  const compact = win.gZenCompactModeManager;
  ok(compact.preference, "the window starts in compact mode");
  const firstTab = win.gBrowser.selectedTab;

  // What Zen's selectEmptyTab() does at startup when no other tab is there
  // to show (the function itself is a no-op while testing).
  const emptyTab = win.gZenWorkspaces._emptyTab;
  win.gBrowser.selectedTab = emptyTab;
  await TestUtils.waitForCondition(
    () => win.gBrowser.selectedTab.hasAttribute("zen-empty-tab"),
    "the empty tab is selected"
  );
  await TestUtils.waitForTick();
  ok(
    !compact.isSidebarPotentiallyOpen(),
    "the sidebar stays hidden on the empty tab while booting"
  );

  // A click through the browser window, the way a real one arrives.
  EventUtils.synthesizeMouseAtCenter(win.gBrowser.selectedBrowser, {}, win);
  win.gBrowser.selectedTab = firstTab;
  win.gBrowser.selectedTab = emptyTab;
  await TestUtils.waitForCondition(
    () => compact.sidebar.hasAttribute("zen-has-empty-tab"),
    "after the first click, the empty tab shows the sidebar as Zen does"
  );

  await BrowserTestUtils.closeWindow(win);
  // Zen's window sync mirrors the new window's tabs into this one.
  for (const tab of gBrowser.tabs) {
    if (!tabsBefore.includes(tab) && !tab.hasAttribute("zen-empty-tab")) {
      BrowserTestUtils.removeTab(tab);
    }
  }
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_explorer_close_hides_sidebar_on_empty_tab() {
  const { Zendia } = ChromeUtils.importESModule(
    "resource:///modules/zendia/Zendia.sys.mjs"
  );
  const emptyTab = gZenWorkspaces._emptyTab;
  ok(emptyTab, "Zen has an empty tab");
  const tab = await openPage();
  await setCompactMode(true);
  gBrowser.selectedTab = emptyTab;
  const sidebar = gZenCompactModeManager.sidebar;
  await TestUtils.waitForCondition(
    () => sidebar.hasAttribute("zen-has-empty-tab"),
    "Zen keeps the compact sidebar shown on the empty tab"
  );
  ok(sidebarShown(), "which is how it looked stuck");

  await Zendia.run("explorer.toggle");
  ok(Zendia.explorerFor(window).isOpen, "<leader>e opens the explorer");
  await Zendia.run("explorer.toggle");
  ok(!sidebarShown(), "closing it slides the sidebar out all the same");

  gBrowser.selectedTab = tab;
  BrowserTestUtils.removeTab(tab);
  await setCompactMode(false);
});

// Split windows: panes are made, left, moved between and closed like vim
// windows. The actions run directly so these tests do not depend on the
// keys reaching the page.
const { ZendiaWindowsSpec, splitWith } = ChromeUtils.importESModule(
  "resource:///modules/zendia/plugins/ZendiaWindows.sys.mjs"
);

const windowAction = name =>
  ZendiaWindowsSpec.actions[name].run({ window, gBrowser });

// Tabs ordered by when they were last used differ by at least a millisecond.
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

async function select(tab) {
  await tick();
  gBrowser.selectedTab = tab;
  await tick();
}

function pinnedToast() {
  return document.querySelector(
    "#zen-toast-container [data-l10n-id='zendia-split-pinned-toast']"
  );
}

function openNamedTabs(...names) {
  return Promise.all(
    names.map(name => openPage(`<title>${name}</title>${PAGE}`))
  ).then(tabs => Object.fromEntries(names.map((name, i) => [name, tabs[i]])));
}

// The layout of the showing split, as row(a,column(b,c)) with tab titles.
function layoutOf(group) {
  const walk = node =>
    node.children
      ? `${node.direction}(${node.children.map(walk).join(",")})`
      : node.tab.label;
  return walk(group.layoutTree);
}

function groupWith(tab) {
  return gZenViewSplitter._data.find(group => group.tabs.includes(tab));
}

function removeGroups() {
  while (gZenViewSplitter._data.length) {
    gZenViewSplitter.removeGroup(0);
  }
}

async function removeAll(tabs) {
  removeGroups();
  for (const tab of Object.values(tabs)) {
    if (tab.pinned) {
      gBrowser.unpinTab(tab);
    }
    BrowserTestUtils.removeTab(tab);
  }
}

// Opens a picker with a split action and clicks the row of a tab.
async function pickFromSplitPicker(action, label) {
  const done = windowAction(action);
  await TestUtils.waitForCondition(() => picker(), `${action} opens a picker`);
  const rows = [...picker().querySelectorAll(".zendia-picker-item")];
  const labels = rows.map(
    row => row.querySelector(".zendia-picker-label").textContent
  );
  if (label !== undefined) {
    rows[labels.indexOf(label)].click();
  }
  return { done, labels, rows };
}

add_task(async function test_split_makes_the_new_pane_right_or_below() {
  const { a, b, c, d } = await openNamedTabs("a", "b", "c", "d");

  await select(a);
  splitWith(window, b, "vsep");
  is(layoutOf(groupWith(a)), "row(a,b)", "vsep puts the new pane right");
  is(gBrowser.selectedTab, b, "and focuses it");
  removeGroups();

  await select(c);
  splitWith(window, d, "hsep");
  is(layoutOf(groupWith(c)), "column(c,d)", "hsep puts the picked tab below");
  is(gBrowser.selectedTab, d, "and focuses it");

  // Inside a split the new pane lands next to the current one the same way.
  await select(c);
  splitWith(window, a, "vsep");
  is(
    layoutOf(groupWith(c)),
    "column(row(c,a),d)",
    "in a split only the current pane is divided, and the new one is to its right"
  );
  is(gBrowser.selectedTab, a, "and gets the focus, as outside a split");
  await removeAll({ a, b, c, d });
});

add_task(async function test_split_picker_choice_is_for_its_own_pane() {
  const { a, b, c } = await openNamedTabs("a", "b", "c");
  await select(a);

  // The tab changes while the picker is open.
  const moved = await pickFromSplitPicker("splits.vertical");
  gBrowser.selectedTab = c;
  moved.rows[moved.labels.indexOf("b")].click();
  await moved.done;
  ok(!a.splitView && !b.splitView && !c.splitView, "nothing was split");
  is(gBrowser.selectedTab, c, "and the tab moved to stays selected");

  // The picked tab closes while the picker is open.
  await select(a);
  const closing = await pickFromSplitPicker("splits.vertical");
  const index = closing.labels.indexOf("b");
  BrowserTestUtils.removeTab(b);
  closing.rows[index].click();
  await closing.done;
  ok(!a.splitView && !c.splitView, "a tab that has closed is not split");
  is(gBrowser.selectedTab, a, "and the current tab stays selected");

  // The picker still splits the tab it was opened on.
  const fine = await pickFromSplitPicker("splits.vertical", "c");
  await fine.done;
  ok(a.splitView && c.splitView, "a tab still open is split with it");
  await removeAll({ a, c });
});

add_task(async function test_split_keeps_tabs_of_another_split_alone() {
  const { a, b, c, d, e } = await openNamedTabs("a", "b", "c", "d", "e");
  await select(d);
  gZenViewSplitter.splitTabs([d, e], "vsep", 1);
  await select(a);

  const { done, labels } = await pickFromSplitPicker("splits.vertical");
  ok(
    !labels.includes("d") && !labels.includes("e"),
    "the picker does not offer the tabs of another split"
  );
  ok(labels.includes("b"), "but offers the free ones");
  EventUtils.synthesizeKey("KEY_Escape");
  await done;

  splitWith(window, d, "vsep");
  ok(!a.splitView, "taking a pane of another split does nothing");
  is(layoutOf(groupWith(d)), "row(d,e)", "the other split is intact");
  is(gZenViewSplitter._data.length, 1, "and no split holds the tab twice");

  // Inside a split too.
  await select(a);
  gZenViewSplitter.splitTabs([a, b], "vsep", 1);
  splitWith(window, d, "vsep");
  Assert.deepEqual(
    gZenViewSplitter._data.map(layoutOf),
    ["row(d,e)", "row(a,b)"],
    "both splits are as they were"
  );

  // The explorer asks for the pane of the row under its cursor, which may be
  // a pane of the split it is in.
  await select(a);
  splitWith(window, c, "hsep");
  is(layoutOf(groupWith(a)), "row(column(a,c),b)", "a third pane");
  await select(b);
  splitWith(window, c, "vsep");
  is(
    layoutOf(groupWith(a)),
    "row(column(a,c),b)",
    "picking a pane that is already shown keeps the layout"
  );
  is(gBrowser.selectedTab, c, "and goes to that pane");
  await removeAll({ a, b, c, d, e });
});

add_task(async function test_split_inside_pinned_panes_adds_one_pane() {
  const { a, b, c } = await openNamedTabs("a", "b", "c");
  gBrowser.pinTab(a);
  gBrowser.pinTab(b);
  await select(a);
  gZenViewSplitter.splitTabs([a, b], "vsep", 1);
  const tabsBefore = gBrowser.tabs.length;

  splitWith(window, c, "vsep");
  is(layoutOf(groupWith(a)), "row(a,b,c)", "the picked tab is the new pane");
  is(gBrowser.tabs.length, tabsBefore, "no pane is a duplicate of a tab");
  is(gBrowser.selectedTab, c, "and it has the focus");
  ok(c.pinned, "it takes on the pinned state of the panes");
  const toast = await TestUtils.waitForCondition(
    () => pinnedToast(),
    "the user is told about the pin"
  );
  await TestUtils.waitForCondition(
    () => toast.textContent.includes("pinned"),
    "with words, so the string reaches the build"
  );

  // What <leader>bp does.
  gBrowser.unpinTab(c);
  await TestUtils.waitForCondition(() => !c.pinned, "the pin can be undone");
  is(layoutOf(groupWith(a)), "row(a,b,c)", "the split stays as it was");
  is(gBrowser.tabs.length, tabsBefore, "with no duplicate pane");
  await removeAll({ a, b, c });
});

add_task(async function test_a_split_that_pins_nothing_says_nothing() {
  await TestUtils.waitForCondition(
    () => !pinnedToast(),
    "the toast of the last split is gone"
  );
  const { a, b, c } = await openNamedTabs("a", "b", "c");
  await select(a);
  gZenViewSplitter.splitTabs([a, b], "vsep", 1);
  await select(a);

  splitWith(window, c, "vsep");
  is(groupWith(a).tabs.length, 3, "the pane is added");
  await tick();
  ok(!c.pinned, "no pane is pinned");
  ok(!pinnedToast(), "so there is nothing to tell");
  await removeAll({ a, b, c });
});

add_task(async function test_split_stops_at_the_limit_before_asking() {
  const { a, b, c, d, e } = await openNamedTabs("a", "b", "c", "d", "e");
  await select(a);
  gZenViewSplitter.splitTabs([a, b, c, d], "grid", 0);
  is(groupWith(a).tabs.length, 4, "four panes");

  windowAction("splits.vertical");
  await new Promise(resolve => setTimeout(resolve, 100));
  ok(!picker(), "a full split does not offer a pane to add");
  ok(!e.splitView, "and splits nothing");
  await removeAll({ a, b, c, d, e });
});

add_task(async function test_split_open_url_works_inside_a_split() {
  const { a, b } = await openNamedTabs("a", "b");
  await select(a);
  gZenViewSplitter.splitTabs([a, b], "vsep", 1);

  const { done, labels, rows } = await pickFromSplitPicker("splits.horizontal");
  is(labels[0], "Open URL…", "the picker offers a URL inside a split too");
  rows[0].click();
  await done;
  await TestUtils.waitForCondition(
    () => gURLBar._zenHandleUrlbarClose,
    "the urlbar opens for the new pane"
  );
  is(gZenViewSplitter._data.length, 1, "without a second split view");
  is(layoutOf(groupWith(a)), "row(a,b)", "and the first one is untouched");
  ok(a.group && b.group, "the panes stay in their tab group");

  // Dismissing it changes nothing.
  gURLBar._zenHandleUrlbarClose(false, false);
  await TestUtils.waitForCondition(
    () => !gURLBar.hasAttribute("zen-newtab"),
    "the urlbar closes"
  );
  is(layoutOf(groupWith(a)), "row(a,b)", "dismissing it changes nothing");
  is(gBrowser.selectedTab, b, "on the same pane");
  await TestUtils.waitForCondition(
    () => !gZenViewSplitter.waitingForSplitTab,
    "the tab strip is told that no tab is coming"
  );

  // Picking a result divides only the current pane.
  const { done: again, rows: rows2 } =
    await pickFromSplitPicker("splits.horizontal");
  rows2[0].click();
  await again;
  await TestUtils.waitForCondition(
    () => gURLBar._zenHandleUrlbarClose,
    "the urlbar opens again"
  );
  const fresh = BrowserTestUtils.addTab(gBrowser, "about:blank");
  gURLBar._zenHandleUrlbarClose(false, true);
  gBrowser.selectedTab = fresh;
  await TestUtils.waitForCondition(
    () => fresh.splitView,
    "the opened tab joins the split"
  );
  is(
    layoutOf(groupWith(a)),
    `row(a,column(b,${fresh.label}))`,
    "below the pane it was opened from"
  );
  is(gBrowser.selectedTab, fresh, "with the focus");
  await removeAll({ a, b, fresh });
});

add_task(async function test_close_goes_back_to_the_pane_used_last() {
  const { a, b, c } = await openNamedTabs("a", "b", "c");
  await select(a);
  gZenViewSplitter.splitTabs([a, b], "vsep", 1);
  splitWith(window, c, "vsep");
  is(layoutOf(groupWith(a)), "row(a,b,c)", "three panes");
  await select(b);
  await select(a);
  await select(b);
  await select(c);

  windowAction("splits.close");
  is(gBrowser.selectedTab, b, "closing goes to the pane used before it");
  ok(!c.splitView && gBrowser.tabs.includes(c), "the closed tab stays open");
  await TestUtils.waitForCondition(
    () => !c.linkedBrowser.docShellIsActive,
    "the closed pane's page stops being active"
  );
  is(layoutOf(groupWith(a)), "row(a,b)", "the others share the space");
  const sizes = groupWith(a).layoutTree.children.map(n => n.sizeInParent);
  Assert.less(Math.abs(sizes[0] + sizes[1] - 100), 0.01, "all of it");
  Assert.greater(Math.min(...sizes), 20, "none of them collapsed");

  windowAction("splits.close");
  is(gBrowser.selectedTab, a, "closing one of two leaves the other");
  ok(!a.splitView && !b.splitView, "which ends the split");
  ok(gBrowser.tabs.includes(a) && gBrowser.tabs.includes(b), "both stay open");
  is(gZenViewSplitter.currentView, -1, "and no split is showing");
  await removeAll({ a, b, c });
});

add_task(async function test_only_keeps_the_current_pane_showing() {
  const { a, b, c } = await openNamedTabs("a", "b", "c");
  await select(a);
  gZenViewSplitter.splitTabs([a, b], "vsep", 1);
  splitWith(window, c, "hsep");
  await select(b);

  windowAction("splits.only");
  is(gBrowser.selectedTab, b, "the current tab stays selected");
  ok(!a.splitView && !b.splitView && !c.splitView, "no tab is a pane any more");
  is(gZenViewSplitter.currentView, -1, "no split is showing");
  ok(
    !gBrowser.tabpanels.hasAttribute("zen-split-view"),
    "the window is back to one page"
  );
  ok(b.linkedBrowser.docShellIsActive, "the page is active");
  await removeAll({ a, b, c });
});

add_task(async function test_close_and_only_drop_an_empty_pane() {
  for (const action of ["splits.close", "splits.only"]) {
    const { a } = await openNamedTabs("a");
    await select(a);
    gZenViewSplitter.createEmptySplit("right");
    await TestUtils.waitForCondition(
      () => gURLBar._zenHandleUrlbarClose && gURLBar.focused,
      `${action}: the empty pane opens the urlbar`
    );
    is(gBrowser.selectedTab, gZenWorkspaces._emptyTab, "on the empty tab");

    windowAction(action);
    is(gBrowser.selectedTab, a, `${action} goes back to the tab it split`);
    ok(!gZenWorkspaces._emptyTab.splitView, "the empty tab is no pane");
    is(gZenViewSplitter._data.length, 0, "no split is left");
    await TestUtils.waitForCondition(
      () => !gURLBar.hasAttribute("zen-newtab"),
      `${action}: the urlbar closes`
    );
    is(gBrowser.selectedTab, a, "and the tab stays selected");
    await removeAll({ a });
  }
});

add_task(async function test_focus_goes_to_the_pane_beside_and_back() {
  const { a, b, c } = await openNamedTabs("a", "b", "c");
  await select(a);
  gZenViewSplitter.splitTabs([a, b], "vsep", 1);
  splitWith(window, c, "hsep");
  is(layoutOf(groupWith(a)), "row(a,column(b,c))", "one tall, two stacked");

  const go = async (action, expected, message) => {
    await tick();
    windowAction(action);
    is(gBrowser.selectedTab, expected, message);
  };
  await go("splits.focusLeft", a, "left from the lower pane is the tall one");
  await go("splits.focusRight", c, "and right comes back to the lower pane");
  await go("splits.focusUp", b, "up goes to the upper pane");
  await go("splits.focusLeft", a, "left from the upper pane is the tall one");
  await go("splits.focusRight", b, "and right comes back to the upper pane");
  await go("splits.focusUp", b, "nothing above the upper pane");
  await go("splits.focusRight", b, "nothing right of it");
  await go("splits.focusDown", c, "down goes to the lower pane");
  await go("splits.focusDown", c, "nothing below");
  await removeAll({ a, b, c });
});

add_task(async function test_focus_in_a_grid_and_after_unequal_resizes() {
  const { a, b, c, d } = await openNamedTabs("a", "b", "c", "d");
  await select(a);
  gZenViewSplitter.splitTabs([a, b, c, d], "grid", 0);
  is(layoutOf(groupWith(a)), "row(column(a,b),column(c,d))", "a grid");

  const go = async (action, expected, message) => {
    await tick();
    windowAction(action);
    is(gBrowser.selectedTab, expected, message);
  };
  await go("splits.focusRight", c, "right of the top left is the top right");
  await go("splits.focusDown", d, "below the top right is the bottom right");
  await go("splits.focusLeft", b, "left of the bottom right is bottom left");
  await go("splits.focusUp", a, "above the bottom left is the top left");

  // A small pane above a big one: the big one is the neighbour that counts.
  const [left, right] = groupWith(a).layoutTree.children;
  left.children[0].sizeInParent = 10;
  left.children[1].sizeInParent = 90;
  right.children[0].sizeInParent = 50;
  right.children[1].sizeInParent = 50;
  gZenViewSplitter.activateSplitView(groupWith(a), true);
  await select(c);
  await go("splits.focusLeft", b, "left goes to the pane covering most");
  await go("splits.focusRight", d, "and right to the one covering most");
  await removeAll({ a, b, c, d });
});

add_task(async function test_removing_an_earlier_split_keeps_the_view_right() {
  const { a, b, c, d } = await openNamedTabs("a", "b", "c", "d");
  await select(a);
  gZenViewSplitter.splitTabs([a, b], "vsep", 1);
  await select(c);
  gZenViewSplitter.splitTabs([c, d], "vsep", 1);
  is(gZenViewSplitter.currentView, 1, "the second split is showing");

  gZenViewSplitter.removeTabFromGroup(a, 0, { forUnsplit: true });
  is(gZenViewSplitter.currentView, 0, "the view follows its split");
  is(gZenViewSplitter._data[0], groupWith(c), "which is the one showing");
  await select(d);
  windowAction("splits.focusLeft");
  is(gBrowser.selectedTab, c, "panes can still be moved between");
  windowAction("splits.close");
  is(gBrowser.selectedTab, d, "and closed");
  await removeAll({ a, b, c, d });
});
