// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The onboarding, from the browser window's side. Its pages are a document
// of their own (zendia-welcome.html, built from tools/zendia-welcome with
// React and React Three Fiber) shown in a frame that fills the window. This
// file answers what the pages ask of the browser through
// the `host` object below, and puts the browser back when they are done.
// Removing the frame then frees the pages' libraries and their WebGL
// context; nothing of them stays in the window.

{
  let lazy = {};

  ChromeUtils.defineESModuleGetters(lazy, {
    ZendiaAgents: "resource:///modules/zendia/agent/ZendiaAgents.sys.mjs",
    agentIcon: "resource:///modules/zendia/agent/ZendiaAgentIcons.sys.mjs",
    ZendiaTheme: "resource:///modules/zendia/ui/ZendiaTheme.sys.mjs",
    ZendiaUblock: "resource:///modules/zendia/ublock/ZendiaUblock.sys.mjs",
    SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
  });

  const kWelcomePage =
    "chrome://browser/content/zen-welcome/zendia-welcome.html";

  const kZenElementsToIgnore = [
    "zen-browser-background",
    "zen-toast-container",
  ];

  const kEssentialApps = [
    {
      name: "Obsidian",
      url: "https://obsidian.md",
      icon: "obsidian",
      color: "#7c3aed",
    },
    {
      name: "Discord",
      url: "https://discord.com",
      icon: "discord",
      color: "#5865f2",
    },
    {
      name: "Trello",
      url: "https://trello.com",
      icon: "trello",
      color: "#0052cc",
    },
    {
      name: "Slack",
      url: "https://slack.com",
      icon: "slack",
      color: "#e01e5a",
    },
    {
      name: "GitHub",
      url: "https://github.com",
      icon: "github",
      color: "#57606a",
    },
    {
      name: "Tuta",
      url: "https://app.tuta.com/",
      icon: "tuta",
      color: "#c00002",
    },
    {
      name: "Notion",
      url: "https://notion.com",
      icon: "notion",
      color: "#37352f",
    },
    {
      name: "Google Calendar",
      url: "https://calendar.google.com",
      icon: "calendar",
      color: "#4285f4",
    },
    {
      name: "Figma",
      url: "https://figma.com",
      icon: "figma",
      color: "#f24e1e",
    },
  ];

  const kVimModePref = "zendia.enabled";

  const gChoices = {
    essentials: new Set(),
  };

  function clearBrowserElements() {
    for (const element of document.getElementById("browser").children) {
      if (kZenElementsToIgnore.includes(element.id)) {
        continue;
      }
      element.style.display = "none";
    }
  }

  function animate(...args) {
    return gZenUIManager.motion.animate(...args);
  }

  const essentialIcon = app =>
    `chrome://browser/content/zen-images/favicons/${app.icon}.svg`;

  var _iconToData = {};

  async function getIconData(iconURL) {
    if (_iconToData[iconURL]) {
      return _iconToData[iconURL];
    }
    const response = await fetch(iconURL);
    if (!response.ok) {
      console.error(`Failed to fetch icon: ${iconURL}`);
      return null;
    }
    const blob = await response.blob();
    const reader = new FileReader();
    const data = await new Promise(resolve => {
      reader.onloadend = () => {
        const base64Data = reader.result.split(",")[1];
        _iconToData[iconURL] = `data:${blob.type};base64,${base64Data}`;
        resolve(_iconToData[iconURL]);
      };
      reader.readAsDataURL(blob);
    });
    return data;
  }

  const kDefaultBrandImage = "chrome://global/skin/icons/defaultFavicon.svg";

  /**
   * Browsers with data to import, most recently used first.
   *
   * @returns {Promise<object[]>} Sources with `key`, `name`, `image` and
   *   `profiles`, the browser's profiles (`{ id, name }`) or `[null]` for a
   *   browser without any.
   */
  async function getImportableBrowsers() {
    const l10n = new Localization([
      "branding/brand.ftl",
      "browser/migrationWizard.ftl",
      "browser/zen-migration.ftl",
    ]);
    const sources = [];
    await Promise.all(
      MigrationUtils.availableMigratorKeys.map(async key => {
        try {
          const migrator = await MigrationUtils.getMigrator(key);
          if (!migrator?.enabled) {
            return;
          }
          const hasPermissions = await migrator.hasPermissions();
          if (!hasPermissions && !(await migrator.canGetPermissions())) {
            return;
          }
          let profiles = hasPermissions
            ? await migrator.getSourceProfiles()
            : [null];
          if (Array.isArray(profiles) && !profiles.length) {
            return;
          }
          if (!Array.isArray(profiles)) {
            // Single profile browsers report no profile list.
            profiles = [null];
          }
          const nameId = migrator.constructor.displayNameL10nID;
          let displayName = nameId;
          try {
            displayName = (await l10n.formatValue(nameId)) || nameId;
          } catch {}
          const lastUsed = (await migrator.getLastUsedDate()).getTime();
          sources.push({
            key,
            name: displayName,
            image: migrator.constructor.brandImage || kDefaultBrandImage,
            lastUsed,
            profiles,
          });
        } catch (ex) {
          console.error(`Could not check the ${key} migrator`, ex);
        }
      })
    );
    return sources.sort((a, b) => b.lastUsed - a.lastUsed);
  }

  async function setDefaultBrowser() {
    const shellSvc =
      AppConstants.HAVE_SHELL_SERVICE && window.getShellService();
    if (!shellSvc) {
      return;
    }
    try {
      await shellSvc.setDefaultBrowser(false);
    } catch (ex) {
      console.error(ex);
    }
  }

  /* Leaving the onboarding: what was chosen is applied and the browser comes
     back in its place. */

  async function pinEssentials() {
    const apps = kEssentialApps.filter(app => gChoices.essentials.has(app.url));
    if (!apps.length) {
      return;
    }
    await PlacesUtils.history.insertMany(
      apps.map(app => ({
        url: app.url,
        visits: [{ transition: PlacesUtils.history.TRANSITIONS.TYPED }],
      }))
    );
    const { TabStateCache } = ChromeUtils.importESModule(
      "moz-src:///browser/components/sessionstore/TabStateCache.sys.mjs"
    );
    for (const app of apps) {
      const tab = window.gBrowser.addTrustedTab(app.url, {
        inBackground: true,
        createLazyBrowser: true,
      });
      const icon = await getIconData(essentialIcon(app));
      // Update the persistent tab state cache with |tabData| information.
      TabStateCache.update(tab.linkedBrowser.permanentKey, {
        history: { entries: [{ url: app.url }], index: 0 },
        image: icon,
      });
      gBrowser.setIcon(tab, icon);
      tab.removeAttribute("pending"); // Make it appear loaded
      gZenPinnedTabManager.addToEssentials(tab);
    }
  }

  async function applyChoices() {
    await pinEssentials();
    let tabsToGroup = [];
    if (!gBrowser.selectedTab.hasAttribute("zen-empty-tab")) {
      tabsToGroup.push(gBrowser.selectedTab);
    }
    gZenFolders.createFolder(tabsToGroup, {
      renameFolder: false,
      label: "zendia basics",
    });
  }

  let _finishing = false;

  async function finish() {
    if (_finishing) {
      return;
    }
    _finishing = true;
    gZenWorkspaces.reorganizeTabsAfterWelcome();
    const applied = applyChoices();
    await animate("#zen-welcome", { opacity: [1, 0] });
    await applied;
    _iconToData = undefined; // Unload icon data
    document.getElementById("zen-welcome").remove();
    delete window.zendiaWelcomeHost;
    document.documentElement.removeAttribute("zen-welcome-stage");
    for (const element of document.getElementById("browser").children) {
      if (kZenElementsToIgnore.includes(element.id)) {
        continue;
      }
      element.style.opacity = 0;
      element.style.removeProperty("display");
    }
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new window.Event("resize")); // To recalculate the layout
    });
    gZenFolders.relayoutCollapsedFolders();
    let elementsToIgnore = kZenElementsToIgnore.map(id => `#${id}`).join(", ");
    await animate(`#browser > *:not(${elementsToIgnore})`, {
      opacity: [0, 1],
    });
  }

  /**
   * What the onboarding's pages can ask of the browser. They find it as
   * `window.parent.zendiaWelcomeHost`; tools/zendia-welcome/dev/host.js is
   * its stand-in outside the browser, so keep the two alike.
   */
  function createHost() {
    let importSources = [];
    let engines = [];
    let agents = [];
    return {
      dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches,
      vimEnabled: Services.prefs.getBoolPref(kVimModePref, true),
      adBlocking: lazy.ZendiaUblock.enabled,
      essentialApps: kEssentialApps.map(app => ({
        name: app.name,
        url: app.url,
        color: app.color,
        icon: essentialIcon(app),
      })),

      async getImportSources() {
        importSources = await getImportableBrowsers();
        return importSources;
      },

      startImport(sourceIndex, profileIndex) {
        const source = importSources[sourceIndex];
        if (!source) {
          return;
        }
        MigrationUtils.showMigrationWizard(window, {
          entrypoint: MigrationUtils.MIGRATION_ENTRYPOINTS.FIRSTRUN,
          isStartupMigration: true,
          migratorKey: source.key,
          profileId: source.profiles[profileIndex]?.id,
        });
      },

      setVimMode(enabled) {
        Services.prefs.setBoolPref(kVimModePref, enabled);
      },

      async getAgents() {
        const all = await lazy.ZendiaAgents.agents();
        const preferred = await lazy.ZendiaAgents.defaultAgent();
        agents = all.filter(agent => agent.path);
        return {
          installed: agents.map(agent => ({
            id: agent.id,
            name: agent.name,
            version: agent.version ?? "",
            color: lazy.ZendiaTheme.agentColor(agent.id),
            icon: lazy.agentIcon(agent.id),
          })),
          missing: all
            .filter(agent => !agent.path)
            .map(agent => ({
              id: agent.id,
              name: agent.name,
              install: agent.install,
              icon: lazy.agentIcon(agent.id),
            })),
          preferredId: preferred?.id ?? null,
        };
      },

      chooseAgent(id) {
        const agent = agents.find(candidate => candidate.id == id);
        if (!agent) {
          return;
        }
        lazy.ZendiaAgents.setDefaultAgent(agent.id);
        // Agents that need zendia added to their own config get it now, so
        // the first question just works.
        lazy.ZendiaAgents.ensureConnected(agent).catch(console.error);
      },

      async getSearchEngines() {
        const visible = await lazy.SearchService.getVisibleEngines();
        engines = visible.filter(engine => {
          const lower = engine.name.toLowerCase();
          return !lower.includes("wikipedia") && !lower.includes("ebay");
        });
        const defaultEngine = await lazy.SearchService.getDefault();
        return {
          engines: await Promise.all(
            engines.map(async engine => ({
              name: engine.name,
              iconURL: (await engine.getIconURL(96)) ?? kDefaultBrandImage,
            }))
          ),
          defaultName: defaultEngine.name,
        };
      },

      setSearchEngine(engineName) {
        const engine = engines.find(candidate => candidate.name == engineName);
        if (engine) {
          lazy.SearchService.setDefault(
            engine,
            lazy.SearchService.CHANGE_REASON.USER
          ).catch(console.error);
        }
      },

      // uBlock Origin is installed at startup; this keeps or drops it.
      setAdBlocking(enabled) {
        lazy.ZendiaUblock.setEnabled(enabled).catch(console.error);
      },

      setEssentials(urls) {
        gChoices.essentials = new Set(urls);
      },

      setDefaultBrowser(enabled) {
        if (enabled) {
          setDefaultBrowser();
        }
      },

      finish,
    };
  }

  function initializeZenWelcome() {
    document.documentElement.setAttribute("zen-welcome-stage", "true");
    window.zendiaWelcomeHost = createHost();
    const stage = document.createElement("div");
    stage.id = "zen-welcome";
    const frame = document.createElement("iframe");
    frame.id = "zen-welcome-frame";
    frame.src = kWelcomePage;
    stage.appendChild(frame);
    document.getElementById("browser").appendChild(stage);
    // The pages have no title bar of their own: their background drags the
    // window, as the browser's toolbars do.
    frame.contentWindow.docShell.windowDraggingAllowed = true;
    frame.addEventListener("load", () => frame.contentWindow.focus(), {
      once: true,
    });
  }

  // The onboarding takes the browser window as it is, whatever its size:
  // the pages lay themselves out to fit.
  function startZenWelcome() {
    lazy.ZendiaUblock.sync();
    clearBrowserElements();
    initializeZenWelcome();
  }

  startZenWelcome();
}
