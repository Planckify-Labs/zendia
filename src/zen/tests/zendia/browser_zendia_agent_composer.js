/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// The agent panel's composer: files attached to a request and the user's
// standing instructions, with a fake Claude that saves the prompt it gets.

const { Zendia } = ChromeUtils.importESModule(
  "resource:///modules/zendia/Zendia.sys.mjs"
);
const { ZendiaAgents } = ChromeUtils.importESModule(
  "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs"
);
const { ZendiaAgentInstructions } = ChromeUtils.importESModule(
  "resource:///modules/zendia/agent/ZendiaAgentInstructions.sys.mjs"
);

const dock = () => Zendia.agentDockFor(window);
const dockElement = () => document.getElementById("zendia-agent-dock");
const $ = selector => dockElement().querySelector(selector);

async function fakeAgent() {
  const dir = await IOUtils.createUniqueDirectory(
    PathUtils.tempDir,
    "lzv-composer-agent"
  );
  const script = PathUtils.join(dir, "claude");
  await IOUtils.writeUTF8(
    script,
    `#!/bin/sh
printf '%s' "$2" > '${dir}/prompt'
echo '{"type":"system","subtype":"init","session_id":"c-1"}'
echo '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}'
echo '{"type":"result","is_error":false,"result":"done","session_id":"c-1"}'
`
  );
  await IOUtils.setPermissions(script, 0o755);
  registerCleanupFunction(() => IOUtils.remove(dir, { recursive: true }));
  const agent = { id: "claude", name: "Fake Claude", path: script };
  const original = ZendiaAgents.defaultAgent;
  ZendiaAgents.defaultAgent = async () => agent;
  registerCleanupFunction(() => {
    ZendiaAgents.defaultAgent = original;
  });
  return dir;
}

