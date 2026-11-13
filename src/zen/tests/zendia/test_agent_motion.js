/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const {
  chunkDuration,
  nextEma,
  ringDashes,
  seedOf,
  sharedEnds,
  veilFrames,
  veilSpeed,
  workingWord,
} = ChromeUtils.importESModule(
  "resource:///modules/zendia/ui/ZendiaAgentMotion.sys.mjs"
);

function near(actual, expected, message, tolerance = 1e-3) {
  Assert.lessOrEqual(
    Math.abs(actual - expected),
    tolerance,
    `${message}: ${actual} vs ${expected}`
  );
}

add_task(function test_shared_ends() {
  Assert.deepEqual(sharedEnds("Opus 5.5", "Opus 5.1"), {
    prefix: 7,
    suffix: 0,
  });
  Assert.deepEqual(sharedEnds("abcXYZdef", "abc12def"), {
    prefix: 3,
    suffix: 3,
  });
  Assert.deepEqual(sharedEnds("same", "same"), { prefix: 4, suffix: 0 });
  Assert.deepEqual(sharedEnds("", ""), { prefix: 0, suffix: 0 });
  Assert.deepEqual(sharedEnds("", "abc"), { prefix: 0, suffix: 0 });
  Assert.deepEqual(sharedEnds("abc", ""), { prefix: 0, suffix: 0 });
  Assert.deepEqual(sharedEnds("abc", "xyz"), { prefix: 0, suffix: 0 });

  // The ends must not overlap: aaa -> aaaa shares 3 at the head, nothing
  // is left to share at the tail.
  Assert.deepEqual(sharedEnds("aaa", "aaaa"), { prefix: 3, suffix: 0 });
  Assert.deepEqual(sharedEnds("aaaa", "aaa"), { prefix: 3, suffix: 0 });
  Assert.deepEqual(sharedEnds("abab", "ab"), { prefix: 2, suffix: 0 });
  const { prefix, suffix } = sharedEnds("xaax", "xax");
  Assert.lessOrEqual(prefix + suffix, 3, "never longer than the shorter text");
});

add_task(function test_shared_ends_keep_emoji_whole() {
  // The two emoji share their first UTF-16 unit; they are different glyphs.
  Assert.deepEqual(sharedEnds("a\u{1F600}b", "a\u{1F601}b"), {
    prefix: 1,
    suffix: 1,
  });
  Assert.deepEqual(sharedEnds("\u{1F600}", "\u{1F601}"), {
    prefix: 0,
    suffix: 0,
  });
  // Counted in code points: one emoji is one.
  Assert.deepEqual(sharedEnds("\u{1F600}a", "\u{1F600}b"), {
    prefix: 1,
    suffix: 0,
  });
  Assert.deepEqual(sharedEnds("x\u{1F600}", "y\u{1F600}"), {
    prefix: 0,
    suffix: 1,
  });
});

add_task(function test_veil_frames() {
  const frames = veilFrames();
  Assert.equal(frames.length, 9);
  const spec = [0, 0.192, 0.369, 0.529, 0.67, 0.792, 0.891, 0.964, 1];
  spec.forEach((value, i) => near(frames[i], value, `frame ${i}`, 1e-3));
  Assert.equal(frames[0], 0);
  Assert.equal(frames[8], 1);
  for (let i = 1; i < frames.length; i++) {
    Assert.greater(frames[i], frames[i - 1], "alpha only goes up");
  }
});

add_task(function test_chunk_timing() {
  Assert.equal(chunkDuration(160), 400, "the seed clamps to the top");
  Assert.equal(chunkDuration(120), 360, "the 120 ms cadence");
  Assert.equal(chunkDuration(10), 120, "clamped to the bottom");
  Assert.equal(chunkDuration(40), 120);
  Assert.equal(chunkDuration(10000), 400);

  near(nextEma(160, 120), 160 * 0.7 + 120 * 0.3, "one step", 1e-9);
  Assert.equal(
    nextEma(100, 5000),
    100 * 0.7 + 1000 * 0.3,
    "a stall counts 1 s"
  );
  Assert.equal(nextEma(100, 1000), nextEma(100, 99999));
  let ema = 160;
  for (let i = 0; i < 60; i++) {
    ema = nextEma(ema, 120);
  }
  near(ema, 120, "converges to the cadence", 0.01);
  near(chunkDuration(ema), 360, "about 360 ms", 0.05);
});

add_task(function test_veil_speed() {
  Assert.equal(veilSpeed(0), 1);
  Assert.equal(veilSpeed(1), 1);
  Assert.equal(veilSpeed(2), 1);
  near(veilSpeed(3), 1.3, "three chunks", 1e-9);
  near(veilSpeed(4), 1.6, "four chunks", 1e-9);
  near(veilSpeed(6), 2.2, "six chunks", 1e-9);
});

