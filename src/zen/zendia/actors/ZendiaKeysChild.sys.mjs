// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { ZendiaDom } from "resource:///modules/zendia/core/ZendiaDom.sys.mjs";
import { ZendiaKeyClaims } from "resource:///modules/zendia/core/ZendiaKeyClaims.sys.mjs";
import { ZendiaKeys } from "resource:///modules/zendia/core/ZendiaKeys.sys.mjs";
import { ZendiaKeyEngine } from "resource:///modules/zendia/core/ZendiaKeyEngine.sys.mjs";
import {
  ZENDIA_CAPTURING_KEY,
  ZENDIA_SHARED_KEY,
  buildKeymap,
} from "resource:///modules/zendia/core/ZendiaShared.sys.mjs";

// One keymap per content process, rebuilt when the parent publishes a new
// version.
let gCached = null;

const JUMP_MODULE =
  "resource:///modules/zendia/plugins/ZendiaJumpContent.sys.mjs";

const POINTER_MODULE =
  "resource:///modules/zendia/plugins/ZendiaPointerContent.sys.mjs";

// A page that keeps refocusing its field gets it after this many refusals,
// rather than a focus fight.
const MAX_REFUSED_FOCUS = 3;

// Content actions that work on the field the keys went to, so they stay in
// its frame; the others act on the page.
function actsOnFocusedField(id) {
  return (
    id.startsWith("edit.") ||
    id.startsWith("input.") ||
    id.startsWith("yank.put") ||
    id == "mode.insert"
  );
}

function currentConfig() {
  const config = Services.cpmm.sharedData.get(ZENDIA_SHARED_KEY);
  if (!config) {
    return null;
  }
  if (gCached?.config.version !== config.version) {
    gCached = { config, keymap: buildKeymap(config) };
  }
  return gCached;
}