function type(element, value) {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

add_task(async function test_instructions_are_kept_and_sent() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "data:text/html,<title>Shop</title><p>shop"
  );
  const dir = await fakeAgent();
  await dock().open(tab.linkedBrowser);
  const page = $(".zendia-agent-instructions");
  ok(page.hidden, "the instructions page starts closed");

  $(".zendia-agent-round-button.instructions").click();
  await TestUtils.waitForCondition(() => !page.hidden, "the page opens");
  ok(
    page.querySelector(".zendia-agent-instructions-empty") &&
      !page.querySelector(".zendia-agent-instructions-empty").hidden,
    "it says what instructions are while there are none"
  );

  page.querySelector(".zendia-agent-instructions-add").click();
  page.querySelector(".zendia-agent-instructions-add").click();
  const cards = page.querySelectorAll(".zendia-agent-instruction");
  is(cards.length, 2, "two instructions were added");
  type(cards[0].querySelector(".zendia-agent-instruction-title"), "Be brief");
  type(
    cards[0].querySelector(".zendia-agent-instruction-text"),
    "Answer in one sentence.\nNo lists."
  );
  type(cards[1].querySelector(".zendia-agent-instruction-title"), "Prices");
  type(
    cards[1].querySelector(".zendia-agent-instruction-text"),
    "Quote prices in euros."
  );
  is(
    $(".zendia-agent-round-button.instructions").hasAttribute("active"),
    true,
    "the button shows that instructions are on"
  );

  // Nothing is wider than the page, so it never scrolls sideways.
  const body = page.querySelector(".zendia-agent-instructions-body");
  await TestUtils.waitForCondition(
    () => page.getAnimations().length == 0,
    "the page has come in"
  );
  ok(body.scrollWidth <= body.clientWidth, "the page has no horizontal scroll");
  const text = cards[0].querySelector(".zendia-agent-instruction-text");
  ok(
    text.getBoundingClientRect().right <=
      cards[0].getBoundingClientRect().right,
    "a guideline's box stays inside its card"
  );
  ok(
    text.getBoundingClientRect().height >
      cards[0]
        .querySelector(".zendia-agent-instruction-title")
        .getBoundingClientRect().height,
    "and it is as tall as its two lines"
  );
  is(getComputedStyle(text).resize, "none", "it has no resize grip");

  // One file comes with an instruction: dropped on its card.
  const dropOn = (card, ...files) => {
    const data = new DataTransfer();
    for (const file of files) {
      data.items.add(file);
    }
    card.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: data,
        bubbles: true,
        cancelable: true,
      })
    );
  };
  const fileTile = () =>
    cards[0].querySelector(".zendia-agent-attachment-tile");
  ok(
    cards[0].querySelector(".zendia-agent-instruction-file-add"),
    "an instruction offers to attach a file"
  );
  dropOn(cards[0], new File(["Quote the style guide."], "guide.md"));
  await TestUtils.waitForCondition(() => fileTile(), "the document shows");
  is(fileTile().getAttribute("kind"), "doc", "a document gets a document tile");
  is(
    fileTile().querySelector(".zendia-agent-doc-ext").textContent,
    "MD",
    "named by its kind"
  );
  const tileBox = fileTile().getBoundingClientRect();
  const cross = fileTile()
    .querySelector(".zendia-agent-attachment-x")
    .getBoundingClientRect();
  is(tileBox.width, 72, "the tile is a full square");
  ok(
    cross.left >= tileBox.left &&
      cross.right <= tileBox.right &&
      cross.top >= tileBox.top &&
      cross.width > 0,
    "its cross sits on the tile's corner, not cut off"
  );
  const first = ZendiaAgentInstructions.items[0].file.path;
  ok(
    first.startsWith(ZendiaAgentInstructions.filesDir),
    "a copy is kept in the profile"
  );
  is(await IOUtils.readUTF8(first), "Quote the style guide.", "it is the file");
  ok($(".zendia-agent-attachments").hidden, "it did not go to the composer");

  // Never more than one: a second replaces the first.
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
    ),
    c => c.charCodeAt(0)
  );
  dropOn(cards[0], new File([png], "pic.png", { type: "image/png" }));
  await TestUtils.waitForCondition(
    () => fileTile()?.getAttribute("kind") == "image",
    "the picture takes its place"
  );
  is(
    cards[0].querySelectorAll(".zendia-agent-attachment-tile").length,
    1,
    "only one file is shown"
  );
  ok(!(await IOUtils.exists(first)), "the earlier copy is gone");

  // Taking it off.
  fileTile().querySelector(".zendia-agent-attachment-x").click();
  await TestUtils.waitForCondition(
    () => !fileTile(),
    "the cross takes the file off"
  );
  is(ZendiaAgentInstructions.items[0].file, null, "and from the store");
  dropOn(cards[0], new File(["Quote the style guide."], "guide.md"));
  await TestUtils.waitForCondition(() => fileTile(), "a file again");

  // A switch turns one off without losing it.
  cards[1].querySelector(".zendia-agent-switch").click();
  is(
    cards[1].querySelector(".zendia-agent-switch").getAttribute("aria-checked"),
    "false",
    "the switch is off"
  );

  // Escape closes the page, not the panel.
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(() => page.hidden, "Escape goes back");
  ok(!dockElement().hidden, "the panel stays open");
  await TestUtils.waitForCondition(
    () => IOUtils.exists(ZendiaAgentInstructions.path),
    "closing the page saves them"
  );
  const saved = await IOUtils.readJSON(ZendiaAgentInstructions.path);
  is(saved.instructions.length, 2, "both were saved");
  is(saved.instructions[1].enabled, false, "with their switches");

  const input = $(".zendia-agent-input");
  await TestUtils.waitForCondition(
    () => document.activeElement == input,
    "the keys go back to the request"
  );
  type(input, "what is on this page?");
  EventUtils.synthesizeKey("KEY_Enter");
  await TestUtils.waitForCondition(
    () => !ZendiaAgents.conversationFor(tab.linkedBrowser)?.running,
    "the turn ends"
  );
  const prompt = await IOUtils.readUTF8(PathUtils.join(dir, "prompt"));
  ok(
    prompt.includes("- Be brief: Answer in one sentence.\n  No lists."),
    prompt
  );
  const guide = prompt.match(/^ {2}File: (.*guide\.md)$/m)?.[1];
  ok(guide, "the instruction's file goes with it");
  is(
    await IOUtils.readUTF8(guide),
    "Quote the style guide.",
    "the agent can read it"
  );
  ok(!prompt.includes("Prices"), "an instruction that is off is not sent");
  ok(prompt.includes("what is on this page?"), "the request is sent");

  // Deleting.
  $(".zendia-agent-round-button.instructions").click();
  await TestUtils.waitForCondition(() => !page.hidden, "the page opens again");
  page.querySelector(".zendia-agent-icon-button.trash").click();
  page.querySelector(".zendia-agent-icon-button.trash").click();
  is(
    page.querySelectorAll(".zendia-agent-instruction").length,
    0,
    "both are deleted"
  );
  await TestUtils.waitForCondition(
    async () => !(await IOUtils.exists(guide)),
    "deleting an instruction deletes its file"
  );
  page.querySelector(".zendia-agent-instructions-done").click();
  await TestUtils.waitForCondition(() => page.hidden, "Done closes the page");
  ok(
    !$(".zendia-agent-round-button.instructions").hasAttribute("active"),
    "the button shows none are on"
  );

  dock().close();
  await TestUtils.waitForCondition(() => dockElement().hidden, "closed");
  ZendiaAgents.reset(tab.linkedBrowser);
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_files_go_with_the_request() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "data:text/html,<title>Shop</title><p>shop"
  );
  const dir = await fakeAgent();
  await dock().open(tab.linkedBrowser);
  const input = $(".zendia-agent-input");
  const send = $(".zendia-agent-round-button.send");
  ok(send.disabled, "there is nothing to send yet");

  // Files dropped on the composer; ones with no path on disk, as a picture
  // from the clipboard is, are kept by their bytes. (A ClipboardEvent made
  // by a test carries no files, so the paste handler shares this path but
  // is not driven here.)
  const dropFiles = (...files) => {
    const data = new DataTransfer();
    for (const file of files) {
      data.items.add(file);
    }
    // On the conversation, away from the composer.
    $(".zendia-agent-log").dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: data,
        bubbles: true,
        cancelable: true,
      })
    );
  };
  dropFiles(new File(["name,price\nlamp,9"], "prices.csv"));
  await TestUtils.waitForCondition(
    () => $(".zendia-agent-attachment"),
    "the file shows as a chip"
  );
  ok(!send.disabled, "a file alone can be sent");
  is(
    $(".zendia-agent-attachment-name").textContent,
    "prices.csv",
    "the chip names the file"
  );

  dropFiles(new File(["x"], "ignored.txt"));
  await TestUtils.waitForCondition(
    () =>
      dockElement().querySelectorAll(".zendia-agent-attachment").length == 2,
    "a second file is added"
  );

  // Taking one off.
  dockElement().querySelectorAll(".zendia-agent-attachment-x")[1].click();
  is(
    dockElement().querySelectorAll(".zendia-agent-attachment").length,
    1,
    "a chip's cross takes the file off"
  );

  // A picture gets a preview, not a chip.
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
    ),
    c => c.charCodeAt(0)
  );
  dropFiles(new File([png], "pic.png", { type: "image/png" }));
  await TestUtils.waitForCondition(
    () => $(".zendia-agent-attachment-tile img"),
    "the picture shows as a tile"
  );
  const image = $(".zendia-agent-attachment-tile img");
  ok(image.src.startsWith("blob:"), "its preview is the picture itself");
  await TestUtils.waitForCondition(
    () => image.complete && image.naturalWidth == 1,
    "the preview loads"
  );
  is(
    dockElement().querySelectorAll(".zendia-agent-attachment").length,
    1,
    "and the picture is not also a chip"
  );

  EventUtils.synthesizeKey("KEY_Enter", {}, window);
  await TestUtils.waitForCondition(
    () => !ZendiaAgents.conversationFor(tab.linkedBrowser)?.running,
    "the turn ends"
  );
  const prompt = await IOUtils.readUTF8(PathUtils.join(dir, "prompt"));
  ok(/^- .*attachments.*pic\.png$/m.test(prompt), "the picture goes along");
  const path = prompt.match(/^- (.*attachments.*prices\.csv)$/m)?.[1];
  ok(path, `the prompt names the file's copy: ${prompt}`);
  is(
    await IOUtils.readUTF8(path),
    "name,price\nlamp,9",
    "the copy is what was attached"
  );
  ok(
    !$(".zendia-agent-attachments") || $(".zendia-agent-attachments").hidden,
    "the chips are cleared once sent"
  );
  // A fast agent can finish within a frame, before the panel draws.
  await TestUtils.waitForCondition(
    () => $('.zendia-agent-message[type="user"] .zendia-agent-attachment'),
    "the sent request is drawn"
  );
  is(
    $('.zendia-agent-message[type="user"] .zendia-agent-attachment')
      .textContent,
    "prices.csv",
    "the sent request lists its file"
  );

  dock().close();
  await TestUtils.waitForCondition(() => dockElement().hidden, "closed");
  ZendiaAgents.reset(tab.linkedBrowser);
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_model_that_cannot_read_the_files_says_so() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "data:text/html,<title>Shop</title><p>shop"
  );
  const dir = await fakeAgent();
  const models = [
    { id: "deep", name: "DeepSeek", input: ["text"] },
    { id: "sonnet", name: "Sonnet", input: ["text", "image", "pdf"] },
  ];
  const modelsNow = ZendiaAgents.modelsNow;
  ZendiaAgents.modelsNow = () => models;
  Services.prefs.setStringPref("zendia.agent.model.claude", "deep");
  registerCleanupFunction(() => {
    ZendiaAgents.modelsNow = modelsNow;
    Services.prefs.clearUserPref("zendia.agent.model.claude");
  });
  await dock().open(tab.linkedBrowser);
  const input = $(".zendia-agent-input");
  const warning = $(".zendia-agent-media-warning");
  ok(warning.hidden, "no warning while nothing is attached");

  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
    ),
    c => c.charCodeAt(0)
  );
  const drop = (...files) => {
    const data = new DataTransfer();
    for (const file of files) {
      data.items.add(file);
    }
    $(".zendia-agent-log").dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: data,
        bubbles: true,
        cancelable: true,
      })
    );
  };
  drop(new File(["a,b"], "notes.csv"));
  await TestUtils.waitForCondition(
    () => $(".zendia-agent-attachment"),
    "a text file attached"
  );
  ok(warning.hidden, "a text file is fine for a text model");

  drop(new File([png], "pic.png", { type: "image/png" }));
  await TestUtils.waitForCondition(() => !warning.hidden, "the warning shows");
  ok(warning.textContent.includes("DeepSeek"), "it names the model");
  ok(warning.textContent.includes("images"), "and what it cannot read");
  const buttons = [...warning.querySelectorAll("button")].map(
    button => button.textContent
  );
  Assert.deepEqual(
    buttons,
    ["Use Sonnet", "Pick…", "Send anyway"],
    "it offers a model that can, another pick, or sending as is"
  );
  ok(
    $(".zendia-agent-model").hasAttribute("text-only"),
    "the model chip says the model reads text only"
  );

  type(input, "what is in the picture?");
  EventUtils.synthesizeKey("KEY_Enter", {}, window);
  ok(
    !ZendiaAgents.conversationFor(tab.linkedBrowser)?.messages.length,
    "the first Enter does not send"
  );
  ok(warning.hasAttribute("nudge"), "it points at the warning instead");
  is(input.value, "what is in the picture?", "what was typed stays");

  // Switching to the model that can read it.
  warning.querySelector("button.primary").click();
  is(
    Services.prefs.getStringPref("zendia.agent.model.claude"),
    "sonnet",
    "the model is switched"
  );
  await TestUtils.waitForCondition(() => warning.hidden, "the warning goes");
  ok(
    !$(".zendia-agent-model").hasAttribute("text-only"),
    "the chip no longer warns"
  );

  // Back to the text model: a second Enter sends anyway, and the agent is
  // told it cannot see the picture.
  Services.prefs.setStringPref("zendia.agent.model.claude", "deep");
  dockElement().querySelector(".zendia-agent-attachment-x").click();
  drop(new File([png], "pic2.png", { type: "image/png" }));
  await TestUtils.waitForCondition(() => !warning.hidden, "warns again");
  EventUtils.synthesizeKey("KEY_Enter", {}, window);
  EventUtils.synthesizeKey("KEY_Enter", {}, window);
  await TestUtils.waitForCondition(
    () => ZendiaAgents.conversationFor(tab.linkedBrowser)?.messages.length,
    "the second Enter sends"
  );
  await TestUtils.waitForCondition(
    () => !ZendiaAgents.conversationFor(tab.linkedBrowser)?.running,
    "the turn ends"
  );
  const prompt = await IOUtils.readUTF8(PathUtils.join(dir, "prompt"));
  ok(
    /cannot read image files/.test(prompt),
    `the agent is told not to guess: ${prompt}`
  );

  // Copying what the agent answered.
  const copy = await TestUtils.waitForCondition(
    () => $('.zendia-agent-message[type="agent"] .zendia-agent-copy'),
    "the answer has a copy button"
  );
  await SimpleTest.promiseClipboardChange("ok", () => copy.click());
  ok(copy.hasAttribute("copied"), "the button says it copied");

  dock().close();
  await TestUtils.waitForCondition(() => dockElement().hidden, "closed");
  ZendiaAgents.reset(tab.linkedBrowser);
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_ctrl_v_attaches_pictures_and_files() {
  if (Services.env.exists("MOZ_HEADLESS")) {
    // The headless clipboard holds text only; run this under a display
    // (xvfb-run, with WAYLAND_DISPLAY unset).
    ok(true, "skipped: no picture or file clipboard when headless");
    return;
  }
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "data:text/html,<title>Shop</title><p>shop"
  );
  await fakeAgent();
  await dock().open(tab.linkedBrowser);
  await TestUtils.waitForCondition(
    () => dockElement().getAnimations().length == 0,
    "the panel has come in"
  );
  const input = $(".zendia-agent-input");
  input.focus();
  // Nothing left over from an earlier test.
  for (const cross of dockElement().querySelectorAll(
    ".zendia-agent-attachment-x"
  )) {
    cross.click();
  }
  const attached = () =>
    dockElement().querySelectorAll(
      ".zendia-agent-attachment, .zendia-agent-attachment-tile"
    ).length;
  const setClipboard = setup => {
    const transferable = Cc[
      "@mozilla.org/widget/transferable;1"
    ].createInstance(Ci.nsITransferable);
    transferable.init(null);
    setup(transferable);
    Services.clipboard.setData(
      transferable,
      null,
      Ci.nsIClipboard.kGlobalClipboard
    );
  };
  const paste = () => EventUtils.synthesizeKey("v", { accelKey: true }, window);

  // A box's own paste does nothing without text on the clipboard, so a
  // picture used to be ignored.
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
    ),
    c => c.charCodeAt(0)
  );
  const container = Cc["@mozilla.org/image/tools;1"]
    .getService(Ci.imgITools)
    .decodeImageFromArrayBuffer(png.buffer, "image/png");
  setClipboard(t => {
    t.addDataFlavor("image/png");
    t.setTransferData("image/png", container);
  });
  paste();
  await TestUtils.waitForCondition(
    () => $(".zendia-agent-attachment-tile img"),
    "a picture on the clipboard is attached"
  );
  is(attached(), 1, "as one tile");

  // A file copied in a file manager.
  const dir = await IOUtils.createUniqueDirectory(PathUtils.tempDir, "paste");
  registerCleanupFunction(() => IOUtils.remove(dir, { recursive: true }));
  const path = PathUtils.join(dir, "prices.csv");
  await IOUtils.writeUTF8(path, "a,b");
  const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(path);
  setClipboard(t => {
    t.addDataFlavor("application/x-moz-file");
    t.setTransferData("application/x-moz-file", file);
  });
  paste();
  await TestUtils.waitForCondition(
    () => attached() == 2,
    "a copied file is attached"
  );
  is(
    $(".zendia-agent-attachment-name").textContent,
    "prices.csv",
    "by its name"
  );

  // Text still goes into the box.
  const text = Cc["@mozilla.org/supports-string;1"].createInstance(
    Ci.nsISupportsString
  );
  text.data = "hello";
  setClipboard(t => {
    t.addDataFlavor("text/plain");
    t.setTransferData("text/plain", text);
  });
  paste();
  await TestUtils.waitForCondition(
    () => input.value == "hello",
    "text is pasted as text"
  );
  is(attached(), 2, "and attaches nothing");

  dock().close();
  await TestUtils.waitForCondition(() => dockElement().hidden, "closed");
  ZendiaAgents.reset(tab.linkedBrowser);
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_ctrl_c_copies_text_selected_in_the_log() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    "data:text/html,<title>Shop</title><p>shop"
  );
  await fakeAgent();
  await dock().open(tab.linkedBrowser);
  await TestUtils.waitForCondition(
    () => dockElement().getAnimations().length == 0,
    "the panel has come in"
  );
  const conversation = ZendiaAgents.conversationFor(tab.linkedBrowser);
  conversation.messages.push({
    type: "agent",
    text: "| Name | Kind |\n| --- | --- |\n| Paper2Agent (Nature) | Multi-agent AI System |",
  });
  conversation.changed();
  const cell = await TestUtils.waitForCondition(
    () =>
      [...dockElement().querySelectorAll("td")].find(td =>
        td.textContent.startsWith("Paper2Agent")
      ),
    "the answer's table is drawn"
  );

  // What a user does: click in the text, select it, press Ctrl+C.
  EventUtils.synthesizeMouseAtCenter(cell, {}, window);
  window.getSelection().selectAllChildren(cell);
  await SimpleTest.promiseClipboardChange("Paper2Agent (Nature)", () =>
    EventUtils.synthesizeKey("c", { accelKey: true }, window)
  );
  ok(true, "the selected text is on the clipboard");

  dock().close();
  await TestUtils.waitForCondition(() => dockElement().hidden, "closed");
  ZendiaAgents.reset(tab.linkedBrowser);
  BrowserTestUtils.removeTab(tab);
});
