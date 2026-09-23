// Regression battery: sharp / non-natural slider corners across turn
// directions and curve types. Every shape must produce finite, in-range
// capsule geometry with no holes: every pixel within radius-1 of the
// centerline falls inside at least one segment quad, where the per-pass
// coverage field is computed (the GPU MAX over those quads is exact by
// construction), and no rendered corner strays from the path.
"use strict";
const H = require("./helpers");

global.document = { createElement: () => ({ getContext: () => null }) };
global._ = global._ || H.ensureUnderscore();
const SliderMesh = H.loadModule("scripts/SliderMesh.js").default;
const LinearBezier = H.loadModule("scripts/curves/LinearBezier.js").default;
const Bezier2 = H.loadModule("scripts/curves/Bezier2.js").default;

const R = 30;
function line(pts, pixelLength) {
  const hit = { x: pts[0].x, y: pts[0].y, keyframes: pts.slice(1), pixelLength: pixelLength };
  return new SliderMesh(new LinearBezier(hit, true), R, 0);
}
function bez(pts, pixelLength) {
  const hit = { x: pts[0].x, y: pts[0].y, keyframes: pts.slice(1), pixelLength: pixelLength };
  return new SliderMesh(new Bezier2(hit), R, 0);
}
function grid(m) {
  // sample coverage over the curve bbox (+R), 2px raster (stride-2
  // prepass geometry: position/segA/segB, one quad per segment)
  const pos = m.prepassGeom.attributes.position.buffer.data;
  const idx = Array.from(m.prepassGeom.indexBuffer.data);
  const P = (v) => ({ x: pos[2 * v], y: pos[2 * v + 1] });
  const tris = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const [a, b, c] = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]];
    if (a === 0 && b === 0 && c === 0) continue; // zeroed tail slot
    const nv = pos.length / 2;
    if (!(a < nv && b < nv && c < nv)) throw new Error(`index out of range [0, ${nv})`);
    tris.push([a, b, c]);
  }
  const pts = m.curve.curve;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const inside = (px, py, A, B, C) => {
    const d = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    if (Math.abs(d) < 1e-12) return false;
    const l1 = ((B.y - C.y) * (px - C.x) + (C.x - B.x) * (py - C.y)) / d;
    const l2 = ((C.y - A.y) * (px - C.x) + (A.x - C.x) * (py - C.y)) / d;
    return l1 >= -1e-7 && l2 >= -1e-7 && l1 + l2 <= 1 + 1e-7;
  };
  let holes = 0;
  for (let gx = Math.floor(x0) - R; gx <= x1 + R; gx += 2) {
    for (let gy = Math.floor(y0) - R; gy <= y1 + R; gy += 2) {
      // near-centerline pixels must be covered (holes)
      let dmin = 1e9;
      for (let s = 1; s < pts.length; s++) {
        const ax = pts[s - 1], bx = pts[s];
        const dx = bx.x - ax.x, dy = bx.y - ax.y;
        const l2 = dx * dx + dy * dy;
        let u = l2 > 1e-12 ? ((gx - ax.x) * dx + (gy - ax.y) * dy) / l2 : 0;
        u = Math.max(0, Math.min(1, u));
        dmin = Math.min(dmin, Math.hypot(ax.x + u * dx - gx, ax.y + u * dy - gy));
      }
      if (dmin > R - 1) continue;
      let covered = false;
      for (let t = 0; t < tris.length && !covered; t++)
        if (inside(gx, gy, P(tris[t][0]), P(tris[t][1]), P(tris[t][2]))) covered = true;
      if (!covered) holes++;
    }
  }
  // stray verts (rendered only: unreferenced leftovers never rasterize):
  // every quad corner sits exactly R*sqrt(2) from its segment endpoint,
  // so anything farther than that + slack is a bug
  const usedIdx = new Set();
  for (const [a, b, c] of tris) { usedIdx.add(a); usedIdx.add(b); usedIdx.add(c); }
  const strayLimit = Math.SQRT2 * R + 3;
  let stray = 0;
  for (let v = 0; v < pos.length / 2; v++) {
    if (!usedIdx.has(v)) continue;
    let dmin = 1e9;
    for (const p of pts) dmin = Math.min(dmin, Math.hypot(pos[2 * v] - p.x, pos[2 * v + 1] - p.y));
    if (dmin > strayLimit) stray++;
  }
  return { holes, stray, tris: tris.length };
}

const SHAPES = [
  ["L-left", () => line([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 200)],
  ["L-right", () => line([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: -100 }], 200)],
  ["turn-135", () => line([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 30, y: 70 }], 190)],
  ["turn-45", () => line([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 170, y: 70 }], 190)],
  ["turn-30", () => line([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 187, y: 50 }], 200)],
  ["turn-150", () => line([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 15, y: 50 }], 165)],
  ["hairpin", () => line([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 8 }, { x: 0, y: 8 }], 208)],
  ["foldback", () => line([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }], 200)],
  ["zigzag", () => line([{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 120, y: 40 }, { x: 120, y: 80 }], 220)],
  ["square-loop", () => line([{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }, { x: 0, y: 0 }], 320)],
  ["star", () => line([{ x: 0, y: 0 }, { x: 60, y: 20 }, { x: 20, y: 20 }, { x: 60, y: 60 }, { x: 0, y: 40 }], 200)],
  ["micro-seg", () => line([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100.5, y: 0 }, { x: 200, y: 0 }], 200)],
  ["tight-S", () => line([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 25 }, { x: 0, y: 25 }, { x: 0, y: 50 }], 130)],
  ["W-shape", () => line([{ x: 0, y: 0 }, { x: 30, y: 60 }, { x: 60, y: 0 }, { x: 90, y: 60 }, { x: 120, y: 0 }], 280)],
  ["bez-cusp", () => bez([{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 0, y: 0 }], 200)],
  ["bez-S", () => bez([{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 80 }, { x: 120, y: 80 }], 190)],
];

test("shapes: capsule quads render exactly (no holes or strays)", () => {
  const failures = [];
  for (const [name, build] of SHAPES) {
    const m = build();
    const pos = m.prepassGeom.attributes.position.buffer.data;
    try {
      H.finiteArray(Array.from(pos), name + " finite");
      H.finiteArray(Array.from(m.prepassGeom.attributes.segA.buffer.data), name + " segA finite");
      H.finiteArray(Array.from(m.prepassGeom.attributes.segB.buffer.data), name + " segB finite");
      const g = grid(m);
      console.log(`    ${name}: holes=${g.holes} stray=${g.stray} tris=${g.tris}`);
      if (g.holes !== 0) failures.push(`${name}: holes=${g.holes}`);
      if (g.stray !== 0) failures.push(`${name}: stray=${g.stray}`);
      if (g.tris === 0) failures.push(`${name}: no geometry`);
    } finally {
      m.destroy();
    }
  }
  if (failures.length) throw new Error("shape defects:\n" + failures.join("\n"));
});
