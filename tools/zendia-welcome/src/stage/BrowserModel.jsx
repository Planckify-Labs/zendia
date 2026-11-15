// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// A Zendia window as an object: the frame in the color of the mode, the
// sidebar with its tabs, the page, and over them the statusline, which-key,
// the explorer's cursor and the agent's panel, each on its own layer so the
// window has real depth. Everything is laid out in the window's own pixels
// (880 by 580, origin top left); the group is scaled to scene units.
//
// A scene drives it by writing to `state.current` before each frame.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Cel } from "./Cel.jsx";
import { MASCOT_SIZE, paintMascot } from "./mascot.js";
import {
  CEL,
  fillRRect,
  font,
  lerp,
  mix,
  paintTexture,
  paragraph,
  roundedRect,
  slab,
  rrect,
  spring,
  text,
  withAlpha,
} from "./kit.js";

export const WINDOW = { width: 880, height: 580, sidebar: 204, unit: 0.01 };
const PAGE = { x: 204, y: 8, width: 668, height: 564 };
const TAB = { x: 8, y: 112, width: 188, height: 34, gap: 3 };
const DOCK = { width: 292, top: 18, height: 544 };

export const tabY = (row, top = TAB.y) => top + row * (TAB.height + TAB.gap);

/** Where a rectangle given from the window's top left sits in the group. */
export function place(x, y, width, height, z = 0) {
  return [
    x + width / 2 - WINDOW.width / 2,
    WINDOW.height / 2 - (y + height / 2),
    z,
  ];
}

export function defaultBrowserState() {
  return {
    scrollA: 0,
    scrollB: 0,
    pageA: 0,
    pageB: 0,
    pageMix: 0,
    tabRow: 0,
    mode: "n",
    keys: "",
    vim: 1,
    whichKey: 0,
    whichKeyPage: "leader",
    explorer: 0,
    explorerRow: 0,
    dock: 0,
    dockFocus: 0,
    caret: 0,
  };
}

/* The pages. Their text is Zendia's own guide, so what the preview shows is
   also true. */

const GUIDE = [
  {
    title: "Moving around",
    lead: "Zendia reads keys the way Neovim does. In NORMAL mode every key is a command, so your hands stay where they are.",
    sections: [
      ["Scrolling", "j and k scroll by a line, Ctrl d and Ctrl u by half a page. gg jumps to the top of the page and G to the bottom.", [["j", "Scroll down"], ["k", "Scroll up"], ["gg", "Top of the page"], ["G", "Bottom of the page"]]],
      ["Jumping", "Press s and every link, button and field on the page gets a label. Type the label to go there, without reaching for the mouse.", [["s", "Label everything"], ["gs", "Narrow by text first"]]],
      ["Text", "v starts a selection on the page's text. The motions you know grow it, and y yanks it into the yank ring.", [["v", "Visual mode"], ["y", "Yank"]]],
      ["Search", "A slash searches in the page. n and N walk through what it found.", [["/", "Search this page"]]],
    ],
  },
  {
    title: "Tabs are buffers",
    lead: "A tab is a buffer, a Zen space is a tabpage and a split is a window. The keys follow from that.",
    sections: [
      ["Next and previous", "Tabs sit in a vertical list, so Shift j moves down it and Shift k moves up. Shift h and Shift l go back and forward in the tab's history.", [["J", "Next tab"], ["K", "Previous tab"], ["u", "Reopen a closed tab"]]],
      ["The explorer", "Space e moves into the sidebar. There j and k walk the tabs, Enter opens one and Esc returns to the page.", [["Space e", "Explorer"], ["Space ,", "Find a tab"]]],
      ["Leader", "Space starts every other command. Pause after it and which-key lists what can follow.", [["Space", "Leader"], ["Space ?", "Every key"]]],
    ],
  },
  {
    title: "Bring your own agent",
    lead: "Zendia hands the tab to the coding agent you already use, signed in as you. It reads the page, clicks, types and navigates.",
    sections: [
      ["Asking", "Space a a opens the agent on the tab you are looking at. Write what you want and press Enter.", [["Space a a", "Ask about this tab"], ["Space a s", "Pick another agent"]]],
      ["Staying in charge", "The tab the agent drives glows in its color. It asks before it closes anything, and Space a x stops it.", [["Space a x", "Stop the agent"], ["Space a l", "Read its log"]]],
    ],
  },
];

