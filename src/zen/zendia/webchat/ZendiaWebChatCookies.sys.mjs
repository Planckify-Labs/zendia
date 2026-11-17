// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// What keeps the web chat panel's accounts apart from the tabs' while it
// still signs in like the rest of the browser.
//
// Each account of a chat site (ZendiaWebChatAccounts.sys.mjs) has a container
// of its own, so the cookies of claude.ai or chatgpt.com in an account are not
// the ones in a tab, nor in another account: the panel can be as many people
// as it has accounts. Every other site's cookies are the browser's, copied
// into each container and kept in step, so "Sign in with Google" offers the
// Google accounts the browser has, and a login a site offers instead works as
// in any tab.
//
// The copy is one way, from the tabs' container to the accounts', and live:
// a cookie set, changed or deleted there (a login, a logout) is set, changed
// or deleted in the accounts' containers a moment later. Once an account
// changes a cookie of a site itself, though, the site is that account's:
// none of its cookies are copied or taken out any more. A login is many
// cookies that belong together, and some of them change on their own (Google
// renews three of them every few minutes): the account's own renewed ones
// with the browser's other ones would be two logins mixed, which the site
// refuses. So a different Google account picked in the panel stays picked, a
// logout in the panel stays a logout, and the browser's logins are copied
// again, whole, by "Refresh logins".
//
// Cookies are all that is copied: a site that keeps its login only in
// localStorage or IndexedDB asks to sign in again, once.

import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { hostIsAnySite } from "resource:///modules/zendia/webchat/ZendiaWebChats.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ContextualIdentityService:
    "moz-src:///toolkit/components/contextualidentity/ContextualIdentityService.sys.mjs",
  DeferredTask: "resource://gre/modules/DeferredTask.sys.mjs",
});

// The one mirror, once an account is in use.
let gMirror = null;

// The sites an account changed cookies of itself, so they stay as it left
// them. The file's version is 2: version 1 kept single cookies, which could
// leave a site's login mixed, and is dropped, so the logins are copied again.
const OWNED_VERSION = 2;
const OWNED_FILE = ["zendia", "webchat", "owned-cookies.json"];
const MAX_OWNED = 20000;
const SAVE_DELAY_MS = 1000;
// A batch of changes in the tabs' container is written together.
const FLUSH_DELAY_MS = 40;
// Cookies written before the main thread gets a break.
const YIELD_EVERY = 200;
// What a session cookie's expiry is set to: the cookie is a session one
// whatever it says, and the number must stay a whole one for a 64-bit
// argument.
const FAR_FUTURE = Number.MAX_SAFE_INTEGER;

/**
 * @param {string} name An account's container name
 *   (ZendiaWebChatAccounts.sys.mjs).
 * @returns {number} The hidden container, made the first time and kept in
 *   the profile.
 */
export function webChatContainerId(name) {
  const service = lazy.ContextualIdentityService;
  const existing = service.getPrivateIdentity(name);
  return existing?.userContextId ?? service.createForPolicy(name).userContextId;
}

/**
 * Forget what an account that was taken off had: its cookies and the rest of
 * what its pages stored.
 *
 * @param {string} name
 * @returns {Promise<void>}
 */
export async function clearWebChatContainer(name) {
  const existing = lazy.ContextualIdentityService.getPrivateIdentity(name);
  if (!existing) {
    return;
  }
  gMirror?.removeTarget(existing.userContextId);
  await Services.clearData.deleteDataFromOriginAttributesPattern({
    userContextId: existing.userContextId,
  });
}

/**
 * @param {string} host A cookie's host, with or without its leading dot.
 * @returns {string} The site it is a part of: its registrable domain.
 */
export function siteOf(host) {
  const bare = String(host).replace(/^\./, "").toLowerCase();
  try {
    return Services.eTLD.getBaseDomainFromHost(bare);
  } catch {
    // An address, or a name without a public suffix.
    return bare;
  }
}

/**
 * @param {object} cookie An nsICookie.
 * @returns {string} What names the cookie in either container.
 */
export function cookieKey(cookie) {
  const { partitionKey = "", firstPartyDomain = "" } =
    cookie.originAttributes ?? {};
  return [
    cookie.host,
    cookie.path,
    cookie.name,
    partitionKey,
    firstPartyDomain,
  ].join("\u0000");
}

