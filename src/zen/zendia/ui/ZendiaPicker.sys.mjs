// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const HTML_NS = "http://www.w3.org/1999/xhtml";

// Hint labels. j and k move the selection instead.
export const LABELS = "asdfghlqweruiopzxcvbnmty";

/**
 * Hide a floating element after its `[leaving]` fade in zendia.css.
 * `hidden` waits for the fade: xul.css makes it display: none !important, and
 * Gecko does not transition display.
 *
 * @param {Element} element
 */
export function hideFloat(element) {
  if (element.hidden || element.hasAttribute("leaving")) {
    return;
  }
  element.setAttribute("leaving", "");
  Promise.allSettled(element.getAnimations().map(a => a.finished)).then(() => {
    if (element.hasAttribute("leaving")) {
      element.removeAttribute("leaving");
      element.hidden = true;
    }
  });
}

/**
 * Show a floating element, taking it back mid-fade if it was leaving.
 *
 * @param {Element} element
 */
export function showFloat(element) {
  element.removeAttribute("leaving");
  element.hidden = false;
}

/**
 * @typedef {object} ZendiaPickerItem
 * @property {string} label What the item is called.
 * @property {string} [detail] Shown dimmed after the label.
 * @property {string} [icon] An image URL.
 * @property {boolean} [iconFill] The icon is a full tile, not a mark on one.
 * @property {string} [color] A color of its own, for the glow on a selected
 *   grid item.
 * @property {boolean} [dim] Shown faded, for an item that cannot be used yet.
 * @property {string} [tooltip] Shown when the mouse rests on it.
 * @property {string} [key] The key that picks it; one is assigned otherwise.
 * @property {string} [section] A heading shown above the first item of a run
 *   of items that share it.
 */

/**
 * A floating list to pick from with the keyboard, LazyVim's picker in the
 * browser window. It takes focus while open, so keys never reach the page.
 */
export class ZendiaPicker {
  /** @type {WeakMap<Document, ZendiaPicker>} */
  static #open = new WeakMap();

  // A closed picker's root while it fades out.
  /** @type {WeakMap<Document, Element>} */
  static #leaving = new WeakMap();

  /**
   * @param {Window} window A browser window.
   * @param {object} options
   * @param {string} options.title
   * @param {ZendiaPickerItem[]} options.items
   * @param {"list"|"grid"} [options.layout] "grid" shows large icons in
   *   tiles, for a few items known by their icon.
   * @param {number} [options.selected] The item selected when it opens.
   * @returns {Promise<number|null>} The index of the picked item, or null
   *   when the picker was dismissed.
   */
  static open(window, { title, items, layout = "list", selected = 0 }) {
    ZendiaPicker.#open.get(window.document)?.close(null);
    ZendiaPicker.#leaving.get(window.document)?.remove();
    const picker = new ZendiaPicker(window, title, items, layout, selected);
    ZendiaPicker.#open.set(window.document, picker);
    return picker.#result.promise;
  }

  /**
   * @param {Document} document
   * @returns {boolean}
   */
  static isOpen(document) {
    return ZendiaPicker.#open.has(document);
  }

  #window;
  #root;
  #cursor;
  #rows = [];
  #keys = [];
  #selected = 0;
  #result = Promise.withResolvers();
  #previousFocus;

