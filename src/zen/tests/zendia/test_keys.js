/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { ZendiaKeys } = ChromeUtils.importESModule(
  "resource:///modules/zendia/core/ZendiaKeys.sys.mjs"
);

function event(key, init = {}) {
  return {
    key,
    code: init.code ?? "",
    ctrlKey: !!init.ctrl,
    altKey: !!init.alt,
    metaKey: !!init.meta,
    shiftKey: !!init.shift,
    isComposing: !!init.composing,
    getModifierState: name => name == "AltGraph" && !!init.altGraph,
  };
}

add_task(function test_parse_plain_sequences() {
  Assert.deepEqual(ZendiaKeys.parse("gg"), ["g", "g"]);
  Assert.deepEqual(ZendiaKeys.parse("G"), ["G"]);
  Assert.deepEqual(ZendiaKeys.parse("-"), ["-"]);
  Assert.deepEqual(ZendiaKeys.parse("<leader>|"), ["<Space>", "|"]);
});

add_task(function test_parse_leader() {
  Assert.deepEqual(ZendiaKeys.parse("<leader>bd"), ["<Space>", "b", "d"]);
  Assert.deepEqual(ZendiaKeys.parse("<Leader>ff", { leader: "," }), [
    ",",
    "f",
    "f",
  ]);
  Assert.deepEqual(
    ZendiaKeys.parse("<leader><tab><tab>"),
    ["<Space>", "<Tab>", "<Tab>"],
    "named keys are case-insensitive and canonical"
  );
});

add_task(function test_parse_modifiers() {
  Assert.deepEqual(ZendiaKeys.parse("<C-d>"), ["<C-d>"]);
  Assert.deepEqual(
    ZendiaKeys.parse("<C-D>"),
    ["<C-d>"],
    "<C-D> is <C-d> as in vim"
  );
  Assert.deepEqual(ZendiaKeys.parse("<c-s-d>"), ["<C-S-d>"]);
  Assert.deepEqual(ZendiaKeys.parse("<S-h>"), ["H"], "<S-h> is H");
  Assert.deepEqual(ZendiaKeys.parse("<A-j>"), ["<A-j>"]);
  Assert.deepEqual(ZendiaKeys.parse("<M-j>"), ["<A-j>"], "M is Alt");
  Assert.deepEqual(ZendiaKeys.parse("<S-C-x>"), ["<C-S-x>"]);
  Assert.deepEqual(ZendiaKeys.parse("<S-Tab>"), ["<S-Tab>"]);
  Assert.deepEqual(ZendiaKeys.parse("<C-Up>"), ["<C-Up>"]);
  Assert.deepEqual(ZendiaKeys.parse("<C-->"), ["<C-->"]);
  Assert.deepEqual(ZendiaKeys.parse("<F5>"), ["<F5>"]);
});

add_task(function test_parse_special_characters() {
  Assert.deepEqual(ZendiaKeys.parse("<lt>"), ["<lt>"]);
  Assert.deepEqual(ZendiaKeys.parse("<"), ["<lt>"]);
  Assert.deepEqual(
    ZendiaKeys.parse("<foo>"),
    ["<lt>", "f", "o", "o", ">"],
    "an unknown name is typed literally"
  );
  Assert.deepEqual(ZendiaKeys.parse("<Bar>"), ["|"]);
  Assert.deepEqual(ZendiaKeys.parse("a b"), ["a", "<Space>", "b"]);
  Assert.throws(() => ZendiaKeys.parse(""), /cannot be empty/);
});

add_task(function test_from_event_printable() {
  Assert.equal(ZendiaKeys.fromEvent(event("j")), "j");
  Assert.equal(ZendiaKeys.fromEvent(event("G", { shift: true })), "G");
  Assert.equal(ZendiaKeys.fromEvent(event("!", { shift: true })), "!");
  Assert.equal(ZendiaKeys.fromEvent(event("|", { shift: true })), "|");
  Assert.equal(ZendiaKeys.fromEvent(event(" ")), "<Space>");
  Assert.equal(ZendiaKeys.fromEvent(event("<", { shift: true })), "<lt>");
});

add_task(function test_from_event_chords() {
  Assert.equal(
    ZendiaKeys.fromEvent(event("d", { ctrl: true, code: "KeyD" })),
    "<C-d>"
  );
  Assert.equal(
    ZendiaKeys.fromEvent(event("D", { ctrl: true, shift: true, code: "KeyD" })),
    "<C-S-d>"
  );
  Assert.equal(
    ZendiaKeys.fromEvent(event("∆", { alt: true, code: "KeyJ" })),
    "<A-j>",
    "Alt combinations use the physical key"
  );
  Assert.equal(ZendiaKeys.fromEvent(event("Tab", { shift: true })), "<S-Tab>");
  Assert.equal(
    ZendiaKeys.fromEvent(event("@", { ctrl: true, alt: true, altGraph: true })),
    "@",
    "AltGr produces a plain character"
  );
});

