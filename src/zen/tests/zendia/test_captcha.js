/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { ZendiaCaptcha } = ChromeUtils.importESModule(
  "resource:///modules/zendia/core/ZendiaCaptcha.sys.mjs"
);

add_task(function test_names_the_service_of_a_captcha_frame() {
  Assert.equal(
    ZendiaCaptcha.nameOf("https://www.google.com/recaptcha/api2/bframe?hl=en"),
    "reCAPTCHA"
  );
  Assert.equal(
    ZendiaCaptcha.nameOf(
      "https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html"
    ),
    "hCaptcha"
  );
  Assert.equal(
    ZendiaCaptcha.nameOf(
      "https://client-api.arkoselabs.com/fc/assets/ec-game-core"
    ),
    "Arkose"
  );
  Assert.equal(ZendiaCaptcha.nameOf("https://example.com/login"), null);
});

add_task(function test_a_challenge_is_the_frame_that_asks_for_clicks() {
  Assert.ok(
    ZendiaCaptcha.isChallenge(
      "https://www.google.com/recaptcha/api2/bframe?hl=en"
    ),
    "reCAPTCHA's grid"
  );
  Assert.ok(
    ZendiaCaptcha.isChallenge(
      "https://www.google.com/recaptcha/enterprise/bframe?hl=en"
    ),
    "and the enterprise one"
  );
  Assert.ok(
    !ZendiaCaptcha.isChallenge(
      "https://www.google.com/recaptcha/api2/anchor?k=1"
    ),
    "not its checkbox"
  );
  Assert.ok(
    ZendiaCaptcha.isChallenge(
      "https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html#frame=challenge&id=1"
    ),
    "hCaptcha's grid"
  );
  Assert.ok(
    !ZendiaCaptcha.isChallenge(
      "https://newassets.hcaptcha.com/captcha/v1/x/static/hcaptcha.html#frame=checkbox&id=1"
    ),
    "not its checkbox"
  );
  Assert.ok(
    ZendiaCaptcha.isChallenge(
      "https://client-api.arkoselabs.com/fc/assets/ec-game-core"
    ),
    "all of Arkose"
  );
  Assert.ok(
    !ZendiaCaptcha.isChallenge(
      "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile"
    ),
    "a Turnstile is a checkbox"
  );
  Assert.ok(!ZendiaCaptcha.isChallenge("https://example.com/"), "not a page");
});

const ALPHABET = "asdfghlqweruiopzxcvbnmty";

add_task(function test_labels_stay_with_their_targets() {
  const kept = new Map([
    ["x", "aa"],
    ["y", "as"],
    ["z", "ad"],
  ]);
  // The page is left out and a new target comes: the old ones keep theirs.
  const labels = ZendiaCaptcha.stickyLabels(["y", "z", "w"], kept, ALPHABET);
  Assert.equal(labels[0], "as");
  Assert.equal(labels[1], "ad");
  Assert.ok(labels[2].length == 2, "a new one gets a label of the same length");
  Assert.ok(!["as", "ad"].includes(labels[2]), "that nobody has");
  Assert.equal(new Set(labels).size, 3, "no two alike");
});

add_task(function test_labels_start_short_when_few() {
  const labels = ZendiaCaptcha.stickyLabels(
    ["a", "b", "c"],
    new Map(),
    ALPHABET
  );
  Assert.deepEqual(labels, ["a", "s", "d"]);
});

add_task(function test_a_label_is_never_given_twice() {
  const kept = new Map([
    ["x", "a"],
    ["y", "a"],
  ]);
  const labels = ZendiaCaptcha.stickyLabels(["x", "y"], kept, ALPHABET);
  Assert.equal(new Set(labels).size, 2);
});

add_task(function test_a_grid_fills_the_area() {
  const cells = ZendiaCaptcha.gridCells(
    { left: 10, top: 20, width: 100, height: 80 },
    40
  );
  Assert.equal(cells.length, 3 * 2);
  Assert.equal(cells[0].left, 10);
  Assert.equal(cells[0].top, 20);
  const last = cells[cells.length - 1];
  Assert.equal(last.left + last.width, 110);
  Assert.equal(last.top + last.height, 100);
  Assert.deepEqual(
    ZendiaCaptcha.middle({ left: 0, top: 0, width: 10, height: 6 }),
    {
      x: 5,
      y: 3,
    }
  );
});

add_task(function test_a_drag_is_a_path_of_small_steps() {
  const path = ZendiaCaptcha.path({ x: 0, y: 0 }, { x: 50, y: 0 }, 12);
  Assert.equal(path.length, 5);
  Assert.deepEqual(path[path.length - 1], { x: 50, y: 0 });
  Assert.ok(path.every((point, i) => point.x - (path[i - 1]?.x ?? 0) <= 12));
  Assert.deepEqual(ZendiaCaptcha.path({ x: 3, y: 3 }, { x: 3, y: 3 }, 12), [
    { x: 3, y: 3 },
  ]);
});