export class ZendiaKeysChild extends JSWindowActorChild {
  #engine = null;
  #version = null;
  // Insert mode entered with `i` stays until <Esc>, wherever focus goes.
  #explicitInsert = false;
  #refusedFocus = 0;
  #lastInput = null;
  // The jump session that takes the keys, until it is done.
  #capture = null;
  // Whether a page field has focus. The parent needs it to take reserved
  // browser shortcuts, like Ctrl+W, only while the user is typing.
  #inField = false;
  // APZ scrolls <Space>, PageDown and the arrows before preventDefault() can
  // stop them, unless the page itself has a key listener that could cancel
  // them. Ours is on the window root, where APZ does not look.
  #deferApzScrolling = () => {};
  // The keys whose keydown went to the keymap or a jump: their keyup is not
  // the page's either. A widget that acts on keyup, as reCAPTCHA's checkbox
  // does on Space, would take <Space> (the leader) for a press.
  #swallowed = new Set();
  #onKeyUp = event => {
    if (event.isTrusted && this.#swallowed.delete(event.code || event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  actorCreated() {
    this.contentWindow?.addEventListener(
      "keydown",
      this.#deferApzScrolling,
      true,
      true
    );
    this.contentWindow?.addEventListener("keyup", this.#onKeyUp, true);
  }

  didDestroy() {
    try {
      this.contentWindow?.removeEventListener(
        "keydown",
        this.#deferApzScrolling,
        true
      );
      this.contentWindow?.removeEventListener("keyup", this.#onKeyUp, true);
    } catch {
      // The window is already gone.
    }
  }

  #swallow(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    this.#swallowed.add(event.code || event.key);
  }

  handleEvent(event) {
    if (!event.isTrusted) {
      return;
    }
    switch (event.type) {
      case "keydown":
        this.#onKeyDown(event);
        break;
      case "focusin":
      case "focusout":
        // focusout fires before the next element takes focus.
        Promise.resolve().then(() => this.#syncMode());
        break;
      case "copy":
      case "cut":
        this.#onCopy();
        break;
      case "pageshow":
        if (!this.browsingContext.parent) {
          const engine = this.#ensureEngine();
          if (engine) {
            this.#reportState(engine);
          }
        }
        break;
    }
  }

  receiveMessage(message) {
    switch (message.name) {
      case "Zendia:RunContent":
        return this.runAction(message.data.id, message.data.args ?? {});
      // From the jump of the page this frame is in.
      case "Zendia:CollectControls":
        return ChromeUtils.importESModule(JUMP_MODULE).collectControls(
          this,
          this.contentWindow
        );
      case "Zendia:PressControl":
        return ChromeUtils.importESModule(JUMP_MODULE).pressControl(
          this,
          this.contentWindow,
          message.data
        );
      // The CAPTCHAs of this frame, and the mouse of a user who points with
      // the keys.
      case "Zendia:CollectAreas":
        return ChromeUtils.importESModule(POINTER_MODULE).captchaAreas(
          this,
          this.contentWindow
        );
      case "Zendia:Pointer":
        return ChromeUtils.importESModule(POINTER_MODULE).pointerAt(
          this,
          this.contentWindow,
          message.data
        );
      // A key typed while the browser UI had the focus, which took nothing
      // from it.
      case "Zendia:Key":
        if (!this.#capture) {
          this.#ensureEngine()?.feed(message.data.token);
        }
        break;
      case "Zendia:LeaveField":
        this.#leaveField();
        break;
      // A frame sent its key's action up: the keys that follow come to the
      // page, not to the frame that had the focus.
      case "Zendia:TakeFocus":
        this.contentWindow?.focus();
        break;
      // A key typed in a frame of this page while its jump has the keys.
      case "Zendia:CaptureKey":
        this.#onFrameKey(message.data);
        break;
      // A frame has nothing to say any more; the page speaks again.
      case "Zendia:ResendState": {
        const engine = this.#ensureEngine();
        if (engine) {
          this.#reportState(engine);
        }
        break;
      }
    }
    return undefined;
  }

  /**
   * Send the keys that follow to a session, like a jump's, until it is done.
   *
   * @param {{handleKey: (event: KeyboardEvent) => void, done: boolean}} session
   */
  startCapture(session) {
    // A session with nothing to pick is over before it starts.
    this.#capture = session.done ? null : session;
    if (!this.#capture) {
      return;
    }
    // The frames of the page pass their keys to it while it lasts: a
    // CAPTCHA moves the focus into its challenge when it opens, and the
    // labels must still take the keys.
    this.#announceCapture(true);
    session.finished?.then(() => {
      if (this.#capture === session) {
        this.#capture = null;
      }
      if (!this.#capture) {
        this.#announceCapture(false);
      }
    });
  }

  #announceCapture(on) {
    if (this.browsingContext.parent) {
      return;
    }
    try {
      this.sendAsyncMessage("Zendia:Capturing", { on });
    } catch {
      // The page is gone, and the parent forgets it.
    }
  }

  // Whether the page this frame is in has a jump that takes the keys.
  #pageCaptures() {
    const ids = Services.cpmm.sharedData.get(ZENDIA_CAPTURING_KEY);
    return Array.isArray(ids) && ids.includes(this.browsingContext.top.id);
  }

  /**
   * The field the user last typed in on this page, for `gi`.
   *
   * @returns {Element|null}
   */
  get lastInput() {
    const input = this.#lastInput?.deref();
    return input?.isConnected ? input : null;
  }

  get engine() {
    return this.#ensureEngine();
  }

  /**
   * @param {string} mode
   * @param {object} [options]
   * @param {boolean} [options.explicit] Keep the mode until <Esc>.
   */
  setMode(mode, { explicit = false } = {}) {
    this.#explicitInsert = mode == "i" && explicit;
    this.#ensureEngine()?.setMode(mode);
  }

  /**
   * Run a content action in this page.
   *
   * @param {string} id
   * @param {object} args
   */
  runAction(id, args) {
    const cached = currentConfig();
    const action = cached?.config.actions[id];
    if (action?.where != "content") {
      throw new Error(`Zendia: "${id}" is not a content action`);
    }
    const implementation = ChromeUtils.importESModule(action.module).actions?.[
      id
    ];
    if (typeof implementation != "function") {
      throw new Error(`Zendia: ${action.module} does not implement "${id}"`);
    }
    return implementation(
      {
        actor: this,
        window: this.contentWindow,
        document: this.document,
        opts: cached.config.options[action.owner] ?? {},
      },
      args
    );
  }