add_task(function test_token_to_event_round_trip() {
  // tokenToEvent is the reverse of fromEvent: a key pressed without a
  // keyboard must read back as the token it was built from.
  const tokens = [
    "a",
    "H",
    "z",
    "5",
    ".",
    ",",
    "|",
    "<CR>",
    "<Tab>",
    "<Esc>",
    "<Space>",
    "<BS>",
    "<Up>",
    "<Down>",
    "<Left>",
    "<Right>",
    "<C-r>",
    "<C-a>",
    "<C-p>",
    "<C-S-d>",
    "<A-j>",
  ];
  for (const token of tokens) {
    const built = ZendiaKeys.tokenToEvent(token);
    Assert.ok(built, `tokenToEvent builds an event for ${token}`);
    Assert.equal(
      ZendiaKeys.fromEvent(built),
      token,
      `${token} reads back from its event`
    );
  }
});

add_task(function test_token_to_event_fields() {
  Assert.deepEqual(
    ZendiaKeys.tokenToEvent("<C-r>"),
    ZendiaKeys.tokenToEvent("<C-r>"),
    "stable"
  );
  const ctrlR = ZendiaKeys.tokenToEvent("<C-r>");
  Assert.equal(ctrlR.key, "r");
  Assert.equal(ctrlR.code, "KeyR");
  Assert.ok(ctrlR.ctrlKey && !ctrlR.shiftKey);
  const enter = ZendiaKeys.tokenToEvent("<CR>");
  Assert.equal(enter.key, "Enter");
  const space = ZendiaKeys.tokenToEvent("<Space>");
  Assert.equal(space.key, " ");
  const cap = ZendiaKeys.tokenToEvent("H");
  Assert.equal(cap.key, "H");
  Assert.ok(cap.shiftKey, "an uppercase letter carries Shift");
  Assert.equal(ZendiaKeys.tokenToEvent(""), null);
  Assert.equal(ZendiaKeys.tokenToEvent("<nope>"), null);
});

add_task(function test_token_to_event_rejects_garbage() {
  // A malformed bracket must be null, never a junk event with an empty key
  // that a capture would try to act on. The subagent's tokens come from
  // parse(), so these should never reach tokenToEvent, but a stray one must
  // do nothing rather than finish a capture or press an empty key.
  for (const garbage of ["<>", "<C->", "<S->", "<C-A->", "< >", "<-a>"]) {
    Assert.equal(
      ZendiaKeys.tokenToEvent(garbage),
      null,
      `${garbage} is not a key`
    );
  }
  // A modifier with a real single key is still a key.
  Assert.ok(ZendiaKeys.tokenToEvent("<C-->"), "<C--> is Ctrl and -");
});

add_task(function test_token_to_event_shifted_letter_inverts() {
  // The "<S-x>" form (a letter with a bare Shift) is the uppercase character,
  // exactly as its canonical "X": both must build the same event, so a key
  // pressed from either reads back as "X".
  const shifted = ZendiaKeys.tokenToEvent("<S-x>");
  Assert.ok(shifted, "<S-x> builds an event");
  Assert.equal(shifted.key, "X", "the key is the uppercase character");
  Assert.equal(shifted.code, "KeyX");
  Assert.ok(shifted.shiftKey && !shifted.ctrlKey);
  Assert.equal(
    ZendiaKeys.fromEvent(shifted),
    "X",
    "<S-x> reads back as the canonical H-style uppercase token"
  );
  Assert.deepEqual(
    ZendiaKeys.tokenToEvent("<S-x>"),
    ZendiaKeys.tokenToEvent("X"),
    "<S-x> and X build the same event"
  );
});

add_task(function test_from_event_named_and_ignored() {
  Assert.equal(ZendiaKeys.fromEvent(event("Escape")), "<Esc>");
  Assert.equal(ZendiaKeys.fromEvent(event("Enter")), "<CR>");
  Assert.equal(ZendiaKeys.fromEvent(event("F5")), "<F5>");
  Assert.equal(ZendiaKeys.fromEvent(event("Shift", { shift: true })), null);
  Assert.equal(ZendiaKeys.fromEvent(event("Control", { ctrl: true })), null);
  Assert.equal(ZendiaKeys.fromEvent(event("Dead")), null);
  Assert.equal(ZendiaKeys.fromEvent(event("a", { composing: true })), null);
  Assert.equal(ZendiaKeys.fromEvent(event("AudioVolumeUp")), null);
});

add_task(function test_event_and_notation_agree() {
  const pairs = [
    ["<C-d>", event("d", { ctrl: true, code: "KeyD" })],
    ["<S-h>", event("H", { shift: true })],
    ["<Esc>", event("Escape")],
    ["<leader>", event(" ")],
    ["<C-Space>", event(" ", { ctrl: true })],
  ];
  for (const [notation, keyEvent] of pairs) {
    Assert.deepEqual(
      ZendiaKeys.parse(notation),
      [ZendiaKeys.fromEvent(keyEvent)],
      `${notation} matches its event`
    );
  }
});

add_task(function test_count_digits() {
  Assert.ok(ZendiaKeys.isCountDigit("5", false));
  Assert.ok(!ZendiaKeys.isCountDigit("0", false), "0 cannot start a count");
  Assert.ok(ZendiaKeys.isCountDigit("0", true), "0 continues a count");
  Assert.ok(!ZendiaKeys.isCountDigit("j", true));
});
