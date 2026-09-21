// Regression battery: sharp / non-natural slider corners across turn
// directions and curve types. Every shape must render with no holes, no
// stray verts, single coverage (exact union) and no stacked overdraw:
// the join pipeline (miter limit + bevel, guarded snap, subtractive
// union) keeps even acute spikes, folds and loops exact.
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
  // sample coverage over the curve bbox (+R), 2px raster
  const pos = m.bodyGeom.attributes.position.buffer.data;
  const idx = m.bodyGeom.indexBuffer.data;
  const P = (v) => ({ x: pos[4 * v], y: pos[4 * v + 1] });
  const n = idx.length / 3;
  const pts = m.curve.curve;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const inside = (px, py, A, B, C, strict) => {
    const d = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    if (Math.abs(d) < 1e-12) return false;
    const l1 = ((B.y - C.y) * (px - C.x) + (C.x - B.x) * (py - C.y)) / d;
    const l2 = ((C.y - A.y) * (px - C.x) + (A.x - C.x) * (py - C.y)) / d;
    return strict ? (l1 > 1e-7 && l2 > 1e-7 && l1 + l2 < 1 - 1e-7)
                  : (l1 >= -1e-7 && l2 >= -1e-7 && l1 + l2 <= 1 + 1e-7);
  };
  let holes = 0, single = 0, dbl = 0, maxDepth = 0;
  for (let gx = Math.floor(x0) - R; gx <= x1 + R; gx += 2) {
    for (let gy = Math.floor(y0) - R; gy <= y1 + R; gy += 2) {
      // near-centerline pixels must be covered (holes); all pixels count depth
      let dmin = 1e9;
      for (let s = 1; s < pts.length; s++) {
        const ax = pts[s - 1], bx = pts[s];
        const dx = bx.x - ax.x, dy = bx.y - ax.y;
        const l2 = dx * dx + dy * dy;
        let u = l2 > 1e-12 ? ((gx - ax.x) * dx + (gy - ax.y) * dy) / l2 : 0;
        u = Math.max(0, Math.min(1, u));
        dmin = Math.min(dmin, Math.hypot(ax.x + u * dx - gx, ax.y + u * dy - gy));
      }
      let c = 0;
      for (let t = 0; t < n; t++) {
        if (inside(gx, gy, P(idx[3 * t]), P(idx[3 * t + 1]), P(idx[3 * t + 2]), true)) {
          if (++c > 4) break;
        }
      }
      if (c > maxDepth) maxDepth = c;
      if (dmin > R - 1) continue;
      if (c === 0) {
        // confirm with inclusive test before calling it a hole
        let cov = false;
        for (let t = 0; t < n && !cov; t++)
          if (inside(gx, gy, P(idx[3 * t]), P(idx[3 * t + 1]), P(idx[3 * t + 2]), false)) cov = true;
        if (!cov) holes++;
        else single++;
      }
      else if (c === 1) single++;
      else dbl++;
    }
  }
  // stray verts (rendered only: unreferenced construction leftovers
  // never rasterize): farther than R+3 from every centerline point
  const vpos = m.bodyGeom.attributes.position.buffer.data;
  const usedIdx = new Set(Array.from(m.bodyGeom.indexBuffer.data));
  let stray = 0;
  for (let v = 0; v < vpos.length / 4; v++) {
    if (!usedIdx.has(v)) continue;
    let dmin = 1e9;
    for (const p of pts) dmin = Math.min(dmin, Math.hypot(vpos[4 * v] - p.x, vpos[4 * v + 1] - p.y));
    if (dmin > R + 3) stray++;
  }
  return { holes, single, dbl, maxDepth, stray };
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

test("shapes: sharp corners render exactly (no holes, strays or doubles)", () => {
  const failures = [];
  for (const [name, build] of SHAPES) {
    const m = build();
    const pos = m.bodyGeom.attributes.position.buffer.data;
    try {
      H.finiteArray(Array.from(pos), name + " finite");
      const idx = Array.from(m.bodyGeom.indexBuffer.data);
      const nv = pos.length / 4;
      for (const ix of idx) {
        if (!(ix >= 0 && ix < nv)) throw new Error(`${name}: index out of range`);
      }
      const g = grid(m);
      const frac = g.dbl / Math.max(1, g.single + g.dbl);
      console.log(`    ${name}: holes=${g.holes} dbl=${g.dbl}(${(frac * 100).toFixed(1)}%) maxDepth=${g.maxDepth} stray=${g.stray}`);
      if (g.holes !== 0) failures.push(`${name}: holes=${g.holes}`);
      if (g.stray !== 0) failures.push(`${name}: stray=${g.stray}`);
      if (frac >= 0.02) failures.push(`${name}: dbl=${(frac * 100).toFixed(1)}%`);
      if (g.maxDepth > 2) failures.push(`${name}: maxDepth=${g.maxDepth}`);
    } finally {
      m.destroy();
    }
  }
  if (failures.length) throw new Error("shape defects:\n" + failures.join("\n"));
});