/**
 * @param {string} partitionKey An origin attribute like "(https,claude.ai)".
 * @returns {string} The top-level site it is for, or "".
 */
export function partitionSite(partitionKey) {
  const match = /^\(([^,)]*),([^,)]*)/.exec(partitionKey ?? "");
  return match ? match[2] : "";
}

/**
 * @param {object} cookie An nsICookie, or the same fields.
 * @param {string[]} hosts The chat sites' hosts.
 * @returns {boolean} Whether the cookie is a chat site's own: set by it, or
 *   for one of its subdomains, or kept for a third party in a page of it.
 */
export function isChatCookie(cookie, hosts) {
  if (hostIsAnySite(cookie.host, hosts)) {
    return true;
  }
  const site = partitionSite(cookie.originAttributes?.partitionKey);
  return !!site && hostIsAnySite(site, hosts);
}

function sameCookie(a, b) {
  return (
    a.value == b.value &&
    a.expiry == b.expiry &&
    a.isSession == b.isSession &&
    a.isSecure == b.isSecure &&
    a.isHttpOnly == b.isHttpOnly &&
    a.sameSite == b.sameSite
  );
}

function idle() {
  return new Promise(resolve =>
    Services.tm.idleDispatchToMainThread(resolve, 500)
  );
}

/**
 * Keeps the cookies of the tabs' container in the panel's, but the chat
 * sites' own.
 */
export class ZendiaCookieMirror {
  #targets = new Set();
  #source;
  #hosts;
  #cookies;
  #storePath;
  #yieldEvery;
  #flushDelay;
  #owned = new Set();
  #pending = new Map();
  #timer = null;
  #writing = false;
  #running = false;
  #reconciling = null;
  #again = false;
  #task = null;
  #loaded = null;

  /**
   * @param {object} options
   * @param {number[]} options.targets The accounts' containers.
   * @param {number} [options.source] The container to copy from.
   * @param {() => string[]} options.hosts The chat sites' hosts, as they are
   *   now.
   * @param {string|null} [options.storePath] Where the cookies the panel
   *   changed are kept; the profile's by default, null for nowhere.
   * @param {object} [options.cookies] The cookie manager.
   * @param {number} [options.yieldEvery] Writes before a break.
   * @param {number} [options.flushDelay] How long changes are held to be
   *   written together.
   */
  constructor({
    targets,
    source = 0,
    hosts,
    storePath = PathUtils.join(PathUtils.profileDir, ...OWNED_FILE),
    cookies = Services.cookies,
    yieldEvery = YIELD_EVERY,
    flushDelay = FLUSH_DELAY_MS,
  }) {
    this.#targets = new Set(targets);
    this.#source = source;
    this.#hosts = hosts;
    this.#storePath = storePath;
    this.#cookies = cookies;
    this.#yieldEvery = yieldEvery;
    this.#flushDelay = flushDelay;
  }

  get targets() {
    return [...this.#targets];
  }

  get source() {
    return this.#source;
  }

  get running() {
    return this.#running;
  }

  /**
   * @param {string} host A cookie's host.
   * @param {number} target An account's container.
   * @returns {boolean} Whether the account changed cookies of the host's
   *   site itself.
   */
  isOwned(host, target) {
    return this.#owned.has(this.#ownKey(target, host));
  }

  #ownKey(target, host) {
    return `${target}\u0001${siteOf(host)}`;
  }

  /**
   * Keep another account's container in step too.
   *
   * @param {number} target
   */
  addTarget(target) {
    if (this.#targets.has(target) || target == this.#source) {
      return;
    }
    this.#targets.add(target);
    if (this.#running) {
      this.#reconcile();
    }
  }