  constructor(window, title, items, layout, selected) {
    this.#window = window;
    const document = window.document;
    const create = (tag, className) => {
      const element = document.createElementNS(HTML_NS, tag);
      if (className) {
        element.className = className;
      }
      return element;
    };

    this.#root = create("div", "zendia-picker");
    this.#root.id = "zendia-picker";
    this.#root.setAttribute("layout", layout);
    this.#root.setAttribute("role", "dialog");
    this.#root.setAttribute("aria-label", title);
    this.#root.tabIndex = -1;

    const heading = create("div", "zendia-picker-title");
    heading.textContent = title;
    const list = create("div", "zendia-picker-list");
    list.setAttribute("role", "listbox");
    this.#cursor = create("div", "zendia-picker-cursor");
    this.#cursor.setAttribute("role", "presentation");
    list.append(this.#cursor);

    const reserved = new Set(items.map(item => item.key).filter(Boolean));
    const free = [...LABELS].filter(label => !reserved.has(label));
    items.forEach((item, index) => {
      if (item.section && item.section != items[index - 1]?.section) {
        const section = create("div", "zendia-picker-section");
        section.setAttribute("role", "presentation");
        section.textContent = item.section;
        list.append(section);
      }
      const key = item.key ?? free.shift() ?? "";
      this.#keys.push(key);
      const row = create("div", "zendia-picker-item");
      row.setAttribute("role", "option");
      row.style.setProperty("--zendia-row", index);
      if (item.color) {
        row.style.setProperty("--zendia-picker-color", item.color);
      }
      row.toggleAttribute("dim", !!item.dim);
      if (item.tooltip) {
        row.title = item.tooltip;
      }
      const kbd = create("kbd", "zendia-picker-key");
      kbd.textContent = key;
      row.append(kbd);
      if (item.icon) {
        const plate = create("span", "zendia-picker-icon-plate");
        plate.toggleAttribute("fill", !!item.iconFill);
        const icon = create("img", "zendia-picker-icon");
        icon.src = item.icon;
        icon.alt = "";
        plate.append(icon);
        row.append(plate);
      }
      const label = create("span", "zendia-picker-label");
      label.textContent = item.label;
      row.append(label);
      if (item.detail) {
        const detail = create("span", "zendia-picker-detail");
        detail.textContent = item.detail;
        row.append(detail);
      }
      row.addEventListener("click", () => this.close(index));
      list.append(row);
      this.#rows.push(row);
    });

    const help = create("div", "zendia-picker-help");
    help.textContent = "j/k move · Enter pick · label picks · Esc cancel";

    this.#root.append(heading, list, help);
    this.#root.addEventListener("keydown", this, true);
    window.addEventListener("mousedown", this, true);
    (document.getElementById("browser") ?? document.documentElement).append(
      this.#root
    );
    this.#select(selected >= 0 && selected < items.length ? selected : 0);
    this.#previousFocus = Services.focus.focusedElement;
    this.#root.focus();
  }

  handleEvent(event) {
    if (event.type == "mousedown") {
      if (!this.#root.contains(event.target)) {
        this.close(null);
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const { key, ctrlKey } = event;
    if (key == "Escape" || (ctrlKey && (key == "c" || key == "["))) {
      this.close(null);
    } else if (key == "Enter") {
      this.close(this.#selected);
    } else if (
      key == "j" ||
      key == "ArrowDown" ||
      key == "ArrowRight" ||
      (ctrlKey && key == "n")
    ) {
      this.#select(this.#selected + 1);
    } else if (
      key == "k" ||
      key == "ArrowUp" ||
      key == "ArrowLeft" ||
      (ctrlKey && key == "p")
    ) {
      this.#select(this.#selected - 1);
    } else if (!ctrlKey && !event.altKey && !event.metaKey) {
      const index = this.#keys.indexOf(key);
      if (index != -1) {
        this.close(index);
      }
    }
  }

  /**
   * @param {number|null} index
   */
  close(index) {
    if (ZendiaPicker.#open.get(this.#window.document) !== this) {
      return;
    }
    ZendiaPicker.#open.delete(this.#window.document);
    this.#window.removeEventListener("mousedown", this, true);
    this.#leave();
    this.#previousFocus?.focus?.();
    this.#result.resolve(index);
  }

  // Closed from here on: no id, no focus, no input. Only the fade is left,
  // and it never delays the pick or the keys that follow.
  #leave() {
    const document = this.#window.document;
    const root = this.#root;
    root.removeEventListener("keydown", this, true);
    root.blur();
    root.removeAttribute("id");
    root.inert = true;
    root.setAttribute("leaving", "");
    ZendiaPicker.#leaving.set(document, root);
    Promise.allSettled(root.getAnimations().map(a => a.finished)).then(() => {
      root.remove();
      if (ZendiaPicker.#leaving.get(document) === root) {
        ZendiaPicker.#leaving.delete(document);
      }
    });
  }

  #select(index) {
    if (!this.#rows.length) {
      return;
    }
    this.#rows[this.#selected]?.removeAttribute("selected");
    this.#rows[this.#selected]?.setAttribute("aria-selected", "false");
    this.#selected = (index + this.#rows.length) % this.#rows.length;
    const row = this.#rows[this.#selected];
    row.setAttribute("selected", "");
    row.setAttribute("aria-selected", "true");
    this.#cursor.style.width = `${row.offsetWidth}px`;
    this.#cursor.style.height = `${row.offsetHeight}px`;
    this.#cursor.style.transform = `translate(${row.offsetLeft}px, ${row.offsetTop}px)`;
    row.scrollIntoView({ block: "nearest" });
  }
}