// Independent copy of the spec's formulas, for a mid-run dash.
function expectedDash(ph, i) {
  const smooth = (a, b, x) => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  };
  const tau = ph / 3.9;
  const lead = 720 * (0.5 - 0.5 * Math.cos(Math.PI * tau));
  const speed = Math.sin(Math.PI * tau);
  const amp = smooth(0, 0.55, ph) * (1 - smooth(3.9 - 0.75, 3.9, ph));
  const pull = lead - 14 * speed;
  const c = 45 * i;
  let dl = (((pull - c + 180) % 360) + 360) % 360;
  dl -= 180;
  const sigma = dl < 0 ? 26 : 40;
  const g = amp * Math.exp(-(dl * dl) / (sigma * sigma));
  return {
    centre: c + Math.sign(dl) * 9 * g,
    half: 10.95 * (1 + 1.3 * g),
    glow: g,
  };
}

add_task(function test_ring_dashes_at_rest() {
  for (const ph of [0, 3.9, 4.2, 100]) {
    const dashes = ringDashes(ph);
    Assert.equal(dashes.length, 8);
    dashes.forEach((dash, i) => {
      Assert.equal(dash.centre, 45 * i, `dash ${i} at ${ph}`);
      Assert.equal(dash.half, 10.95);
      Assert.equal(dash.glow, 0);
    });
  }
  // 21.9 degrees of dash and 23.1 of gap fill the 45 degree step.
  near(2 * 10.95 + 23.1, 45, "dash and gap", 1e-9);
});

add_task(function test_ring_dashes_mid_run() {
  const ph = 1.95;
  const dashes = ringDashes(ph);
  Assert.equal(dashes.length, 8);
  for (let i = 0; i < 8; i++) {
    const want = expectedDash(ph, i);
    near(dashes[i].centre, want.centre, `centre ${i}`);
    near(dashes[i].half, want.half, `half ${i}`);
    near(dashes[i].glow, want.glow, `glow ${i}`);
  }
  // Halfway through, the pull sits at 346 degrees: the first dash is 14
  // degrees ahead of it, so it leans back by 9 * g and stretches to 2.3x.
  const g = Math.exp(-196 / 676);
  near(dashes[0].glow, g, "first dash glow");
  near(dashes[0].centre, -9 * g, "first dash leans toward the pull");
  near(dashes[0].half, 10.95 * (1 + 1.3 * g), "first dash stretches");
  Assert.greater(dashes[0].half, 10.95);
  Assert.lessOrEqual(
    Math.max(...dashes.map(d => d.half)),
    10.95 * 2.3 + 1e-9,
    "no more than 2.3x"
  );
  Assert.ok(
    dashes.every(d => d.glow >= 0 && d.glow <= 1),
    "glow stays within 0 and 1"
  );
});

add_task(function test_ring_dashes_ease_in_and_out() {
  // amp is 0 at the start and the end of the run.
  for (const ph of [0, 3.9]) {
    Assert.ok(
      ringDashes(ph).every(d => d.glow === 0),
      `rest at ${ph}`
    );
  }
  // Just after the start the dashes have barely moved; far into the run they
  // have.
  const early = Math.max(...ringDashes(0.05).map(d => d.glow));
  const middle = Math.max(...ringDashes(1.95).map(d => d.glow));
  Assert.less(early, 0.05);
  Assert.greater(middle, 0.5);
  for (let ph = 0.1; ph < 3.9; ph += 0.37) {
    ringDashes(ph).forEach((dash, i) => {
      const want = expectedDash(ph, i);
      near(dash.centre, want.centre, `centre ${i} at ${ph}`);
      near(dash.half, want.half, `half ${i} at ${ph}`);
    });
  }
});

add_task(function test_seed_and_word() {
  Assert.equal(seedOf(""), 0);
  Assert.equal(seedOf("a"), 97);
  Assert.equal(seedOf("ab"), (97 * 31 + 98) % 9973);
  let expected = 0;
  const text = "message-id-1234567890-abcdefghij";
  for (const ch of text) {
    expected = (expected * 31 + ch.charCodeAt(0)) % 9973;
  }
  Assert.equal(seedOf(text), expected);
  Assert.less(seedOf("a long message id with many characters"), 9973);
  Assert.equal(seedOf("same"), seedOf("same"), "stable");

  const words = [
    "Thinking",
    "Reading",
    "Pondering",
    "Tinkering",
    "Yanking",
    "Sifting",
    "Weaving",
    "Plotting",
    "Composing",
    "Untangling",
    "Distilling",
    "Sketching",
    "Buffering",
    "Hopping",
    "Threading",
    "Musing",
  ];
  Assert.equal(workingWord(0, 0), "Thinking…");
  Assert.equal(workingWord(0, 6.9), "Thinking…", "same word under 7 s");
  Assert.equal(workingWord(0, 7), "Reading…", "next word at 7 s");
  Assert.equal(workingWord(0, 14), "Pondering…");
  Assert.equal(workingWord(3, 0), "Tinkering…", "the seed picks the start");
  words.forEach((word, i) => {
    Assert.equal(workingWord(0, 7 * i), word + "…", `step ${i}`);
  });
  Assert.equal(workingWord(0, 7 * 16), "Thinking…", "wraps around");
  Assert.equal(workingWord(9972, 0), words[9972 % 16] + "…");
  Assert.equal(workingWord(5, -3), workingWord(5, 0), "no negative steps");
});
