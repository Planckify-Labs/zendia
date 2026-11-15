// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Props the scenes share: painted cards, pictures, a pointer, clouds.

import { forwardRef, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Cel } from "./Cel.jsx";
import { CEL, paintTexture, roundedRect, slab } from "./kit.js";

/**
 * A slab with a painted face. Sizes are in scene units; `paint(ctx, w, h)`
 * draws the face in hundredths of a unit.
 */
export const Card = forwardRef(function Card(
  { width, height, depth = 0.12, radius = 0.12, color = CEL.paper, line = 0.03, paint, paintKey, children, ...props },
  ref
) {
  const body = useMemo(() => slab(width, height, depth, radius), [width, height, depth, radius]);
  const face = useMemo(() => roundedRect(width, height, radius), [width, height, radius]);
  const texture = useMemo(
    () => paint && paintTexture(width * 100, height * 100, 2.5, paint),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width, height, paintKey]
  );
  useEffect(() => () => texture?.dispose(), [texture]);
  useEffect(
    () => () => {
      body.dispose();
      face.dispose();
    },
    [body, face]
  );
  return (
    <group ref={ref} {...props}>
      <Cel geometry={body} color={color} line={line} />
      {texture && (
        <mesh geometry={face} position={[0, 0, 0.004]}>
          <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      )}
      {children}
    </group>
  );
});

/** A picture by URL (a favicon, a browser's logo), or null until it loads. */
export function useImageTexture(url) {
  const [texture, setTexture] = useState(null);
  useEffect(() => {
    if (!url) {
      setTexture(null);
      return undefined;
    }
    let live = true;
    let made = null;
    const image = new Image();
    // Some icons are drawn black or white by the color scheme. The plates
    // they are shown on are light, so the image loads in the page, unseen,
    // with a light scheme of its own.
    image.style.cssText = "position:absolute;width:0;height:0;visibility:hidden;color-scheme:light";
    document.body.appendChild(image);
    image.onload = () => {
      if (!live) {
        return;
      }
      // Drawn to a canvas first: an SVG has no size of its own to upload.
      made = paintTexture(96, 96, 2, ctx => ctx.drawImage(image, 0, 0, 96, 96));
      image.remove();
      setTexture(made);
    };
    image.onerror = () => {
      image.remove();
      live && setTexture(null);
    };
    image.src = url;
    return () => {
      live = false;
      image.remove();
      made?.dispose();
    };
  }, [url]);
  return texture;
}

export function Picture({ url, size, ...props }) {
  const texture = useImageTexture(url);
  if (!texture) {
    return null;
  }
  return (
    <mesh {...props}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

const arrow = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0, -0.62);
  shape.lineTo(0.16, -0.47);
  shape.lineTo(0.27, -0.72);
  shape.lineTo(0.37, -0.67);
  shape.lineTo(0.26, -0.43);
  shape.lineTo(0.46, -0.42);
  shape.closePath();
  return shape;
})();

/** A mouse pointer, flat, in `color` with an ink edge. Its tip is the origin. */
export const Pointer = forwardRef(function Pointer({ color = CEL.paper, edge = CEL.ink, ...props }, ref) {
  const geometry = useMemo(() => new THREE.ShapeGeometry(arrow), []);
  return (
    <group ref={ref} {...props}>
      <mesh geometry={geometry} scale={1.18} position={[-0.035, 0.05, -0.01]} renderOrder={30}>
        {/* Transparent only to be drawn with, and so over, the window's layers. */}
        <meshBasicMaterial color={edge} toneMapped={false} depthTest={false} transparent />
      </mesh>
      <mesh geometry={geometry} renderOrder={31}>
        <meshBasicMaterial color={color} toneMapped={false} depthTest={false} transparent />
      </mesh>
    </group>
  );
});

/** A ring that spreads from a click. Scale and opacity are the scene's. */
export const Ripple = forwardRef(function Ripple({ color = CEL.ink, ...props }, ref) {
  return (
    <mesh ref={ref} renderOrder={29} {...props}>
      <ringGeometry args={[0.8, 1, 40]} />
      <meshBasicMaterial color={color} transparent toneMapped={false} depthTest={false} />
    </mesh>
  );
});
