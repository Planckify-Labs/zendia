// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The web chat panel (ChatGPT, Claude, Gemini, Kimi and the other chat
// sites) next to the agent under LazyVim's <leader>a "ai" group:
// <leader>aw toggles it, <leader>ac picks the site, and the accounts of
// the picked one are in a menu on its name. The panel is per
// window and is the user's own use of a web page, so none of it is for the
// agent's toolbox.
//
// Asking it about the page (ZendiaWebChatAsk), as the page's context menu
// does: in visual mode <leader>ae explains the selection, <leader>at
// translates it, <leader>ak picks any prompt; in normal mode <leader>ak asks
// about the page, <leader>ai about an image, <leader>ar about a part of the
// screen, and <leader>aR puts the reply to a field's text back in it.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ZendiaWebChatAsk:
    "resource:///modules/zendia/webchat/ZendiaWebChatAsk.sys.mjs",
});

function dock({ zendia, window }) {
  return zendia.webChatDockFor(window);
}

// Visual mode is done once its selection was asked about, as after y.
async function leaveVisual({ zendia, browser, runContent }) {
  if (zendia.stateFor(browser).mode != "v") {
    return;
  }
  try {
    await runContent({ id: "visual.exit" }, {});
  } catch {
    // The page went, or vim mode is off.
  }
}

// What the keys ask about: the selection, else the page.
async function selectionOrPage(context) {
  const ask = lazy.ZendiaWebChatAsk;
  return (
    (await ask.selectionOf(context.browser)) ??
    (await ask.pageOf(context.browser))
  );
}

function askWith(id, desc) {
  return {
    desc,
    agent: false,
    run: async context => {
      const chat = dock(context);
      if (!chat) {
        return;
      }
      const ask = lazy.ZendiaWebChatAsk;
      const what = await ask.selectionOf(context.browser);
      if (!what) {
        context.window.gZenUIManager?.showToast(
          "zendia-webchat-no-selection-toast"
        );
        return;
      }
      await leaveVisual(context);
      const prompt =
        ask.promptById(id, what.kind) ?? ask.promptById(id, "selection");
      if (prompt) {
        await ask.ask(context.window, chat, what, prompt);
      }
    },
  };
}

export const ZendiaWebChatSpec = {
  name: "webchat",
  actions: {
    "webchat.toggle": {
      desc: "Toggle Web Chat",
      agent: false,
      run: context => dock(context)?.toggle(),
    },
    "webchat.select": {
      desc: "Select Web Chat Site",
      agent: false,
      run: context => dock(context)?.pick(),
    },
    "webchat.accounts": {
      desc: "Switch Web Chat Account",
      agent: false,
      run: async context => {
        const chat = dock(context);
        await chat?.open();
        chat?.toggleAccounts();
      },
    },
    "webchat.newChat": {
      desc: "New Web Chat",
      agent: false,
      run: context => dock(context)?.newChat(),
    },
    "webchat.newChatAll": {
      desc: "New Chat on Every Web Chat Site",
      agent: false,
      run: context => dock(context)?.newChat({ all: true }),
    },
    "webchat.reload": {
      desc: "Reload Web Chat",
      agent: false,
      run: context => dock(context)?.reload(),
    },
    "webchat.sync": {
      desc: "Sync Browser Logins to Web Chat",
      agent: false,
      run: context => dock(context)?.syncLogins(),
    },
    "webchat.ask": {
      desc: "Ask Web Chat About the Selection or Page",
      agent: false,
      run: async context => {
        const chat = dock(context);
        if (!chat) {
          return;
        }
        const what = await selectionOrPage(context);
        await leaveVisual(context);
        await lazy.ZendiaWebChatAsk.pickAndAsk(context.window, chat, what);
      },
    },
    "webchat.explain": askWith("explain", "Explain the Selection"),
    "webchat.summarize": askWith("summarize", "Summarize the Selection"),
    "webchat.translate": askWith("translate", "Translate the Selection"),
    "webchat.define": askWith("define", "Define the Selection"),
    "webchat.factCheck": askWith("factcheck", "Fact-Check the Selection"),
    "webchat.askAbout": askWith("ask", "Ask About the Selection…"),
    "webchat.summarizePage": {
      desc: "Summarize the Page in Web Chat",
      agent: false,
      run: async context => {
        const chat = dock(context);
        const ask = lazy.ZendiaWebChatAsk;
        const prompt = ask.promptById("summarize-page", "page");
        if (chat && prompt) {
          await ask.ask(
            context.window,
            chat,
            await ask.pageOf(context.browser),
            prompt
          );
        }
      },
    },
    "webchat.askImage": {
      desc: "Ask Web Chat About an Image",
      agent: false,
      run: async context => {
        const chat = dock(context);
        const ask = lazy.ZendiaWebChatAsk;
        const what =
          chat && (await ask.pickImage(context.window, context.browser));
        if (what) {
          await ask.pickAndAsk(context.window, chat, what);
        } else if (chat) {
          context.window.gZenUIManager?.showToast(
            "zendia-webchat-no-image-toast"
          );
        }
      },
    },
    "webchat.askRegion": {
      desc: "Ask Web Chat About Part of the Screen",
      agent: false,
      run: async context => {
        const chat = dock(context);
        const ask = lazy.ZendiaWebChatAsk;
        const what =
          chat && (await ask.regionOf(context.window, context.browser));
        if (what) {
          await ask.pickAndAsk(context.window, chat, what);
        }
      },
    },
    "webchat.askTabs": {
      desc: "Ask Web Chat About the Selected Tabs",
      agent: false,
      run: async context => {
        const chat = dock(context);
        if (!chat) {
          return;
        }
        const ask = lazy.ZendiaWebChatAsk;
        const tabs = context.gBrowser.selectedTabs;
        const what =
          tabs.length > 1
            ? await ask.tabsOf(tabs)
            : await ask.pageOf(context.browser);
        await ask.pickAndAsk(context.window, chat, what);
      },
    },
    "webchat.putReply": {
      desc: "Put the Web Chat's Reply Back in the Field",
      agent: false,
      run: async context => {
        if (!(await dock(context)?.putReply())) {
          context.window.gZenUIManager?.showToast(
            "zendia-webchat-no-reply-toast"
          );
        }
      },
    },
  },
};