  /**
   * Stop keeping an account's container in step, and forget what it changed.
   *
   * @param {number} target
   */
  removeTarget(target) {
    if (!this.#targets.delete(target)) {
      return;
    }
    const prefix = `${target}\u0001`;
    for (const key of [...this.#owned]) {
      if (key.startsWith(prefix)) {
        this.#owned.delete(key);
      }
    }
    this.#save();
  }

  /**
   * Start keeping the containers in step: the first copy runs in the
   * background, in idle time.
   *
   * @returns {Promise<void>} Once the panel's own cookies are read; use
   *   settled() for the copy.
   */
  async start() {
    if (this.#running) {
      return;
    }
    this.#running = true;
    Services.obs.addObserver(this, "cookie-changed");
    this.#loaded = this.#load();
    await this.#loaded;
    if (this.#running) {
      this.#reconcile();
    }
  }

  stop() {
    if (!this.#running) {
      return;
    }
    this.#running = false;
    Services.obs.removeObserver(this, "cookie-changed");
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#pending.clear();
    this.#task?.finalize();
    this.#task = null;
  }

  /**
   * @returns {Promise<void>} Once the copy that is running has finished.
   */
  async settled() {
    await this.#loaded;
    while (this.#reconciling) {
      await this.#reconciling;
    }
    // The held changes too.
    this.#flush();
  }

  /**
   * Copy from another container: the one the tab in front is in.
   *
   * @param {number} source
   */
  setSource(source) {
    if (this.#targets.has(source) || source == this.#source) {
      return;
    }
    this.#source = source;
    if (this.#running) {
      this.#reconcile();
    }
  }

  /**
   * Make the accounts' containers the tabs' again, whatever they changed:
   * their logins and logouts of other sites give way to the browser's.
   *
   * @returns {Promise<void>}
   */
  async resync() {
    await this.#loaded;
    this.#owned.clear();
    this.#save();
    await this.#reconcile();
  }

  /**
   * Run the copy again, after the chat sites changed.
   *
   * @returns {Promise<void>}
   */
  refresh() {
    return this.#reconcile();
  }

  observe(subject, topic) {
    if (topic != "cookie-changed" || this.#writing) {
      return;
    }
    let notification;
    try {
      notification = subject.QueryInterface(Ci.nsICookieNotification);
    } catch {
      return;
    }
    switch (notification.action) {
      case Ci.nsICookieNotification.COOKIE_ADDED:
      case Ci.nsICookieNotification.COOKIE_CHANGED:
      case Ci.nsICookieNotification.COOKIE_DELETED:
        this.#onCookie(notification.action, notification.cookie);
        break;
      case Ci.nsICookieNotification.ALL_COOKIES_CLEARED:
        // Cleared in every container: nothing is an account's own any more.
        this.#owned.clear();
        this.#save();
        break;
      default:
        // Expired cookies are purged from both containers alike.
        break;
    }
  }

  #onCookie(action, cookie) {
    const attributes = cookie.originAttributes;
    if (attributes.privateBrowsingId || isChatCookie(cookie, this.#hosts())) {
      return;
    }
    const key = cookieKey(cookie);
    if (this.#targets.has(attributes.userContextId)) {
      // Not ours: a site of the account set it, or took it away.
      this.#own(this.#ownKey(attributes.userContextId, cookie.host));
    } else if (attributes.userContextId == this.#source) {
      this.#pending.set(key, { action, cookie });
      this.#timer ??= setTimeout(() => this.#flush(), this.#flushDelay);
    }
  }

  // The last thing that happened to each cookie is what is written.
  #flush() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    const pending = [...this.#pending];
    this.#pending.clear();
    for (const { action, cookie } of pending.map(([, change]) => change)) {
      for (const target of this.#targets) {
        if (this.#owned.has(this.#ownKey(target, cookie.host))) {
          continue;
        }
        if (action == Ci.nsICookieNotification.COOKIE_DELETED) {
          this.#remove(cookie, target);
        } else {
          this.#copy(cookie, target);
        }
      }
    }
  }

