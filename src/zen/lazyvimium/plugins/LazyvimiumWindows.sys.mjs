// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Vim tab pages are Zen spaces and vim windows are split view panes.

import { lastUsed } from "resource:///modules/lazyvimium/plugins/LazyvimiumTabs.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  LazyvimiumPicker:
    "resource:///modules/lazyvimium/ui/LazyvimiumPicker.sys.mjs",
});

const SPLITS = {
  vsep: { title: "Split Window Right", side: "right" },
  hsep: { title: "Split Window Below", side: "bottom" },
};

function hostOf(tab) {
  try {
    return (
      tab.linkedBrowser.currentURI.host || tab.linkedBrowser.currentURI.spec
    );
  } catch {
    return tab.linkedBrowser.currentURI?.spec ?? "";
  }
}

// The split view a tab is a pane of. Looked up through the tab, not through
// the splitter's current view, so it is right whichever view is showing.
function groupOf(splitter, tab) {
  return splitter?._data.find(group => group.tabs.includes(tab)) ?? null;
}

// Whether a tab can still be shown in a new pane.
function isPaneable(tab) {
  return (
    tab.isConnected &&
    !tab.closing &&
    !tab.hidden &&
    !tab.hasAttribute("zen-empty-tab")
  );
}

function showLimitToast(window) {
  window.gZenUIManager.showToast("zen-split-view-limit-toast");
}

/**
 * Split the current tab like :vsplit or :split. The new pane shows a tab
 * picked from the space, or, with "Open URL" or when there is nothing to
 * pick, the urlbar to load any site into it.
 *
 * @param {Window} window
 * @param {"vsep"|"hsep"} gridType
 */
async function split(window, gridType) {
  const { gBrowser, gZenViewSplitter: splitter } = window;
  const current = gBrowser.selectedTab;
  // The empty tab only stands in for a pane whose urlbar is open, or for a
  // space without tabs: there is nothing to divide.
  if (current.hasAttribute("zen-empty-tab")) {
    return;
  }
  const group = groupOf(splitter, current);
  if (group && group.tabs.length >= splitter.MAX_TABS) {
    showLimitToast(window);
    return;
  }
  // A tab shows in one pane at most, so the tabs of any split are left out.
  const candidates = gBrowser.visibleTabs.filter(
    tab =>
      tab != current &&
      !tab.closing &&
      !tab.hasAttribute("zen-empty-tab") &&
      !groupOf(splitter, tab)
  );
  const { title, side } = SPLITS[gridType];

  if (!candidates.length) {
    openUrlPane(window, side);
    return;
  }

  const items = candidates.map(tab => ({
    label: tab.label,
    detail: hostOf(tab),
    icon: tab.getAttribute("image") || undefined,
  }));
  items.unshift({ label: "Open URL…", detail: "any website", key: "/" });
  const index = await lazy.LazyvimiumPicker.open(window, { title, items });
  // The picker leaves the page alone, so only a mouse click or the agent can
  // have moved on meanwhile. The choice was made for the pane that was
  // current when it opened; do not split another one with it.
  if (
    index === null ||
    gBrowser.selectedTab != current ||
    !current.isConnected
  ) {
    return;
  }
  if (index == 0) {
    openUrlPane(window, side);
    return;
  }
  splitWith(window, candidates[index - 1], gridType);
}

/**
 * Put the urlbar to work for a new pane next to the current tab.
 *
 * @param {Window} window
 * @param {"right"|"bottom"} side
 */
function openUrlPane(window, side) {
  const { gBrowser, gZenViewSplitter: splitter } = window;
  const current = gBrowser.selectedTab;
  if (!groupOf(splitter, current)) {
    splitter.createEmptySplit(side);
    return;
  }
  // createEmptySplit assumes the tab is not in a split yet: it would make a
  // second split view out of the current pane and break the first one. Open
  // the urlbar for a new tab and divide the pane with it once it is picked.
  const gridType = side == "bottom" ? "hsep" : "vsep";
  const closeToken = {};
  const controller = new AbortController();
  const clearWaiting = () =>
    window.requestAnimationFrame(() => {
      splitter.waitingForSplitTab = false;
    });
  window.addEventListener(
    "ZenURLBarClosed",
    event => {
      if (!window.gZenUIManager.matchesCloseToken(closeToken, event)) {
        return;
      }
      controller.abort();
      clearWaiting();
      const picked = gBrowser.selectedTab;
      if (
        event.detail.onElementPicked &&
        current.isConnected &&
        picked != current &&
        picked.getAttribute("zen-workspace-id") ==
          current.getAttribute("zen-workspace-id")
      ) {
        gBrowser.selectedTab = current;
        splitWith(window, picked, gridType);
      }
    },
    { signal: controller.signal }
  );
  splitter.waitingForSplitTab = true;
  if (
    !window.gZenUIManager.handleNewTab(false, false, "tab", true, closeToken)
  ) {
    controller.abort();
    clearWaiting();
  }
}

