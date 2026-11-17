// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The chat sites the web chat panel (ui/ZendiaWebChatDock) shows. A site is
// the page itself, not an API: the user signs in as they would in a tab. The
// built-in ones come first, then the user's own from zendia.webchat.custom:
//
//   [
//     { "id": "mistral", "name": "Le Chat", "url": "https://chat.mistral.ai/" },
//     { "id": "grok", "hidden": true }
//   ]
//
// An entry with the id of a built-in site replaces its fields, `hidden` takes
// it off the panel. `hosts` are the sites whose own cookies stay in the
// panel's container (ZendiaWebChatCookies.sys.mjs); they default to the
// address's host.

const PREF_CUSTOM = "zendia.webchat.custom";

/**
 * @typedef {object} ZendiaWebChat
 * @property {string} id A short name for pickers and prefs.
 * @property {string} name What the strip and the picker call it.
 * @property {string} url Where the panel opens it, https.
 * @property {string[]} hosts The hosts that are the chat site itself: their
 *   cookies, and their subdomains', are the panel's own.
 * @property {string} [color] #rrggbb.
 * @property {boolean} [custom] Added by the user.
 */

// The order is the order of the panel's strip.
export const ZENDIA_WEBCHATS = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    hosts: ["chatgpt.com", "openai.com"],
    color: "#10a37f",
  },
  {
    id: "claude",
    name: "Claude",
    url: "https://claude.ai/new",
    hosts: ["claude.ai", "anthropic.com"],
    color: "#d97757",
  },
  {
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com/app",
    // Only Gemini's own host: Google's sign-in is on google.com, whose
    // cookies the panel takes from the browser like any other site's.
    hosts: ["gemini.google.com"],
    color: "#4285f4",
  },
  {
    id: "kimi",
    name: "Kimi",
    url: "https://www.kimi.com/",
    hosts: ["kimi.com", "moonshot.cn"],
    color: "#1783ff",
  },
  {
    id: "grok",
    name: "Grok",
    url: "https://grok.com/",
    hosts: ["grok.com", "x.ai"],
    color: "#a3a3a3",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    url: "https://chat.deepseek.com/",
    hosts: ["deepseek.com"],
    color: "#4d6bfe",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    url: "https://www.perplexity.ai/",
    hosts: ["perplexity.ai"],
    color: "#20b8cd",
  },
  {
    id: "copilot",
    name: "Copilot",
    url: "https://copilot.microsoft.com/",
    hosts: ["copilot.microsoft.com"],
    color: "#7f5af0",
  },
];

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_NAME = 40;
const MAX_CUSTOM = 24;

/**
 * @param {string} host A cookie's host, with or without its leading dot.
 * @param {string} site A chat site's host.
 * @returns {boolean} Whether the host is the site or one of its subdomains.
 */
export function hostIsSite(host, site) {
  const bare = String(host).replace(/^\./, "").toLowerCase();
  return bare == site || bare.endsWith(`.${site}`);
}

/**
 * @param {string} host
 * @param {string[]} sites
 * @returns {boolean} Whether the host belongs to any of the sites.
 */
export function hostIsAnySite(host, sites) {
  return sites.some(site => hostIsSite(host, site));
}

/**
 * Check a chat address.
 *
 * @param {*} value
 * @returns {URL|null} The address when it is an https one with a host.
 */
export function parseChatUrl(value) {
  if (typeof value != "string") {
    return null;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol == "https:" && url.hostname ? url : null;
  } catch {
    return null;
  }
}

/**
 * An id for an address typed by the user: its host, without www.
 *
 * @param {URL} url
 * @param {Set<string>} taken
 * @returns {string}
 */
