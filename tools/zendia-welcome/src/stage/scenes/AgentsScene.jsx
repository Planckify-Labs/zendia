// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Agents: the agent picked on the page works on the tab. Its pointer, in its
// color, clicks through the guide; the tab it drives wears its color.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { BrowserModel, defaultBrowserState, place } from "../BrowserModel.jsx";
import { Pointer, Ripple } from "../parts.jsx";
import { Set, useFraming, useLoop, useStage } from "../Stage.jsx";
import { CEL, easeInOut, lerp, span, track } from "../kit.js";

const LOOP = 9;
// Where the pointer goes on the page, in the window's pixels, and when it
// clicks there.
const STOPS = [
  { at: 0.3, x: 520, y: 470, click: null },
  { at: 1.4, x: 330, y: 318, click: 1.5 },
  { at: 3.6, x: 110, y: 166, click: 3.8 },
  { at: 6.0, x: 350, y: 372, click: 6.2 },
];
const scroll = track(0, [[1.6, 250, 0.6], [3.85, 0, 0.01]]);
const scrollB = track(0, [[6.3, 190, 0.6]]);

/**
 * @param {object} props
 * @param {{name: string, color: string}|null} props.agent
 * @param {boolean} props.vim
 */
export function AgentsScene({ agent, vim }) {
  const { theme } = useStage();
  const time = useLoop(LOOP, 2);
  const frame = useFraming();
  const browser = useRef({ ...defaultBrowserState(), dock: 1 });
  const pointer = useRef();
  const ripple = useRef();
  const who = useMemo(
    () => (agent ? { name: agent.name, color: agent.color } : { name: "Your agent", color: CEL.green }),
    [agent?.name, agent?.color]
  );

  useFrame(() => {
    const t = time.current;
    const fade = 1 - span(t, LOOP - 0.5, 0.4);
    const turned = t >= 3.85;
    Object.assign(browser.current, {
      vim: vim ? 1 : 0,
      dock: 1,
      scrollA: turned ? 0 : scroll(t),
      scrollB: scrollB(t),
      pageA: 0,
      pageB: 1,
      pageMix: turned ? Math.min(span(t, 3.85, 0.18), fade) : 0,
      tabRow: turned && fade > 0.5 ? 1 : 0,
      tabGlow: 1,
    });

    let index = STOPS.findLastIndex(stop => t >= stop.at);
    const to = STOPS[Math.max(0, index)];
    const from = STOPS[Math.max(0, index - 1)];
    const move = easeInOut(span(t, to.at, 0.75));
    const [x, y] = place(lerp(from.x, to.x, move), lerp(from.y, to.y, move), 0, 0);
    pointer.current.position.set(x, y, 20);

    const clicked = STOPS.findLast(stop => stop.click != null && t >= stop.click);
    const age = clicked ? t - clicked.click : 1;
    ripple.current.visible = age < 0.4;
    if (ripple.current.visible) {
      const [rx, ry] = place(clicked.x, clicked.y, 0, 0);
      ripple.current.position.set(rx, ry, 19);
      ripple.current.scale.setScalar(8 + Math.floor(age / 0.07) * 9);
      ripple.current.material.opacity = age > 0.25 ? 0.5 : 1;
    }
    // A click presses the pointer down for a moment.
    pointer.current.scale.setScalar(age < 0.12 ? 58 : 70);

    frame({ target: [0.2, 3.3, 0], direction: [0.24, 0.16, 1], width: 10.2, height: 7 });
  }, -1);

  return (
    <Set accent={who.color} second={CEL.pink}>
      <BrowserModel theme={theme} state={browser} agent={who} position={[0, 3.35, 0]} rotation={[-0.04, 0, 0]}>
        <Ripple ref={ripple} color={who.color} visible={false} />
        <Pointer ref={pointer} color={who.color} edge={theme.dark ? CEL.paper : CEL.ink} scale={70} />
      </BrowserModel>
    </Set>
  );
}