/**
 * Show a tab in a new pane next to the current tab, dividing only the
 * current pane when it is already part of a split. The new pane is on the
 * right or below, as with :vsplit and :split, and gets the focus.
 *
 * @param {Window} window
 * @param {Element} picked
 * @param {"vsep"|"hsep"} gridType
 */
export function splitWith(window, picked, gridType) {
  const { gBrowser, gZenViewSplitter: splitter } = window;
  const current = gBrowser.selectedTab;
  if (
    picked == current ||
    current.hasAttribute("zen-empty-tab") ||
    !isPaneable(picked)
  ) {
    return;
  }
  const group = groupOf(splitter, current);
  const pickedGroup = groupOf(splitter, picked);
  if (pickedGroup) {
    // A tab shows in one pane at most. Its own split is already on screen,
    // so go to the pane; another split would be broken by taking it.
    if (pickedGroup == group) {
      gBrowser.selectedTab = picked;
    }
    return;
  }
  if (!group) {
    splitter.splitTabs([current, picked], gridType, 1);
    return;
  }
  // Zen turns a pinned tab into a duplicate when the panes of a split mix
  // pinned and unpinned tabs, and would add one for the current pane too.
  // The panes of a split share their pinned state, so match it instead.
  const pinning =
    current.pinned && !current.hasAttribute("zen-essential") && !picked.pinned;
  if (pinning) {
    gBrowser.pinTab(picked);
  }
  const before = new Set(group.tabs);
  // Zen adds a tab to an existing split at the root of its layout; move it
  // next to the current pane so only that pane is divided, as in vim.
  if (
    !splitter.splitTabs([current, picked], gridType, 0, { activate: false })
  ) {
    if (pinning) {
      gBrowser.unpinTab(picked);
    }
    return;
  }
  // A pinned tab may have been split as a duplicate, which Zen adds last.
  const added = group.tabs.findLast(tab => !before.has(tab));
  const node = leafOf(group.layoutTree, added);
  const target = leafOf(group.layoutTree, current);
  if (node && target) {
    splitter.removeNode(node);
    splitter.splitIntoNode(target, node, SPLITS[gridType].side, 0.5);
  }
  splitter.activateSplitView(group, true);
  gBrowser.selectedTab = added;
  // The user asked for a split, not a pin, so they are told.
  if (pinning) {
    window.gZenUIManager.showToast("lazyvimium-split-pinned-toast");
  }
}

function leafOf(node, tab) {
  if (node.tab == tab) {
    return node;
  }
  for (const child of node.children ?? []) {
    const leaf = leafOf(child, tab);
    if (leaf) {
      return leaf;
    }
  }
  return null;
}

// Layout rounding leaves panes a hair apart, in percent of the view.
const EDGE = 0.5;

// The rectangle of each pane in percent of the split view, from the layout
// tree: it is what Zen lays the panes out from, so it holds for panes that
// are unloaded or not yet laid out too.
function paneRects(group) {
  const rects = [];
  const walk = node => {
    const at = node.positionToRoot;
    if (node.children) {
      node.children.forEach(walk);
    } else if (node.tab && at) {
      rects.push({
        tab: node.tab,
        left: at.left,
        right: 100 - at.right,
        top: at.top,
        bottom: 100 - at.bottom,
      });
    }
  };
  walk(group.layoutTree);
  return rects;
}

/**
 * The pane next to a pane in a direction, the way <C-w>h/j/k/l finds a
 * window: one of those sharing the edge on that side. Of several, the one
 * that overlaps the pane most, and the pane used last when they tie, so
 * going there and back returns to the same pane.
 *
 * @param {object} group The split view.
 * @param {Element} from
 * @param {number} dx -1 left, 1 right, 0 vertical.
 * @param {number} dy -1 up, 1 down, 0 horizontal.
 * @returns {Element|null}
 */
