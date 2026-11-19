// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The sterile task a subagent is given: the same work, with nothing that
// says what kind of page it came from. The pictures keep their bytes (the
// work is in them), the file names, the words and the wording are neutral,
// and the page, the service and the record never reach the prompt.
//
// This module is pure: it knows nothing of a browser or a tab, so it can be
// tested alone.

import {
  neutralWords,
  sterileRecord,
  stripServiceNames,
} from "resource:///modules/zendia/captcha/ZendiaChallengeAdapters.sys.mjs";

// What the labels up on the screen are on, as a task says it: the agent's
// own names for them (ZendiaCaptchaAgent's LABELED_NOW) say what kind of
// thing was labeled, and nothing the subagent is handed says that.
const STERILE_LABELS = new Map([
  ["captcha", "tags"],
  ["cursor", "cursor"],
  ["page", "page"],
]);

/**
 * @param {string|boolean} labeled What the agent labeled.
 * @returns {string|null} What a task calls it, if it was labeled at all.
 */
export function sterileLabeled(labeled) {
  return STERILE_LABELS.get(String(labeled)) ?? null;
}

// The names the subagent sees, so a file is a task and not a challenge.
export const STERILE_FILE_NAMES = Object.freeze({
  area: "task-area.jpg",
  example: "task-example.jpg",
  whole: "task.jpg",
});

/**
 * The task's own ask, with the services' names and the kind's vocabulary
 * taken out. What it asks a person to do is kept.
 *
 * @param {string} said
 * @param {string[]} serviceNames
 * @returns {string}
 */
export function sterileSaid(said, serviceNames = []) {
  return neutralWords(stripServiceNames(said, serviceNames));
}

/**
 * The files for a turn: the area to act on, and the instruction's example
 * where it shows what words cannot. Neutral names, the same bytes.
 *
 * @param {object} [options]
 * @param {object} [options.parts] The challenge's parts.
 * @param {object} [options.picture] The whole challenge, when it has no
 *   parts of its own.
 * @returns {{name: string, bytes: Uint8Array}[]}
 */
export function sterileFiles({ parts, picture } = {}) {
  const files = [];
  if (parts?.area) {
    files.push({ name: STERILE_FILE_NAMES.area, bytes: parts.area.bytes });
    if (parts.instruction?.shot && parts.instruction.pictures) {
      files.push({
        name: STERILE_FILE_NAMES.example,
        bytes: parts.instruction.shot.bytes,
      });
    }
  } else if (picture) {
    files.push({ name: STERILE_FILE_NAMES.whole, bytes: picture.bytes });
  }
  return files;
}

/**
 * The whole of what a subagent is given for one task: an id that names it
 * and nothing else, the kind of work it asks for, the files to look at and
 * a neutral wording of its ask. The address, the service, the words of the
 * finding and the time it was found stay behind in the vault.
 *
 * @param {object} options
 * @param {string} options.id The handle the task is known by.
 * @param {object} [options.record] What the watch found, page and all.
 * @param {object} [options.shot] The task as it was photographed.
 * @param {string} [options.capability] Its capability, or the record's.
 * @param {number} [options.ttlSeconds] How long the id is good for.
 * @param {string[]} [options.serviceNames]
 * @param {boolean} [options.sees] Whether the model can see pictures at
 *   all: one that cannot is given none.
 * @returns {object} The sterile task.
 */
export function sterileTask({
  id,
  record = null,
  shot = null,
  capability = null,
  ttlSeconds = 0,
  serviceNames = [],
  sees = true,
} = {}) {
  const sterile = sterileRecord(record);
  const parts = shot?.parts?.area ? shot.parts : null;
  return {
    id,
    capability: capability ?? sterile.capability,
    detections: sterile.detections,
    signature: sterile.signature,
    ttlSeconds,
    said: sterileSaid(shot?.parts?.instruction?.text, serviceNames),
    labeled: sterileLabeled(shot?.labeled),
    state: shot?.state ?? null,
    // A shot of the whole page is the page, not the task: only one cut to
    // the task itself is ever handed over.
    files: sees
      ? sterileFiles({ parts, picture: shot?.cropped ? shot : null })
      : [],
  };
}

/**
 * The turn the subagent gets when it works the task itself. It is the same
 * instructions the agent always gave, in words that name no service, no
 * challenge and no page: the picture is the truth, the keys are the keys,
 * and the work is the work.
 *
 * @param {object} options
 * @param {string} [options.said] What the task asks at the start.
 * @param {string} [options.nowLine] What the labels up on the screen are
 *   and how they work, in the agent's own words.
 * @param {string} options.keysReference The keys and their recipes.
 * @param {typeof STERILE_FILE_NAMES} [options.fileNames]
 * @param {string[]} [options.serviceNames]
 * @returns {string}
 */