  #own(key) {
    if (this.#owned.has(key)) {
      return;
    }
    this.#owned.add(key);
    if (this.#owned.size > MAX_OWNED) {
      this.#owned.delete(this.#owned.values().next().value);
    }
    this.#save();
  }

  // What the writes below do is an account's container changing: not the
  // account's own doing.
  #write(change) {
    this.#writing = true;
    try {
      change();
    } catch (e) {
      // A cookie the cookie manager refuses (a malformed one) is left out.
      console.warn("Zendia: a cookie was not copied", e);
    } finally {
      this.#writing = false;
    }
  }

  #copy(cookie, target) {
    this.#write(() =>
      this.#cookies.add(
        cookie.host,
        cookie.path,
        cookie.name,
        cookie.value,
        cookie.isSecure,
        cookie.isHttpOnly,
        cookie.isSession,
        cookie.isSession ? FAR_FUTURE : cookie.expiry,
        { ...cookie.originAttributes, userContextId: target },
        cookie.sameSite,
        cookie.schemeMap,
        cookie.isPartitioned
      )
    );
  }

  #remove(cookie, target) {
    this.#write(() =>
      this.#cookies.remove(cookie.host, cookie.name, cookie.path, {
        ...cookie.originAttributes,
        userContextId: target,
      })
    );
  }

  // Make the accounts' containers what the tabs' is, but for the chat sites'
  // cookies and the accounts' own. Runs once at a time, again if asked while
  // running.
  #reconcile() {
    if (this.#reconciling) {
      this.#again = true;
      return this.#reconciling;
    }
    this.#reconciling = this.#runReconcile().finally(() => {
      this.#reconciling = null;
      if (this.#again && this.#running) {
        this.#again = false;
        this.#reconcile();
      }
    });
    return this.#reconciling;
  }

  async #runReconcile() {
    await this.#loaded;
    const hosts = this.#hosts();
    const wanted = new Map();
    const present = new Map(
      [...this.#targets].map(target => [target, new Map()])
    );
    for (const cookie of this.#cookies.cookies) {
      const attributes = cookie.originAttributes;
      if (attributes.privateBrowsingId || isChatCookie(cookie, hosts)) {
        continue;
      }
      if (present.has(attributes.userContextId)) {
        present.get(attributes.userContextId).set(cookieKey(cookie), cookie);
      } else if (attributes.userContextId == this.#source) {
        wanted.set(cookieKey(cookie), cookie);
      }
    }
    let written = 0;
    const breather = async () => {
      if (++written % this.#yieldEvery == 0) {
        await idle();
      }
      return this.#running;
    };
    for (const [target, existing] of present) {
      for (const [key, cookie] of wanted) {
        if (this.#owned.has(this.#ownKey(target, cookie.host))) {
          continue;
        }
        const there = existing.get(key);
        if (!there || !sameCookie(there, cookie)) {
          this.#copy(cookie, target);
          if (!(await breather())) {
            return;
          }
        }
      }
      for (const [key, cookie] of existing) {
        if (
          wanted.has(key) ||
          this.#owned.has(this.#ownKey(target, cookie.host))
        ) {
          continue;
        }
        // Gone from the tabs' container, as a logout there takes it.
        this.#remove(cookie, target);
        if (!(await breather())) {
          return;
        }
      }
    }
  }

  async #load() {
    if (!this.#storePath) {
      return;
    }
    try {
      const { version, owned } = await IOUtils.readJSON(this.#storePath);
      if (version != OWNED_VERSION) {
        return;
      }
      for (const key of Array.isArray(owned) ? owned : []) {
        if (typeof key == "string") {
          this.#owned.add(key);
        }
      }
    } catch {
      // Nothing kept yet.
    }
  }

  #save() {
    if (!this.#storePath || !this.#running) {
      return;
    }
    this.#task ??= new lazy.DeferredTask(async () => {
      await IOUtils.makeDirectory(PathUtils.parent(this.#storePath), {
        ignoreExisting: true,
      });
      await IOUtils.writeJSON(this.#storePath, {
        version: OWNED_VERSION,
        owned: [...this.#owned],
      });
    }, SAVE_DELAY_MS);
    this.#task.arm();
  }

  /**
   * @returns {Promise<void>} Once the panel's own cookies are on disk.
   */
  async flushStore() {
    await this.#task?.finalize();
    this.#task = null;
  }
}

/**
 * Keep an account's container in step with the tabs'.
 *
 * @param {object} options
 * @param {number} options.container The account's container.
 * @param {number} options.source The container of the tab in front.
 * @param {() => string[]} options.hosts The chat sites' hosts.
 * @returns {Promise<void>}
 */
export async function useWebChatContainer({ container, source, hosts }) {
  if (!gMirror) {
    gMirror = new ZendiaCookieMirror({ targets: [container], source, hosts });
    await gMirror.start();
  } else {
    gMirror.setSource(source);
    gMirror.addTarget(container);
  }
}

/**
 * @returns {ZendiaCookieMirror|null} The mirror, once an account is in use.
 */
export function webChatMirror() {
  return gMirror;
}
