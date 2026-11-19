/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// The boundary between a page's challenge and the subagent that works it:
// what crosses is a task, and what stays behind is everything that says
// where the task came from.

const { ZendiaCaptcha } = ChromeUtils.importESModule(
  "resource:///modules/zendia/core/ZendiaCaptcha.sys.mjs"
);
const {
  capabilityOf,
  capabilityOfRecord,
  neutralWords,
  sterileDetections,
  sterileRecord,
  stripServiceNames,
} = ChromeUtils.importESModule(
  "resource:///modules/zendia/captcha/ZendiaChallengeAdapters.sys.mjs"
);
const {
  STERILE_FILE_NAMES,
  sterileFiles,
  sterileLabeled,
  sterileSaid,
  sterileSolvePrompt,
  sterileStatusPrompt,
  sterileTask,
} = ChromeUtils.importESModule(
  "resource:///modules/zendia/captcha/ZendiaSterileChallenge.sys.mjs"
);
const { getChallengeVault, resetChallengeVault, ZendiaChallengeVault } =
  ChromeUtils.importESModule(
    "resource:///modules/zendia/captcha/ZendiaChallengeVault.sys.mjs"
  );
const {
  getCaptchaBoundary,
  resetCaptchaBoundary,
  ZendiaCaptchaBoundaryService,
} = ChromeUtils.importESModule(
  "resource:///modules/zendia/captcha/ZendiaCaptchaBoundary.sys.mjs"
);

// A finding of the watch's, with everything of the page on it.
const RECORD = {
  url: "https://shop.example.com/checkout?order=4711",
  text:
    'reCAPTCHA (image); page-drawn image challenge "Select all images with ' +
    'buses"; honeypot field website',
  at: 1763000000000,
  detections: [
    {
      signal: "frame",
      name: "reCAPTCHA",
      kind: "image",
      challenge: true,
      detail: "https://www.google.com/recaptcha/api2/bframe?hl=en",
    },
    {
      signal: "script",
      name: "Kasada",
      kind: "sensor",
      detail: "/ips.js",
    },
    { signal: "honeypot", detail: "website" },
  ],
};

// The shot the subagent works: cut to the challenge (`cropped`), with the
// instruction read off it.
function shotOf({ cropped = true, said = null, example = false } = {}) {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    cropped,
    labeled: "captcha",
    state: "open",
    parts: {
      area: { bytes: new Uint8Array([4, 5, 6]) },
      instruction: said
        ? {
            text: said,
            pictures: example ? 1 : 0,
            shot: { bytes: new Uint8Array([7, 8, 9]) },
          }
        : null,
    },
  };
}

// Everything of a task but the bytes, as text, for the leak assertions.
function words(task) {
  return JSON.stringify({ ...task, files: task.files.map(file => file.name) });
}

add_task(function test_a_kind_asks_for_one_capability() {
  Assert.equal(capabilityOf("image"), "visual-selection");
  Assert.equal(capabilityOf("slider"), "positioning");
  Assert.equal(capabilityOf("text"), "transcription");
  Assert.equal(capabilityOf("checkbox"), "confirmation");
  Assert.equal(capabilityOf("proof-of-work"), "computation");
  Assert.equal(capabilityOf("score"), "behavioral");
  Assert.equal(
    capabilityOf("something-new"),
    "visual-selection",
    "a kind this build does not know still asks for the work it can see"
  );
  for (const kind of ZendiaCaptcha.KINDS) {
    Assert.ok(
      !!capabilityOf(kind),
      `every kind the watch reports has a capability (${kind})`
    );
  }
});

add_task(function test_the_capability_of_a_record_is_the_one_to_act_on() {
  Assert.equal(
    capabilityOfRecord(RECORD),
    "visual-selection",
    "the images to pick, not the sensor that watches"
  );
  Assert.equal(
    capabilityOfRecord({ detections: [{ kind: "score" }, { kind: "slider" }] }),
    "positioning",
    "the piece to slide, not the score"
  );
  Assert.equal(
    capabilityOfRecord({ detections: [{ kind: "invisible" }] }),
    "behavioral"
  );
  Assert.equal(capabilityOfRecord(null), "behavioral", "nothing to act on");
});

