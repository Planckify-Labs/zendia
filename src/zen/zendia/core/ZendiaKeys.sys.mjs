// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Vim key notation. A key sequence like "<leader>bd" or "<C-d>" is parsed
// into tokens, and a KeyboardEvent is normalized into the same token form so
// the two can be compared with plain string equality.
//
// Canonical tokens:
//   - a printable character stands for itself: "j", "G", "|", "!"
//   - everything else is bracketed: "<Space>", "<lt>", "<Esc>", "<CR>",
//     "<C-d>", "<C-S-d>", "<A-j>", "<S-Tab>"
// Modifiers are always written in the order C (Ctrl), A (Alt/Meta in vim),
// D (Cmd/Super), S (Shift). Shift is folded into printable characters, as in
// vim: "<S-h>" is "H".

const MODIFIER_ORDER = ["C", "A", "D", "S"];

const MODIFIER_ALIASES = {
  c: "C",
  a: "A",
  m: "A",
  d: "D",
  s: "S",
};

// Vim names (lowercased) to canonical names.
const NAMED_KEYS = {
  esc: "Esc",
  escape: "Esc",
  cr: "CR",
  enter: "CR",
  return: "CR",
  tab: "Tab",
  bs: "BS",
  backspace: "BS",
  space: "Space",
  del: "Del",
  delete: "Del",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  insert: "Insert",
  lt: "lt",
};

// Characters with a vim name that may appear in bracketed form.
const NAMED_CHARS = {
  bar: "|",
  bslash: "\\",
};

// KeyboardEvent.key values to canonical names.
const EVENT_KEYS = {
  Escape: "Esc",
  Enter: "CR",
  Tab: "Tab",
  Backspace: "BS",
  " ": "Space",
  Delete: "Del",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Insert: "Insert",
  "<": "lt",
};

// Canonical names back to a KeyboardEvent.key, for tokenToEvent.
const CANONICAL_TO_KEY = Object.fromEntries(
  Object.entries(EVENT_KEYS).map(([key, name]) => [name, key])
);

// Keys that never form a token on their own.
const IGNORED_EVENT_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "OS",
  "Hyper",
  "Super",
  "Fn",
  "FnLock",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Dead",
  "Unidentified",
  "Process",
]);

function isFunctionKey(name) {
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(name);
}

// A KeyboardEvent-style getModifierState for a synthetic token event. It is
// shared, reading `this`, rather than a fresh closure per event: two events
// built from the same token are then structurally equal, and no closure is
// allocated per key fed.
function tokenEventModifierState(state) {
  switch (state) {
    case "Shift":
      return !!this.shiftKey;
    case "Control":
      return !!this.ctrlKey;
    case "Alt":
      return !!this.altKey;
    case "Meta":
      return !!this.metaKey;
    default:
      return false;
  }
}

/**
 * Build the canonical token for a key and a set of modifiers.
 *
 * @param {string} key A single printable character, or a canonical name
 *   ("Esc", "F5", "lt", ...).
 * @param {Set<string>} modifiers Canonical modifier letters.
 * @returns {string}
 */
function makeToken(key, modifiers) {
  if (key == " ") {
    key = "Space";
  }
  if (key.length == 1) {
    const chorded =
      modifiers.has("C") || modifiers.has("A") || modifiers.has("D");
    if (!chorded) {
      // Shift on a printable key is part of the character: <S-h> is "H".
      return modifiers.has("S") ? key.toUpperCase() : key;
    }
    // <C-D> and <C-d> are the same key; Shift is spelled out: <C-S-d>.
    key = key.toLowerCase();
  }
  const prefix = MODIFIER_ORDER.filter(m => modifiers.has(m))
    .map(m => m + "-")
    .join("");
  return `<${prefix}${key}>`;
}

/**
 * Parse the inside of a bracketed key ("C-d", "leader", "S-Tab").
 *
 * @param {string} inner
 * @returns {string|null} The canonical token, or null if this is not a key.
 */
