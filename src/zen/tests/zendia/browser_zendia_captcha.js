/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const ROOT = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com"
);

function type(keys) {
  for (const key of keys) {
    EventUtils.synthesizeKey(key, { shiftKey: key != key.toLowerCase() });
  }
}

// The labels on the page, not the prompt that says what the jump is.
const labelsShown = tab =>
  SpecialPowers.spawn(tab.linkedBrowser, [], () =>
    [...content.document.documentElement.querySelectorAll("div > span")]
      .map(span => span.textContent)
      .filter(text => text && !text.includes(" "))
  );

async function openChallenge() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    ROOT + "file_captcha_host.html"
  );
  registerCleanupFunction(() => {
    if (gBrowser.tabs.includes(tab)) {
      BrowserTestUtils.removeTab(tab);
    }
  });
  const browser = tab.linkedBrowser;
  browser.focus();
  await SpecialPowers.spawn(browser, [], () => content.focus());
  const frame = browser.browsingContext.children.find(
    child => child.currentURI?.host == "example.org"
  );
  ok(frame, "the challenge is a frame of another site");
  const selected = () =>
    SpecialPowers.spawn(
      frame,
      [],
      () => content.document.querySelectorAll("[data-on=yes]").length
    );
  return { tab, frame, selected };
}

add_task(async function test_a_challenge_stays_open_for_every_pick() {
  const { tab, frame, selected } = await openChallenge();

  // Reading order: the page's button, the three images, the check.
  type("s");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 5,
    "the page and the challenge are labeled"
  );
  const before = await labelsShown(tab);
  type(before[1]);
  await TestUtils.waitForCondition(
    async () => (await selected()) == 1,
    "a label picks an image"
  );
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 4,
    "the labels stay, on the challenge alone"
  );
  Assert.deepEqual(
    await labelsShown(tab),
    before.slice(1),
    "and they are the ones that were there, not new ones"
  );

  type((await labelsShown(tab))[1]);
  await TestUtils.waitForCondition(
    async () => (await selected()) == 2,
    "the next image is picked without pressing s again"
  );
  type((await labelsShown(tab))[2]);
  await TestUtils.waitForCondition(
    async () => (await selected()) == 3,
    "and the one after"
  );
  is((await labelsShown(tab)).length, 4, "the labels are still there");

  // The check hides the challenge: the jump ends when it is gone.
  type((await labelsShown(tab))[3]);
  await TestUtils.waitForCondition(
    async () =>
      await SpecialPowers.spawn(frame, [], () => content.document.body.hidden),
    "the check is pressed"
  );
  await TestUtils.waitForCondition(
    async () => !(await labelsShown(tab)).length,
    "the labels go once the challenge does"
  );

  type("s");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 1,
    "s labels the page again, which has the one control left"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_escape_leaves_a_challenge() {
  const { tab, selected } = await openChallenge();
  type("s");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 5,
    "labels"
  );
  type((await labelsShown(tab))[1]);
  await TestUtils.waitForCondition(
    async () => (await selected()) == 1 && (await labelsShown(tab)).length == 4,
    "an image is picked and the labels stay"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    async () => !(await labelsShown(tab)).length,
    "<Esc> drops the labels"
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_other_pages_still_end_after_one_pick() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    ROOT + "file_jump_frame_host.html"
  );
  tab.linkedBrowser.focus();
  await SpecialPowers.spawn(tab.linkedBrowser, [], () => content.focus());
  type("s");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 3,
    "labels"
  );
  type((await labelsShown(tab))[1]);
  await TestUtils.waitForCondition(
    async () => !(await labelsShown(tab)).length,
    "a frame that is not a challenge ends the jump at the first pick"
  );
  BrowserTestUtils.removeTab(tab);
});

// The labels on the page with where they are, the pad's cells included.
const tagsShown = tab =>
  SpecialPowers.spawn(tab.linkedBrowser, [], () =>
    [...content.document.documentElement.querySelectorAll("div > span")]
      .filter(span => span.textContent && !span.textContent.includes(" "))
      .map(span => {
        const { left, top } = span.getBoundingClientRect();
        return { text: span.textContent, left, top };
      })
  );