add_task(function test_a_detection_crosses_as_a_signal_and_nothing_else() {
  Assert.deepEqual(sterileDetections(RECORD.detections), [
    { signal: "interactive-element", taskType: "visual-selection" },
    { signal: "background-process", taskType: "behavioral" },
  ]);
  Assert.deepEqual(
    sterileDetections([{ signal: "honeypot", detail: "website" }]),
    [],
    "a trap is not a task: it is dropped whole"
  );
  Assert.deepEqual(sterileDetections(null), []);
});

add_task(function test_the_same_look_has_the_same_signature() {
  const sterile = sterileRecord(RECORD);
  Assert.equal(
    sterile.signature,
    sterileRecord({
      ...RECORD,
      url: "https://other.example.org/",
      detections: [...RECORD.detections].reverse(),
    }).signature,
    "neither the page nor the order of the findings is in it"
  );
  Assert.notEqual(
    sterile.signature,
    sterileRecord({ detections: [{ signal: "frame", kind: "slider" }] })
      .signature,
    "a different kind of task is a different task"
  );
});

add_task(function test_a_services_name_leaves_the_ask_but_a_word_stays() {
  Assert.equal(
    stripServiceNames("Protected by hCaptcha and Cloudflare Turnstile", [
      "hCaptcha",
      "Cloudflare Turnstile",
    ]),
    "Protected by the task and the task"
  );
  Assert.equal(
    stripServiceNames(
      "Select every image with a human face",
      ZendiaCaptcha.NAMES
    ),
    "Select every image with a human face",
    "the words of the ask are the work, and HUMAN is one of them"
  );
  Assert.ok(
    !ZendiaCaptcha.NAMES.includes("HUMAN"),
    "a name that is an ordinary word of an ask is not stripped"
  );
  Assert.ok(
    ZendiaCaptcha.NAMES.includes("reCAPTCHA") &&
      ZendiaCaptcha.NAMES.includes("Kasada"),
    "the names a page can give away are there"
  );
});

add_task(function test_the_words_of_a_challenge_are_the_words_of_a_task() {
  Assert.equal(
    neutralWords("Complete the CAPTCHA challenge below"),
    "Complete the task task below",
    "neither word says what kind of thing this is"
  );
  Assert.equal(
    sterileSaid("reCAPTCHA challenge: pick the buses", ZendiaCaptcha.NAMES),
    "the task task: pick the buses"
  );
  Assert.equal(sterileSaid(null), "");
});

add_task(function test_a_turns_files_are_the_same_bytes_under_neutral_names() {
  const parts = shotOf({ said: "Pick the buses", example: true }).parts;
  Assert.deepEqual(
    sterileFiles({ parts }).map(file => file.name),
    [STERILE_FILE_NAMES.area, STERILE_FILE_NAMES.example]
  );
  Assert.deepEqual(
    sterileFiles({ parts }).map(file => [...file.bytes]),
    [
      [4, 5, 6],
      [7, 8, 9],
    ],
    "the work is in the bytes: they are handed over untouched"
  );
  Assert.deepEqual(
    sterileFiles({
      parts: shotOf({ said: "Type the characters" }).parts,
    }).map(file => file.name),
    [STERILE_FILE_NAMES.area],
    "the instruction's own picture goes only where it shows what words cannot"
  );
  Assert.deepEqual(
    sterileFiles({ picture: { bytes: new Uint8Array([1]) } }).map(
      file => file.name
    ),
    [STERILE_FILE_NAMES.whole]
  );
  Assert.deepEqual(sterileFiles({}), []);
});

add_task(function test_a_task_carries_nothing_of_the_page() {
  const task = sterileTask({
    id: "6f1c",
    record: RECORD,
    shot: shotOf({ said: "reCAPTCHA: select all images with buses" }),
    capability: capabilityOfRecord(RECORD),
    ttlSeconds: 120,
    serviceNames: ZendiaCaptcha.NAMES,
  });
  const text = words(task);
  for (const leak of [
    "shop.example.com",
    "checkout",
    "4711",
    "recaptcha",
    "reCAPTCHA",
    "Kasada",
    "google.com",
    "honeypot",
    "website",
    "ips.js",
    "challenge",
    "CAPTCHA",
    "captcha",
    String(RECORD.at),
  ]) {
    Assert.ok(
      !text.includes(leak),
      `${JSON.stringify(leak)} does not cross the boundary (${text})`
    );
  }
  Assert.equal(task.id, "6f1c");
  Assert.equal(task.capability, "visual-selection");
  Assert.equal(task.ttlSeconds, 120);
  Assert.equal(
    task.said,
    "the task: select all images with buses",
    "the ask keeps what to do and loses who asks"
  );
  Assert.equal(
    task.labeled,
    "tags",
    "what is up on the screen, in words that say nothing of the page"
  );
  Assert.equal(sterileLabeled("cursor"), "cursor");
  Assert.equal(sterileLabeled(false), null, "nothing was labeled");
  Assert.deepEqual(
    task.files.map(file => file.name),
    [STERILE_FILE_NAMES.area]
  );
});

