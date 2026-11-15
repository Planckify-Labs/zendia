// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// The canvas the previews play on. One WebGL context serves the whole
// onboarding; the scene in it changes with the step.

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import "./Cel.jsx";
import { Storm } from "./Storm.jsx";
import { CEL, mix, paintTexture, rimLight, withAlpha } from "./kit.js";

const StageContext = createContext(null);
export const useStage = () => useContext(StageContext);

/**
 * The scene's clock: seconds into a loop of `length`. Without motion (the
 * system's reduced motion setting, or a frozen dev page) it stays at `pose`,
 * the moment that shows the scene best.
 *
 * @returns {{current: number}}
 */
export function useLoop(length, pose) {
  const { still, frozenAt } = useStage();
  const time = useRef(frozenAt ?? (still ? pose : 0));
  useFrame((_, delta) => {
    if (frozenAt == null && !still) {
      time.current = (time.current + Math.min(delta, 0.1)) % length;
    }
  }, -2);
  return time;
}

/**
 * Points the camera so that a box of `width` by `height` around `target`
 * fills the canvas whatever its shape, seen from `direction`.
 */
export function useFraming() {
  const size = useThree(state => state.size);
  const camera = useThree(state => state.camera);
  const scratch = useMemo(() => ({ direction: new THREE.Vector3(), target: new THREE.Vector3() }), []);
  return ({ target, direction, width, height, zoom = 1 }) => {
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const aspect = size.width / Math.max(1, size.height);
    const distance = Math.max(height / 2 / half, width / 2 / (half * aspect)) / zoom;
    scratch.target.set(...target);
    scratch.direction.set(...direction).normalize();
    camera.position.copy(scratch.target).addScaledVector(scratch.direction, distance);
    camera.lookAt(scratch.target);
  };
}

// The same city every time: a small generator with a fixed seed.
function random(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const WALL = { width: 44, height: 22, floor: 0.9, pixels: [2048, 1024] };

// The backdrop, painted the way an animation's backgrounds are: soft and
// deep where the cels in front of it are hard. Zendia's night as a city at
// night, its haze and its signs in the scene's two colors.
function paintWall(accent, second) {
  const [width, height] = WALL.pixels;
  return paintTexture(width, height, 1, ctx => {
    const horizon = height * WALL.floor;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#0d0e17");
    sky.addColorStop(0.5, CEL.night);
    sky.addColorStop(0.86, mix(CEL.raised, accent, 0.28));
    sky.addColorStop(1, mix(CEL.raised, accent, 0.62));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizon);

    // A shaft of light across the haze, hard edged.
    ctx.fillStyle = withAlpha(accent, 0.07);
    ctx.beginPath();
    ctx.moveTo(width * 0.58, 0);
    ctx.lineTo(width * 0.74, 0);
    ctx.lineTo(width * 0.5, horizon);
    ctx.lineTo(width * 0.3, horizon);
    ctx.fill();

    const next = random(7);
    const skyline = (count, tone, tallest, lights) => {
      let x = -20;
      for (let i = 0; i < count; i++) {
        const w = 46 + next() * 90;
        // Lower in the middle, where the scene's subject stands.
        const side = Math.min(1, Math.abs(x + w / 2 - width / 2) / (width * 0.42));
        const h = tallest * (0.28 + 0.72 * side) * (0.55 + next() * 0.45);
        ctx.fillStyle = tone;
        ctx.fillRect(x, horizon - h, w, h);
        // Its lit windows.
        for (let wy = horizon - h + 10; wy < horizon - 12; wy += 13) {
          for (let wx = x + 7; wx < x + w - 9; wx += 11) {
            if (next() < lights) {
              ctx.fillStyle = withAlpha(next() < 0.7 ? accent : second, 0.35 + next() * 0.5);
              ctx.fillRect(wx, wy, 6, 4);
            }
          }
        }
        x += w + next() * 14;
      }
    };
    skyline(22, mix(CEL.raised, accent, 0.16), 420, 0.1);
    skyline(16, mix(CEL.night, CEL.base, 0.5), 300, 0.16);

    // Signs: strips of neon with their glow.
    for (const [sx, sy, sw, sh, color] of [
      [width * 0.16, horizon - 150, 150, 9, accent],
      [width * 0.79, horizon - 190, 9, 120, second],
      [width * 0.7, horizon - 96, 110, 7, accent],
      [width * 0.27, horizon - 64, 8, 52, second],
    ]) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 26;
      ctx.fillStyle = color;
      ctx.fillRect(sx, sy, sw, sh);
      ctx.fillRect(sx, sy, sw, sh);
    }
    ctx.shadowBlur = 0;

    // The city's light gathered on the ground behind the scene.
    const glow = ctx.createLinearGradient(0, horizon - 60, 0, horizon);
    glow.addColorStop(0, withAlpha(accent, 0));
    glow.addColorStop(1, withAlpha(accent, 0.5));
    ctx.fillStyle = glow;
    ctx.fillRect(0, horizon - 60, width, 60);
    ctx.fillStyle = CEL.night;
    ctx.fillRect(0, horizon, width, height - horizon);
  });
}

