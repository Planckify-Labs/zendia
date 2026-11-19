// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The kinds of task a challenge can be, and the one kind of work the
// subagent is ever told about. A CAPTCHA's own vocabulary (its service, its
// kind names, "challenge", "verification") never leaves this module: what
// leaves is a capability, a neutral wording of the same ask, and nothing
// that says where the ask came from.
//
// This module is pure: it imports nothing, so it can be tested alone.

// The capabilities, in the order a record prefers them: a record may hold
// several detections, and the one a person can act on is the one the
// subagent works.
export const CAPABILITIES = Object.freeze([
  "visual-selection",
  "positioning",
  "transcription",
  "confirmation",
  "computation",
  "behavioral",
]);

// A kind of check (ZendiaCaptcha's KINDS) to the capability it asks for.
// The invisible, scored, sensed and managed ones ask nothing of a person and
// are all "behavioral"; a service's game and its proof-of-work are work a
// person does, so "computation".
const KIND_CAPABILITY = new Map([
  ["image", "visual-selection"],
  ["icon", "visual-selection"],
  ["click", "visual-selection"],
  ["video", "visual-selection"],
  ["slider", "positioning"],
  ["puzzle", "positioning"],
  ["rotate", "positioning"],
  ["text", "transcription"],
  ["audio", "transcription"],
  ["math", "transcription"],
  ["word", "transcription"],
  ["checkbox", "confirmation"],
  ["managed", "confirmation"],
  ["honeypot", "confirmation"],
  ["timing", "confirmation"],
  ["game", "computation"],
  ["proof-of-work", "computation"],
  ["invisible", "behavioral"],
  ["score", "behavioral"],
  ["behavioral", "behavioral"],
  ["sensor", "behavioral"],
  ["biometric", "behavioral"],
  ["risk", "behavioral"],
  ["hybrid", "behavioral"],
]);

// A detection's signal to a neutral name for it. A honeypot is a trap, not
// a task: it is dropped whole, so the subagent never hears of it.
const SIGNAL_TYPES = new Map([
  ["frame", "interactive-element"],
  ["script", "background-process"],
  ["widget", "interactive-widget"],
  ["own", "custom-element"],
  ["token", "completion-indicator"],
]);

/**
 * @param {string} kind A kind of check, one of ZendiaCaptcha's KINDS.
 * @returns {string} The capability it asks for.
 */
export function capabilityOf(kind) {
  return KIND_CAPABILITY.get(String(kind)) ?? "visual-selection";
}

/**
 * The detections of a record as the subagent may hear of them: a neutral
 * signal and a capability, with the service's name, the kind's own name and
 * the honeypots gone.
 *
 * @param {object[]} detections
 * @returns {{signal: string, taskType: string}[]}
 */
export function sterileDetections(detections) {
  if (!Array.isArray(detections)) {
    return [];
  }
  return detections.flatMap(detection => {
    if (detection?.signal == "honeypot") {
      return [];
    }
    return [
      {
        signal: SIGNAL_TYPES.get(detection?.signal) ?? "unknown",
        taskType: capabilityOf(detection?.kind),
      },
    ];
  });
}

/**
 * A signature of the sterile detections, so two looks at the same task are
 * the same and a change is a change. It carries nothing of the page.
 *
 * @param {{signal: string, taskType: string}[]} detections
 * @returns {string}
 */
export function sterileSignature(detections) {
  return detections
    .map(({ signal, taskType }) => `${signal}:${taskType ?? ""}`)
    .sort()
    .join("|");
}

/**
 * The record as the boundary keeps it: a capability and the sterile
 * detections. The address, the page's words and the time are left out, and
 * so is everything else the page said.
 *
 * @param {{url?: string, detections?: object[], text?: string, at?: number}} record
 * @returns {{capability: string, detections: object[], signature: string}}
 */
export function sterileRecord(record) {
  const detections = sterileDetections(record?.detections);
  return {
    capability: capabilityOfRecord(record),
    detections,
    signature: sterileSignature(detections),
  };
}

/**
 * The one capability of a record: the first, in CAPABILITIES order, that any
 * of its detections asks for. A record with nothing actable is behavioral.
 *
 * @param {{detections?: object[]}} record
 * @returns {string}
 */
export function capabilityOfRecord(record) {
  const capabilities = (record?.detections ?? []).map(detection =>
    capabilityOf(detection?.kind)
  );
  return (
    CAPABILITIES.find(capability => capabilities.includes(capability)) ??
    "behavioral"
  );
}

/**
 * A text with the services' names taken out, so a task's own words do not
 * carry its provider. The names are the caller's, from ZendiaCaptcha, so
 * this module holds no list of its own.
 *
 * @param {string} text
 * @param {string[]} serviceNames
 * @returns {string}
 */
export function stripServiceNames(text, serviceNames = []) {
  let out = String(text ?? "");
  for (const name of serviceNames) {
    if (!name) {
      continue;
    }
    // Whole words only: a name inside a longer word is part of that word,
    // and the ask keeps its own words.
    const pattern = new RegExp(
      `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "gi"
    );
    out = out.replace(pattern, "the task");
  }
  return out;
}

/**
 * The words that would tell the subagent what it is working on, made neutral:
 * "challenge" and "CAPTCHA" become "task". The task's own ask is unchanged,
 * so a model can still do the work.
 *
 * @param {string} text
 * @returns {string}
 */
export function neutralWords(text) {
  return String(text ?? "")
    .replace(/\bCAPTCHAs?\b/g, "task")
    .replace(/\bcaptchas?\b/gi, "task")
    .replace(/\bchallenges?\b/gi, "task");
}