add_task(function test_a_shot_of_the_whole_page_is_not_the_task() {
  const whole = {
    bytes: new Uint8Array([1]),
    cropped: false,
    labeled: false,
    state: "timeout",
  };
  Assert.deepEqual(
    sterileTask({ id: "a", record: RECORD, shot: whole }).files,
    [],
    "the page is the page, not the task: it is never handed over"
  );
  Assert.equal(
    sterileTask({ id: "a", record: RECORD, shot: { ...whole, cropped: true } })
      .files.length,
    1,
    "a shot cut to the task is the task"
  );
  Assert.deepEqual(
    sterileTask({
      id: "a",
      record: RECORD,
      shot: shotOf({ said: "Pick the buses" }),
      sees: false,
    }).files,
    [],
    "a model that cannot see pictures is given none"
  );
  Assert.equal(
    sterileTask({ id: "a", shot: whole }).labeled,
    null,
    "an unlabeled shot says so plainly"
  );
});

add_task(function test_the_turn_the_subagent_gets_names_nothing() {
  const prompt = sterileSolvePrompt({
    said: "reCAPTCHA: select all images with buses",
    nowLine: "Small letter tags sit on the challenge's tiles.",
    keysReference: "- `Enter`: the challenge's Verify button.",
    serviceNames: ZendiaCaptcha.NAMES,
  });
  for (const leak of ["reCAPTCHA", "recaptcha", "CAPTCHA", "challenge"]) {
    Assert.ok(!prompt.includes(leak), `the turn does not say ${leak}`);
  }
  Assert.ok(
    prompt.includes(STERILE_FILE_NAMES.area),
    "it says which picture to look at, by the name the turn was given"
  );
  Assert.ok(
    prompt.includes("Small letter tags sit on the task's tiles."),
    "what the labels are on is said in the same neutral words"
  );
  Assert.ok(
    prompt.includes("the task's Verify button"),
    "the keys are the agent's own, with their vocabulary made neutral"
  );
  Assert.ok(
    prompt.includes("select all images with buses"),
    "what to do survives the scrubbing"
  );
  Assert.ok(
    sterileSolvePrompt({ keysReference: "keys" }).includes("keys"),
    "a turn with nothing said of the labels is still a turn with keys"
  );
});

add_task(function test_a_turn_with_nothing_to_work_only_says_so() {
  const status = sterileStatusPrompt({
    pictureName: STERILE_FILE_NAMES.whole,
    said: "hCaptcha challenge",
    state: "passed",
    sees: true,
    serviceNames: ZendiaCaptcha.NAMES,
  });
  Assert.ok(!status.includes("hCaptcha"), "no service");
  Assert.ok(!status.toLowerCase().includes("captcha"), "no vocabulary");
  Assert.ok(status.includes("It may already be done."));
  Assert.ok(
    sterileStatusPrompt({ sees: false }).includes("cannot see it"),
    "a model that cannot see is asked only to say so"
  );
});

add_task(function test_a_handle_names_a_task_and_nothing_else() {
  const vault = new ZendiaChallengeVault();
  const browser = {};
  const first = vault.open({
    browser,
    record: RECORD,
    shot: shotOf(),
    capability: "visual-selection",
  });
  const second = vault.open({
    browser,
    record: RECORD,
    shot: shotOf(),
    capability: "visual-selection",
  });
  Assert.notEqual(first, second, "two looks at one challenge cannot be tied");
  for (const handle of [first, second]) {
    Assert.ok(
      !handle.includes("example") && !/captcha/i.test(handle),
      "a handle cannot be read as a page or a service"
    );
  }
  Assert.equal(vault.size, 2);
  Assert.equal(vault.peek(first).browser, browser, "the tab stays in here");
  Assert.equal(vault.peek("made-up"), null, "a handle no one opened is no key");
});

