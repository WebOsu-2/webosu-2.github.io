// Unit tests: SliderMesh geometry + v8 mesh wiring, using the real
// PixiJS bundle headlessly (geometry/uniforms need no GL context).
// GlProgram construction probes document, so a minimal stub is installed.
"use strict";
const H = require("./helpers");

global.document = { createElement: () => ({ getContext: () => null }) };
global._ = global._ || H.ensureUnderscore();
const SliderMesh = H.loadModule("scripts/SliderMesh.js").default;
const LinearBezier = H.loadModule("scripts/curves/LinearBezier.js").default;

function meshFromPoints(pts, pixelLength, line) {
  const hit = { x: pts[0].x, y: pts[0].y, keyframes: pts.slice(1), pixelLength: pixelLength || 200 };
  const curve = new LinearBezier(hit, !!line);
  return new SliderMesh(curve, 50, 0);
}
function posOf(mesh) {
  return mesh.bodyGeom.attributes.position.buffer.data;
}
function checkGeometry(m, label) {
  const pos = posOf(m);
  H.finiteArray(Array.from(pos), label + " positions");
  const idx = Array.from(m.bodyGeom.indexBuffer.data);
  H.assert(idx.length > 0, label + " has indices");
  const verts = pos.length / 4;
  for (const ix of idx) {
    if (!(ix >= 0 && ix < verts)) throw new Error(`${label}: index ${ix} out of range [0, ${verts})`);
  }
  return { verts, tris: idx.length / 3 };
}
function initMesh(m) {
  m.initialize([0xff0000, 0x00ff00], 50, { dx: 0.01, dy: -0.01, ox: 0, oy: 0 });
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
  const sTris = straight.bodyGeom.indexBuffer.data.length;
  H.assert(
    bent.bodyGeom.indexBuffer.data.length > sTris,
    `bent corner should add join triangles (bent=${bent.bodyGeom.indexBuffer.data.length} vs straight=${sTris})`
  );
  console.log(`    bent: ${b.verts} verts, ${b.tris} tris`);
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
  const pos = posOf(m);
  const R = 50;
  for (let v = 0; v < pos.length / 4; v++) {
    const t = pos[4 * v + 2];
    if (Math.abs(t) < 1e-9) {
      const d = Math.hypot(pos[4 * v] - H0.x, pos[4 * v + 1] - H0.y);
      // tolerance well below any real floater (pre-fix: 114px on R=50)
      if (d > R + 1e-3) throw new Error(`vertex ${v} has t=0 but sits ${d.toFixed(1)}px from the head (snake glitch)`);
    }
  }
});

test("slider-mesh: initialize builds meshes, sync drives uniforms", () => {
  const m = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
  initMesh(m);
  m.sync(); // meshes build lazily once shared state exists
  H.assert(m.bodyMesh && m.capMesh, "both meshes built");
  H.eq(m.capMesh.visible, false, "cap hidden on full slider");
  const bu = () => m.bodyShader.resources.sliderUniforms.uniforms;
  m.startt = 0.5; m.endt = 1.0; m.alpha = 0.8;
  m.sync();
  H.eq(bu().dt, -1, "snake-in clip flag");
  H.eq(bu().ot, -0.5, "snake-in threshold");
  H.eq(bu().alpha, 0.8, "alpha pushed");
  H.eq(m.capMesh.visible, true, "cap shown while snaking");
  m.startt = 0.0; m.endt = 1.0;
  m.sync();
  H.eq(bu().dt, 0, "full slider");
  H.eq(m.capMesh.visible, false, "cap hidden when full");
  m.destroy();
});
