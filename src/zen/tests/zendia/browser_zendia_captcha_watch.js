/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { ZendiaCaptchaWatch } = ChromeUtils.importESModule(
  "resource:///modules/zendia/captcha/ZendiaCaptchaWatch.sys.mjs",
);

const ROOT = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com",
);

async function openPage(file) {
  const tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    ROOT + file,
  );
  registerCleanupFunction(() => {
    if (gBrowser.tabs.includes(tab)) {
      BrowserTestUtils.removeTab(tab);
    }
  });
  return tab;
}

const scan = (browser) =>
  SpecialPowers.spawn(browser, [], async () => {
    const { scanPage } = ChromeUtils.importESModule(
      "resource:///modules/zendia/captcha/ZendiaCaptchaWatchChild.sys.mjs",
    );
    return scanPage(content);
  });

add_task(async function test_a_page_with_a_captcha_is_reported() {
  ZendiaCaptchaWatch.init();
  const tab = await openPage("file_captcha_host.html");
  const browser = tab.linkedBrowser;

  // The page itself, read through the layer.
  const detections = await scan(browser);
  const frame = detections.find(({ signal }) => signal == "frame");
  Assert.equal(frame?.name, "hCaptcha");
  Assert.equal(frame?.kind, "image");
  Assert.equal(frame?.challenge, true);

  // And what the watch kept of it, once the page's actor spoke.
  let record = null;
  await TestUtils.waitForCondition(() => {
    record = ZendiaCaptchaWatch.lastFor(browser);
    return record?.detections.some(({ name }) => name == "hCaptcha");
  }, "the watch reports the hCaptcha frame");
  Assert.equal(record.text, "hCaptcha (image)");
  Assert.equal(record.url, ROOT + "file_captcha_host.html");
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_plain_page_reports_nothing() {
  const tab = await openPage("file_jump_frame_host.html");
  Assert.deepEqual(await scan(tab.linkedBrowser), [], "nothing is a CAPTCHA's");
  Assert.equal(
    ZendiaCaptchaWatch.lastFor(tab.linkedBrowser),
    null,
    "and the watch says nothing",
  );
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_notice_is_shown_in_dev() {
  await SpecialPowers.pushPrefEnv({
    set: [["zendia.captcha.watch.notify", true]],
  });
  ZendiaCaptchaWatch.init();
  const tab = await openPage("file_captcha_host.html");
  const browser = tab.linkedBrowser;
  await TestUtils.waitForCondition(
    () =>
      ZendiaCaptchaWatch.lastFor(browser)?.detections.some(
        ({ name }) => name == "hCaptcha",
      ),
    "the watch reports the hCaptcha frame",
  );
  const box = gBrowser.getNotificationBox(browser);
  await TestUtils.waitForCondition(
    () => box.getNotificationWithValue("zendia-captcha-watch"),
    "an infobar is shown",
  );
  const notice = box.getNotificationWithValue("zendia-captcha-watch");
  Assert.ok(
    notice.messageText.textContent.includes("hCaptcha (image)"),
    "and it names what was found",
  );
  await SpecialPowers.popPrefEnv();
  BrowserTestUtils.removeTab(tab);
});

add_task(async function test_a_captcha_a_script_adds_later_is_reported() {
  ZendiaCaptchaWatch.init();
  const tab = await openPage("file_jump_frame_host.html");
  const browser = tab.linkedBrowser;
  Assert.equal(ZendiaCaptchaWatch.lastFor(browser), null, "nothing at first");

  // As a CAPTCHA's loader does: the frame comes after the page is shown.
  await SpecialPowers.spawn(browser, [], () => {
    const frame = content.document.createElement("iframe");
    frame.src =
      "https://example.org/browser/zen/tests/zendia/file_captcha_frame.html#hcaptcha.com/frame=challenge";
    content.document.body.append(frame);
  });
  await TestUtils.waitForCondition(
    () =>
      ZendiaCaptchaWatch.lastFor(browser)?.detections.some(
        ({ name }) => name == "hCaptcha",
      ),
    "the frame added later is reported",
  );
  Assert.equal(ZendiaCaptchaWatch.lastFor(browser).text, "hCaptcha (image)");
  BrowserTestUtils.removeTab(tab);
});
