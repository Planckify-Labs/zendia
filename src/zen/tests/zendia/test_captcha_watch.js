/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { ZendiaCaptchaWatch, describe, signatureOf } =
  ChromeUtils.importESModule(
    "resource:///modules/zendia/captcha/ZendiaCaptchaWatch.sys.mjs",
  );

add_task(function test_a_finding_is_told_in_one_line() {
  Assert.equal(
    describe([
      {
        signal: "frame",
        name: "reCAPTCHA",
        kind: "image",
        challenge: true,
        detail: "https://www.google.com/recaptcha/api2/bframe?hl=en",
      },
      {
        signal: "script",
        name: "reCAPTCHA",
        kind: "score",
        detail: "https://www.google.com/recaptcha/api2/api.js?render=6Lcx",
      },
      { signal: "script", name: "Kasada", kind: "sensor", detail: "/ips.js" },
      { signal: "widget", detail: "2" },
      { signal: "token", detail: "cf-turnstile-response" },
      { signal: "honeypot", detail: "website" },
    ]),
    "reCAPTCHA (image, score); Kasada (sensor); 2 page widgets; " +
      "token field cf-turnstile-response; honeypot field website",
  );
  Assert.equal(describe([{ signal: "widget", detail: "1" }]), "1 page widget");
  Assert.equal(describe([]), "");
});

add_task(function test_a_signature_marks_the_same_finding() {
  const detections = [
    { signal: "frame", name: "hCaptcha", kind: "image", detail: "a" },
    { signal: "token", detail: "h-captcha-response" },
  ];
  Assert.equal(
    signatureOf(detections),
    signatureOf([...detections].reverse()),
    "the order of the findings does not matter",
  );
  Assert.notEqual(
    signatureOf(detections),
    signatureOf(detections.slice(1)),
    "a different finding does",
  );
});

add_task(function test_a_page_is_kept_and_announced_once() {
  const browser = {}; // A stand-in: only a WeakMap key and an ownerGlobal.
  const report = {
    url: "https://example.com/",
    frame: 0,
    top: true,
    detections: [
      {
        signal: "frame",
        name: "hCaptcha",
        kind: "image",
        challenge: true,
        detail: "https://hcaptcha.example/frame",
      },
    ],
  };
  const first = ZendiaCaptchaWatch.report(browser, report);
  Assert.ok(first, "the finding is kept");
  Assert.equal(ZendiaCaptchaWatch.lastFor(browser), first);
  Assert.equal(first.text, "hCaptcha (image)");
  const again = ZendiaCaptchaWatch.report(browser, report);
  Assert.equal(
    again.signature,
    first.signature,
    "the same finding on the same page keeps its signature",
  );
  const changed = ZendiaCaptchaWatch.report(browser, {
    ...report,
    detections: [...report.detections, { signal: "widget", detail: "1" }],
  });
  Assert.notEqual(
    changed.signature,
    first.signature,
    "a new finding on the page is a new one",
  );
});

add_task(function test_a_captcha_in_a_sub_frame_counts_toward_the_tab() {
  const browser = {};
  // The top frame holds a plain widget.
  ZendiaCaptchaWatch.report(browser, {
    url: "https://shop.example/checkout",
    frame: 0,
    top: true,
    detections: [{ signal: "widget", detail: "1" }],
  });
  // A sub-frame holds a service the top page cannot see into.
  const merged = ZendiaCaptchaWatch.report(browser, {
    url: "https://verify.example/px",
    frame: 7,
    top: false,
    detections: [
      { signal: "frame", name: "HUMAN", kind: "behavioral", detail: "d" },
    ],
  });
  Assert.ok(
    merged.detections.some(({ name }) => name == "HUMAN"),
    "the sub-frame's finding is part of the tab's",
  );
  Assert.ok(merged.text.includes("HUMAN"), "and is named in the line");
  Assert.equal(
    merged.url,
    "https://shop.example/checkout",
    "the tab is named by its top frame",
  );
  // The sub-frame navigates away: its finding is dropped.
  ZendiaCaptchaWatch.drop(browser, 7);
  Assert.ok(
    !ZendiaCaptchaWatch.lastFor(browser).detections.some(
      ({ name }) => name == "HUMAN",
    ),
    "a gone frame no longer counts",
  );
});