add_task(function test_a_handle_is_good_once() {
  const vault = new ZendiaChallengeVault();
  const handle = vault.open({ browser: {}, record: RECORD, shot: shotOf() });
  Assert.ok(!!vault.take(handle), "the one-way door opens once");
  Assert.equal(vault.take(handle), null, "and not twice");
  Assert.equal(vault.peek(handle), null, "a spent handle reads as nothing");

  const other = new ZendiaChallengeVault();
  const spent = other.open({ browser: {}, record: RECORD, shot: shotOf() });
  const done = other.resolve(spent, { status: "ok", at: 7 });
  Assert.deepEqual(
    done,
    { handle: spent, status: "ok", at: 7 },
    "a resolution is a status, never the task"
  );
  Assert.equal(other.resolve(spent, { status: "ok" }), null, "spent is spent");
  Assert.equal(
    other.resolve("made-up", { status: "ok" }),
    null,
    "nothing is resolved by guessing"
  );
});

add_task(function test_a_handle_expires_on_its_own() {
  // A TTL already in the past: the handle is stale the moment it is made,
  // which is how a forgotten one ends up without a timer of its own.
  const vault = new ZendiaChallengeVault({ ttlMs: -1 });
  const handle = vault.open({ browser: {}, record: RECORD, shot: shotOf() });
  Assert.equal(vault.peek(handle), null, "an expired handle opens nothing");
  Assert.equal(vault.take(handle), null);
  Assert.equal(vault.sweep(), 1, "and it is dropped");
  Assert.equal(vault.size, 0);
  Assert.equal(new ZendiaChallengeVault({ ttlMs: 120000 }).ttlSeconds, 120);
});

add_task(function test_the_boundary_hands_over_the_task_and_keeps_the_page() {
  const vault = new ZendiaChallengeVault();
  const boundary = new ZendiaCaptchaBoundaryService(vault);
  const browser = {};
  const handle = boundary.open({
    browser,
    record: RECORD,
    shot: shotOf({ said: "reCAPTCHA: select all images with buses" }),
  });
  const task = boundary.task(handle, { serviceNames: ZendiaCaptcha.NAMES });
  Assert.equal(task.id, handle);
  Assert.equal(task.capability, "visual-selection", "from the record itself");
  Assert.equal(task.ttlSeconds, vault.ttlSeconds);
  Assert.ok(!words(task).includes("shop.example.com"), "the page stays behind");
  Assert.equal(
    boundary.entry(handle).browser,
    browser,
    "the tab to act on is the parent's, through the handle"
  );
  Assert.deepEqual(
    boundary.task(handle, { serviceNames: ZendiaCaptcha.NAMES }).said,
    task.said,
    "reading a task does not spend its handle"
  );
  Assert.equal(boundary.resolve(handle, "ok").status, "ok");
  Assert.equal(
    boundary.task(handle),
    null,
    "a settled task cannot be opened again, and a null is the end of the work"
  );
  Assert.equal(boundary.resolve("made-up", "ok"), null);
  Assert.equal(boundary.task("made-up"), null);
});

add_task(function test_a_task_dropped_before_its_ttl_is_gone() {
  const vault = new ZendiaChallengeVault();
  const boundary = new ZendiaCaptchaBoundaryService(vault);
  const handle = boundary.open({ browser: {}, record: RECORD, shot: shotOf() });
  boundary.close(handle);
  Assert.equal(boundary.task(handle), null);
  Assert.equal(vault.size, 0);
  Assert.equal(boundary.sweep(), 0, "nothing left to sweep");
});

add_task(function test_the_process_has_one_vault_and_one_boundary() {
  resetCaptchaBoundary();
  resetChallengeVault();
  const boundary = getCaptchaBoundary();
  Assert.equal(getCaptchaBoundary(), boundary, "one boundary to a process");
  const vault = getChallengeVault();
  Assert.equal(getChallengeVault(), vault, "over one vault");
  const handle = boundary.open({ browser: {}, record: RECORD, shot: shotOf() });
  Assert.equal(
    vault.peek(handle).capability,
    "visual-selection",
    "what the boundary opens is in that vault, under the handle"
  );
  resetCaptchaBoundary();
  resetChallengeVault();
  Assert.notEqual(
    getChallengeVault(),
    vault,
    "and both are put back fresh for the next test"
  );
});
