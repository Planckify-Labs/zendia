// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Essentials: each app picked on the page takes its tile at the top of the
// sidebar, where Zen keeps Essentials, and the tabs move down to make room.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { BrowserModel, defaultBrowserState, place } from "../BrowserModel.jsx";
import { Cel } from "../Cel.jsx";
import { Picture } from "../parts.jsx";
import { Set, useFraming, useStage } from "../Stage.jsx";
import { CEL, mix, slab, spring } from "../kit.js";

const TILE = { width: 56, height: 46, gap: 8, x: 10, y: 92 };

// The plate is white in both themes: the apps' icons are drawn for it.
function Tile({ app, index, still }) {
  const node = useRef();
  const born = useRef(null);
  const geometry = useMemo(() => slab(TILE.width, TILE.height, 8, 11, 2), []);
  useFrame(state => {
    born.current ??= state.clock.elapsedTime;
    const age = still ? 1 : (state.clock.elapsedTime - born.current) / 0.45;
    node.current.scale.setScalar(Math.max(0.001, spring(age)));
  });
  const x = TILE.x + (index % 3) * (TILE.width + TILE.gap);
  const y = TILE.y + Math.floor(index / 3) * (TILE.height + TILE.gap);
  return (
    <group ref={node} position={place(x, y, TILE.width, TILE.height, 9)}>
      <Cel geometry={geometry} color={mix("#ffffff", app.color, 0.22)} line={2.2} shadow={false} />
      <Picture url={app.icon} size={22} position={[0, 0, 0.6]} />
    </group>
  );
}

/**
 * @param {object} props
 * @param {Array<{url: string, icon: string, color: string}>} props.apps
 *   The apps picked, in the order they were picked.
 * @param {boolean} props.vim
 */
export function EssentialsScene({ apps, vim }) {
  const { theme, still } = useStage();
  const frame = useFraming();
  const browser = useRef(defaultBrowserState());
  const rows = Math.ceil(apps.length / 3);
  const top = 112 + rows * (TILE.height + TILE.gap) + (rows ? 6 : 0);

  useFrame(() => {
    browser.current.vim = vim ? 1 : 0;
    frame({ target: [-1.4, 3.9, 0], direction: [-0.34, 0.12, 1], width: 7.6, height: 6.2 });
  }, -1);

  return (
    <Set accent={CEL.yellow} second={CEL.orange}>
      <BrowserModel theme={theme} state={browser} tabsTop={top} position={[0, 3.35, 0]} rotation={[-0.04, 0, 0]}>
        {apps.map((app, index) => (
          <Tile key={app.url} app={app} index={index} still={still} />
        ))}
      </BrowserModel>
    </Set>
  );
}
