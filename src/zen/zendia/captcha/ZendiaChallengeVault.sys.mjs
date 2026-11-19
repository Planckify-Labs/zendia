// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The vault a challenge's provenance lives in, and the only place it lives.
// The subagent is handed a handle and a sterile task; the page, the service,
// the record and the shot stay here, in memory, under that handle. Nothing
// of the entry is logged, and an entry is used once and expires on its own.
//
// This module is pure: it imports nothing, so it can be tested alone.

// How long a handle is good for: long enough for a solve turn and its
// retries, short enough that a forgotten one does not linger.
const DEFAULT_TTL_MS = 120000;

/**
 * A handle that names an entry and nothing else: random, so it cannot be
 * read as a page, a service or a time.
 *
 * @returns {string}
 */
export function challengeHandle() {
  const source = globalThis.crypto;
  if (source?.randomUUID) {
    return source.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (source?.getRandomValues) {
    source.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The entries, keyed by handle. Each is the whole provenance of one task:
 * what page it was on, what the watch said, and the shot the subagent works.
 * The entry is plain on purpose (it never leaves the process), but nothing
 * outside this class can reach one without the handle.
 */
export class ZendiaChallengeVault {
  #entries = new Map();
  #ttlMs;

  /**
   * @param {object} [options]
   * @param {number} [options.ttlMs] How long a handle is good for.
   */
  constructor({ ttlMs = DEFAULT_TTL_MS } = {}) {
    this.#ttlMs = ttlMs;
  }

  /**
   * Put a task in the vault and return the handle that opens it.
   *
   * @param {object} entry
   * @param {Element} entry.browser The tab the task is on.
   * @param {object} entry.record What the watch found, page and all.
   * @param {object} entry.shot The challenge as it was photographed.
   * @param {string} entry.capability The task's capability.
   * @returns {string} The handle.
   */
  open({ browser, record, shot, capability }) {
    this.sweep();
    const handle = challengeHandle();
    const now = Date.now();
    this.#entries.set(handle, {
      handle,
      browser,
      record,
      shot,
      capability,
      openedAt: now,
      expiresAt: now + this.#ttlMs,
      used: false,
      resolution: null,
    });
    return handle;
  }

  /**
   * The entry a handle names, without consuming it. Null when the handle is
   * unknown, expired, or already used.
   *
   * @param {string} handle
   * @returns {object|null}
   */
  peek(handle) {
    const entry = this.#entries.get(handle);
    if (!entry || entry.used || Date.now() > entry.expiresAt) {
      return null;
    }
    return entry;
  }

  /**
   * The entry a handle names, once. The handle is spent: a second call, or
   * one after the TTL, gives null. This is the one-way door the boundary
   * walks through.
   *
   * @param {string} handle
   * @returns {object|null}
   */
  take(handle) {
    const entry = this.peek(handle);
    if (!entry) {
      return null;
    }
    entry.used = true;
    return entry;
  }

  /**
   * Record how a task ended, and spend the handle. The resolution is the
   * only thing that leaves the vault: a status, never the task. There is no
   * proof to carry back — the subagent works the page itself, so what a
   * passed check leaves behind is the service's own token, already in the
   * page's form.
   *
   * @param {string} handle
   * @param {{status: string, at?: number}} resolution "ok", "fail" or
   *   "escalate", and when it ended.
   * @returns {{handle: string, status: string, at: number}|null}
   */
  resolve(handle, resolution) {
    const entry = this.take(handle);
    if (!entry) {
      return null;
    }
    const done = {
      handle,
      status: resolution?.status ?? "fail",
      at: resolution?.at ?? Date.now(),
    };
    entry.resolution = done;
    return done;
  }

  /**
   * Drop an entry before its TTL: the work is over, or the tab went away.
   *
   * @param {string} handle
   */
  close(handle) {
    this.#entries.delete(handle);
  }

  /**
   * Drop the entries whose TTL has passed. Called on every open and read, so
   * no timer of this module's own is needed.
   *
   * @returns {number} How many were dropped.
   */
  sweep() {
    const now = Date.now();
    let dropped = 0;
    for (const [handle, entry] of this.#entries) {
      if (now > entry.expiresAt) {
        this.#entries.delete(handle);
        dropped++;
      }
    }
    return dropped;
  }

  /**
   * @returns {number} How long a handle is good for, in seconds.
   */
  get ttlSeconds() {
    return Math.round(this.#ttlMs / 1000);
  }

  /**
   * @returns {number} The live entries.
   */
  get size() {
    this.sweep();
    return this.#entries.size;
  }
}

let vaultInstance = null;

/**
 * The process's vault.
 *
 * @returns {ZendiaChallengeVault}
 */
export function getChallengeVault() {
  vaultInstance ??= new ZendiaChallengeVault();
  return vaultInstance;
}

/**
 * Reset the singleton, for tests.
 */
export function resetChallengeVault() {
  vaultInstance = null;
}
