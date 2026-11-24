/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

let lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
});

const { InternalTestingProfileMigrator } = ChromeUtils.importESModule(
  "moz-src:///browser/components/migration/InternalTestingProfileMigrator.sys.mjs"
);

const { MigrationWizardConstants } = ChromeUtils.importESModule(
  "chrome://browser/content/migration/migration-wizard-constants.mjs"
);

/* eslint-disable mozilla/no-arbitrary-setTimeout */

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// The page's 2D SVG preview on the stage.
function previewSvg() {
  return welcomeDocument().querySelector("#zen-welcome-stage svg");
}

// The chapters along the top, by their state.
function chapters() {
  return [...welcomeDocument().querySelectorAll(".zen-welcome-chapter")];
}

add_task(async function test_Welcome_Steps() {
  const selectedTab = gBrowser.selectedTab;
  await wait(2000); // Give the onboarding time to load.
  await waitForFocus();

  // The onboarding takes the window as it is: it fills it and follows it
  // when it is resized, and never sets a size of its own.
  const root = document.documentElement;
  const fills = () => {
    const stage = document
      .getElementById("zen-welcome")
      .getBoundingClientRect();
    return (
      Math.abs(stage.width - window.innerWidth) <= 1 &&
      Math.abs(stage.height - window.innerHeight) <= 1
    );
  };
  ok(fills(), "The onboarding fills the window");
  for (const property of ["minWidth", "maxWidth", "minHeight", "maxHeight"]) {
    Assert.equal(root.style[property], "", `The window has no ${property}`);
  }
  const outerWidth = window.outerWidth;
  const outerHeight = window.outerHeight;
  window.resizeTo(outerWidth - 160, outerHeight - 90);
  await TestUtils.waitForCondition(
    () => window.outerWidth != outerWidth && fills(),
    "the onboarding follows the window to another size"
  );
  window.resizeTo(outerWidth, outerHeight);
  await TestUtils.waitForCondition(
    () => window.outerWidth == outerWidth && fills(),
    "and back"
  );

  // The start page.
  await TestUtils.waitForCondition(
    () =>
      welcomeDocument().querySelector(
        "#zen-welcome-start-button [data-l10n-id]"
      )?.textContent,
    "the start page to be shown and translated"
  );
  ok(
    welcomeDocument()
      .getElementById("zen-welcome-start-button")
      .textContent.includes("Zendia"),
    "The start page names Zendia, whatever the build's brand is"
  );
  await TestUtils.waitForCondition(
    () => previewSvg()?.getBoundingClientRect().width > 0,
    "the start page's 2D mascot preview to be drawn"
  );
  await clickInWelcome(
    welcomeDocument().getElementById("zen-welcome-start-button")
  );
  await waitForChapter("keys");
  await wait(800);

  // Vim mode is offered in the onboarding, not assumed before it.
  Assert.equal(
    document.getElementById("zendia-statusline")?.style.display,
    "none",
    "No vim mode indicator during the onboarding"
  );
  ok(!root.hasAttribute("zendia-mode"), "Nor a vim mode color on the window");
  Assert.equal(chapters().length, 6, "The onboarding has six chapters");
  Assert.equal(
    chapters().filter(chapter => !chapter.disabled).length,
    1,
    "Only the first can be gone to yet"
  );

  // Keys.
  const backButton = welcomeDocument().getElementById("zen-welcome-back");
  ok(backButton.disabled, "There is no going back from the first chapter");
  Assert.equal(
    welcomeDocument().querySelectorAll(".zen-welcome-zendia-keys kbd").length,
    6,
    "The keys chapter shows the keys its preview plays"
  );
  ok(
    currentPageContent().querySelector("#zen-welcome-zendia-keys-yes").checked,
    "Vim mode is on by default"
  );
  // The 2D preview names the key it is playing: within a loop one of the
  // keys is opened to say what it does.
  await TestUtils.waitForCondition(
    () =>
      welcomeDocument().querySelector(".zen-welcome-zendia-key[data-active]"),
    "the vim mode preview to play a key",
    100,
    100
  );
  await clickInWelcome(
    currentPageContent().querySelector(
      "label[for='zen-welcome-zendia-keys-no']"
    )
  );
  await TestUtils.waitForCondition(
    () =>
      !welcomeDocument().querySelector(".zen-welcome-zendia-key[data-active]"),
    "turning vim mode down stops the keys"
  );
  await clickInWelcome(
    currentPageContent().querySelector(
      "label[for='zen-welcome-zendia-keys-yes']"
    )
  );
  await goNextWelcomePage("agent");
  ok(
    Services.prefs.getBoolPref("zendia.enabled"),
    "Keeping vim mode leaves it on"
  );

  // Agent.
  await TestUtils.waitForCondition(
    () =>
      !currentPageContent().querySelector(
        "[data-l10n-id='zendia-welcome-agent-looking']"
      ),
    "the agents on this computer are looked up",
    100,
    200
  );
  ok(
    currentPageContent().querySelector(
      ".zen-welcome-option, [data-l10n-id='zendia-welcome-agent-none']"
    ),
    "It offers the agents found, or says none were"
  );
  for (const option of currentPageContent().querySelectorAll(
    ".zen-welcome-option"
  )) {
    ok(
      option.querySelector(".zen-welcome-plate img")?.getAttribute("src"),
      "Each agent is shown with its logo"
    );
  }

  // The chapters along the top lead back to the ones already seen.
  ok(!backButton.disabled, "Back works after the first chapter");
  await clickInWelcome(chapters()[0]);
  await waitForChapter("keys");
  await wait(600);
  await goNextWelcomePage("agent");

  // Enter moves on and Backspace goes back, as the buttons say.
  EventUtils.synthesizeKey("KEY_Enter", {}, welcomeWindow());
  await waitForChapter("shield");
  await wait(600);
  EventUtils.synthesizeKey("KEY_Backspace", {}, welcomeWindow());
  await waitForChapter("agent");
  await wait(600);
  await goNextWelcomePage("shield");

  // Shield. The test profile keeps uBlock Origin from being downloaded, so
  // the page starts on NO.
  ok(
    currentPageContent().querySelector("#zen-welcome-block-ads-no").checked,
    "The shield chapter shows the current choice"
  );
  await goNextWelcomePage("move-in");
  ok(
    !Services.prefs.getBoolPref("zendia.ublock.enabled"),
    "Turning ad blocking down keeps uBlock Origin away"
  );

  // Move in: what to import, the search engine and the default browser.
  ok(
    currentPageContent().querySelector("#zen-welcome-import-no").checked,
    "Starting fresh is selected by default"
  );
  const sourceSelector = `input[data-source-key="${InternalTestingProfileMigrator.key}"]`;
  await TestUtils.waitForCondition(
    () => currentPageContent().querySelector(sourceSelector),
    "the testing migrator to be listed",
    100,
    300
  );
  for (const source of currentPageContent().querySelectorAll(
    ".zen-welcome-import-source"
  )) {
    ok(
      source.querySelector("input").dataset.sourceIndex,
      "Each browser knows its source"
    );
    ok(
      source.querySelector(".engine-icon").getAttribute("src"),
      "and shows its brand image"
    );
  }
  ok(
    !currentPageContent().querySelector(".zen-welcome-import-profiles"),
    "Profiles stay hidden until their browser is selected"
  );
  // A browser with several profiles lists them once it is selected.
  for (const source of currentPageContent().querySelectorAll(
    ".zen-welcome-import-source"
  )) {
    const option = source.querySelector(".zen-welcome-option");
    option.scrollIntoView({ block: "center" });
    await clickInWelcome(option);
    ok(source.hasAttribute("expanded"), "The selected browser is marked");
    const profileRadios = source.querySelectorAll(
      ".zen-welcome-import-profile input"
    );
    if (!profileRadios.length) {
      continue;
    }
    Assert.greater(profileRadios.length, 1, "Several profiles are listed");
    ok(profileRadios[0].checked, "The first profile is selected by default");
    const secondProfile = profileRadios[1].closest(
      ".zen-welcome-import-profile"
    );
    secondProfile.scrollIntoView({ block: "center" });
    await clickInWelcome(secondProfile);
    ok(profileRadios[1].checked, "Another profile can be picked");
    break;
  }
  const startFresh = currentPageContent().querySelector(
    "label[for='zen-welcome-import-no']"
  );
  startFresh.scrollIntoView({ block: "center" });
  await clickInWelcome(startFresh);
  ok(
    !currentPageContent().querySelector(".zen-welcome-import-profiles"),
    "Choosing another option hides the profiles again"
  );

  const engines = [
    ...currentPageContent().querySelectorAll(
      "input[name='zen-welcome-search-engine']"
    ),
  ].map(input => input.closest(".zen-welcome-option"));
  Assert.greater(engines.length, 1, "The search engines are listed");
  for (const engine of engines) {
    ok(
      engine.querySelector("img").getAttribute("src"),
      "Each engine is shown with its icon"
    );
  }
  engines[1].scrollIntoView({ block: "center" });
  await clickInWelcome(engines[1]);
  await wait(100);
  ok(engines[1].querySelector("input").checked, "An engine can be picked");
  Assert.equal(
    (await lazy.SearchService.getDefault()).name,
    engines[1].querySelector(".zen-welcome-option-label").textContent.trim(),
    "and becomes the default search engine"
  );

  const makeDefault = currentPageContent().querySelector(
    "label[for='zen-welcome-set-default-browser']"
  );
  makeDefault.scrollIntoView({ block: "center" });
  await clickInWelcome(makeDefault);
  ok(
    makeDefault.querySelector("input").checked,
    "Links from other apps can be sent here"
  );
  // Don't actually change the default browser in the test.
  await clickInWelcome(
    currentPageContent().querySelector(
      "label[for='zen-welcome-dont-set-default-browser']"
    )
  );

  let wizardOpened = false;
  const windowObserver = () => {
    wizardOpened = true;
  };
  Services.obs.addObserver(windowObserver, "domwindowopened");
  await goNextWelcomePage("apps");
  Services.obs.removeObserver(windowObserver, "domwindowopened");
  ok(!wizardOpened, "Starting fresh does not open the migration wizard");

  // Back, to bring something along this time.
  await clickInWelcome(backButton);
  await waitForChapter("move-in");
  await wait(600);
  const sourceOption = currentPageContent()
    .querySelector(sourceSelector)
    .closest(".zen-welcome-option");
  sourceOption.scrollIntoView({ block: "center" });
  await clickInWelcome(sourceOption);
  ok(
    sourceOption.querySelector("input").checked,
    "The browser to import from is selected"
  );
  const wizardPromise = BrowserTestUtils.domWindowOpened();
  const nextButton = welcomeDocument().getElementById("zen-welcome-next");
  executeSoon(() => clickInWelcome(nextButton));
  const wizardWin = await wizardPromise;
  await BrowserTestUtils.waitForEvent(wizardWin, "MigrationWizard:Ready");
  const wizardShadow =
    wizardWin.document.getElementById("wizard").openOrClosedShadowRoot;
  Assert.equal(
    wizardShadow.querySelector("#wizard-deck").getAttribute("selected-view"),
    "page-" + MigrationWizardConstants.PAGES.SELECTION,
    "The wizard waits on its selection page"
  );
  const selectedSource = wizardShadow.querySelector(
    "#browser-profile-selector"
  ).selectedPanelItem;
  Assert.equal(
    selectedSource.getAttribute("key"),
    InternalTestingProfileMigrator.key,
    "The wizard opens on the browser picked in the onboarding"
  );
  Assert.equal(
    selectedSource.profile?.id,
    InternalTestingProfileMigrator.testProfile.id,
    "and on that browser's profile"
  );
  await BrowserTestUtils.closeWindow(wizardWin);
  await waitForChapter("apps");
  await wait(800);

  // Apps.
  const essentials = currentPageContent().querySelectorAll(
    "#zen-welcome-essentials .zen-welcome-essential"
  );
  Assert.greater(essentials.length, 3, "More than three apps are offered");
  await clickInWelcome(essentials[0]);
  await clickInWelcome(essentials[2]);
  ok(essentials[0].hasAttribute("selected"), "The first app is selected");
  ok(!essentials[1].hasAttribute("selected"), "The second is not");
  ok(essentials[2].hasAttribute("selected"), "The third is");
  const urlsToCheck = [essentials[0].dataset.url, essentials[2].dataset.url];
  for (const url of urlsToCheck) {
    ok(url.startsWith("https://"), `"${url}" is a web address`);
  }
  await goNextWelcomePage("go");

  // Go.
  Assert.equal(
    chapters().filter(chapter => !chapter.disabled).length,
    6,
    "Every chapter has been reached"
  );
  await goNextWelcomePage();

  await wait(3000); // Wait for the browser to come back.
  ok(
    !document.getElementById("zen-welcome"),
    "The onboarding is gone from the window"
  );
  Assert.equal(
    document.getElementById("zendia-statusline")?.style.display,
    "flex",
    "Vim mode, kept on, shows its mode once the onboarding is over"
  );

  for (const url of urlsToCheck) {
    ok(
      await PlacesUtils.history.hasVisits(url),
      `The URL "${url}" should have visits in history`
    );
  }
  Assert.equal(
    gBrowser._numZenEssentials,
    2,
    "There should be 2 Essentials after the welcome process"
  );
  Assert.equal(
    gBrowser.tabs.filter(
      tab => tab.pinned && !tab.hasAttribute("zen-essential")
    ).length,
    2,
    "There should be 2 pinned tabs after the welcome process"
  );

  gBrowser.selectedTab = selectedTab;
  const groups = gBrowser.tabGroups;
  Assert.equal(
    groups.length,
    1,
    "There should be one tab group after the welcome process"
  );
  const group = groups[0];
  Assert.equal(
    group.tabs.length,
    2,
    "The first tab group should have 2 tabs after the welcome process"
  );
  Assert.equal(
    group.label,
    "zendia basics",
    'The first tab group should be labeled "zendia basics"'
  );
  for (const tab of gBrowser.tabs) {
    if (tab.hasAttribute("zen-empty-tab")) {
      continue;
    }
    if (tab.pinned && !tab.hasAttribute("zen-essential")) {
      ok(
        tab.hasAttribute("zen-workspace-id"),
        "Pinned tabs should have a zen-workspace-id attribute"
      );
      Assert.equal(
        tab.group,
        group,
        "Pinned tabs should belong to the first tab group"
      );
    }
  }
  group.delete();
  for (const tab of gBrowser.tabs) {
    if (tab.pinned) {
      gBrowser.removeTab(tab);
    }
  }
  ok(true, "Welcome process completed successfully");
});