  #ensureEngine() {
    const cached = currentConfig();
    if (!cached) {
      return null;
    }
    if (this.#engine && this.#version === cached.config.version) {
      return this.#engine;
    }
    const mode = this.#engine?.mode ?? "n";
    this.#engine?.reset();
    this.#engine = new ZendiaKeyEngine({
      keymap: cached.keymap,
      timeoutlen: cached.config.timeoutlen,
      // which-key waits on a prefix for as long as it takes.
      waitForPrefix: !!cached.config.options["which-key"],
      onMatch: match => this.#onMatch(match),
      onStateChange: engine => this.#reportState(engine),
    });
    this.#engine.setMode(mode);
    this.#version = cached.config.version;
    return this.#engine;
  }

  // vim stays in normal mode when it moves to another window. A page reached
  // with the keys does too, or the field it kept focused would turn the next
  // <C-h> into a deleted character and the next J into a typed one. `gi` goes
  // back to the field.
  #leaveField() {
    if (!this.document) {
      return;
    }
    const active = ZendiaDom.deepActiveElement(this.document);
    if (ZendiaDom.isEditable(active)) {
      active.blur();
    }
    this.#explicitInsert = false;
    this.#syncMode();
  }

  #syncMode() {
    if (!this.document) {
      return;
    }
    const engine = this.#ensureEngine();
    if (!engine) {
      return;
    }
    const active = ZendiaDom.deepActiveElement(this.document);
    const editing = ZendiaDom.isEditable(active);
    if (editing && engine.mode == "v") {
      // Clicking into a field ends visual mode.
      this.#inField = true;
      this.#lastInput = new WeakRef(active);
      engine.setMode("i");
      return;
    }
    if (editing && engine.mode == "n" && this.#isStolenFocus()) {
      // Pages like Wikipedia focus their search field on load, which would
      // put the page in insert mode before the user did anything.
      this.#refusedFocus++;
      active.blur();
      return;
    }
    if (editing) {
      this.#lastInput = new WeakRef(active);
    }
    const fieldChanged = editing != this.#inField;
    this.#inField = editing;
    if (editing && engine.mode == "n") {
      engine.setMode("i");
    } else if (!editing && engine.mode == "i" && !this.#explicitInsert) {
      engine.setMode("n");
    } else if (fieldChanged) {
      this.#reportState(engine);
    }
  }

  #isStolenFocus() {
    const preventAutofocus =
      currentConfig()?.config.options.core?.preventAutofocus ?? true;
    return (
      preventAutofocus &&
      this.#refusedFocus < MAX_REFUSED_FOCUS &&
      !this.contentWindow?.navigator.userActivation.hasBeenActive
    );
  }

  #onKeyDown(event) {
    // Whether its keyup is the page's is decided again by this keydown.
    this.#swallowed.delete(event.code || event.key);
    const engine = this.#ensureEngine();
    if (!engine || ZendiaDom.agentTyping) {
      return;
    }
    // A jump can end on its own, when the challenge it stayed in is gone.
    if (this.#capture?.done) {
      this.#capture = null;
    }
    const editing = () =>
      ZendiaDom.isEditable(ZendiaDom.deepActiveElement(this.document));
    if (
      this.browsingContext.parent &&
      !this.#capture &&
      this.#pageCaptures() &&
      !editing()
    ) {
      // The page's jump has the keys; a field of the frame keeps its own,
      // for the answer of a CAPTCHA to be typed in.
      const token = ZendiaKeys.fromEvent(event);
      if (token) {
        this.#swallow(event);
        this.sendAsyncMessage("Zendia:CaptureKey", {
          key: event.key,
          code: event.code,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altGraph: event.getModifierState("AltGraph"),
        });
      }
      return;
    }
    // A CAPTCHA's jump stays while its answer is typed in a field.
    if (this.#capture && !(this.#capture.yieldsToFields && editing())) {
      this.#swallow(event);
      this.#giveToCapture(event, engine);
      return;
    }
    this.#syncMode();
    // An extension popup's labels take their letters in normal mode, which
    // the keymap leaves free for them.
    if (
      engine.mode == "n" &&
      ZendiaKeyClaims.claims(this.contentWindow, event)
    ) {
      return;
    }
    if (engine.feed(ZendiaKeys.fromEvent(event))) {
      this.#swallow(event);
    }
  }

  #giveToCapture(event, engine) {
    const capture = this.#capture;
    capture.handleKey(event);
    if (capture.done) {
      this.#capture = null;
    }
    // A jump that ended on this key leaves it to the keymap.
    if (capture.passesKey) {
      engine.feed(ZendiaKeys.fromEvent(event));
    }
  }

  // A key from a frame of this page, as the frame's keydown had it.
  #onFrameKey(data) {
    const engine = this.#ensureEngine();
    if (!engine || !data) {
      return;
    }
    const event = {
      key: data.key,
      code: data.code,
      ctrlKey: data.ctrlKey,
      altKey: data.altKey,
      metaKey: data.metaKey,
      shiftKey: data.shiftKey,
      isComposing: false,
      getModifierState: state => state == "AltGraph" && data.altGraph,
    };
    if (this.#capture?.done) {
      this.#capture = null;
    }
    if (this.#capture) {
      this.#giveToCapture(event, engine);
      return;
    }
    // The jump ended before the key came: it is the page's now.
    const token = ZendiaKeys.fromEvent(event);
    if (token) {
      engine.feed(token);
    }
  }

  #onMatch({ mapping, count }) {
    const action = currentConfig()?.config.actions[mapping.rhs];
    if (!action) {
      console.error(
        `Zendia: "${mapping.lhs}" maps to unknown "${mapping.rhs}"`
      );
      return;
    }
    const args = count !== null && action.params?.count ? { count } : {};
    if (action.where == "content") {
      if (action.params?.lhs) {
        // One action serves many keys, like every text object's.
        args.lhs = mapping.lhs;
      }
      const inFrame = !!this.browsingContext.parent;
      if (inFrame && !actsOnFocusedField(mapping.rhs)) {
        // The page is what the keys act on, not the frame that has the
        // focus, which would trap them there.
        this.sendAsyncMessage("Zendia:RunInTop", {
          id: mapping.rhs,
          args,
        });
        if (mapping.rhs != "mode.normal") {
          return;
        }
      }
      Promise.resolve()
        .then(() => this.runAction(mapping.rhs, args))
        .catch(e => console.error(`Zendia: "${mapping.rhs}" failed`, e));
    } else {
      this.sendAsyncMessage("Zendia:Run", { id: mapping.rhs, args });
    }
  }

  // What the user copied or cut in the page, for the yank ring. Passwords
  // never go there.
  #onCopy() {
    const window = this.contentWindow;
    const field = ZendiaDom.deepActiveElement(this.document);
    let text;
    if (field?.localName == "input" || field?.localName == "textarea") {
      if (field.type == "password") {
        return;
      }
      text = field.value.substring(field.selectionStart, field.selectionEnd);
    } else {
      text = window.getSelection().toString();
    }
    if (text?.trim()) {
      this.sendAsyncMessage("Zendia:Yank", {
        text,
        url: this.document.documentURI,
        title: this.document.title,
      });
    }
  }

  #reportState(engine) {
    if (engine.mode != "v") {
      ChromeUtils.importESModule(
        "resource:///modules/zendia/plugins/ZendiaVisualContent.sys.mjs"
      ).hideCaret(this.contentWindow);
    }
    const state = {
      mode: engine.mode,
      ...engine.pending,
      field: this.#inField,
    };
    if (
      this.browsingContext.parent &&
      state.mode == "n" &&
      !state.tokens.length &&
      !state.field
    ) {
      // A frame with nothing pending must not overwrite the page's mode,
      // like visual mode's; the page says where it is.
      this.sendAsyncMessage("Zendia:FrameIdle");
      return;
    }
    this.sendAsyncMessage("Zendia:State", state);
  }
}