function parseBracketed(inner) {
  const parts = inner.split("-");
  // "<C-->" means Ctrl and the "-" key.
  if (inner.endsWith("--")) {
    parts.splice(-2, 2, "-");
  }
  const keyPart = parts.pop();
  const modifiers = new Set();
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (!modifier) {
      return null;
    }
    modifiers.add(modifier);
  }
  if (keyPart.length == 1) {
    if (!modifiers.size) {
      return null;
    }
    return makeToken(keyPart, modifiers);
  }
  const lower = keyPart.toLowerCase();
  if (NAMED_CHARS[lower]) {
    return makeToken(NAMED_CHARS[lower], modifiers);
  }
  if (NAMED_KEYS[lower]) {
    return makeToken(NAMED_KEYS[lower], modifiers);
  }
  if (isFunctionKey(keyPart.toUpperCase())) {
    return makeToken(keyPart.toUpperCase(), modifiers);
  }
  return null;
}

export const ZendiaKeys = {
  DEFAULT_LEADER: "<Space>",

  /**
   * Parse a key sequence in vim notation into canonical tokens.
   *
   * @param {string} lhs e.g. "gg", "<leader>bd", "<C-w>v"
   * @param {object} [options]
   * @param {string} [options.leader] The key sequence <leader> expands to.
   * @returns {string[]}
   */
  parse(lhs, { leader = this.DEFAULT_LEADER } = {}) {
    if (typeof lhs != "string" || !lhs.length) {
      throw new Error("Zendia: a key sequence cannot be empty");
    }
    const tokens = [];
    let i = 0;
    while (i < lhs.length) {
      const char = lhs[i];
      if (char == "<") {
        const close = lhs.indexOf(">", i + 2);
        if (close != -1) {
          const inner = lhs.slice(i + 1, close);
          if (inner.toLowerCase() == "leader") {
            if (leader.toLowerCase().includes("<leader>")) {
              throw new Error("Zendia: the leader cannot contain <leader>");
            }
            tokens.push(...this.parse(leader, { leader }));
            i = close + 1;
            continue;
          }
          const token = parseBracketed(inner);
          if (token) {
            tokens.push(token);
            i = close + 1;
            continue;
          }
        }
        // A "<" that does not start a key name is the "<" key itself.
        tokens.push("<lt>");
        i++;
        continue;
      }
      tokens.push(char == " " ? "<Space>" : char);
      i++;
    }
    return tokens;
  },

  /**
   * Normalize a keydown event into a canonical token.
   *
   * @param {KeyboardEvent} event
   * @returns {string|null} null for events that are not a key on their own
   *   (bare modifiers, dead keys, IME composition).
   */
  fromEvent(event) {
    if (event.isComposing || IGNORED_EVENT_KEYS.has(event.key)) {
      return null;
    }
    const altGraph = event.getModifierState?.("AltGraph") ?? false;
    const modifiers = new Set();
    // AltGr reports Ctrl+Alt on some platforms; the character it produced is
    // what the user typed.
    if (event.ctrlKey && !altGraph) {
      modifiers.add("C");
    }
    if (event.altKey && !altGraph) {
      modifiers.add("A");
    }
    if (event.metaKey) {
      modifiers.add("D");
    }
    if (event.shiftKey) {
      modifiers.add("S");
    }

    let key = event.key;
    const chorded =
      modifiers.has("C") || modifiers.has("A") || modifiers.has("D");
    if (key.length == 1 && key != " " && !chorded) {
      // Shift is already in the character ("<", "!"), even when the
      // character has a bracketed name.
      modifiers.delete("S");
    }
    if (EVENT_KEYS[key]) {
      key = EVENT_KEYS[key];
    } else if (key.length > 1 && !isFunctionKey(key)) {
      // Media keys, "Clear", "ContextMenu" and the like.
      return null;
    }

    if (chorded && key.length == 1) {
      // Alt and Ctrl change event.key on some layouts (Option+j is "∆" on
      // macOS). Use the physical key so <A-j> means the j key.
      const code = event.code ?? "";
      if (/^Key[A-Z]$/.test(code)) {
        key = code.slice(3).toLowerCase();
      } else if (/^Digit[0-9]$/.test(code)) {
        key = code.slice(5);
      }
    }
    return makeToken(key, modifiers);
  },

  /**
   * Build a synthetic keydown event for a canonical token: the reverse of
   * fromEvent. Feed it where a real KeyboardEvent would go (a jump session,
   * the keymap engine) to press that key without a keyboard. The object
   * carries only the fields those readers use, and fromEvent turns it back
   * into the same token.
   *
   * @param {string} token A canonical token such as "a", "H", "<CR>",
   *   "<C-r>", "<Esc>", "<Space>", ".".
   * @returns {{key: string, code: string, ctrlKey: boolean, altKey: boolean,
   *   metaKey: boolean, shiftKey: boolean, isComposing: boolean,
   *   getModifierState: (name: string) => boolean}|null} Null for a string
   *   that is not a key.
   */
  tokenToEvent(token) {
    if (typeof token != "string" || !token.length) {
      return null;
    }
    const modifiers = new Set();
    let key;
    if (token.length == 1) {
      // A printable character stands for itself; an uppercase letter is sent
      // with Shift, as the keyboard would send it.
      key = token;
      if (token != token.toLowerCase() && token == token.toUpperCase()) {
        modifiers.add("S");
      }
    } else if (token.startsWith("<") && token.endsWith(">")) {
      const inner = token.slice(1, -1);
      const parts = inner.split("-");
      // "<C-->" is Ctrl and the "-" key.
      if (inner.endsWith("--")) {
        parts.splice(-2, 2, "-");
      }
      const keyPart = parts.pop();
      for (const part of parts) {
        const modifier = MODIFIER_ALIASES[part.toLowerCase()];
        if (!modifier) {
          return null;
        }
        modifiers.add(modifier);
      }
      const mapped = CANONICAL_TO_KEY[keyPart];
      // A bracketed body is a key only if it is a known name ("CR"), a
      // function key ("F5"), or a single character carrying a modifier
      // ("C-d", "C--"). Anything else is not a key and must be null, never a
      // junk event with an empty key ("<>", "<C->") or a bare bracketed
      // character ("<a>", which is parsed as "<", "a", ">", not a key), both
      // of which a capture would otherwise try to act on. parseBracketed
      // rejects the same shapes.
      if (
        mapped === undefined &&
        !isFunctionKey(keyPart) &&
        !(keyPart.length == 1 && modifiers.size)
      ) {
        return null;
      }
      key = mapped ?? keyPart;
    } else {
      return null;
    }
    const chorded =
      modifiers.has("C") || modifiers.has("A") || modifiers.has("D");
    let code = "";
    if (key.length == 1) {
      const lower = key.toLowerCase();
      if (/[a-z]/.test(lower)) {
        // A chorded letter is the physical key in lower case, with Shift
        // spelled out; fromEvent reads event.code for it. A bare Shift on a
        // letter is the uppercase character, as a real keyboard sends it, so
        // the "<S-x>" form inverts to the same event as its canonical "X".
        code = `Key${lower.toUpperCase()}`;
        if (chorded) {
          key = lower;
        } else if (modifiers.has("S")) {
          key = lower.toUpperCase();
        }
      } else if (/[0-9]/.test(key)) {
        code = `Digit${key}`;
      }
    }
    const shiftKey = modifiers.has("S");
    const ctrlKey = modifiers.has("C");
    const altKey = modifiers.has("A");
    const metaKey = modifiers.has("D");
    return {
      key,
      code,
      ctrlKey,
      altKey,
      metaKey,
      shiftKey,
      isComposing: false,
      getModifierState: tokenEventModifierState,
    };
  },

  /**
   * Join tokens back into a display string.
   *
   * @param {string[]} tokens
   * @returns {string}
   */
  format(tokens) {
    return tokens.join("");
  },

  /**
   * A stable key for a token sequence, usable as a Map key.
   *
   * @param {string[]} tokens
   * @returns {string}
   */
  sequenceKey(tokens) {
    return tokens.join("\u0000");
  },

  /**
   * Whether a token is a count digit. "0" only continues a count.
   *
   * @param {string} token
   * @param {boolean} counting Whether a count is already being typed.
   * @returns {boolean}
   */
  isCountDigit(token, counting) {
    return counting ? /^[0-9]$/.test(token) : /^[1-9]$/.test(token);
  },
};
