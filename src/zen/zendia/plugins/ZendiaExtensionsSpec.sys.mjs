// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Every extension is reached the same way, whichever it is: <leader>x lists
// the installed ones, and the one picked opens its popup, whose controls get
// jump labels (ZendiaPopupChild) as the sidebar's rows do for <leader>bj.
// A popup opened with the mouse has none until `s` asks for them.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  ZendiaPopupKeys:
    "resource:///modules/zendia/actors/ZendiaPopupParent.sys.mjs",
  ZendiaPicker: "resource:///modules/zendia/ui/ZendiaPicker.sys.mjs",
});

/**
 * The running extensions the user installed that have a popup.
 *
 * @returns {Promise<{addon: object, extension: object}[]>}
 */
async function installed() {
  const { addons } = await lazy.AddonManager.getActiveAddons(["extension"]);
  return addons
    .filter(addon => !addon.isSystem && !addon.hidden)
    .flatMap(addon => {
      const extension = WebExtensionPolicy.getByID(addon.id)?.extension;
      const { manifest } = extension ?? {};
      return manifest?.browser_action || manifest?.action
        ? [{ addon, extension }]
        : [];
    })
    .sort((a, b) => a.addon.name.localeCompare(b.addon.name));
}

async function pick(window) {
  const list = await installed();
  if (!list.length) {
    window.gZenUIManager.showToast("zendia-extensions-none-toast");
    return;
  }
  const index = await lazy.ZendiaPicker.open(window, {
    title: "Extensions",
    items: list.map(({ addon }) => ({
      label: addon.name,
      icon: addon.iconURL || undefined,
    })),
  });
  if (index !== null) {
    lazy.ZendiaPopupKeys.trigger(window, list[index].extension);
  }
}

export const ZendiaExtensionsSpec = {
  name: "extensions",
  actions: {
    "extensions.pick": {
      desc: "Extensions",
      agent: false,
      run: ({ window }) => pick(window),
    },
  },
};
