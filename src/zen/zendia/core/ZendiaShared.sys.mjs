// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { ZendiaKeymap } from "resource:///modules/zendia/core/ZendiaKeymap.sys.mjs";

/**
 * The sharedData key the parent publishes the keymap under for content
 * processes.
 */
export const ZENDIA_SHARED_KEY = "zendia:config";

function cloneable(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? {}));
  } catch {
    return {};
  }
}

/**
 * Turn the parent's registries into plain data a content process can rebuild
 * them from. Function mappings stay in the parent.
 *
 * @param {object} options
 * @param {number} options.version
 * @param {number} options.timeoutlen
 * @param {ZendiaKeymap} options.keymap
 * @param {import("resource:///modules/zendia/core/ZendiaActions.sys.mjs").ZendiaActions} options.actions
 * @param {import("resource:///modules/zendia/core/ZendiaPlugins.sys.mjs").ZendiaPlugins} options.plugins
 * @returns {object}
 */
export function serializeConfig({
  version,
  timeoutlen,
  keymap,
  actions,
  plugins,
}) {
  const mappings = [];
  const groups = [];
  for (const mode of keymap.modes()) {
    for (const { lhs, rhs, desc } of keymap.list(mode)) {
      if (typeof rhs == "string") {
        mappings.push({ mode, lhs, rhs, desc: desc ?? null });
      }
    }
    for (const { lhs, name } of keymap.groups(mode)) {
      groups.push({ mode, lhs, name });
    }
  }
  const actionTable = {};
  for (const { id, where, module, params, owner } of actions.list()) {
    actionTable[id] = { where, module: module ?? null, params, owner };
  }
  const options = {};
  for (const plugin of plugins.list()) {
    if (plugin.loaded) {
      options[plugin.name] = cloneable(plugin.opts);
    }
  }
  return {
    version,
    leader: keymap.leader,
    timeoutlen,
    mappings,
    groups,
    actions: actionTable,
    options,
  };
}

/**
 * @param {object} config A value from serializeConfig().
 * @returns {ZendiaKeymap}
 */
export function buildKeymap(config) {
  const keymap = new ZendiaKeymap({ leader: config.leader });
  for (const { mode, lhs, rhs, desc } of config.mappings) {
    keymap.set(mode, lhs, rhs, { desc: desc ?? undefined });
  }
  for (const { mode, lhs, name } of config.groups) {
    keymap.group(mode, lhs, name);
  }
  return keymap;
}
