// Unit tests: SliderMesh geometry guards (no-NaN normals, joint fill).
// Covers the slider rendering slice: flicker/vanish on degenerate segments,
// cut inner corners on tight curves. PIXI is stubbed; only the CPU-side
// vertex/index buffers are inspected.
"use strict";
const H = require("./helpers");

global.PIXI = H.makePixiStub();
const SliderMesh = H.loadAmd("scripts/SliderMesh.js", {});
const LinearBezier = H.loadAmd("scripts/curves/LinearBezier.js", {});

function meshFromPoints(pts, pixelLength) {
  const hit = { x: pts[0].x, y: pts[0].y, keyframes: pts.slice(1), pixelLength: pixelLength || 200 };
  const curve = new LinearBezier(hit, false);
  return new SliderMesh(curve, 50, 0);
}
function checkGeometry(m, label) {
  const pos = m.geometry.attrs.position.data;
  H.finiteArray(pos, label + " positions");
  H.assert(m.geometry.index.length > 0, label + " has indices");
  const verts = pos.length / 4;
  for (const ix of m.geometry.index) {
    if (!(ix >= 0 && ix < verts)) throw new Error(`${label}: index ${ix} out of range [0, ${verts})`);
  }
  return { verts, tris: m.geometry.index.length / 3 };
}

test("slider-mesh: straight slider geometry is finite and indexed", () => {
  const m = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
  const s = checkGeometry(m, "straight");
  console.log(`    straight: ${s.verts} verts, ${s.tris} tris`);
});

test("slider-mesh: degenerate (coincident) curve cannot produce NaN", () => {
  const hit = { x: 100, y: 100, keyframes: [{ x: 100, y: 100 }], pixelLength: 50 };
  const curve = new LinearBezier(hit, false);
  const m = new SliderMesh(curve, 50, 0);
  checkGeometry(m, "degenerate");
});

test("slider-mesh: zero-length middle segment cannot produce NaN", () => {
  // duplicate consecutive point => zero-length segment (old code: NaN normals)
  const m = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
  checkGeometry(m, "zero-seg");
});

test("slider-mesh: joint/end-cap fans carry joint t for snake clipping", () => {
  // The vertex shader clips snake in/out per-fragment on position[2] (the
  // curve parameter t): with snake-in at `endt`, fragments with t > endt
  // are pushed beyond the far plane. So every vertex with t≈0 must sit
  // within radius of the curve head (the head cap); anywhere else it pops
  // in ahead of the snake and the slider visibly falls apart on curves.
  // NOTE: line=true (L-type slider) keeps the 90° corner sharp, which is
  // what grows multi-vertex joint fans; smoothed beziers barely turn per
  // joint and would not exercise this path.
  const H0 = { x: 0, y: 0 };
  const curve = new LinearBezier({ x: H0.x, y: H0.y, keyframes: [{ x: 100, y: 0 }, { x: 100, y: 100 }], pixelLength: 200 }, true);
  const m = new SliderMesh(curve, 50, 0);
  const pos = m.geometry.attrs.position.data;
  const R = 50;
  for (let v = 0; v < pos.length / 4; v++) {
    const t = pos[4 * v + 2];
    if (Math.abs(t) < 1e-9) {
      const d = Math.hypot(pos[4 * v] - H0.x, pos[4 * v + 1] - H0.y);
      if (d > R + 1e-6) throw new Error(`vertex ${v} has t=0 but sits ${d.toFixed(1)}px from the head (snake glitch)`);
    }
  }
});

test("slider-mesh: sharp corner gets joint fill (no missing wedge)", () => {
  const straight = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
  // bent path smooths to ~162px; size pixelLength to match so the test
  // exercises joints without tripping length warnings
  const bent = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 162);
  checkGeometry(straight, "straight");
  const b = checkGeometry(bent, "bent");
  const sTris = straight.geometry.index.length;
  H.assert(
    bent.geometry.index.length > sTris,
    `bent corner should add join triangles (bent=${bent.geometry.index.length} vs straight=${sTris})`
  );
  console.log(`    bent: ${b.verts} verts, ${b.tris} tris`);
});