add_task(function test_what_a_page_sends_is_checked() {
  const record = ZendiaCaptchaWatch.report(
    {},
    {
      url: 42,
      detections: [
        { signal: "read-all-cookies", name: "nope" },
        { signal: "frame", name: "hCaptcha", kind: "image", detail: "d" },
        "garbage",
        null,
      ],
    },
  );
  Assert.equal(record.url, "", "a non-string address is dropped");
  Assert.deepEqual(
    record.detections.map(({ signal }) => signal),
    ["frame"],
    "only the signals the watch knows are kept",
  );
  Assert.equal(
    ZendiaCaptchaWatch.report({}, { url: "https://x", detections: [] }),
    null,
    "an empty report is kept out",
  );
  Assert.equal(
    ZendiaCaptchaWatch.report({}, { url: "https://x" }),
    null,
    "and one without findings",
  );
});

add_task(function test_the_tab_takes_the_state_that_asks_most() {
  const browser = {};
  // The page sees a widget; its checkbox frame says the box is not ticked.
  ZendiaCaptchaWatch.report(browser, {
    url: "https://shop.example/login",
    frame: 0,
    top: true,
    detections: [
      { signal: "frame", name: "reCAPTCHA", kind: "checkbox", detail: "a" },
    ],
    state: { state: "none" },
  });
  const record = ZendiaCaptchaWatch.report(browser, {
    url: "https://www.google.com/recaptcha/api2/anchor",
    frame: 3,
    top: false,
    detections: [],
    state: {
      state: "unchecked",
      name: "reCAPTCHA",
      how: "reCAPTCHA's checkbox is not ticked",
    },
  });
  Assert.equal(record.state, "unchecked", "the frame's state is the tab's");
  Assert.equal(record.how, "reCAPTCHA's checkbox is not ticked");
  Assert.equal(
    record.url,
    "https://shop.example/login",
    "a frame with only a state does not name the tab"
  );
});

add_task(function test_a_change_of_state_is_announced_live() {
  const browser = {};
  const heard = [];
  const off = ZendiaCaptchaWatch.onDetect((tab, record) => {
    if (tab == browser) {
      heard.push(record.state);
    }
  });
  const page = state => ({
    url: "https://shop.example/",
    frame: 0,
    top: true,
    detections: [{ signal: "widget", detail: "1" }],
    state,
  });
  try {
    ZendiaCaptchaWatch.report(browser, page({ state: "unchecked" }));
    ZendiaCaptchaWatch.report(browser, page({ state: "unchecked" }));
    ZendiaCaptchaWatch.report(browser, page({ state: "solved" }));
    // Expired: it asks again on the same page, with no reload.
    ZendiaCaptchaWatch.report(browser, page({ state: "unchecked" }));
    // The page takes the widget down.
    ZendiaCaptchaWatch.report(browser, { ...page(), detections: [] });
  } finally {
    off();
  }
  Assert.deepEqual(
    heard,
    ["unchecked", "solved", "unchecked", "none"],
    "each change is told once, and so is the CAPTCHA going"
  );
  Assert.equal(ZendiaCaptchaWatch.lastFor(browser), null);
});

add_task(function test_a_state_a_page_sends_is_checked() {
  const record = ZendiaCaptchaWatch.report(
    {},
    {
      url: "https://x",
      detections: [{ signal: "widget", detail: "1" }],
      state: { state: "pwned", how: "x".repeat(1000) },
    }
  );
  Assert.equal(record.state, "none", "an unknown state is none");
  Assert.equal(
    ZendiaCaptchaWatch.report(
      {},
      { url: "https://x", detections: [], state: { state: "none" } }
    ),
    null,
    "a report of nothing is kept out"
  );
  const kept = ZendiaCaptchaWatch.report(
    {},
    {
      url: "https://x",
      detections: [],
      state: { state: "solved", how: "y".repeat(1000) },
    }
  );
  Assert.equal(kept.state, "solved", "a state alone is kept");
  Assert.ok(kept.how.length <= 160, "and what it says is cut short");
});
