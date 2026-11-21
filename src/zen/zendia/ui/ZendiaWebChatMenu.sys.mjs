// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// "Ask ChatGPT" in a page's context menu and a tab's: the prompts for what
// was right-clicked (ZendiaWebChatPrompts), sent to the web chat panel's site
// at once (ZendiaWebChatAsk). A row of the sites' logos at the top of the
// submenu picks another one, or every one, without closing it. Shift with a
// prompt leaves it in the site's box to finish instead of sending it.
//
// What was right-clicked decides what comes first: text selected in a field
// (rewrite, fix, change tone), text selected on the page (explain,
// summarize, translate), an image or a video's frame, a link, else the page.
// The others follow in submenus of their own.

import {
  askPrompt,
  labelOf,
  languageName,
  namesLanguage,
  nativeLanguageName,
} from "resource:///modules/zendia/webchat/ZendiaWebChatPrompts.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ZendiaWebChatAsk:
    "resource:///modules/zendia/webchat/ZendiaWebChatAsk.sys.mjs",
  webChatIcon: "resource:///modules/zendia/webchat/ZendiaWebChatIcons.sys.mjs",
});

/** Whether the menus offer to ask. */
export const PREF_MENU = "zendia.webchat.ask.menu";

const ALL = "*";

const KIND_NAMES = {
  selection: "Selected Text",
  editable: "Selected Text",
  image: "Image",
  video: "Video Frame",
  link: "Linked Page",
  page: "This Page",
};

export class ZendiaWebChatMenu {
  #window;
  #dock;
  #menu;
  #popup;
  #separator;
  #putBack;
  #tabMenu;
  #tabPopup;
  // What was right-clicked, kept from when the menu opened.
  #context = null;
  // The prompt items whose labels name the language.
  #named = [];
  // The site asked, or ALL; the panel's by default.
  #target = null;

  /**
   * @param {Window} window A browser window.
   * @param {object} options
   * @param {object} options.dock The window's ZendiaWebChatDock.
   */
  constructor(window, { dock }) {
    this.#window = window;
    this.#dock = dock;
    const document = window.document;
    const pageMenu = document.getElementById("contentAreaContextMenu");
    if (pageMenu) {
      this.#menu = document.createXULElement("menu");
      this.#menu.id = "context-zendia-ask";
      this.#menu.className = "menu-iconic";
      this.#popup = document.createXULElement("menupopup");
      this.#popup.id = "context-zendia-ask-popup";
      this.#menu.append(this.#popup);
      this.#putBack = this.#item("Put the Chat's Reply Here", () =>
        this.#dock.putReply()
      );
      this.#putBack.id = "context-zendia-put-back";
      this.#putBack.setAttribute("accesskey", "R");
      this.#separator = document.createXULElement("menuseparator");
      this.#separator.id = "context-zendia-ask-sep";
      const after = document.getElementById("context-sep-navigation");
      if (after?.parentNode == pageMenu) {
        after.after(this.#menu, this.#putBack, this.#separator);
      } else {
        pageMenu.prepend(this.#menu, this.#putBack, this.#separator);
      }
      pageMenu.addEventListener("popupshowing", event => {
        if (event.target == pageMenu) {
          this.#onPageMenu(pageMenu);
        }
      });
    }
    const tabMenu = document.getElementById("tabContextMenu");
    if (tabMenu) {
      this.#tabMenu = document.createXULElement("menu");
      this.#tabMenu.id = "context_zendiaAskTabs";
      this.#tabMenu.className = "menu-iconic";
      this.#tabPopup = document.createXULElement("menupopup");
      this.#tabMenu.append(this.#tabPopup);
      const separator = document.createXULElement("menuseparator");
      tabMenu.prepend(this.#tabMenu, separator);
      tabMenu.addEventListener("popupshowing", event => {
        if (event.target == tabMenu) {
          this.#onTabMenu(separator);
        }
      });
    }
  }

  // The page's menu.

  #onPageMenu(pageMenu) {
    const menu = this.#window.gContextMenu;
    const browser = menu?.browser;
    const wanted =
      !!menu &&
      !!browser &&
      Services.prefs.getBoolPref(PREF_MENU, true) &&
      !!this.#dock.chats.length &&
      !this.#dock.contains(browser) &&
      !menu.onPassword;
    this.#context = null;
    this.#menu.hidden = !wanted;
    this.#putBack.hidden = !wanted || !this.#dock.canPutBackInto(browser);
    if (wanted) {
      this.#context = {
        browser,
        frame: menu.frameBrowsingContext ?? browser.browsingContext,
        kinds: this.#kindsOf(menu),
        selected: menu.isTextSelected ? (menu.selectedText ?? "") : "",
        targetIdentifier: menu.targetIdentifier,
        mediaURL: menu.mediaURL,
        linkURL: menu.linkURL,
        linkText: menu.linkTextStr ?? "",
      };
      this.#target = null;
      this.#fillAsk();
    }
    this.#separator.hidden = !wanted;
    pageMenu.showHideSeparators?.();
  }

