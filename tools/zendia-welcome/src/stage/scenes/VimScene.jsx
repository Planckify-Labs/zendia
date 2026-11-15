// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Vim mode: a keyboard plays the keys of the onboarding's list and the
// window behind it does what they do in Zendia. With vim mode turned down,
// the keyboard rests and the window is plain Zen.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { BrowserModel, defaultBrowserState } from "../BrowserModel.jsx";
import { Keyboard } from "../Keyboard.jsx";
import { Set, useFraming, useLoop, useStage } from "../Stage.jsx";
import { CEL, easeInOut, lerp, paintTexture, span, track } from "../kit.js";

export const VIM_LOOP = 21;
export const VIM_POSE = 9.4;

// When each beat of the loop starts; the caption under the preview follows.
export const VIM_BEATS = [0.5, 4.4, 8, 10.4, 13.6, 17.1];

const PRESSES = {
  j: [[1.0], [1.4], [1.8], [2.2], [5.0], [5.7], [11.3], [11.8]],
  k: [[3.0], [3.4], [6.7], [12.4]],
  shift: [[4.8, 1.25], [6.5, 0.5]],
  space: [[8.4, 0.12], [10.7, 0.12], [13.9, 0.12]],
  e: [[11.0]],
  a: [[14.6], [15.3]],
  esc: [[13.0], [17.6]],
  q: [[19.2]],
};

const scroll = track(0, [
  [1.0, 110], [1.4, 220], [1.8, 330], [2.2, 440], [3.0, 330], [3.4, 220],
]);
const tabRow = track(0, [[5.0, 1, 0.22], [5.7, 2, 0.22], [6.7, 1, 0.22], [20.2, 0, 0.4]]);
const whichKey = track(0, [
  [8.4, 1, 0.5, x => x], [11.0, 0, 0.12], [13.9, 1, 0.5, x => x], [15.3, 0, 0.12],
]);
const explorer = track(0, [[11.0, 1, 0.15], [13.0, 0, 0.15]]);
const explorerRow = track(1, [[11.3, 2, 0.16], [11.8, 3, 0.16], [12.4, 2, 0.16]]);
const dock = track(0, [[15.3, 1, 0.6, x => x], [19.2, 0, 0.18]]);
const dockFocus = track(0, [[15.5, 1, 0.15], [17.6, 0, 0.12]]);
// Where the camera leans: 0 the whole desk, then the sidebar, the corner
// which-key opens in, and the agent's panel.
const lean = track(0, [
  [4.6, 1, 0.9, easeInOut], [7.6, 2, 0.9, easeInOut], [10.9, 1, 0.9, easeInOut],
  [13.5, 2, 0.9, easeInOut], [15.4, 3, 0.9, easeInOut], [19.4, 0, 1.2, easeInOut],
]);
const LEANS = [
  { x: 0, y: 2.75, zoom: 1 },
  { x: -0.7, y: 2.75, zoom: 1.08 },
  { x: 0.7, y: 2.6, zoom: 1.08 },
  { x: 0.6, y: 2.75, zoom: 1.06 },
];

function pageAt(t) {
  // [tab under, tab over, how far the one over has faded in]
  if (t < 5.0) return [0, 0, 0];
  if (t < 5.7) return [0, 1, span(t, 5.0, 0.16)];
  if (t < 6.7) return [1, 2, span(t, 5.7, 0.16)];
  if (t < 20.2) return [2, 1, span(t, 6.7, 0.16)];
  return [1, 0, span(t, 20.2, 0.3)];
}

function modeAt(t) {
  if (t >= 11.0 && t < 13.0) return "e";
  if (t >= 15.3 && t < 17.6) return "i";
  return "n";
}

function keysAt(t) {
  if ((t >= 8.4 && t < 11.0) || (t >= 13.9 && t < 14.6)) return "<Space>";
  if (t >= 14.6 && t < 15.3) return "<Space>a";
  return "";
}

// The lines that fly off a key as it is hit.
function paintBurst() {
  return paintTexture(128, 128, 2, ctx => {
    ctx.translate(64, 64);
    ctx.fillStyle = CEL.yellow;
    for (let i = 0; i < 9; i++) {
      ctx.rotate((Math.PI * 2) / 9);
      ctx.beginPath();
      ctx.moveTo(-3.5, -34);
      ctx.lineTo(0, -62);
      ctx.lineTo(3.5, -34);
      ctx.fill();
    }
  });
}

const KEY_AT = {
  j: [0.75, 0], k: [1.75, 0], e: [-3.5, 1], a: [-5.25, 0], q: [-5.5, 1],
  esc: [-7, 2], space: [-0.625, -2], shift: [-6.375, -1],
};

