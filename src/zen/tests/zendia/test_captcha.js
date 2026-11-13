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
