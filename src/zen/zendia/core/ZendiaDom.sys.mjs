// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

export const ZendiaDom = {
  /**
   * Set while an agent presses keys in this content process. Its keys are
   * meant for the page, not for the vim engine: in dev testing the engine
   * took an agent's k (scroll up) and Escape before YouTube saw them.
   */
  agentTyping: false,

  /**
   * Run an agent's synthesized mouse input so it never takes the user's
   * focus or window. A mousedown on something that takes no focus, in the
   * tab in front, makes Gecko focus the page's window and raise the browser
   * window (EventStateManager -> nsFocusManager::SetFocusedWindow), and
   * window managers that warp the pointer to a raised window move the
   * user's OS cursor with it. While the user's focus is elsewhere (another
   * application, or the browser's own UI), the mousedown's default is
   * prevented after the page has heard it: the page sees the press, the
   * click still follows, and nothing is focused or raised.
   *
   * @param {Window} window
   * @param {() => *} run Dispatches the input, synchronously.
   * @param {boolean} [shield] Whether to keep the user's focus, when the
   *   caller knows (page_act's quiet); otherwise judged here, from a tab
   *   that is active yet has no focus.
   * @returns {*} What run returned.
   */
  agentMouse(window, run, shield = null) {
    let guard = null;
    try {
      if (
        shield ??
        (window.browsingContext?.isActive && !window.document.hasFocus())
      ) {
        guard = event => {
          if (event.isTrusted) {
            event.preventDefault();
          }
        };
        Services.els.addSystemEventListener(window, "mousedown", guard, false);
      }
    } catch {
      guard = null;
    }
    try {
      return run();
    } finally {
      if (guard) {
        try {
          Services.els.removeSystemEventListener(
            window,
            "mousedown",
            guard,
            false
          );
        } catch {
          // The window is gone.
        }
      }
    }
  },

  /**
   * Whether typing into this element edits it, which puts the page in
   * insert mode.
   *
   * @param {Element|null} element
   * @returns {boolean}
   */
  isEditable(element) {
    if (!element) {
      return false;
    }
    if (
      element.isContentEditable ||
      element.ownerDocument?.designMode == "on"
    ) {
      return true;
    }
    switch (element.localName) {
      case "textarea":
        return !element.readOnly && !element.disabled;
      case "select":
        return !element.disabled;
      case "input":
        return (
          !NON_TEXT_INPUTS.has(element.type) &&
          !element.readOnly &&
          !element.disabled
        );
    }
    return false;
  },

  /**
   * The focused element, looking inside open and closed shadow roots.
   *
   * @param {Document} document
   * @returns {Element|null}
   */
  deepActiveElement(document) {
    let element = document.activeElement;
    while (element?.openOrClosedShadowRoot?.activeElement) {
      element = element.openOrClosedShadowRoot.activeElement;
    }
    return element;
  },

  /**
   * Every element under a root in document order, with those of each shadow
   * root (closed ones too, which privileged code can see) right after its
   * host. Settings pages and web components keep their controls there.
   *
   * @param {Document|ShadowRoot|Element} root
   * @yields {Element}
   */
  *deepElements(root) {
    for (const element of root.querySelectorAll("*")) {
      yield element;
      const shadow = element.openOrClosedShadowRoot;
      if (shadow) {
        yield* ZendiaDom.deepElements(shadow);
      }
    }
  },

  /**
   * Every text node under a root in document order, with those of a shadow
   * root before the host's own children.
   *
   * @param {Node} root
   * @yields {Text}
   */
  *deepTextNodes(root) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (node.nodeType == node.TEXT_NODE) {
        yield node;
        continue;
      }
      const children = [
        ...(node.openOrClosedShadowRoot?.childNodes ?? []),
        ...node.childNodes,
      ];
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i]);
      }
    }
  },

  /**
   * The parent of a node across shadow roots: a shadow root's child has its
   * host.
   *
   * @param {Node} node
   * @returns {Element|null}
   */
  composedParent(node) {
    return node.parentElement ?? node.getRootNode()?.host ?? null;
  },

  /**
   * Whether an element is another one, or inside it, across shadow roots.
   *
   * @param {Element} ancestor
   * @param {Element} element
   * @returns {boolean}
   */
  composedContains(ancestor, element) {
    for (let each = element; each; each = ZendiaDom.composedParent(each)) {
      if (each === ancestor) {
        return true;
      }
    }
    return false;
  },

  /**
   * Elements in the order `deepElements` gives them: a shadow root's before
   * its host's own children.
   *
   * @param {Element[]} elements
   * @returns {Element[]}
   */
  sortComposed(elements) {
    // From the top of the page down to each element, found once.
    const paths = new Map(
      elements.map(element => {
        const path = [];
        for (let each = element; each; each = ZendiaDom.composedParent(each)) {
          path.push(each);
        }
        return [element, path.reverse()];
      })
    );
    return [...elements].sort((a, b) => {
      const first = paths.get(a);
      const second = paths.get(b);
      let depth = 0;
      while (
        depth < first.length &&
        depth < second.length &&
        first[depth] === second[depth]
      ) {
        depth++;
      }
      // One holds the other: the outer one comes first.
      if (depth == first.length || depth == second.length) {
        return first.length - second.length;
      }
      const x = first[depth];
      const y = second[depth];
      const inShadow = element => !!element.getRootNode().host;
      if (inShadow(x) != inShadow(y)) {
        return inShadow(x) ? -1 : 1;
      }
      return x.compareDocumentPosition(y) & x.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1;
    });
  },

  /**
   * The element on top at a point, looking inside shadow roots.
   *
   * @param {Document} document
   * @param {number} x
   * @param {number} y
   * @returns {Element|null}
   */
  deepElementFromPoint(document, x, y) {
    let element = document.elementFromPoint(x, y);
    for (
      let shadow = element?.openOrClosedShadowRoot;
      shadow;
      shadow = element?.openOrClosedShadowRoot
    ) {
      const inner = shadow.elementFromPoint(x, y);
      if (!inner || inner === element) {
        break;
      }
      element = inner;
    }
    return element;
  },
};