add_task(function test_more_services_are_named() {
  for (const [url, name] of [
    ["https://api.geetest.com/get.php", "GeeTest"],
    ["https://geo.captcha-delivery.com/captcha/?initialCid=1", "DataDome"],
    ["https://captcha.px-cdn.net/PX1/captcha.js", "HUMAN"],
    ["https://smartcaptcha.yandexcloud.net/webtest", "Yandex SmartCaptcha"],
    ["https://octocaptcha.com/?origin=github", "Arkose"],
    ["https://api.friendlycaptcha.com/api/v1/puzzle", "Friendly Captcha"],
  ]) {
    Assert.equal(ZendiaCaptcha.nameOf(url), name, url);
  }
});

add_task(function test_a_board_is_found_from_its_pieces() {
  const piece = (column, row) => ({
    left: 100 + column * 50,
    top: 40 + row * 50,
    width: 40,
    height: 40,
  });
  const places = ZendiaCaptcha.lattice([piece(0, 0), piece(1, 1), piece(4, 4)]);
  Assert.equal(places.length, 25, "a board of five by five");
  Assert.deepEqual(places[0], piece(0, 0));
  Assert.deepEqual(places[24], piece(4, 4));
  Assert.equal(
    ZendiaCaptcha.lattice([piece(0, 0), piece(1, 1)]),
    null,
    "two pieces say nothing"
  );
  Assert.equal(
    ZendiaCaptcha.lattice([
      piece(0, 0),
      piece(1, 0),
      { ...piece(2, 0), left: 215 },
    ]),
    null,
    "pieces off the lines are not on a board"
  );
});
add_task(function test_a_turnstile_on_the_sites_own_address_is_found() {
  Assert.equal(
    ZendiaCaptcha.nameOf(
      "https://example.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0"
    ),
    "Cloudflare Turnstile"
  );
  Assert.equal(
    ZendiaCaptcha.kindOf(
      "https://example.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0"
    ),
    "managed"
  );
});

add_task(function test_the_kind_of_a_check_is_told() {
  const kinds = new Map([
    ["https://www.google.com/recaptcha/api2/bframe?hl=en", "image"],
    ["https://www.google.com/recaptcha/api2/anchor?k=1", "checkbox"],
    [
      "https://www.google.com/recaptcha/api2/api.js?render=explicit",
      "checkbox",
    ],
    [
      "https://www.google.com/recaptcha/api2/api.js?onload=cb&render=6Lcx",
      "score",
    ],
    ["https://www.google.com/recaptcha/enterprise.js?render=6Lcx", "score"],
    [
      "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/turnstile",
      "managed",
    ],
    ["https://client-api.arkoselabs.com/fc/assets/ec-game-core", "game"],
    ["https://api.geetest.com/get.php", "slider"],
    ["https://geo.captcha-delivery.com/captcha/?initialCid=1", "slider"],
    ["https://captcha.px-cdn.net/PX1/captcha.js", "behavioral"],
    ["https://api.friendlycaptcha.com/api/v1/puzzle", "proof-of-work"],
    ["https://service.mtcaptcha.com/mtcv1/demo/abc", "text"],
    ["https://smartcaptcha.yandexcloud.net/webtest", "checkbox"],
  ]);
  for (const [url, kind] of kinds) {
    Assert.equal(ZendiaCaptcha.kindOf(url), kind, url);
    Assert.ok(ZendiaCaptcha.KINDS.includes(kind), "a known kind");
  }
  Assert.equal(ZendiaCaptcha.kindOf("https://example.com/"), null);
});

add_task(function test_scripts_give_away_the_invisible_ones() {
  const scripts = new Map([
    [
      "https://www.google.com/recaptcha/api2/api.js?render=6Lcx",
      ["reCAPTCHA", "score"],
    ],
    [
      "https://www.gstatic.com/recaptcha/releases/abc/recaptcha__en.js",
      ["reCAPTCHA", "checkbox"],
    ],
    ["https://js.hcaptcha.com/1/api.js", ["hCaptcha", "checkbox"]],
    [
      "https://challenges.cloudflare.com/turnstile/v0/api.js",
      ["Cloudflare Turnstile", "managed"],
    ],
    ["https://js.datadome.co/tags.js", ["DataDome", "behavioral"]],
    ["https://example.com/ips.js", ["Kasada", "sensor"]],
    [
      "https://cdn.jsdelivr.net/npm/altcha@2/dist/altcha.min.js",
      ["ALTCHA", "proof-of-work"],
    ],
    [
      "https://cdn.jsdelivr.net/npm/friendly-challenge@0.9/widget.module.min.js",
      ["Friendly Captcha", "proof-of-work"],
    ],
  ]);
  for (const [url, [name, kind]] of scripts) {
    Assert.equal(ZendiaCaptcha.nameOfScript(url), name, url);
    Assert.equal(ZendiaCaptcha.kindOfScript(url), kind, url);
    Assert.equal(
      ZendiaCaptcha.kindOf(url),
      kind,
      "the kind is told either way"
    );
  }
  Assert.equal(ZendiaCaptcha.nameOfScript("https://example.com/app.js"), null);
  Assert.equal(ZendiaCaptcha.kindOfScript("https://example.com/app.js"), null);
});