async function openSlider() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    ROOT + "file_captcha_slider_host.html"
  );
  registerCleanupFunction(() => {
    if (gBrowser.tabs.includes(tab)) {
      BrowserTestUtils.removeTab(tab);
    }
  });
  const browser = tab.linkedBrowser;
  browser.focus();
  await SpecialPowers.spawn(browser, [], () => content.focus());
  const frame = browser.browsingContext.children.find(
    child => child.currentURI?.host == "example.org"
  );
  ok(frame, "the challenge is a frame of another site");
  const handle = () =>
    SpecialPowers.spawn(frame, [], () => {
      const element = content.document.getElementById("btn");
      return {
        left: parseFloat(element.style.left || 0),
        down: element.dataset.down,
        released: element.dataset.released,
      };
    });
  const clicked = () =>
    SpecialPowers.spawn(
      frame,
      [],
      () => content.document.getElementById("board").dataset.click
    );
  // Where the picture is in the page.
  const board = () =>
    SpecialPowers.spawn(browser, [], () => {
      const box = content.document
        .getElementById("challenge")
        .getBoundingClientRect();
      return { left: box.left + 8, top: box.top + 8 + 40 };
    });
  return { tab, frame, handle, clicked, board };
}

add_task(async function test_gc_labels_only_the_captcha() {
  const { tab } = await openSlider();
  type("gc");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 1,
    "the handle of the slider is labeled, and not the button of the page"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    async () => !(await labelsShown(tab)).length,
    "<Esc> drops the labels"
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_slider_is_dragged_with_the_keys() {
  const { tab, handle } = await openSlider();
  type("gc");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 1,
    "the handle is labeled"
  );
  type((await labelsShown(tab))[0]);
  await TestUtils.waitForCondition(
    async () => (await handle()).down == "yes",
    "its label presses the mouse on the handle"
  );
  type("L");
  type("L");
  await TestUtils.waitForCondition(
    async () => Math.round((await handle()).left) == 20,
    "L moves it 10px, twice"
  );
  type("h");
  await TestUtils.waitForCondition(
    async () => Math.round((await handle()).left) == 18,
    "h moves it back 2px"
  );
  type("3l");
  await TestUtils.waitForCondition(
    async () => Math.round((await handle()).left) == 24,
    "a count moves it that many times"
  );
  EventUtils.synthesizeKey("KEY_Enter");
  await TestUtils.waitForCondition(
    async () => (await handle()).released == "24",
    "<CR> lets go where it is"
  );
  is((await handle()).down, "", "and the mouse is up");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 1,
    "the labels are back"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_escape_lets_go_of_a_slider_where_it_began() {
  const { tab, handle } = await openSlider();
  type("gc");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 1,
    "labeled"
  );
  type((await labelsShown(tab))[0]);
  await TestUtils.waitForCondition(
    async () => (await handle()).down == "yes",
    "held"
  );
  type("L");
  await TestUtils.waitForCondition(
    async () => Math.round((await handle()).left) == 10,
    "moved"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    async () => (await handle()).released == "0",
    "<Esc> takes it back to the start and lets go"
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_point_of_a_picture_is_clicked_with_the_keys() {
  const { tab, clicked, board } = await openSlider();
  type("gc");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 1,
    "labeled"
  );
  type(".");
  // The cells of the grid, two letters each.
  await TestUtils.waitForCondition(
    async () => (await tagsShown(tab)).length > 10,
    "a grid is drawn over the challenge"
  );
  const { left, top } = await board();
  const cell = (await tagsShown(tab)).find(
    tag =>
      tag.text.length == 2 &&
      tag.left > left + 40 &&
      tag.left < left + 120 &&
      tag.top > top + 20 &&
      tag.top < top + 60
  );
  ok(cell, "a cell lies over the picture");
  type(cell.text);
  is(await clicked(), undefined, "its label only moves the cursor there");
  type(" ");
  await TestUtils.waitForCondition(
    async () => !!(await clicked()),
    "<Space> clicks the middle of the cell"
  );
  const [x, y] = (await clicked()).split(",").map(Number);
  // The cell is about 40 wide, the middle about 20 in from its corner.
  ok(Math.abs(x + 8 + 8 - (cell.left + 19)) < 30, `x is in the cell (${x})`);
  ok(y > 0, "and so is y");
  EventUtils.synthesizeKey("KEY_Escape");
  EventUtils.synthesizeKey("KEY_Escape");
  BrowserTestUtils.removeTab(tab);
});

async function openBoard() {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    ROOT + "file_captcha_board.html"
  );
  registerCleanupFunction(() => {
    if (gBrowser.tabs.includes(tab)) {
      BrowserTestUtils.removeTab(tab);
    }
  });
  tab.linkedBrowser.focus();
  await SpecialPowers.spawn(tab.linkedBrowser, [], () => content.focus());
  const board = key =>
    SpecialPowers.spawn(
      tab.linkedBrowser,
      [key],
      key => content.document.getElementById("board").dataset[key]
    );
  return { tab, board };
}

