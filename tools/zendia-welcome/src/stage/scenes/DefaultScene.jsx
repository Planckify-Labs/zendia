// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Default browser: a link clicked in another app. As the default, Zendia
// opens it; otherwise it goes to the browser behind.

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { BrowserModel, defaultBrowserState } from "../BrowserModel.jsx";
import { Card, Pointer } from "../parts.jsx";
import { Set, useFraming, useLoop, useStage } from "../Stage.jsx";
import { CEL, easeInOut, fillRRect, lerp, span } from "../kit.js";

const LOOP = 5.5;
const CLICK = 1.2;
const FLIGHT = 1.0;

// A chat in some other app: two messages, the second with a link.
function paintChat(ctx, w, h) {
  ctx.fillStyle = "#bcc5e8";
  ctx.fillRect(0, 0, w, 44);
  fillRRect(ctx, 16, 14, 90, 16, 8, "#8490c0");
  fillRRect(ctx, 20, 70, 170, 54, 16, "#cdd5f5");
  fillRRect(ctx, 34, 86, 120, 8, 4, "#8490c0");
  fillRRect(ctx, 34, 102, 80, 8, 4, "#8490c0");
  fillRRect(ctx, 20, 142, 210, 74, 16, "#cdd5f5");
  fillRRect(ctx, 34, 158, 150, 8, 4, "#8490c0");
  fillRRect(ctx, 34, 180, 170, 22, 11, CEL.blue);
  fillRRect(ctx, 20, h - 52, w - 40, 34, 17, "#cdd5f5");
}

function paintLink(ctx, w, h) {
  ctx.strokeStyle = CEL.paper;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(24, h / 2, 8, Math.PI * 0.5, Math.PI * 1.5);
  ctx.arc(40, h / 2, 8, Math.PI * 1.5, Math.PI * 0.5);
  ctx.stroke();
  fillRRect(ctx, 60, h / 2 - 4, w - 78, 8, 4, CEL.paper);
}

function paintOther(ctx, w, h) {
  ctx.fillStyle = "#a9b3dc";
  ctx.fillRect(0, 0, w, 40);
  fillRRect(ctx, 12, 10, 80, 30, [8, 8, 0, 0], "#bcc5e8");
  fillRRect(ctx, 12, 52, w - 24, 22, 11, "#bcc5e8");
}

/**
 * @param {object} props
 * @param {boolean} props.enabled The page's choice: Zendia as the default.
 * @param {boolean} props.vim
 */
export function DefaultScene({ enabled, vim }) {
  const { theme, still } = useStage();
  const time = useLoop(LOOP, 1.9);
  const frame = useFraming();
  const browser = useRef(defaultBrowserState());
  const on = useRef(enabled ? 1 : 0);
  const link = useRef();
  const pointer = useRef();
  const zendia = useRef();
  const other = useRef();

  useFrame((_, delta) => {
    const t = time.current;
    on.current = still ? (enabled ? 1 : 0) : lerp(on.current, enabled ? 1 : 0, 1 - Math.exp(-delta * 7));
    const a = easeInOut(on.current);
    const fly = easeInOut(span(t, CLICK, FLIGHT));
    const landed = t > CLICK + FLIGHT;
    const reset = 1 - span(t, LOOP - 0.5, 0.4);

    // The default browser stands in front; the other waits behind.
    zendia.current.position.set(lerp(3.4, 2.1, a), lerp(4.6, 3.2, a), lerp(-3.4, 0, a));
    zendia.current.scale.setScalar(lerp(0.4, 0.6, a));
    other.current.position.set(lerp(2.2, 3.6, a), lerp(3.0, 5.0, a), lerp(0.2, -3.2, a));
    other.current.scale.setScalar(lerp(1.25, 0.8, a));

    const goal = on.current > 0.5 ? zendia.current.position : other.current.position;
    link.current.visible = t > CLICK && !landed;
    link.current.position.set(
      lerp(-3.1, goal.x, fly),
      lerp(2.55, goal.y, fly) + Math.sin(fly * Math.PI) * 1.6,
      lerp(0.9, goal.z + 0.4, fly)
    );
    link.current.scale.setScalar(Math.min(1, (t - CLICK) / 0.1));

    // In Zendia the link opens as a tab; the other browser only nods.
    const opened = landed && on.current > 0.5 ? reset : 0;
    Object.assign(browser.current, {
      vim: vim ? 1 : 0,
      pageA: 0,
      pageB: 2,
      pageMix: opened * span(t, CLICK + FLIGHT, 0.2),
      tabRow: opened > 0.5 ? 2 : 0,
    });
    const bump = landed && t < CLICK + FLIGHT + 0.14 ? 1.06 : 1;
    (on.current > 0.5 ? zendia : other).current.scale.multiplyScalar(bump);

    const press = t > CLICK - 0.08 && t < CLICK + 0.1;
    pointer.current.position.set(lerp(-1.8, -3.0, easeInOut(span(t, 0.2, 0.8))), lerp(1.6, 2.5, easeInOut(span(t, 0.2, 0.8))), 1.2);
    pointer.current.scale.setScalar(press ? 0.72 : 0.9);

    frame({ target: [-0.2, 3.3, 0], direction: [0.05, 0.2, 1], width: 11.4, height: 7 });
  }, -1);

  return (
    <Set accent={CEL.cyan} second={CEL.pink}>
      <Card width={2.6} height={3.6} depth={0.2} radius={0.18} color="#e4e9ff" paint={paintChat} position={[-3.6, 3.1, 0.6]} rotation={[-0.05, 0.32, 0]} />
      <Card ref={other} width={3.2} height={2.3} depth={0.2} radius={0.16} color="#d5dcf7" paint={paintOther} rotation={[-0.05, -0.2, 0]} />
      <group ref={zendia} rotation={[-0.05, -0.2, 0]}>
        <BrowserModel theme={theme} state={browser} />
      </group>
      <Card ref={link} width={1.7} height={0.44} depth={0.08} radius={0.2} color={CEL.blue} paint={paintLink} visible={false} />
      <Pointer ref={pointer} />
    </Set>
  );
}
