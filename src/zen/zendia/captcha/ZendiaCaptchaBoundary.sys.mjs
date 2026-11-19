// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The boundary between a page's task and the subagent that works it. The
// agent holds a handle, not the page: it opens a task, hands the handle and
// a sterile payload to the subagent, and the page, the service and the
// record stay in the vault. What comes back is a resolution, never the
// task.
//
// The boundary is the only thing the subagent-facing code needs to know
// about, so the agent's own words, its keys and its pictures are the ones
// that reach the model.

import { getChallengeVault } from "resource:///modules/zendia/captcha/ZendiaChallengeVault.sys.mjs";
import { capabilityOfRecord } from "resource:///modules/zendia/captcha/ZendiaChallengeAdapters.sys.mjs";
import { sterileTask } from "resource:///modules/zendia/captcha/ZendiaSterileChallenge.sys.mjs";

export class ZendiaCaptchaBoundaryService {
  #vault;

  /**
   * @param {ZendiaChallengeVault} [vault]
   */
  constructor(vault = null) {
    this.#vault = vault ?? getChallengeVault();
  }

  /**
   * Open a task: its provenance goes into the vault, and the handle that
   * names it is what the caller keeps.
   *
   * @param {object} options
   * @param {Element} options.browser The tab the task is on.
   * @param {object} options.record What the watch found, page and all.
   * @param {object} options.shot The task as it was photographed.
   * @param {string} [options.capability] Its capability, or the record's.
   * @returns {string} The handle.
   */
  open({ browser, record, shot, capability = null }) {
    return this.#vault.open({
      browser,
      record,
      shot,
      capability: capability ?? capabilityOfRecord(record),
    });
  }

  /**
   * The sterile task a handle names: the one thing the subagent is ever
   * given. Null when the handle is unknown, expired or spent — and a null
   * is the end of the work, never a reason to hand over the page instead.
   *
   * @param {string} handle
   * @param {object} [options]
   * @param {string[]} [options.serviceNames] The names to take out of the
   *   task's own words, from ZendiaCaptcha.
   * @param {boolean} [options.sees] Whether the model can see pictures.
   * @returns {object|null} The sterile task.
   */
  task(handle, { serviceNames = [], sees = true } = {}) {
    const entry = this.#vault.peek(handle);
    if (!entry) {
      return null;
    }
    return sterileTask({
      id: entry.handle,
      record: entry.record,
      shot: entry.shot,
      capability: entry.capability,
      ttlSeconds: this.#vault.ttlSeconds,
      serviceNames,
      sees,
    });
  }

  /**
   * The entry a handle names, without spending it: the browser to act on and
   * the capability, for the code that works the task. Null when the handle
   * is unknown, expired or used.
   *
   * @param {string} handle
   * @returns {object|null}
   */
  entry(handle) {
    return this.#vault.peek(handle);
  }

  /**
   * Record how a task ended and spend the handle.
   *
   * @param {string} handle
   * @param {string} status "ok", "fail" or "escalate".
   * @returns {{handle: string, status: string, at: number}|null}
   */
  resolve(handle, status) {
    return this.#vault.resolve(handle, { status });
  }

  /**
   * Drop a task before its TTL.
   *
   * @param {string} handle
   */
  close(handle) {
    this.#vault.close(handle);
  }

  /**
   * Drop the expired tasks.
   *
   * @returns {number} How many were dropped.
   */
  sweep() {
    return this.#vault.sweep();
  }
}

let boundaryInstance = null;

/**
 * The process's boundary.
 *
 * @returns {ZendiaCaptchaBoundaryService}
 */
export function getCaptchaBoundary() {
  boundaryInstance ??= new ZendiaCaptchaBoundaryService();
  return boundaryInstance;
}

/**
 * Reset the singleton, for tests.
 */
export function resetCaptchaBoundary() {
  boundaryInstance = null;
}