export function idForUrl(url, taken = new Set()) {
  const base =
    url.hostname
      .replace(/^www\./, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "chat";
  let id = base;
  for (let n = 2; taken.has(id); n++) {
    id = `${base}-${n}`;
  }
  return id;
}

/**
 * A name for an address typed by the user, from its host.
 *
 * @param {URL} url
 * @returns {string}
 */
export function nameForUrl(url) {
  const [first] = url.hostname.replace(/^(www|chat|app)\./, "").split(".");
  return (first.charAt(0).toUpperCase() + first.slice(1)).slice(0, MAX_NAME);
}

/**
 * Read the user's entries from their pref's JSON. Entries that are not
 * valid are left out, one bad entry never takes the others down.
 *
 * @param {string} json
 * @returns {object[]} Each {id, name?, url?, hosts?, color?, hidden?}.
 */
export function parseCustom(json) {
  let list;
  try {
    list = JSON.parse(json || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set();
  const entries = [];
  for (const entry of list.slice(0, MAX_CUSTOM)) {
    if (
      !entry ||
      typeof entry != "object" ||
      !ID.test(entry.id ?? "") ||
      seen.has(entry.id)
    ) {
      continue;
    }
    seen.add(entry.id);
    const clean = { id: entry.id };
    if (entry.hidden === true) {
      clean.hidden = true;
    }
    if (typeof entry.name == "string" && entry.name.trim()) {
      clean.name = entry.name.trim().slice(0, MAX_NAME);
    }
    if (entry.url !== undefined) {
      const url = parseChatUrl(entry.url);
      if (!url) {
        continue;
      }
      clean.url = url.href;
    }
    if (Array.isArray(entry.hosts)) {
      const hosts = entry.hosts
        .filter(host => typeof host == "string")
        .map(host => host.trim().toLowerCase().replace(/^\./, ""))
        .filter(host => /^[a-z0-9.-]+$/.test(host));
      if (hosts.length) {
        clean.hosts = hosts.slice(0, 8);
      }
    }
    if (HEX.test(entry.color ?? "")) {
      clean.color = entry.color;
    }
    entries.push(clean);
  }
  return entries;
}

/**
 * The sites for the panel: the built-in ones, changed by the user's entries,
 * then the ones the user added.
 *
 * @param {string} [json] The user's entries; the pref's by default.
 * @returns {ZendiaWebChat[]}
 */
export function webChats(json = Services.prefs.getStringPref(PREF_CUSTOM, "")) {
  const entries = parseCustom(json);
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const chats = [];
  for (const base of ZENDIA_WEBCHATS) {
    const entry = byId.get(base.id);
    byId.delete(base.id);
    if (entry?.hidden) {
      continue;
    }
    const merged = { ...base, ...(entry ?? {}) };
    delete merged.hidden;
    // A new address without hosts is on its own host.
    if (entry?.url && !entry.hosts) {
      merged.hosts = [new URL(entry.url).hostname.replace(/^www\./, "")];
    }
    chats.push(merged);
  }
  for (const entry of byId.values()) {
    if (entry.hidden || !entry.url) {
      continue;
    }
    const url = new URL(entry.url);
    chats.push({
      id: entry.id,
      name: entry.name ?? nameForUrl(url),
      url: entry.url,
      hosts: entry.hosts ?? [url.hostname.replace(/^www\./, "")],
      color: entry.color,
      custom: true,
    });
  }
  return chats;
}

/**
 * The user's entries with one more site, as the pref's JSON.
 *
 * @param {string} json The pref's current value.
 * @param {string} address What the user typed.
 * @returns {{json: string, chat: ZendiaWebChat}|null} Null for an address
 *   that is not an https one, or when there are too many sites already.
 */
export function withCustomSite(json, address) {
  const url = parseChatUrl(
    address.includes("://") ? address : `https://${address}`
  );
  const entries = parseCustom(json);
  if (!url || entries.length >= MAX_CUSTOM) {
    return null;
  }
  const taken = new Set([
    ...ZENDIA_WEBCHATS.map(chat => chat.id),
    ...entries.map(entry => entry.id),
  ]);
  const entry = {
    id: idForUrl(url, taken),
    name: nameForUrl(url),
    url: url.href,
  };
  return {
    json: JSON.stringify([...entries, entry]),
    chat: {
      ...entry,
      hosts: [url.hostname.replace(/^www\./, "")],
      custom: true,
    },
  };
}

/**
 * The user's entries without one site, as the pref's JSON.
 *
 * @param {string} json
 * @param {string} id
 * @returns {string}
 */
export function withoutCustomSite(json, id) {
  return JSON.stringify(parseCustom(json).filter(entry => entry.id != id));
}

/**
 * @param {ZendiaWebChat[]} chats
 * @returns {string[]} Every host that is a chat site itself.
 */
export function chatHosts(chats) {
  return [...new Set(chats.flatMap(chat => chat.hosts))];
}