// The ground: night, with the city's light spilling over it from behind.
function paintFloor(accent) {
  return paintTexture(64, 512, 1, (ctx, width, height) => {
    const spill = ctx.createLinearGradient(0, 0, 0, height);
    spill.addColorStop(0, mix(CEL.raised, accent, 0.5));
    spill.addColorStop(0.22, mix(CEL.base, accent, 0.16));
    spill.addColorStop(1, CEL.base);
    ctx.fillStyle = spill;
    ctx.fillRect(0, 0, width, height);
  });
}

/**
 * The set every scene stands on: Zendia's night as a city behind a lit
 * floor. A warm key light with a cool ambient gives every shadow its color,
 * and the scene's neon lights the edges from behind.
 *
 * @param {object} props
 * @param {string} [props.accent] The scene's neon.
 * @param {string} [props.second] A second color for a few signs and windows.
 */
export function Set({ accent = CEL.pink, second = CEL.cyan, children }) {
  const wall = useMemo(() => paintWall(accent, second), [accent, second]);
  const floor = useMemo(() => paintFloor(accent), [accent]);
  useEffect(
    () => () => {
      wall.dispose();
      floor.dispose();
    },
    [wall, floor]
  );
  useLayoutEffect(() => {
    rimLight.value.set(accent);
  }, [accent]);
  // Every preview arrives on a strike.
  const { strike } = useStage();
  useEffect(() => strike(0.45), [strike]);
  return (
    <>
      <ambientLight color="#948fc9" intensity={Math.PI} />
      <directionalLight
        color="#d9deae"
        intensity={Math.PI}
        position={[-6, 12, 9]}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-near={1}
        shadow-camera-far={40}
        shadow-bias={-0.0006}
        shadow-normalBias={0.02}
      />
      {/* The neon, from behind: it catches the edges turned away from the key. */}
      <directionalLight color={accent} intensity={Math.PI * 0.4} position={[9, 5, -8]} />
      <mesh position={[0, 12, -14.2]}>
        <planeGeometry args={[160, 80]} />
        <meshBasicMaterial color={CEL.night} toneMapped={false} />
      </mesh>
      <mesh position={[0, WALL.height * (WALL.floor - 0.5), -14]}>
        <planeGeometry args={[WALL.width, WALL.height]} />
        <meshBasicMaterial map={wall} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 6]} receiveShadow>
        <planeGeometry args={[160, 40]} />
        <celMaterial args={[{ gloss: 0, rim: 0 }]} map={floor} />
      </mesh>
      {children}
    </>
  );
}

// A preview that cannot draw (no WebGL, a lost context) leaves its place
// empty; the onboarding goes on without it.
class Quiet extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error("Zendia onboarding preview:", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * @param {object} props
 * @param {boolean} props.still No motion: scenes hold their pose.
 * @param {number} [props.frozenAt] Dev page: hold every scene at this second.
 * @param {number} [props.frozenStrike] Dev page: hold a strike at this age.
 * @param {object} props.theme
 * @param {React.ReactNode} props.children The scene.
 */
export function Stage({ still, frozenAt, frozenStrike, theme, children }) {
  const storm = useRef({ pending: 0, at: -10, length: 0, seed: 0 });
  const value = useMemo(
    () => ({
      still,
      frozenAt,
      theme,
      // Thunder and a glitch for `seconds` (Storm.jsx); under a third of a
      // second it is the glitch alone.
      strike(seconds) {
        storm.current.pending = seconds;
      },
    }),
    [still, frozenAt, theme]
  );
  return (
    <Quiet>
      <Canvas
        flat
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ fov: 30, near: 0.5, far: 120 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        aria-hidden="true"
        tabIndex={-1}
      >
        <StageContext.Provider value={value}>
          {children}
          <Storm storm={storm} still={still} frozenAt={frozenStrike} />
        </StageContext.Provider>
      </Canvas>
    </Quiet>
  );
}
