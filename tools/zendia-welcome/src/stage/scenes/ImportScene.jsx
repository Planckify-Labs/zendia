// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Import: bookmarks, history and passwords cross from the browser picked on
// the page into Zendia. Starting fresh, Zendia stands alone.

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { BrowserModel, defaultBrowserState } from "../BrowserModel.jsx";
import { Card, Picture } from "../parts.jsx";
import { Set, useFraming, useLoop, useStage } from "../Stage.jsx";
import { CEL, easeInOut, fillRRect, lerp } from "../kit.js";

const LOOP = 6;

function paintOldBrowser(ctx, w, h) {
  ctx.fillStyle = "#a9b3dc";
  ctx.fillRect(0, 0, w, 46);
  fillRRect(ctx, 14, 12, 92, 34, [9, 9, 0, 0], "#d5dcf7");
  fillRRect(ctx, 114, 16, 80, 26, 8, "#8490c0");
  fillRRect(ctx, 202, 16, 80, 26, 8, "#8490c0");
  fillRRect(ctx, 14, 58, w - 28, 26, 13, "#bcc5e8");
}

// What comes along: a bookmark, the history, a password.
const ITEMS = [
  {
    color: CEL.yellow,
    paint(ctx) {
      ctx.fillStyle = CEL.ink;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 ? 9 : 21;
        const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
        ctx.lineTo(45 + Math.cos(angle) * radius, 31 + Math.sin(angle) * radius);
      }
      ctx.fill();
    },
  },
  {
    color: CEL.teal,
    paint(ctx) {
      ctx.strokeStyle = CEL.ink;
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(45, 30, 18, 0, Math.PI * 2);
      ctx.moveTo(45, 19);
      ctx.lineTo(45, 30);
      ctx.lineTo(54, 35);
      ctx.stroke();
    },
  },
  {
    color: CEL.pink,
    paint(ctx) {
      ctx.strokeStyle = CEL.ink;
      ctx.lineWidth = 5.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(30, 30, 10, 0, Math.PI * 2);
      ctx.moveTo(40, 30);
      ctx.lineTo(68, 30);
      ctx.moveTo(60, 30);
      ctx.lineTo(60, 40);
      ctx.stroke();
    },
  },
];

/**
 * @param {object} props
 * @param {{image: string}|null} props.source The browser to import from.
 * @param {boolean} props.vim
 */
export function ImportScene({ source, vim }) {
  const { theme, still } = useStage();
  const time = useLoop(LOOP, 2.2);
  const frame = useFraming();
  const browser = useRef({ ...defaultBrowserState(), vim: vim ? 1 : 0 });
  const active = useRef(source ? 1 : 0);
  const old = useRef();
  const zendia = useRef();
  const items = useRef([]);

  useFrame((_, delta) => {
    const t = time.current;
    active.current = still ? (source ? 1 : 0) : lerp(active.current, source ? 1 : 0, 1 - Math.exp(-delta * 6));
    const a = easeInOut(active.current);
    old.current.position.set(lerp(-11, -3.7, a), 2.3, 0.6);
    zendia.current.position.x = lerp(0, 2.3, a);
    zendia.current.scale.setScalar(lerp(0.86, 0.66, a));
    ITEMS.forEach((_item, index) => {
      const node = items.current[index];
      const p = (t / LOOP + index / ITEMS.length) % 1;
      const along = easeInOut(Math.min(1, p / 0.7));
      node.visible = a > 0.6 && p < 0.72;
      node.position.set(lerp(-3.3, 0.2, along), 2.6 + Math.sin(along * Math.PI) * 2.3, lerp(0.9, 0.5, along));
      node.rotation.z = (1 - along) * 0.5 - 0.1;
      node.scale.setScalar(Math.min(1, p / 0.08) * Math.min(1, (0.72 - p) / 0.06));
    });
    frame({ target: [0, 3.2, 0], direction: [0.1, 0.22, 1], width: lerp(9.4, 12.6, a), height: 7 });
  }, -1);

  return (
    <Set accent={CEL.purple} second={CEL.cyan}>
      <Card ref={old} width={3.6} height={2.6} depth={0.2} radius={0.16} color="#d5dcf7" paint={paintOldBrowser} rotation={[-0.05, 0.3, 0]}>
        <Picture url={source?.image} size={0.9} position={[0, -0.3, 0.01]} />
      </Card>
      <group ref={zendia} position={[0, 3.3, -0.4]} rotation={[-0.05, -0.16, 0]}>
        <BrowserModel theme={theme} state={browser} />
      </group>
      {ITEMS.map((item, index) => (
        <Card
          key={index}
          ref={node => (items.current[index] = node)}
          width={0.9}
          height={0.6}
          depth={0.1}
          radius={0.1}
          color={item.color}
          paint={item.paint}
        />
      ))}
    </Set>
  );
}