function paintPage(theme, guide, height) {
  return paintTexture(PAGE.width, height, 1.75, (ctx, width) => {
    ctx.fillStyle = theme.page;
    ctx.fillRect(0, 0, width, height);
    const left = 72;
    const column = width - left * 2;
    let y = 76;
    text(ctx, "ZENDIA GUIDE", left, y, theme.pageMuted, font(11, 700));
    y += 40;
    text(ctx, guide.title, left, y, theme.pageText, font(36, 750));
    y += 44;
    y = paragraph(ctx, guide.lead, left, y, column, 27, theme.pageMuted, font(17, 400));
    y += 18;
    for (const [heading, body, keys] of guide.sections) {
      ctx.fillStyle = theme.pageRule;
      ctx.fillRect(left, y, column, 1);
      y += 36;
      text(ctx, heading, left, y, theme.pageText, font(21, 700));
      y += 34;
      y = paragraph(ctx, body, left, y, column, 25, theme.pageText, font(15, 400));
      y += 10;
      for (const [key, label] of keys) {
        ctx.font = font(13, 700, true);
        const keyWidth = ctx.measureText(key).width + 18;
        fillRRect(ctx, left, y - 13, keyWidth, 26, 6, theme.pageSoft);
        rrect(ctx, left + 0.5, y - 12.5, keyWidth - 1, 25, 6);
        ctx.strokeStyle = theme.pageRule;
        ctx.stroke();
        text(ctx, key, left + 9, y + 1, theme.pageText, font(13, 700, true));
        text(ctx, label, left + keyWidth + 12, y + 1, theme.accent, font(15, 500));
        y += 34;
      }
      y += 14;
    }
  });
}

/* The sidebar: Zen's, with the tabs of the guide. */

export const TABS = GUIDE.map(guide => guide.title);

