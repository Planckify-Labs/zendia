// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Search: Zen's floating address bar takes a query and hands it to the
// engine picked on the page, whose icon sits in the bar.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BrowserModel, defaultBrowserState, place } from "../BrowserModel.jsx";
import { useImageTexture } from "../parts.jsx";
import { Set, useFraming, useLoop, useStage } from "../Stage.jsx";
import { CEL, fillRRect, font, lerp, paintTexture, roundedRect, span, spring, text, withAlpha } from "../kit.js";

const LOOP = 6.5;
const QUERY = "vim keys";
const BAR = { width: 470, height: 60, x: 303, y: 150 };
const TYPE_FROM = 1.1;
const TYPE_STEP = 0.14;
const ENTER = TYPE_FROM + QUERY.length * TYPE_STEP + 0.7;

function paintBar(theme, typed) {
  return paintTexture(BAR.width, BAR.height, 2.5, ctx => {
    fillRRect(ctx, 0, 0, BAR.width, BAR.height, 18, CEL.ink);
    fillRRect(ctx, 2.5, 2.5, BAR.width - 5, BAR.height - 5, 15.5, theme.float);
    const ink = theme.dark ? "#ffffff" : "#15151a";
    const width = text(ctx, typed, 64, BAR.height / 2 + 1, ink, font(20, 500));
    ctx.fillStyle = withAlpha(ink, 0.9);
    ctx.fillRect(66 + width, BAR.height / 2 - 12, 2, 24);
  });
}

/**
 * @param {object} props
 * @param {{iconURL: string}|null} props.engine
 * @param {boolean} props.vim
 */
export function SearchScene({ engine, vim }) {
  const { theme } = useStage();
  const time = useLoop(LOOP, 2.6);
  const frame = useFraming();
  const browser = useRef(defaultBrowserState());
  const bar = useRef();
  const panel = useRef();
  const icon = useImageTexture(engine?.iconURL);
  const bars = useMemo(
    () => Array.from({ length: QUERY.length + 1 }, (_, length) => paintBar(theme, QUERY.slice(0, length))),
    [theme]
  );
  useEffect(() => () => bars.forEach(texture => texture.dispose()), [bars]);
  const geometry = useMemo(() => roundedRect(BAR.width, BAR.height, 18), []);
  const shadow = useMemo(() => paintTexture(BAR.width, BAR.height, 1, ctx => fillRRect(ctx, 0, 0, BAR.width, BAR.height, 18, withAlpha(CEL.ink, 0.38))), []);

  useFrame(() => {
    const t = time.current;
    const open = spring(span(t, 0.4, 0.5)) * (1 - span(t, ENTER, 0.14));
    const typed = Math.max(0, Math.min(QUERY.length, Math.floor((t - TYPE_FROM) / TYPE_STEP) + 1));
    Object.assign(browser.current, {
      vim: vim ? 1 : 0,
      pageA: 0,
      pageB: 1,
      pageMix: span(t, ENTER + 0.1, 0.25) * (1 - span(t, LOOP - 0.5, 0.4)),
    });
    bar.current.visible = open > 0.01;
    bar.current.scale.setScalar(lerp(0.9, 1, open));
    bar.current.position.z = lerp(6, 22, open);
    const texture = bars[typed];
    if (panel.current.material.map != texture) {
      panel.current.material.map = texture;
      panel.current.material.needsUpdate = true;
    }
    frame({ target: [0.4, 3.5, 0], direction: [-0.18, 0.14, 1], width: 9.8, height: 6.6 });
  }, -1);

  return (
    <Set accent={CEL.orange} second={CEL.yellow}>
      <BrowserModel theme={theme} state={browser} position={[0, 3.35, 0]} rotation={[-0.04, 0, 0]}>
        <group ref={bar} position={place(BAR.x, BAR.y, BAR.width, BAR.height, 22)}>
          <mesh geometry={geometry} position={[9, -9, -1]} renderOrder={11}>
            <meshBasicMaterial map={shadow} transparent toneMapped={false} depthWrite={false} />
          </mesh>
          <mesh ref={panel} geometry={geometry} renderOrder={12}>
            <meshBasicMaterial transparent toneMapped={false} depthWrite={false} />
          </mesh>
          {icon && (
            <mesh position={[-BAR.width / 2 + 34, 0, 0.5]} renderOrder={13}>
              <planeGeometry args={[28, 28]} />
              <meshBasicMaterial map={icon} transparent toneMapped={false} depthWrite={false} />
            </mesh>
          )}
        </group>
      </BrowserModel>
    </Set>
  );
}