add_task(
  async function test_a_capital_label_holds_a_piece_and_a_board_takes_it() {
    const { tab, board } = await openBoard();
    type("s");
    // The button of the page, three pieces and the picture.
    await TestUtils.waitForCondition(
      async () => (await labelsShown(tab)).length == 5,
      "labeled"
    );
    const labels = await labelsShown(tab);
    // Reading order: button, first piece (diagonal), ..., picture last.
    // A plain label: a piece on a board with empty places is held anyway.
    type(labels[1]);
    await TestUtils.waitForCondition(
      async () => (await board("held")) == "0",
      "a piece's label presses the mouse on it rather than clicking it"
    );
    // Every place of the board is labeled, the empty ones too: nine of them.
    await TestUtils.waitForCondition(
      async () => (await tagsShown(tab)).length == 9,
      "the places of the board are labeled"
    );
    const cell = await SpecialPowers.spawn(tab.linkedBrowser, [], () => {
      const box = content.document
        .querySelectorAll(".cell")[2]
        .getBoundingClientRect();
      return { left: box.left, top: box.top };
    });
    const place = (await tagsShown(tab)).find(
      tag =>
        Math.abs(tag.left - cell.left) < 4 && Math.abs(tag.top - cell.top) < 4
    );
    ok(place, "one of them lies on the third place");
    type(place.text);
    await TestUtils.waitForCondition(
      async () => (await board("moved")) == "0>2",
      "its label puts the piece there and lets go"
    );
    await TestUtils.waitForCondition(
      async () => (await labelsShown(tab)).length > 0,
      "the labels are back, for the next piece"
    );
    EventUtils.synthesizeKey("KEY_Escape");
    BrowserTestUtils.removeTab(tab);
  }
);

add_task(
  async function test_a_picture_is_pointed_at_not_clicked_in_the_middle() {
    const { tab } = await openBoard();
    type("s");
    await TestUtils.waitForCondition(
      async () => (await labelsShown(tab)).length == 5,
      "labeled"
    );
    const labels = await labelsShown(tab);
    type(labels[4]);
    await TestUtils.waitForCondition(
      async () => (await tagsShown(tab)).length > 10,
      "the grid is drawn over the picture"
    );
    const box = await SpecialPowers.spawn(tab.linkedBrowser, [], () => {
      const rect = content.document
        .getElementById("picture")
        .getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    });
    ok(
      (await tagsShown(tab)).every(
        tag =>
          tag.left >= box.left - 2 &&
          tag.left <= box.right &&
          tag.top >= box.top - 2 &&
          tag.top <= box.bottom
      ),
      "and over the picture alone"
    );
    EventUtils.synthesizeKey("KEY_Escape");
    EventUtils.synthesizeKey("KEY_Escape");
    BrowserTestUtils.removeTab(tab);
  }
);

