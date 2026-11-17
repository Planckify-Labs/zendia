// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The web chat panel (ChatGPT, Claude, Gemini, Kimi and the other chat
// sites) next to the agent under LazyVim's <leader>a "ai" group:
// <leader>aw toggles it, <leader>ac picks the site, and the accounts of
// the picked one are in a menu on its name. The panel is per
// window and is the user's own use of a web page, so none of it is for the
// agent's toolbox.

function dock({ zendia, window }) {
  return zendia.webChatDockFor(window);
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
  },
};