function paneBeside(group, from, dx, dy) {
  const rects = paneRects(group);
  const here = rects.find(rect => rect.tab == from);
  if (!here) {
    return null;
  }
  const beside = [];
  for (const rect of rects) {
    if (rect == here) {
      continue;
    }
    let gap;
    if (dx) {
      gap = dx > 0 ? rect.left - here.right : here.left - rect.right;
    } else {
      gap = dy > 0 ? rect.top - here.bottom : here.top - rect.bottom;
    }
    const overlap = dx
      ? Math.min(rect.bottom, here.bottom) - Math.max(rect.top, here.top)
      : Math.min(rect.right, here.right) - Math.max(rect.left, here.left);
    if (gap >= -EDGE && overlap > EDGE) {
      beside.push({ tab: rect.tab, gap, overlap });
    }
  }
  if (!beside.length) {
    return null;
  }
  const nearest = Math.min(...beside.map(pane => pane.gap));
  const touching = beside.filter(pane => pane.gap <= nearest + EDGE);
  const most = Math.max(...touching.map(pane => pane.overlap));
  const best = touching.filter(pane => pane.overlap >= most - EDGE);
  return lastUsed(best.map(pane => pane.tab));
}

/**
 * Select the split pane next to the current one in a direction, the way
 * <C-w>h/j/k/l picks a window.
 *
 * @param {Window} window
 * @param {number} dx -1 left, 1 right, 0 vertical.
 * @param {number} dy -1 up, 1 down, 0 horizontal.
 */
function focusPane(window, dx, dy) {
  const { gBrowser, gZenViewSplitter: splitter } = window;
  const group = groupOf(splitter, gBrowser.selectedTab);
  const next = group && paneBeside(group, gBrowser.selectedTab, dx, dy);
  if (next) {
    gBrowser.selectedTab = next;
  }
}

/**
 * Take the selected pane out of its split view, like :close. The tab stays
 * open, and the focus goes to the pane that was used last, which is where
 * :close returns to after a :split.
 *
 * @param {Window} window
 */
function closePane(window) {
  const { gBrowser, gZenViewSplitter: splitter } = window;
  const tab = gBrowser.selectedTab;
  const group = groupOf(splitter, tab);
  if (!group) {
    return;
  }
  const others = group.tabs.filter(
    pane => pane != tab && !pane.hasAttribute("zen-empty-tab")
  );
  // Pick it first: Zen selects the first pane left, which would count as the
  // one used last.
  const next = others.length ? lastUsed(others) : null;
  splitter.removeTabFromGroup(tab, undefined, { forUnsplit: true });
  if (next) {
    gBrowser.selectedTab = next;
  }
}

function changeSpace(window, pick) {
  const spaces = window.gZenWorkspaces.getWorkspaces();
  const space = pick(spaces);
  if (space && space.uuid != window.gZenWorkspaces.activeWorkspace) {
    return window.gZenWorkspaces.changeWorkspace(space);
  }
  return undefined;
}

export const LazyvimiumWindowsSpec = {
  name: "windows",
  actions: {
    "spaces.first": {
      desc: "First Space",
      agent: "act",
      run: ({ window }) => changeSpace(window, spaces => spaces[0]),
    },
    "spaces.last": {
      desc: "Last Space",
      agent: "act",
      run: ({ window }) => changeSpace(window, spaces => spaces.at(-1)),
    },
    "spaces.close": {
      desc: "Close Space",
      agent: "confirm",
      run: ({ window }) => window.gZenWorkspaces.contextDeleteWorkspace(),
    },
    "splits.focusLeft": {
      desc: "Go to Left Window",
      agent: "act",
      run: ({ window }) => focusPane(window, -1, 0),
    },
    "splits.focusDown": {
      desc: "Go to Lower Window",
      agent: "act",
      run: ({ window }) => focusPane(window, 0, 1),
    },
    "splits.focusUp": {
      desc: "Go to Upper Window",
      agent: "act",
      run: ({ window }) => focusPane(window, 0, -1),
    },
    "splits.focusRight": {
      desc: "Go to Right Window",
      agent: "act",
      run: ({ window }) => focusPane(window, 1, 0),
    },
    "splits.vertical": {
      desc: "Split Window Right",
      agent: false,
      run: ({ window }) => split(window, "vsep"),
    },
    "splits.horizontal": {
      desc: "Split Window Below",
      agent: false,
      run: ({ window }) => split(window, "hsep"),
    },
    "splits.close": {
      desc: "Delete Window",
      agent: "act",
      run: ({ window }) => closePane(window),
    },
    "splits.only": {
      desc: "Close Other Windows",
      agent: "act",
      run({ window }) {
        // The empty pane has only its urlbar: leaving it alone would keep
        // the placeholder tab selected, so drop it like <Esc> does.
        if (window.gBrowser.selectedTab.hasAttribute("zen-empty-tab")) {
          closePane(window);
        } else {
          window.gZenViewSplitter.unsplitCurrentView();
        }
      },
    },
  },
};