add_task(function test_a_solved_one_leaves_a_known_field() {
  for (const name of [
    "g-recaptcha-response",
    "g-recaptcha-response-1",
    "h-captcha-response",
    "cf-turnstile-response",
    "frc-captcha-solution",
    "mtcaptcha-verifiedtoken",
    "aws-waf-token",
    "fc-token",
    "altcha",
    "geetest_validate",
  ]) {
    Assert.ok(ZendiaCaptcha.isTokenField(name), name);
  }
  for (const name of ["username", "csrfmiddlewaretoken", "g-recaptcha"]) {
    Assert.ok(!ZendiaCaptcha.isTokenField(name), name);
  }
});

add_task(function test_a_trap_field_is_known_by_its_name() {
  Assert.ok(ZendiaCaptcha.isHoneypotField("website", { visible: false }));
  Assert.ok(ZendiaCaptcha.isHoneypotField("hp", { visible: false }));
  Assert.ok(
    !ZendiaCaptcha.isHoneypotField("website"),
    "one a person can see is no trap"
  );
  Assert.ok(
    !ZendiaCaptcha.isHoneypotField("email", { visible: false }),
    "nor a hidden field with an honest name"
  );
});

// The controls below are as reCAPTCHA's and hCaptcha's challenges have them.
add_task(function test_the_buttons_of_a_challenge_are_known_by_what_they_do() {
  const purpose = control => ZendiaCaptcha.purposeOf(control);
  const button = (label, name = "") => ({ tag: "button", label, name });
  Assert.equal(
    purpose(button("Get a new challenge", "recaptcha-reload-button rc-button")),
    "reload"
  );
  Assert.equal(
    purpose(button("Get an audio challenge", "recaptcha-audio-button")),
    "audio"
  );
  Assert.equal(
    purpose(button("Get a visual challenge", "recaptcha-image-button")),
    "visual"
  );
  Assert.equal(purpose(button("SKIP", "recaptcha-verify-button")), "verify");
  Assert.equal(purpose(button("Verify")), "verify");
  Assert.equal(purpose(button("Next")), "verify");
  Assert.equal(
    purpose(button("PLAY", "rc-button-default rc-audiochallenge-play-button")),
    "play",
    "play, though it sits in the audio challenge"
  );
  Assert.equal(
    purpose({
      tag: "div",
      label: "Verify Answers",
      name: "button-submit button",
    }),
    "verify"
  );
  Assert.equal(purpose({ tag: "div", label: "Refresh Challenge." }), "reload");
  Assert.equal(purpose(button("Restart")), "reload");
  Assert.equal(purpose(button("", "refresh button")), "reload", "by its class");
});

add_task(function test_the_answer_field_and_what_is_not_a_purpose() {
  const purpose = control => ZendiaCaptcha.purposeOf(control);
  Assert.equal(
    purpose({
      tag: "input",
      type: "text",
      editable: true,
      name: "audio-response",
    }),
    "answer",
    "a text field is the answer, whatever its name says"
  );
  Assert.equal(purpose({ tag: "textarea", editable: true }), "answer");
  Assert.equal(purpose({ tag: "div", editable: true }), "answer");
  Assert.equal(purpose({ tag: "select", editable: true }), null);
  Assert.equal(
    purpose({ tag: "input", type: "checkbox", label: "Verify you are human" }),
    null,
    "Turnstile's checkbox is labeled, not verified"
  );
  Assert.equal(
    purpose({
      tag: "td",
      label: "Image challenge",
      name: "rc-imageselect-tile",
    }),
    null,
    "an image to pick"
  );
  Assert.equal(
    purpose({
      tag: "a",
      label: "Alternatively, download audio as MP3",
      name: "rc-audiochallenge-tdownload-link",
    }),
    null
  );
  Assert.equal(
    purpose({ tag: "button", label: "Help", name: "recaptcha-help-button" }),
    null
  );
  Assert.equal(purpose({}), null);
});

add_task(function test_a_sites_own_captcha_is_known_by_its_names() {
  for (const names of [
    "/dist/web/assets/captcha-rn1S3orp.jpg normal captcha example _captchaImage_rrn3u_9",
    "simple-captcha-field simpleCaptcha Enter answer here...",
    "/securimage/securimage_show.php security_code",
    "Enter the characters you see",
  ]) {
    Assert.ok(ZendiaCaptcha.namesOwnCaptcha(names), names);
  }
  for (const names of [
    "/assets/normal-captcha.svg Logo of «Normal Captcha»",
    "g-recaptcha-response",
    "search q Search",
    "",
  ]) {
    Assert.ok(!ZendiaCaptcha.namesOwnCaptcha(names), names);
  }
});