function paintSidebar(theme, tabs, top) {
  return paintTexture(WINDOW.sidebar, WINDOW.height, 2.5, ctx => {
    const ink = theme.dark ? "#ffffff" : "#15151a";
    // Sidebar, back, forward, reload.
    ctx.strokeStyle = withAlpha(ink, 0.62);
    ctx.lineWidth = 1.6;
    ctx.lineCap = ctx.lineJoin = "round";
    rrect(ctx, 16, 17, 16, 14, 3.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(22, 17);
    ctx.lineTo(22, 31);
    for (const [x, direction] of [[132, -1], [158, 1]]) {
      ctx.moveTo(x + 3 * direction, 18);
      ctx.lineTo(x - 3 * direction, 24);
      ctx.lineTo(x + 3 * direction, 30);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(183, 24, 6, -0.6, Math.PI * 1.45);
    ctx.stroke();

    fillRRect(ctx, 10, 44, 184, 34, 10, withAlpha(ink, 0.09));
    text(ctx, "about:zendia", 24, 62, withAlpha(ink, 0.82), font(13, 500));

    text(ctx, "Space", 18, top - 15, withAlpha(ink, 0.5), font(11.5, 600));

    tabs.forEach((title, row) => {
      const y = tabY(row, top) + TAB.height / 2;
      fillRRect(ctx, 19, y - 8, 16, 16, 5, theme.accent);
      text(ctx, "Z", 27, y + 0.5, theme.dark ? theme.ink : "#ffffff", font(10, 800), "center");
      text(ctx, title, 45, y + 0.5, withAlpha(ink, 0.9), font(13.5, 500));
    });
    const y = tabY(tabs.length, top) + TAB.height / 2;
    ctx.strokeStyle = withAlpha(ink, 0.55);
    ctx.beginPath();
    ctx.moveTo(21, y);
    ctx.lineTo(33, y);
    ctx.moveTo(27, y - 6);
    ctx.lineTo(27, y + 6);
    ctx.stroke();
    text(ctx, "New Tab", 45, y + 0.5, withAlpha(ink, 0.55), font(13.5, 500));

    // The spaces at the foot of the sidebar: one, this one.
    fillRRect(ctx, WINDOW.sidebar / 2 - 4, WINDOW.height - 26, 8, 8, 4, withAlpha(ink, 0.7));
  });
}

/* The mode indicator: Zendia's mascot in its drawing for the mode
   (mascot.js), with what has been typed toward a mapping beside it. */

// `shown` is how much larger than life it is drawn in the preview, where the
// whole window is a few hundred pixels wide and it has to be read.
const STATUS = { height: MASCOT_SIZE.height + 16, fontSize: 13.5, shown: 1.9 };
const MODES = { n: "NORMAL", i: "INSERT", v: "VISUAL", e: "EXPLORER" };

function paintStatusline(theme, mode, keys) {
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = font(STATUS.fontSize, 700, true);
  const typed = keys ? measure.measureText(keys).width + 22 : 0;
  const body = MASCOT_SIZE.width;
  const width = Math.ceil(typed + (typed ? 6 : 0) + body + 4);
  const texture = paintTexture(width, STATUS.height, 4, ctx => {
    if (keys) {
      const chip = 24;
      const top = MASCOT_SIZE.height - chip;
      fillRRect(ctx, 0, top, typed, chip, 8, CEL.ink);
      fillRRect(ctx, 2, top + 2, typed - 4, chip - 4, 6, theme.night);
      text(ctx, keys, 11, top + chip / 2 + 0.5, theme.snow, font(STATUS.fontSize, 700, true));
    }
    const x = width - body - 4;
    paintMascot(ctx, mode, theme.modes[mode], x, 0);
    // The mode's name, on a tag in its color under the mascot.
    const tag = MASCOT_SIZE.height + 2;
    fillRRect(ctx, x, tag, body, 13, 4, CEL.ink);
    fillRRect(ctx, x + 1.2, tag + 1.2, body - 2.4, 10.6, 3, theme.modes[mode]);
    text(ctx, MODES[mode], x + body / 2, tag + 7, CEL.ink, font(7.6, 800, true), "center");
  });
  texture.userData.width = width;
  return texture;
}

/* which-key: one column in the bottom right corner, above the statusline. */

const WHICH_KEY = {
  leader: {
    title: "<Space>",
    rows: [
      ["<Space>", "Find Tabs, History and Bookmarks"],
      [",", "Tabs"],
      ["a", "ai", true],
      ["b", "buffer", true],
      ["e", "Explorer"],
      ["f", "file/find", true],
      ["m", "Toolbar and Main Menu"],
      ["o", "library", true],
      ["p", "Yank History"],
      ["q", "quit/session", true],
      ["s", "search", true],
      ["u", "ui", true],
      ["w", "windows", true],
      ["x", "Extensions"],
    ],
  },
  ai: {
    title: "<Space>a +ai",
    rows: [
      ["a", "Ask Agent About This Tab"],
      ["l", "Open Agent Log"],
      ["m", "Select Agent Model"],
      ["n", "New Agent Conversation"],
      ["p", "Toggle Agent"],
      ["s", "Select Agent"],
      ["x", "Stop Agent"],
    ],
  },
};
const WK = { width: 352, row: 23, pad: 12 };
const whichKeyHeight = page => 44 + WHICH_KEY[page].rows.length * WK.row + 34;

// A floating panel, drawn flat with an ink line as the rest of the preview.
function paintFloat(ctx, theme, width, height, radius) {
  fillRRect(ctx, 0, 0, width, height, radius, CEL.ink);
  fillRRect(ctx, 2, 2, width - 4, height - 4, radius - 2, theme.float);
}

function paintWhichKey(theme, page) {
  const { title, rows } = WHICH_KEY[page];
  const height = whichKeyHeight(page);
  return paintTexture(WK.width, height, 3, ctx => {
    paintFloat(ctx, theme, WK.width, height, 18);
    const ink = theme.dark ? "#ffffff" : "#15151a";
    text(ctx, title, WK.pad + 8, 24, withAlpha(ink, 0.78), font(14, 600));
    ctx.font = font(13.5, 700, true);
    const keyColumn = Math.max(...rows.map(([key]) => ctx.measureText(key).width));
    rows.forEach(([key, description, group], index) => {
      const y = 44 + index * WK.row + WK.row / 2;
      const x = WK.pad + 8 + keyColumn;
      text(ctx, key, x, y, theme.orange, font(13.5, 700, true), "right");
      text(ctx, "➜", x + 9, y, withAlpha(ink, 0.5), font(12, 400));
      text(
        ctx,
        group ? `+${description}` : description,
        x + 30,
        y,
        group ? theme.purple : ink,
        font(14, 400)
      );
    });
    text(ctx, "ESC close · BS back", WK.pad + 8, height - 19, withAlpha(ink, 0.78), font(12, 400));
  });
}

/* The agent's panel, docked on the right over the page. */

function paintDock(theme, agent) {
  return paintTexture(DOCK.width, DOCK.height, 2.5, (ctx, width, height) => {
    paintFloat(ctx, theme, width, height, 16);
    const ink = theme.dark ? "#ffffff" : "#15151a";
    fillRRect(ctx, 18, 18, 22, 22, 7, agent.color);
    text(ctx, agent.name, 50, 29.5, ink, font(14.5, 650));
    text(ctx, "This tab", width - 18, 29.5, withAlpha(ink, 0.6), font(12.5, 500), "right");
    ctx.fillStyle = withAlpha(ink, 0.1);
    ctx.fillRect(0, 56, width, 1);
    paragraph(
      ctx,
      "Ask about this tab, or tell me what to do on it.",
      20,
      height - 108,
      width - 40,
      20,
      withAlpha(ink, 0.6),
      font(13.5, 400)
    );
    fillRRect(ctx, 12, height - 62, width - 24, 50, 13, withAlpha(ink, 0.07));
  });
}

function paintRing(color, width, height, radius, line) {
  return paintTexture(width, height, 3, ctx => {
    rrect(ctx, line / 2, line / 2, width - line, height - line, radius);
    ctx.strokeStyle = color;
    ctx.lineWidth = line;
    ctx.stroke();
  });
}

/* The shadow a floating layer drops: its own shape, hard edged. */
function paintShadow(width, height, radius) {
  return paintTexture(width, height, 1, ctx => {
    fillRRect(ctx, 0, 0, width, height, radius, withAlpha(CEL.ink, 0.38));
  });
}
const SHADOW = 9;

function Layer({ rect, z, texture, radius = 0, opacity = 1, renderOrder = 0, meshRef }) {
  const [x, y, width, height] = rect;
  const geometry = useMemo(
    () => (radius ? roundedRect(width, height, radius) : new THREE.PlaneGeometry(width, height)),
    [width, height, radius]
  );
  return (
    <mesh ref={meshRef} position={place(x, y, width, height, z)} geometry={geometry} renderOrder={renderOrder}>
      <meshBasicMaterial map={texture} transparent opacity={opacity} toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

function useDisposable(factory, deps) {
  const value = useMemo(factory, deps);
  useEffect(
    () => () => {
      for (const item of [value].flat()) {
        item?.dispose?.();
      }
    },
    [value]
  );
  return value;
}

/**
 * @param {object} props
 * @param {object} props.theme
 * @param {{current: object}} props.state See defaultBrowserState().
 * @param {string[]} [props.tabs] Titles of the tabs in the sidebar.
 * @param {{name: string, color: string}} [props.agent]
 * @param {React.ReactNode} [props.children] More layers, in window pixels.
 */
export function BrowserModel({ theme, state, tabs = TABS, tabsTop = TAB.y, agent, children, ...props }) {
  agent ??= { name: "Your agent", color: theme.accent };
  const pageHeight = 1240;
  const pages = useDisposable(() => GUIDE.map(guide => paintPage(theme, guide, pageHeight)), [theme]);
  const sidebar = useDisposable(() => paintSidebar(theme, tabs, tabsTop), [theme, tabs, tabsTop]);
  const glow = useDisposable(() => paintRing(agent.color, TAB.width, TAB.height, 9, 3), [agent.color]);
  const whichKey = useDisposable(
    () => ({ leader: paintWhichKey(theme, "leader"), ai: paintWhichKey(theme, "ai") }),
    [theme]
  );
  useEffect(() => () => Object.values(whichKey).forEach(texture => texture.dispose()), [whichKey]);
  const dock = useDisposable(() => paintDock(theme, agent), [theme, agent.name, agent.color]);
  const cursor = useDisposable(() => paintRing(theme.modes.e, TAB.width, TAB.height, 9, 2), [theme]);
  const focusRing = useDisposable(() => paintRing(theme.modes.i, DOCK.width - 24, 50, 13, 2), [theme]);
  const dockShadow = useDisposable(() => paintShadow(DOCK.width, DOCK.height, 16), []);
  const whichKeyShadows = useDisposable(
    () => ({
      leader: paintShadow(WK.width, whichKeyHeight("leader"), 18),
      ai: paintShadow(WK.width, whichKeyHeight("ai"), 18),
    }),
    []
  );
  useEffect(() => () => Object.values(whichKeyShadows).forEach(texture => texture.dispose()), [whichKeyShadows]);
  const statuslines = useRef(new Map());
  useEffect(() => {
    const cache = statuslines.current;
    return () => {
      cache.forEach(texture => texture.dispose());
      cache.clear();
    };
  }, [theme]);

  const geometry = useDisposable(
    () => ({
      frame: slab(WINDOW.width, WINDOW.height, 22, 16, 3),
      page: roundedRect(PAGE.width, PAGE.height, 10),
      tab: roundedRect(TAB.width, TAB.height, 9),
      unit: new THREE.PlaneGeometry(1, 1),
      caret: new THREE.PlaneGeometry(1.6, 18),
    }),
    []
  );
  // Each page plane shows a window of its tall texture.
  const pageMaterials = useDisposable(
    () =>
      [0, 1].map(
        () => new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false })
      ),
    []
  );
  const pageMaps = useMemo(
    () =>
      [0, 1].map(() =>
        pages.map(page => {
          const map = page.clone();
          map.repeat.set(1, PAGE.height / pageHeight);
          return map;
        })
      ),
    [pages]
  );
  useEffect(() => () => pageMaps.flat().forEach(map => map.dispose()), [pageMaps]);

  const refs = useRef({});
  const set = name => node => {
    refs.current[name] = node;
  };
  const frameColor = useMemo(() => new THREE.Color(), []);

  useFrame((_, delta) => {
    const s = state.current;
    const r = refs.current;
    const damp = 1 - Math.exp(-delta * 12);

    // The frame takes the mode's color, as the window does.
    frameColor.set(
      s.vim > 0.01 && s.mode
        ? mix(theme.window, theme.modes[s.mode], (theme.dark ? 0.3 : 0.42) * s.vim)
        : theme.window
    );
    r.frame.material.color.lerp(frameColor, damp);

    // Pages: A under B, B fading in while tabs change.
    [s.pageA, s.pageB].forEach((page, index) => {
      const material = pageMaterials[index];
      const map = pageMaps[index][page];
      if (material.map != map) {
        material.map = map;
        material.needsUpdate = true;
      }
      const scroll = index ? s.scrollB : s.scrollA;
      map.offset.y = 1 - (scroll + PAGE.height) / pageHeight;
    });
    pageMaterials[1].opacity = s.pageMix;

    r.tab.position.y = place(0, tabY(s.tabRow, tabsTop), 0, TAB.height)[1];
    // The tab an agent drives glows in the agent's color.
    r.glow.position.y = r.tab.position.y;
    r.glow.material.opacity = s.tabGlow ?? 0;

    r.cursor.material.opacity = s.explorer;
    r.cursor.position.y = place(0, tabY(s.explorerRow, tabsTop), 0, TAB.height)[1];

    // The statusline, right aligned in the page's corner.
    const visible = s.mode && s.vim > 0.5;
    r.status.visible = !!visible;
    if (visible) {
      const key = `${s.mode}|${s.keys}`;
      let texture = statuslines.current.get(key);
      if (!texture) {
        texture = paintStatusline(theme, s.mode, s.keys);
        statuslines.current.set(key, texture);
      }
      if (r.status.material.map != texture) {
        r.status.material.map = texture;
        r.status.material.needsUpdate = true;
      }
      const width = texture.userData.width * STATUS.shown;
      r.status.scale.set(width, STATUS.height * STATUS.shown, 1);
      r.status.position.x = place(PAGE.x + PAGE.width - 12 - width, 0, width, 0)[0];
    }

    // which-key grows out of its corner.
    const wk = spring(s.whichKey);
    const wkTexture = whichKey[s.whichKeyPage];
    const wkHeight = whichKeyHeight(s.whichKeyPage);
    r.whichKey.visible = s.whichKey > 0.001;
    if (r.whichKeyPanel.material.map != wkTexture) {
      r.whichKeyPanel.material.map = wkTexture;
      r.whichKeyPanel.material.needsUpdate = true;
    }
    r.whichKeyPanel.scale.set(WK.width, wkHeight, 1);
    r.whichKeyPanel.position.set(-WK.width / 2, wkHeight / 2, 0);
    const wkShadow = whichKeyShadows[s.whichKeyPage];
    if (r.whichKeyShadow.material.map != wkShadow) {
      r.whichKeyShadow.material.map = wkShadow;
      r.whichKeyShadow.material.needsUpdate = true;
    }
    r.whichKeyShadow.scale.set(WK.width, wkHeight, 1);
    r.whichKeyShadow.position.set(-WK.width / 2 + SHADOW, wkHeight / 2 - SHADOW, -1);
    r.whichKey.scale.setScalar(lerp(0.9, 1, wk));
    r.whichKey.position.z = lerp(4, 16, wk);
    r.whichKeyPanel.material.opacity = Math.min(1, s.whichKey * 3);
    r.whichKeyShadow.material.opacity = Math.min(1, s.whichKey * 2);

    // The agent's panel slides in from the right edge.
    const dockIn = spring(s.dock);
    r.dock.visible = s.dock > 0.001;
    r.dock.position.x = lerp(DOCK.width * 0.5, 0, dockIn);
    r.dock.position.z = lerp(4, 14, dockIn);
    r.dockPanel.material.opacity = Math.min(1, s.dock * 2.5);
    r.dockShadow.material.opacity = Math.min(1, s.dock * 2);
    r.focus.material.opacity = s.dockFocus * Math.min(1, s.dock * 2.5);
    r.caret.material.opacity = s.dockFocus * s.caret * Math.min(1, s.dock * 2.5);
  });

  const ink = theme.dark ? "#ffffff" : "#15151a";
  const dockX = PAGE.x + PAGE.width - 10 - DOCK.width;

  return (
    <group {...props}>
      <group scale={WINDOW.unit}>
        <Cel ref={set("frame")} geometry={geometry.frame} color={theme.window} line={3.2} />

        <mesh ref={set("tab")} geometry={geometry.tab} position={place(TAB.x, tabY(0), TAB.width, TAB.height, 0.6)}>
          <meshBasicMaterial color={ink} transparent opacity={theme.dark ? 0.14 : 0.1} toneMapped={false} depthWrite={false} />
        </mesh>
        <Layer rect={[0, 0, WINDOW.sidebar, WINDOW.height]} z={1} texture={sidebar} renderOrder={1} />
        <Layer meshRef={set("glow")} rect={[TAB.x, tabY(0), TAB.width, TAB.height]} z={1.4} texture={glow} opacity={0} renderOrder={2} />
        <Layer meshRef={set("cursor")} rect={[TAB.x, tabY(0), TAB.width, TAB.height]} z={1.6} texture={cursor} opacity={0} renderOrder={2} />

        <mesh geometry={geometry.page} position={place(PAGE.x, PAGE.y, PAGE.width, PAGE.height, 0.8)} material={pageMaterials[0]} renderOrder={1} />
        <mesh geometry={geometry.page} position={place(PAGE.x, PAGE.y, PAGE.width, PAGE.height, 1)} material={pageMaterials[1]} renderOrder={2} />

        {children}

        <mesh
          ref={set("status")}
          geometry={geometry.unit}
          position={place(0, PAGE.y + PAGE.height - 10 - STATUS.height * STATUS.shown, 0, STATUS.height * STATUS.shown, 6)}
          renderOrder={8}
        >
          <meshBasicMaterial transparent toneMapped={false} depthWrite={false} />
        </mesh>

        <group
          ref={set("whichKey")}
          position={[
            place(PAGE.x + PAGE.width - 12, 0, 0, 0)[0],
            place(0, PAGE.y + PAGE.height - 10 - STATUS.height * STATUS.shown - 8, 0, 0)[1],
            16,
          ]}
        >
          <mesh ref={set("whichKeyShadow")} geometry={geometry.unit} renderOrder={9}>
            <meshBasicMaterial transparent toneMapped={false} depthWrite={false} />
          </mesh>
          <mesh ref={set("whichKeyPanel")} geometry={geometry.unit} renderOrder={10}>
            <meshBasicMaterial transparent toneMapped={false} depthWrite={false} />
          </mesh>
        </group>

        <group ref={set("dock")} position={[0, 0, 14]}>
          <mesh
            ref={set("dockShadow")}
            geometry={geometry.unit}
            position={place(dockX + SHADOW, DOCK.top + SHADOW, DOCK.width, DOCK.height, -1)}
            scale={[DOCK.width, DOCK.height, 1]}
            renderOrder={5}
          >
            <meshBasicMaterial map={dockShadow} transparent toneMapped={false} depthWrite={false} />
          </mesh>
          <Layer meshRef={set("dockPanel")} rect={[dockX, DOCK.top, DOCK.width, DOCK.height]} z={0} texture={dock} renderOrder={6} />
          <Layer
            meshRef={set("focus")}
            rect={[dockX + 12, DOCK.top + DOCK.height - 62, DOCK.width - 24, 50]}
            z={0.4}
            texture={focusRing}
            opacity={0}
            renderOrder={7}
          />
          <mesh
            ref={set("caret")}
            geometry={geometry.caret}
            position={place(dockX + 28, DOCK.top + DOCK.height - 46, 1.6, 18, 0.5)}
            renderOrder={7}
          >
            <meshBasicMaterial color={ink} transparent opacity={0} toneMapped={false} depthWrite={false} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
