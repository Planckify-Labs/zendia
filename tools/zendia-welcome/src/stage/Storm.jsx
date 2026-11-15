// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// A strike: thunder across the picture and the picture glitching under it.
// It marks the moments something changes, a new preview arriving or the
// mode turning over, and lasts a few drawings, held like cels rather than
// eased. The bolts are flat jagged shapes in front of the camera; the
// glitch tears the finished frame into bands and pulls its colors apart.

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { CEL } from "./kit.js";

const DRAWING = 0.055;

function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// One bolt, in screen units (-1 to 1 both ways): a zigzag from above the
// top edge down, wide where it starts and a point where it ends, with one
// fork.
function boltGeometry(seed) {
  const next = random(seed);
  const positions = [];
  const strand = (x, y, width, steps, lean) => {
    const points = [];
    let side = next() < 0.5 ? -1 : 1;
    for (let i = 0; i <= steps; i++) {
      points.push([x, y, width * (1 - i / steps) + 0.004]);
      // A long stroke one way, then a short one back, as lightning is drawn.
      const long = i % 2 == 0;
      x += side * (long ? 0.05 + next() * 0.16 : 0.02 + next() * 0.07) + lean;
      y -= long ? 0.16 + next() * 0.2 : 0.03 + next() * 0.08;
      side = -side;
    }
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, ay, aw] = points[i];
      const [bx, by, bw] = points[i + 1];
      positions.push(
        ax - aw, ay, 0, ax + aw, ay, 0, bx + bw, by, 0,
        ax - aw, ay, 0, bx + bw, by, 0, bx - bw, by, 0
      );
    }
    return points;
  };
  const main = strand(-0.55 + next() * 1.1, 1.1, 0.034, 9, (next() - 0.5) * 0.05);
  const [fx, fy] = main[3 + Math.floor(next() * 2)];
  strand(fx, fy, 0.016, 5, next() < 0.5 ? -0.06 : 0.06);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

const glitchShader = {
  uniforms: { map: { value: null }, amount: { value: 0 }, seed: { value: 0 }, flash: { value: 0 } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D map;
    uniform float amount;
    uniform float seed;
    uniform float flash;
    varying vec2 vUv;
    float hash(float n) {
      return fract(sin(n * 91.345 + seed * 17.13) * 47453.5453);
    }
    void main() {
      vec2 uv = vUv;
      // Thin bands torn sideways, and now and then a whole block.
      float band = floor(uv.y * 22.0);
      float shift = hash(band) > 1.0 - amount * 0.5 ? (hash(band + 31.0) - 0.5) * 0.2 * amount : 0.0;
      float block = floor(uv.y * 5.0);
      shift += hash(block + 77.0) > 1.0 - amount * 0.3 ? (hash(block + 5.0) - 0.5) * 0.07 : 0.0;
      uv.x += shift;
      float split = 0.01 * amount + abs(shift) * 0.35;
      vec3 color = vec3(
        texture2D(map, uv + vec2(split, 0.0)).r,
        texture2D(map, uv).g,
        texture2D(map, uv - vec2(split, 0.0)).b
      );
      color += flash * vec3(0.5, 0.4, 0.55);
      gl_FragColor = vec4(color, 1.0);
      #include <colorspace_fragment>
    }`,
  depthTest: false,
  depthWrite: false,
};

/**
 * @param {object} props
 * @param {{current: {pending: number, at: number, length: number, seed: number}}} props.storm
 *   Stage's record of the last strike; `pending` is one asked for and not
 *   yet started.
 * @param {boolean} props.still No motion: no strikes.
 * @param {number} [props.frozenAt] Dev page: hold a strike at this age.
 */
export function Storm({ storm, still, frozenAt }) {
  const camera = useThree(state => state.camera);
  const bolts = useRef();
  const variants = useMemo(() => [11, 23, 37, 53].map(boltGeometry), []);
  const pass = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, { samples: 4 });
    const material = new THREE.ShaderMaterial(glitchShader);
    material.uniforms = THREE.UniformsUtils.clone(glitchShader.uniforms);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    return { target, material, quad, size: new THREE.Vector2() };
  }, []);
  useEffect(
    () => () => {
      variants.forEach(geometry => geometry.dispose());
      pass.target.dispose();
      pass.material.dispose();
      pass.quad.geometry.dispose();
    },
    [variants, pass]
  );

  // Priority 1: this draws the frame, in place of the canvas' own render.
  useFrame(({ gl, scene, clock }) => {
    const s = storm.current;
    if (s.pending) {
      Object.assign(s, { at: clock.elapsedTime, length: s.pending, pending: 0, seed: s.seed + 1 });
    }
    const age = frozenAt ?? clock.elapsedTime - s.at;
    const length = frozenAt != null ? 0.45 : s.length;
    const live = !still && age >= 0 && age < length;
    const drawing = Math.floor(age / DRAWING);

    // The bolt shows on the first drawing, is gone on the second and comes
    // back as another on the next two: the flicker of a strike.
    const shown = live && length > 0.3 && drawing != 1 && drawing < 4;
    bolts.current.visible = shown;
    if (shown) {
      const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 2;
      bolts.current.position.copy(camera.position);
      bolts.current.quaternion.copy(camera.quaternion);
      bolts.current.scale.set(half * camera.aspect, half, 1);
      const pick = (s.seed + (drawing > 1 ? 1 : 0)) % variants.length;
      bolts.current.children.forEach((bolt, index) => {
        bolt.visible = index == pick;
      });
    }

    if (!live) {
      gl.setRenderTarget(null);
      gl.render(scene, camera);
      return;
    }
    gl.getDrawingBufferSize(pass.size);
    if (pass.target.width != pass.size.x || pass.target.height != pass.size.y) {
      pass.target.setSize(pass.size.x, pass.size.y);
    }
    gl.setRenderTarget(pass.target);
    gl.render(scene, camera);
    gl.setRenderTarget(null);
    const uniforms = pass.material.uniforms;
    uniforms.map.value = pass.target.texture;
    uniforms.amount.value = Math.max(0.15, 1 - age / length);
    uniforms.seed.value = drawing + s.seed * 7;
    // A short lift of the whole picture on the first drawing, kept low: one
    // soft flash for each strike, never a strobe.
    uniforms.flash.value = drawing == 0 && length > 0.3 ? 0.4 : 0;
    gl.render(pass.quad, camera);
  }, 1);

  return (
    <group ref={bolts} visible={false}>
      {variants.map((geometry, index) => (
        <mesh key={index} geometry={geometry} position={[0, 0, -2]} renderOrder={50} frustumCulled={false}>
          <meshBasicMaterial color={CEL.red} toneMapped={false} depthTest={false} transparent side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}