  // What can be asked about, the one first that the click was most about.
  #kindsOf(menu) {
    const kinds = [];
    if (menu.isTextSelected) {
      kinds.push(menu.onEditable ? "editable" : "selection");
    }
    if (menu.onVideo) {
      kinds.push("video");
    } else if (menu.onImage || menu.onCanvas) {
      kinds.push("image");
    }
    if (
      menu.onLink &&
      !menu.onMailtoLink &&
      !menu.onTelLink &&
      /^https?:/.test(menu.linkURL ?? "")
    ) {
      kinds.push("link");
    }
    if (!kinds.length || !menu.onEditable) {
      kinds.push("page");
    }
    // Media first when the click was on it rather than on a selection.
    if (
      kinds[0] != "editable" &&
      (menu.onImage || menu.onCanvas || menu.onVideo) &&
      kinds.includes("selection")
    ) {
      kinds.splice(kinds.indexOf("selection"), 1);
      kinds.splice(1, 0, "selection");
    }
    return [...new Set(kinds)];
  }

  #targetChat() {
    const chats = this.#dock.chats;
    if (this.#target == ALL) {
      return null;
    }
    return (
      chats.find(chat => chat.id == this.#target) ??
      this.#dock.currentChat ??
      chats[0]
    );
  }

  #fillAsk() {
    const document = this.#window.document;
    this.#syncLabel();
    const popup = this.#popup;
    popup.replaceChildren();
    if (this.#dock.chats.length > 1) {
      popup.append(
        this.#sitesRow(),
        document.createXULElement("menuseparator")
      );
    }
    this.#fillPrompts();
  }

  #syncLabel() {
    const chat = this.#targetChat();
    this.#menu.setAttribute(
      "label",
      chat ? `Ask ${chat.name}` : "Ask Every Chat Site"
    );
    this.#menu.setAttribute("accesskey", "A");
    if (chat) {
      this.#menu.setAttribute("image", lazy.webChatIcon(chat));
    } else {
      this.#menu.removeAttribute("image");
    }
  }

  // Everything under the row of sites, which a pick there changes.
  #fillPrompts() {
    const document = this.#window.document;
    const popup = this.#popup;
    const row = popup.querySelector(".zendia-ask-sites");
    const keep = row ? row.nextElementSibling : null;
    while (popup.lastElementChild && popup.lastElementChild != (keep ?? null)) {
      popup.lastElementChild.remove();
    }
    if (!row) {
      popup.replaceChildren();
    }
    this.#named = [];
    const [first, ...rest] = this.#context.kinds;
    this.#fillKind(popup, first);
    if (rest.length) {
      popup.append(document.createXULElement("menuseparator"));
    }
    for (const kind of rest) {
      const menu = document.createXULElement("menu");
      menu.setAttribute("label", KIND_NAMES[kind]);
      const sub = document.createXULElement("menupopup");
      menu.append(sub);
      this.#fillKind(sub, kind);
      popup.append(menu);
    }
    popup.append(
      document.createXULElement("menuseparator"),
      this.#languagesMenu(),
      this.#item(
        "Ask About Part of the Screen…",
        () => this.#askRegion(),
        "screenshot.svg"
      ),
      this.#hint()
    );
  }

  // The sites' logos in a row, with every site at its end: picking one
  // keeps the menu open.
  #sitesRow() {
    const document = this.#window.document;
    const row = document.createXULElement("menugroup");
    row.className = "zendia-ask-sites";
    const current = this.#targetChat();
    const add = (id, label, image) => {
      const item = document.createXULElement("menuitem");
      // No checkbox: on Linux one takes the logo's place.
      item.className = image
        ? "menuitem-iconic zendia-ask-site"
        : "zendia-ask-site zendia-ask-all";
      item.setAttribute("closemenu", "none");
      item.setAttribute("tooltiptext", label);
      item.setAttribute("label", label);
      if (image) {
        item.setAttribute("image", image);
      }
      item.dataset.site = id;
      item.dataset.name = label;
      const mark = picked => {
        item.toggleAttribute("current", picked);
        item.setAttribute("aria-label", picked ? `${label}, asked` : label);
      };
      mark(id == ALL ? this.#target == ALL : current?.id == id);
      item.addEventListener("command", () => {
        this.#target = id;
        for (const each of row.children) {
          const picked = each.dataset.site == id;
          each.toggleAttribute("current", picked);
          each.setAttribute(
            "aria-label",
            picked ? `${each.dataset.name}, asked` : each.dataset.name
          );
        }
        this.#syncLabel();
        this.#fillPrompts();
      });
      row.append(item);
    };
    for (const chat of this.#dock.chats) {
      add(chat.id, chat.name, lazy.webChatIcon(chat));
    }
    add(ALL, "All", null);
    return row;
  }

  #fillKind(popup, kind) {
    const document = this.#window.document;
    const ask = lazy.ZendiaWebChatAsk;
    const offered = ask.offered(
      kind == "selection" || kind == "editable"
        ? { kind, text: this.#context.selected }
        : kind
    );
    const groups = new Map();
    for (const { prompt, label } of offered) {
      if (prompt.group) {
        if (!groups.has(prompt.group)) {
          const menu = document.createXULElement("menu");
          menu.setAttribute("label", prompt.group);
          const sub = document.createXULElement("menupopup");
          menu.append(sub);
          groups.set(prompt.group, sub);
          popup.append(menu);
        }
        groups.get(prompt.group).append(this.#promptItem(kind, prompt, label));
        continue;
      }
      popup.append(this.#promptItem(kind, prompt, label));
    }
    if (this.#target != ALL) {
      popup.append(this.#promptItem(kind, askPrompt(kind), "Ask…"));
    }
  }

  #promptItem(kind, prompt, label) {
    const item = this.#item(label, event =>
      this.#ask(kind, prompt, { send: event.shiftKey ? false : undefined })
    );
    if (namesLanguage(prompt)) {
      this.#named.push({ item, prompt });
    }
    if (prompt.key && /^[a-z0-9]$/i.test(prompt.key)) {
      item.setAttribute("accesskey", prompt.key);
    }
    const site =
      prompt.site && this.#dock.chats.find(chat => chat.id == prompt.site);
    if (site && this.#target != ALL) {
      item.setAttribute("acceltext", site.name);
    }
    return item;
  }

  // The language answers and translations are written in, the one used last
  // checked. Picking another keeps the menu open and renames the prompts.
  #languagesMenu() {
    const document = this.#window.document;
    const ask = lazy.ZendiaWebChatAsk;
    const menu = document.createXULElement("menu");
    menu.id = "context-zendia-ask-language";
    const popup = document.createXULElement("menupopup");
    menu.append(popup);
    const label = () =>
      menu.setAttribute(
        "label",
        `Language: ${languageName(ask.defaultLanguage())}`
      );
    label();
    menu.setAttribute("accesskey", "L");
    popup.addEventListener(
      "popupshowing",
      () => {
        for (const code of ask.languages()) {
          const name = languageName(code);
          const native = nativeLanguageName(code);
          const item = document.createXULElement("menuitem");
          item.setAttribute("type", "radio");
          item.setAttribute("name", "zendia-ask-language");
          item.setAttribute("closemenu", "none");
          item.setAttribute("label", native ? `${name} · ${native}` : name);
          item.dataset.code = code;
          item.toggleAttribute("checked", code == ask.defaultLanguage());
          item.addEventListener("command", () => {
            ask.useLanguage(code);
            for (const each of popup.children) {
              each.toggleAttribute("checked", each.dataset.code == code);
            }
            label();
            this.#relabel();
          });
          popup.append(item);
        }
      },
      { once: true }
    );
    return menu;
  }

  // The prompts that name the language, after another was picked.
  #relabel() {
    const lang = languageName(lazy.ZendiaWebChatAsk.defaultLanguage());
    for (const { item, prompt } of this.#named) {
      item.setAttribute("label", labelOf(prompt, lang));
    }
  }

  #hint() {
    const item = this.#window.document.createXULElement("menuitem");
    item.setAttribute("label", "Shift-click to edit before sending");
    item.setAttribute("disabled", "true");
    item.className = "zendia-ask-hint";
    return item;
  }

  #item(label, command, icon) {
    const item = this.#window.document.createXULElement("menuitem");
    item.setAttribute("label", label);
    if (icon) {
      item.className = "menuitem-iconic";
      item.setAttribute("image", `chrome://browser/skin/zen-icons/${icon}`);
    }
    item.addEventListener("command", event => {
      Promise.resolve(command(event)).catch(e =>
        console.error("Zendia: asking the chat failed", e)
      );
    });
    return item;
  }

  async #ask(kind, prompt, options) {
    const context = this.#context;
    if (!context) {
      return;
    }
    const ask = lazy.ZendiaWebChatAsk;
    const window = this.#window;
    let what = null;
    switch (kind) {
      case "selection":
      case "editable":
        what = await ask.selectionIn(context.frame, context.browser);
        break;
      case "image":
      case "video":
        what = await ask.imageOf(window, {
          frame: context.frame,
          browser: context.browser,
          targetIdentifier: context.targetIdentifier,
          src: kind == "image" ? context.mediaURL : "",
        });
        break;
      case "link":
        what = await ask.linkOf(
          context.linkURL,
          context.browser,
          context.linkText
        );
        break;
      case "page":
        what = await ask.pageOf(context.browser);
        break;
    }
    if (!what) {
      return;
    }
    // A selection in a field asked about with the page's prompts.
    if (kind == "selection" && what.kind == "editable") {
      what.kind = "selection";
    }
    await ask.ask(window, this.#dock, what, prompt, {
      ...options,
      all: this.#target == ALL,
      chatId: this.#target && this.#target != ALL ? this.#target : undefined,
    });
  }

  async #askRegion() {
    const context = this.#context;
    if (!context) {
      return;
    }
    const ask = lazy.ZendiaWebChatAsk;
    const target = this.#target;
    const what = await ask.regionOf(this.#window, context.browser);
    if (what) {
      await ask.pickAndAsk(this.#window, this.#dock, what, {
        all: target == ALL,
      });
    }
  }

  // A tab's menu.

  #onTabMenu(separator) {
    const window = this.#window;
    const contextTab = window.TabContextMenu?.contextTab;
    const tabs = contextTab?.multiselected
      ? window.gBrowser.selectedTabs
      : [contextTab].filter(Boolean);
    const wanted =
      Services.prefs.getBoolPref(PREF_MENU, true) &&
      !!this.#dock.chats.length &&
      !!tabs.length;
    this.#tabMenu.hidden = !wanted;
    separator.hidden = !wanted;
    if (!wanted) {
      return;
    }
    const chat = this.#dock.currentChat ?? this.#dock.chats[0];
    this.#tabMenu.setAttribute(
      "label",
      tabs.length > 1
        ? `Ask ${chat.name} About ${tabs.length} Tabs`
        : `Ask ${chat.name} About This Tab`
    );
    this.#tabMenu.setAttribute("image", lazy.webChatIcon(chat));
    const popup = this.#tabPopup;
    popup.replaceChildren();
    const kind = tabs.length > 1 ? "tabs" : "page";
    const gather = () =>
      kind == "tabs"
        ? lazy.ZendiaWebChatAsk.tabsOf(tabs)
        : lazy.ZendiaWebChatAsk.pageOf(tabs[0].linkedBrowser);
    const add = (prompt, label) => {
      const item = this.#item(label, async event => {
        const what = await gather();
        await lazy.ZendiaWebChatAsk.ask(window, this.#dock, what, prompt, {
          send: event.shiftKey ? false : undefined,
        });
      });
      if (prompt.key && /^[a-z0-9]$/i.test(prompt.key)) {
        item.setAttribute("accesskey", prompt.key);
      }
      popup.append(item);
    };
    for (const { prompt, label } of lazy.ZendiaWebChatAsk.offered(kind)) {
      add(prompt, label);
    }
    add(askPrompt(kind), "Ask…");
    if (this.#dock.chats.length > 1) {
      const first = lazy.ZendiaWebChatAsk.offered(kind)[0];
      if (first) {
        popup.append(window.document.createXULElement("menuseparator"));
        const every = this.#item(`${first.label}: Every Site`, async () => {
          const what = await gather();
          await lazy.ZendiaWebChatAsk.ask(
            window,
            this.#dock,
            what,
            first.prompt,
            {
              all: true,
            }
          );
        });
        popup.append(every);
      }
    }
  }
}
