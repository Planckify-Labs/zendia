/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The onboarding's pages are a document of their own, in a frame of the
// browser window.

function welcomeWindow() {
  return document.getElementById("zen-welcome-frame").contentWindow;
}

function welcomeDocument() {
  return welcomeWindow().document;
}

function clickInWelcome(element) {
  return EventUtils.synthesizeMouseAtCenter(element, {}, welcomeWindow());
}

// The page of the chapter the onboarding is on, and that chapter's name.
function currentPageContent() {
  return welcomeDocument().querySelector(
    "#zen-welcome-page-content > .zen-welcome-page"
  );
}

function currentChapter() {
  return currentPageContent()?.getAttribute("page");
}

function waitForChapter(id) {
  return TestUtils.waitForCondition(
    () => currentChapter() === id,
    `the onboarding to be on its "${id}" chapter`
  );
}

/**
 * Presses the onboarding's Next button and waits for the chapter it leads
 * to, if one is named.
 *
 * @param {string} [chapter]
 */
async function goNextWelcomePage(chapter) {
  await clickInWelcome(welcomeDocument().getElementById("zen-welcome-next"));
  if (chapter) {
    await waitForChapter(chapter);
  }
  // Let the page's entrance settle before anything on it is clicked.
  /* eslint-disable-next-line mozilla/no-arbitrary-setTimeout */
  await new Promise(resolve => setTimeout(resolve, 600));
}

async function waitForFocus(...args) {
  await new Promise(resolve => SimpleTest.waitForFocus(resolve, ...args));
}
