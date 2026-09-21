// Unit tests: procedural osu!-style slider ball texture.
"use strict";
const H = require("./helpers");
const { makeSliderBallData, BALL_SIZE, makeTrailData, TRAIL_SIZE } = H.loadModule("scripts/sliderBall.js");

function px(buf, S, x, y) {
  const o = (y * S + x) * 4;
  return [buf[o], buf[o + 1], buf[o + 2], buf[o + 3]];
}

test("slider-ball: opaque white core sized to the track", () => {
  const { data, width, height } = makeSliderBallData();
  H.eq(width, 256, "atlas-compatible width");
  H.eq(height, 256, "atlas-compatible height");
  H.eq(data.length, 256 * 256 * 4, "RGBA buffer");
  const c = (BALL_SIZE - 1) / 2;
  // core (r <= 96): fully opaque, near-white
  for (const [x, y] of [[c, c], [c + 60, c], [c, c - 90], [c + 68, c + 68]]) {
    const [r, g, b, a] = px(data, 256, Math.round(x), Math.round(y));
    H.eq(a, 255, `core opaque at (${x},${y})`);
    H.assert(r >= 230 && r === g && g === b, `core near-white at (${x},${y}): ${r},${g},${b}`);
  }
  // rim (r ~100): opaque gray border, not transparent
  {
    const [r, g, b, a] = px(data, 256, Math.round(c + 102), Math.round(c));
    H.eq(a, 255, "rim opaque");
    H.assert(r < 230 && r === g && g === b, `rim gray: ${r},${g},${b}`);
  }
  // top-light shading: crown brighter than base (stable sliderb look)
  {
    const [top] = px(data, 256, Math.round(c), Math.round(c - 60));
    const [bot] = px(data, 256, Math.round(c), Math.round(c + 60));
    H.assert(top > bot + 5, `directional shading (crown ${top} vs base ${bot})`);
  }
  // outside (r >= 126): transparent
  {
    const [, , , a] = px(data, 256, Math.round(c + 126), Math.round(c));
    H.eq(a, 0, "outside transparent");
    const [, , , a2] = px(data, 256, 0, 0);
    H.eq(a2, 0, "corner transparent");
  }
  console.log("    ball: opaque core r<=96, rim r~102, feather to r=126");
});

test("slider-ball: buffer is consistently premultiplied", () => {
  // v8 premultiplies "premultiply-alpha-on-upload" data on upload; the
  // buffer must already be premultiplied AND declared as such, otherwise
  // the ball renders dark (same lesson as the slider gradient).
  const { data } = makeSliderBallData();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (r > a || g > a || b > a) throw new Error(`not premultiplied at ${i / 4}: ${r},${g},${b},${a}`);
    if ((r !== g || g !== b) && a > 0) throw new Error(`tinted pixel at ${i / 4}: ${r},${g},${b},${a}`);
  }
});

test("slider-ball: trail dot is a soft premultiplied falloff", () => {  const { data, width, height } = makeTrailData();
  H.eq(width, TRAIL_SIZE, "trail size");
  H.eq(height, TRAIL_SIZE, "trail square");
  const px = (x, y) => data[(y * width + x) * 4 + 3];
  const c = (TRAIL_SIZE - 1) / 2;
  H.assert(px(Math.round(c), Math.round(c)) > 200, "center bright");
  H.eq(px(0, 0), 0, "corner transparent");
  // monotonically non-increasing along the middle row outward
  let prev = 999;
  for (let x = Math.round(c); x < width; x++) {
    const a = px(x, Math.round(c));
    if (a > prev) throw new Error(`trail not falling off at x=${x}: ${a} > ${prev}`);
    prev = a;
  }
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > data[i + 3] || data[i] !== data[i + 1] || data[i] !== data[i + 2])
      throw new Error(`trail not white-premultiplied at ${i / 4}`);
  }
});