/**
 * @param {object} props
 * @param {boolean} props.enabled The page's choice: vim mode on or off.
 * @param {(beat: number) => void} [props.onBeat]
 */
export function VimScene({ enabled, onBeat }) {
  const { theme, still, strike } = useStage();
  const lastMode = useRef("n");
  const time = useLoop(VIM_LOOP, VIM_POSE);
  const frame = useFraming();
  const browser = useRef(defaultBrowserState());
  const flash = useRef(theme.modes.n);
  const vim = useRef(enabled ? 1 : 0);
  const beat = useRef(-1);
  const burst = useRef();
  const keyboard = useRef();
  const burstTexture = useMemo(paintBurst, []);
  const pointer = useMemo(() => new THREE.Vector2(), []);

  // Every press in order, to find the one a burst belongs to.
  const hits = useMemo(
    () =>
      Object.entries(PRESSES)
        .flatMap(([id, list]) => list.map(([at]) => ({ id, at })))
        .sort((a, b) => a.at - b.at),
    []
  );

  useFrame((state, delta) => {
    const t = time.current;
    vim.current = still ? (enabled ? 1 : 0) : lerp(vim.current, enabled ? 1 : 0, 1 - Math.exp(-delta * 7));
    const on = vim.current;
    const s = browser.current;
    const mode = modeAt(t);
    const [pageA, pageB, pageMix] = pageAt(t);
    Object.assign(s, {
      // The first tab keeps its place while the second fades in over it.
      scrollA: t < 5.7 ? scroll(Math.min(t, 4.9)) : 0,
      scrollB: 0,
      pageA,
      pageB,
      pageMix,
      tabRow: tabRow(t),
      mode,
      keys: keysAt(t),
      vim: on,
      whichKey: whichKey(t) * on,
      whichKeyPage: t >= 14.6 && t < 16 ? "ai" : "leader",
      explorer: explorer(t) * on,
      explorerRow: explorerRow(t),
      dock: dock(t) * on,
      dockFocus: dockFocus(t),
      caret: t % 1 < 0.55 ? 1 : 0,
    });
    flash.current = theme.modes[mode];
    // The mode turning over glitches the picture for a moment.
    if (mode != lastMode.current) {
      lastMode.current = mode;
      if (on > 0.5) {
        strike(0.2);
      }
    }

    const now = VIM_BEATS.findLastIndex(start => t >= start);
    if (now != beat.current) {
      beat.current = now;
      onBeat?.(enabled ? now : -1);
    }

    // The keyboard sinks out of the way when vim mode is turned down.
    keyboard.current.position.y = lerp(-1.6, 0, easeInOut(on));

    // A burst on the last key hit, held for a few drawings like a cel.
    const hit = hits.findLast(({ at }) => t >= at);
    const age = hit ? t - hit.at : 1;
    const place = hit && KEY_AT[hit.id];
    burst.current.visible = on > 0.9 && age < 0.2 && !!place;
    if (burst.current.visible) {
      const step = Math.floor(age / 0.05);
      burst.current.position.set(place[0], place[1], 0.75);
      burst.current.scale.setScalar(1.25 + step * 0.42);
      burst.current.rotation.z = step * 0.35;
      burst.current.material.opacity = step > 2 ? 0.55 : 1;
    }

    // The camera leans toward what the keys are changing, and a little
    // toward the pointer.
    const l = on > 0.5 ? lean(t) : 0;
    const from = LEANS[Math.floor(l)];
    const to = LEANS[Math.min(LEANS.length - 1, Math.floor(l) + 1)];
    const mixAt = l - Math.floor(l);
    pointer.lerp(still ? pointer.set(0, 0) : state.pointer, 1 - Math.exp(-delta * 3));
    frame({
      target: [lerp(from.x, to.x, mixAt), lerp(from.y, to.y, mixAt) + (1 - on) * 0.5, 0.6],
      direction: [0.16 + pointer.x * 0.06, 0.34 + pointer.y * 0.04, 1],
      width: 11.6,
      height: 10.4,
      zoom: lerp(from.zoom, to.zoom, mixAt),
    });
  }, -1);

  return (
    <Set accent={CEL.blue} second={CEL.pink}>
      <BrowserModel theme={theme} state={browser} position={[0, 3.35, -1.2]} rotation={[-0.07, 0, 0]} />

      <group ref={keyboard}>
        <group position={[0, 0.34, 3.3]} rotation={[-Math.PI / 2 + 0.13, 0, 0]} scale={0.56}>
          <Keyboard time={time} presses={PRESSES} flash={flash} />
          <mesh ref={burst} visible={false} renderOrder={20}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial map={burstTexture} transparent toneMapped={false} depthTest={false} depthWrite={false} />
          </mesh>
        </group>
      </group>
    </Set>
  );
}
