/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Stands in for the browser on the dev page: a host with made up answers,
// Fluent's part, and what a headless screenshot needs.
//
//   ?step=1        open on that page (0 is the first after the start page)
//   ?theme=light   the light theme
//   ?choice=0      answer the yes or no pages with no
//   ?t=9.4         hold the preview at that second of its loop
//   ?strike=0.02   hold a thunder strike at that age, in seconds
//   ?apps=3        pick that many Essentials
//   ?wait=3500     hold the load event (for `firefox --screenshot`)

const params = new URLSearchParams(location.search);

// Errors on the page itself, where a headless screenshot shows them.
function report(message) {
  const box = document.body.appendChild(document.createElement("pre"));
  box.style.cssText =
    "position:fixed;inset:0 0 auto 0;z-index:9;margin:0;padding:8px;background:#b00020;color:#fff;font:12px monospace;white-space:pre-wrap";
  box.textContent = message;
}
addEventListener("error", event => report(`${event.message}\n${event.filename}:${event.lineno}`));
addEventListener("unhandledrejection", event => report(String(event.reason?.stack ?? event.reason)));
const consoleError = console.error;
console.error = (...args) => {
  consoleError(...args);
  report(
    args
      .map(arg => arg?.stack ?? String(arg))
      .join(" ")
      .slice(0, 900)
  );
};

const log = name => (...args) => console.log(`host.${name}`, ...args);
const later = (value, ms = 300) => new Promise(resolve => setTimeout(() => resolve(value), ms));
const apps = ["obsidian", "discord", "trello", "slack", "github", "tuta", "notion", "calendar", "figma"].map(name => ({
  url: `https://${name}.example`,
  name,
  icon: `/favicons/${name}.svg`,
  color: "#5865f2",
}));

window.zendiaWelcomeHost = {
  dark: params.get("theme") != "light",
  reducedMotion: false,
  vimEnabled: true,
  adBlocking: true,
  essentialApps: apps,
  dev: {
    step: params.has("step") ? Number(params.get("step")) : undefined,
    choice: params.has("choice") ? params.get("choice") != "0" : undefined,
    frozenAt: params.has("t") ? Number(params.get("t")) : undefined,
    frozenStrike: params.has("strike") ? Number(params.get("strike")) : undefined,
    essentials: apps.slice(0, Number(params.get("apps") ?? 0)).map(app => app.url),
  },
  getImportSources: () =>
    later([
      { key: "firefox", name: "Firefox", image: "/favicons/github.svg", profiles: [{ id: "a", name: "Work" }, { id: "b", name: "Home" }] },
      { key: "chrome", name: "Chrome", image: "/favicons/figma.svg", profiles: [null] },
    ]),
  startImport: log("startImport"),
  setVimMode: log("setVimMode"),
  getAgents: () =>
    later({
      installed: [
        { id: "claude", name: "Claude Code", version: "2.1.0", color: "#d97757", icon: "/favicons/obsidian.svg" },
        { id: "codex", name: "Codex", version: "0.50.0", color: "#10a37f", icon: "/favicons/figma.svg" },
      ],
      missing: [{ id: "cursor", name: "Cursor", install: "curl https://cursor.com/install -fsS | bash", icon: "/favicons/github.svg" }],
      preferredId: "claude",
    }),
  chooseAgent: log("chooseAgent"),
  getSearchEngines: () =>
    later({
      engines: ["Google", "Bing", "DuckDuckGo", "Perplexity", "Ecosia", "Qwant"].map((name, index) => ({
        name,
        iconURL: `/favicons/${apps[index].name}.svg`,
      })),
      defaultName: "Google",
    }),
  setSearchEngine: log("setSearchEngine"),
  setAdBlocking: log("setAdBlocking"),
  setEssentials: log("setEssentials"),
  setDefaultBrowser: log("setDefaultBrowser"),
  showThemePicker: log("showThemePicker"),
  hideThemePicker: log("hideThemePicker"),
  finish: log("finish"),
};

// Fluent's part: fill every element that names a message.
fetch("/zen-welcome.ftl")
  .then(response => response.text())
  .then(source => {
    const messages = new Map();
    for (const line of source.split("\n")) {
      const match = /^([a-z0-9-]+) = (.*)$/.exec(line);
      if (match) {
        messages.set(match[1], match[2]);
      }
    }
    const translate = element => {
      const args = JSON.parse(element.dataset.l10nArgs ?? "{}");
      const html = (messages.get(element.dataset.l10nId) ?? element.dataset.l10nId)
        .replaceAll("{ -zendia-name }", "Zendia")
        .replace(/\{ \$(\w+) \}/g, (_, name) => args[name]);
      // Writing it again would wake the observer below for ever.
      if (element.l10nShown != html) {
        element.l10nShown = html;
        element.innerHTML = html;
      }
    };
    const scan = () => document.querySelectorAll("[data-l10n-id]").forEach(translate);
    new MutationObserver(scan).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-l10n-id", "data-l10n-args"],
    });
    scan();
  });

if (params.has("wait")) {
  // Headless Firefox leaves WebGL out of its screenshots, so the preview is
  // copied every frame to a 2D canvas laid over it.
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, options) {
    return getContext.call(this, type, type.startsWith("webgl") ? { ...options, preserveDrawingBuffer: true } : options);
  };
  const copies = new Map();
  const copy = () => {
    for (const source of document.querySelectorAll("canvas[data-engine]")) {
      let target = copies.get(source);
      if (!target?.isConnected) {
        target = document.createElement("canvas");
        target.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
        source.after(target);
        copies.set(source, target);
      }
      if (target.width != source.width || target.height != source.height) {
        target.width = source.width;
        target.height = source.height;
      }
      const ctx = target.getContext("2d");
      ctx.clearRect(0, 0, target.width, target.height);
      ctx.drawImage(source, 0, 0);
    }
    requestAnimationFrame(copy);
  };
  requestAnimationFrame(copy);
  document.write(`<img hidden src="/wait?ms=${Number(params.get("wait"))}">`);
}
