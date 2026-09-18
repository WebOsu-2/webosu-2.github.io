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