export function sterileSolvePrompt({
  said,
  nowLine = "",
  keysReference,
  fileNames = STERILE_FILE_NAMES,
  serviceNames = [],
}) {
  const ask = sterileSaid(said, serviceNames);
  const area = fileNames.area;
  return neutralWords(
    [
      ask
        ? `At the start it asks: "${ask}" — but the picture is the truth, and it can change.`
        : null,
      `A picture of the task is on the user's screen with small key labels on it, and you do it yourself. ${nowLine}`,
      `These are the keys, exactly as they work; use no others:\n${keysReference}`,
      `Pass type_keys a list of keys in order: a tile's letters typed together like "ac", a move like "h", "H" or ".", or a named key exactly as above ("Enter", "Tab", "Ctrl+R", "Ctrl+A", "Ctrl+P", "Space"). Pass type_text the characters to put in an answer field.
Work it on your own, and do not stop until it is finished:
1. First see the task: call picture_view on ${area} (or open the file you were given). Only after you have truly tried and got no image may you say you cannot see it, in one short line, and stop.
2. Read what it asks and the labels off the picture, and make the move for its kind: pick images (type each matching tile's letters, then verify); slide a piece to a gap; rotate; click points in order; press and hold; a checkbox — all with type_keys. If it shows characters to copy, read them and put them in with type_text, then verify. A slider or drag puzzle takes two looks: first type the handle's tag alone to grab it (its track may be below the picture, not beside it), then call look_again — only then does a ruler of tags appear across the row. The ruler only gets the piece CLOSE, not exact: type the tag nearest the gap, then look_again and nudge one step at a time with \`h\`/\`l\` (\`H\`/\`L\` for bigger steps), looking again after each nudge, until the piece's shape sits squarely inside the gap. Only then \`Space\`. Never drop right after the ruler jump without first looking and correcting the fit with nudges; the exact fit is what passes, and the ruler alone rarely lands it. Do not guess the ruler before you have looked.
3. After each press the labels change, and new ones often appear — a ruler across a slider's row once you grab, the next button or field, the tiles of the next step. So call look_again after every move: it returns a fresh picture with the labels that are on screen now, and what it asks now. Read the labels off that latest picture and choose your next key from what you see there, never from a label you remember or guess — if you expected a new label and do not see it yet, look_again once more before pressing. When one task is complete, submit with the verify key; if another appears, solve that one too.
4. Keep looking and acting until the task is finished (it is gone, or it says it passed). If a picture is too blurred or it keeps refusing, get a fresh one with the new-task key and carry on.
Do not press \`Esc\` to leave — that drops your control; use it only to cancel a drag under the cursor. If type_text reports there is no field it can fill, or the task needs listening to audio, that part cannot be done: say so in one short line and stop. Do not name or guess what this is or where it is from, do not explain it, and do not write steps for the user — just do it yourself. When it is finished, or you are truly stuck, answer in one short line that says only that.`,
    ]
      .filter(Boolean)
      .join("\n\n")
  );
}

/**
 * The turn the subagent gets when there is nothing for it to work: it only
 * says in one line whether anything is left, and names nothing.
 *
 * @param {object} options
 * @param {string} [options.pictureName]
 * @param {string} [options.said]
 * @param {string} [options.state] How the wait ended.
 * @param {boolean} [options.sees] Whether the model can see pictures.
 * @param {string[]} [options.serviceNames]
 * @returns {string}
 */
export function sterileStatusPrompt({
  pictureName,
  said,
  state,
  sees,
  serviceNames = [],
} = {}) {
  const ask = sterileSaid(said, serviceNames);
  if (!sees) {
    return "You were given a picture you may not be able to see. Say in one short line that you cannot see it. Do not guess what it shows, do not name it, and do not write steps.";
  }
  let note = "There may be nothing here to act on.";
  if (state == "passed") {
    note = "It may already be done.";
  } else if (state == "timeout") {
    note =
      "It may not have loaded yet, or it opens only once something on the page is used.";
  }
  return neutralWords(
    [
      ask ? `The task says: "${ask}"` : null,
      pictureName ? `Look at ${pictureName}. ${note}` : note,
      "Say in one short line whether anything still needs doing. Do not name or guess what this is or where it is from, do not explain it, and do not write steps for the user.",
    ]
      .filter(Boolean)
      .join("\n\n")
  );
}