add_task(async function test_a_capital_label_holds_what_is_not_known_to_drag() {
  const { tab, selected } = await openChallenge();
  type("gc");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 4,
    "labeled"
  );
  // A capital holds the mouse on an image; <CR> lets go, which is a click.
  type((await labelsShown(tab))[0].toUpperCase());
  // The three places of the row are labeled, for the piece to be put on one.
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 3,
    "the labels give way to the places of the mouse"
  );
  is(await selected(), 0, "held, not clicked yet");
  // <CR> lets go where it is.
  EventUtils.synthesizeKey("KEY_Enter");
  await TestUtils.waitForCondition(
    async () => (await selected()) == 1,
    "letting go on the image clicks it"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_grid_of_images_is_clicked_not_held() {
  const { tab, frame, selected } = await openChallenge();
  type("gc");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 4,
    "the three images and the check are labeled"
  );
  type((await labelsShown(tab))[0]);
  await TestUtils.waitForCondition(
    async () => (await selected()) == 1,
    "an image of a full grid is a click, not a hold"
  );
  ok(frame, "in the frame");
  EventUtils.synthesizeKey("KEY_Escape");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_ruler_puts_a_slider_on_its_line() {
  const { tab, handle } = await openSlider();
  type("gc");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 1,
    "the handle is labeled"
  );
  type((await labelsShown(tab))[0]);
  // A letter for every stop of the slider, along the 270px it can go.
  await TestUtils.waitForCondition(
    async () =>
      (await tagsShown(tab)).filter(tag => tag.text.length == 1).length == 21,
    "a ruler of single letters is laid along the slider"
  );
  // The seventh stop, of 21 over 270px: 90px along.
  type("w");
  await TestUtils.waitForCondition(
    async () => Math.round((await handle()).left) == 90,
    "its letter takes the handle to its line"
  );
  is((await handle()).down, "yes", "still held, to be set finely");
  EventUtils.synthesizeKey("KEY_Enter");
  await TestUtils.waitForCondition(
    async () => (await handle()).released == "90",
    "and <CR> lets go there"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_enter_verifies_from_the_cursor() {
  const { tab, frame, selected } = await openChallenge();
  type("gc");
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 4,
    "labeled"
  );
  type(".");
  await TestUtils.waitForCondition(
    async () => (await tagsShown(tab)).length > 4,
    "the cursor's grid is drawn"
  );
  EventUtils.synthesizeKey("KEY_Enter");
  await TestUtils.waitForCondition(
    async () =>
      await SpecialPowers.spawn(frame, [], () => content.document.body.hidden),
    "<CR> presses the check, as it does from the labels"
  );
  is(await selected(), 0, "and clicks nothing on the way");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_gc_says_what_it_labeled() {
  const { Zendia } = ChromeUtils.importESModule(
    "resource:///modules/zendia/Zendia.sys.mjs"
  );
  const { tab } = await openChallenge();
  is(
    await Zendia.run(
      "jump.captcha",
      { orPage: true },
      { browser: tab.linkedBrowser }
    ),
    "captcha",
    "the CAPTCHA is labeled"
  );
  await TestUtils.waitForCondition(
    async () => (await labelsShown(tab)).length == 4,
    "its controls alone"
  );
  EventUtils.synthesizeKey("KEY_Escape");
  BrowserTestUtils.removeTab(tab);
});

add_task(
  async function test_or_page_labels_a_page_whose_captcha_is_not_found() {
    const { Zendia } = ChromeUtils.importESModule(
      "resource:///modules/zendia/Zendia.sys.mjs"
    );
    const tab = await BrowserTestUtils.openNewForegroundTab(
      gBrowser,
      "data:text/html,<button>One</button> <button>Two</button> <a href='%23x'>Three</a>"
    );
    const browser = tab.linkedBrowser;
    browser.focus();
    is(
      await Zendia.run("jump.captcha", { orPage: true }, { browser }),
      "page",
      "with no CAPTCHA to find, the page is labeled"
    );
    await TestUtils.waitForCondition(
      async () => (await labelsShown(tab)).length == 3,
      "every control of it, as `s` labels them"
    );
    EventUtils.synthesizeKey("KEY_Escape");
    await TestUtils.waitForCondition(
      async () => !(await labelsShown(tab)).length,
      "<Esc> drops them"
    );
    BrowserTestUtils.removeTab(tab);
  }
);
