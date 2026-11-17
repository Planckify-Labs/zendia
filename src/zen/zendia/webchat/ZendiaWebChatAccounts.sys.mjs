// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The accounts of each chat site in the web chat panel. A site always has
// its first account, and the user can add more: each one is a container of
// its own (ZendiaWebChatCookies.sys.mjs), so ChatGPT can be signed in as
// two people at once, and none of them is the account the tabs have. The
// panel can also use the browser's own state for a site, whether it is
// signed in there or not: that is not an account, only a choice, and it is
// listed apart.
//
// What is kept, in zendia.webchat.accounts, is only what differs from the
// first account alone:
//
//   { "chatgpt": { "active": "a2", "accounts": [{ "id": "a2", "name": "Account 2" }] } }

/** The first account of every site, and the only one it starts with. */
export const MAIN = "main";
/** The choice to use the browser's state of the site. */
export const BROWSER = "browser";

const ID = /^a[0-9]{1,3}$/;
const MAX_ACCOUNTS = 12;
const MAX_NAME = 32;

/**
 * Read the pref's JSON. What is not valid is left out.
 *
 * @param {string} json
 * @returns {object} Each site's {active, accounts} the user changed.
 */
export function parseAccounts(json) {
  let data;
  try {
    data = JSON.parse(json || "{}");
  } catch {
    return {};
  }
  if (!data || typeof data != "object" || Array.isArray(data)) {
    return {};
  }
  const sites = {};
  for (const [chatId, entry] of Object.entries(data)) {
    if (!entry || typeof entry != "object") {
      continue;
    }
    const seen = new Set();
    const accounts = [];
    for (const account of Array.isArray(entry.accounts) ? entry.accounts : []) {
      if (
        account &&
        typeof account.id == "string" &&
        ID.test(account.id) &&
        !seen.has(account.id) &&
        accounts.length < MAX_ACCOUNTS - 1
      ) {
        seen.add(account.id);
        accounts.push({
          id: account.id,
          name:
            typeof account.name == "string" && account.name.trim()
              ? account.name.trim().slice(0, MAX_NAME)
              : `Account ${account.id.slice(1)}`,
        });
      }
    }
    const active =
      entry.active == BROWSER || seen.has(entry.active) ? entry.active : MAIN;
    sites[chatId] = { active, accounts };
  }
  return sites;
}

/**
 * @param {string} json The pref's JSON.
 * @param {string} chatId
 * @returns {{active: string, accounts: {id: string, name: string}[],
 *   multiple: boolean, label: string}} The site's accounts, the first one
 *   included, which one is in use, and whether the panel should offer a
 *   choice on the strip: more than one account, or the browser's state.
 *   `label` names what is in use.
 */
export function accountsOf(json, chatId) {
  const { active = MAIN, accounts = [] } = parseAccounts(json)[chatId] ?? {};
  const all = [{ id: MAIN, name: "Account 1" }, ...accounts];
  return {
    active,
    accounts: all,
    multiple: all.length > 1 || active == BROWSER,
    label:
      active == BROWSER
        ? "Browser"
        : (all.find(account => account.id == active)?.name ?? "Account 1"),
  };
}

function write(sites) {
  return JSON.stringify(sites);
}

/**
 * Add an account to a site and make it the one in use.
 *
 * @param {string} json
 * @param {string} chatId
 * @returns {{json: string, account: {id: string, name: string}}|null} Null
 *   once the site has all the accounts it may have.
 */
export function addAccount(json, chatId) {
  const sites = parseAccounts(json);
  const site = (sites[chatId] ??= { active: MAIN, accounts: [] });
  if (site.accounts.length >= MAX_ACCOUNTS - 1) {
    return null;
  }
  let number = 2;
  for (const { id } of site.accounts) {
    number = Math.max(number, Number(id.slice(1)) + 1);
  }
  const account = { id: `a${number}`, name: `Account ${number}` };
  site.accounts.push(account);
  site.active = account.id;
  return { json: write(sites), account };
}

/**
 * @param {string} json
 * @param {string} chatId
 * @param {string} key An account's id, MAIN, or BROWSER.
 * @returns {string} The JSON with that one in use; the same when there is no
 *   such account.
 */
export function selectAccount(json, chatId, key) {
  const sites = parseAccounts(json);
  const site = (sites[chatId] ??= { active: MAIN, accounts: [] });
  if (key != MAIN && key != BROWSER && !site.accounts.some(a => a.id == key)) {
    return json;
  }
  site.active = key;
  return write(sites);
}

/**
 * Take an account off a site. The first one stays.
 *
 * @param {string} json
 * @param {string} chatId
 * @param {string} id
 * @returns {string} The JSON, with the first account in use if the removed
 *   one was.
 */
export function removeAccount(json, chatId, id) {
  const sites = parseAccounts(json);
  const site = sites[chatId];
  if (!site || id == MAIN) {
    return json;
  }
  site.accounts = site.accounts.filter(account => account.id != id);
  if (site.active == id) {
    site.active = MAIN;
  }
  if (!site.accounts.length && site.active == MAIN) {
    delete sites[chatId];
  }
  return write(sites);
}

/**
 * @param {string} chatId
 * @param {string} accountId
 * @returns {string} The name of the account's hidden container. The first
 *   account of every site runs in the container the panel had before it had
 *   accounts, so what was signed in stays signed in.
 */
export function identityName(chatId, accountId) {
  return accountId == MAIN
    ? "zendia-webchat"
    : `zendia-webchat:${chatId}:${accountId}`;
}
