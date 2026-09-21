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

test("slider-mesh: initialize builds meshes, sync drives uniforms", () => {  const m = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
  initMesh(m);
  m.sync(); // meshes build lazily once shared state exists
  H.assert(m.bodyMesh, "body mesh built");
  H.eq(m.capMesh, undefined, "no cap mesh (soft tip)");
  const bu = () => m.bodyShader.resources.sliderUniforms.uniforms;
  m.startt = 0.5; m.endt = 1.0; m.alpha = 0.8;
  m.sync();
  H.eq(bu().dt, -1, "snake-in clip flag");
  H.eq(bu().ot, -0.5, "snake-in threshold");
  H.eq(bu().alpha, 0.8, "alpha pushed");
  H.eq(bu().texturepos, 0, "body uses combo row 0");
  H.eq(bu().fadelen, 0.04, "tip fade on while snaking");
  H.eq(m.bodyMesh.visible, true, "body shown while snaking");
  m.startt = 0.0; m.endt = 1.0;
  m.sync();
  H.eq(bu().dt, 0, "full slider");
  H.eq(bu().fadelen, 0, "tip fade off when full");
  H.eq(m.bodyMesh.visible, true, "body shown when full");
  m.startt = 0.0; m.endt = 0.5; m.alpha = 0.8;
  m.sync();
  H.eq(bu().dt, 1, "snake-out clip flag");
  H.eq(bu().ot, 0.5, "snake-out threshold");
  H.eq(bu().fadelen, 0.04, "tip fade on while growing");
  m.destroy();
});

test("slider-mesh: near-straight joints emit no sliver triangles", () => {
  // A kink too small to see must not add join geometry: those slivers
  // rasterize as streaks along the slider side. (The kinked line-slider
  // resamples to one extra grid point via junction snapping, so compare
  // post-grid fan verts — caps only — instead of raw index counts.)
  const straight = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
  const kinked = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0.05 }], 200, true);
  const fanVerts = (m) => posOf(m).length / 4 - (1 + 5 * (m.curve.curve.length - 1));
  H.eq(fanVerts(kinked), fanVerts(straight), "kink adds no fan verts");
});

test("slider-mesh: sharp kink has no double-drawn interior (single coverage)", () => {
  // Butt quads of the two legs used to overlap in a full R x R square at
  // a sharp kink (~23% of the kink-region body double-drawn, visible as
  // alpha-doubled streaks); the inner span collapses to a fan around the
  // kink miter. Measure double-drawn AREA (pair counts over-weight
  // sub-pixel boundary slivers): rasterize the kink region and require
  // <3% of covered pixels to be covered twice.
  const m = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 200, true);
  checkGeometry(m, "kink");
  const R = 50;
  const pos = posOf(m);
  const idx = m.bodyGeom.indexBuffer.data;
  const P = (v) => ({ x: pos[4 * v], y: pos[4 * v + 1] });
  const n = idx.length / 3;
  const inside = (px, py, A, B, C) => {
    // strict interior: shared tiling edges must not count as double-drawn
    const d = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    if (Math.abs(d) < 1e-12) return false;
    const l1 = ((B.y - C.y) * (px - C.x) + (C.x - B.x) * (py - C.y)) / d;
    const l2 = ((C.y - A.y) * (px - C.x) + (A.x - C.x) * (py - C.y)) / d;
    return l1 > 1e-7 && l2 > 1e-7 && l1 + l2 < 1 - 1e-7;
  };
  let single = 0, dbl = 0;
  for (let gx = 100 - R - 5; gx <= 100 + R + 5; gx += 2) {
    for (let gy = -R - 5; gy <= R + 5; gy += 2) {
      let c = 0;
      for (let t = 0; t < n; t++) {
        if (inside(gx, gy, P(idx[3 * t]), P(idx[3 * t + 1]), P(idx[3 * t + 2]))) {
          if (++c > 1) break;
        }
      }
      if (c === 1) single++;
      else if (c > 1) dbl++;
    }
  }
  console.log(`    kink region: single=${single} dbl=${dbl}`);
  H.assert(single > 100, "kink region has body pixels");
  H.assert(dbl / (single + dbl) < 0.03, `double-drawn fraction ${(dbl / (single + dbl) * 100).toFixed(2)}% < 3%`);
});

function countUncovered(m, R) {
  // every pixel within R-1 of the centerline must sit inside a triangle
  // (guards against holes from span collapsing); 2px raster for speed.
  const pos = posOf(m);
  const idx = m.bodyGeom.indexBuffer.data;
  const P = (v) => ({ x: pos[4 * v], y: pos[4 * v + 1] });
  const n = idx.length / 3;
  const inside = (px, py, A, B, C) => {
    const d = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    if (Math.abs(d) < 1e-12) return false;
    const l1 = ((B.y - C.y) * (px - C.x) + (C.x - B.x) * (py - C.y)) / d;
    const l2 = ((C.y - A.y) * (px - C.x) + (A.x - C.x) * (py - C.y)) / d;
    return l1 >= -1e-7 && l2 >= -1e-7 && l1 + l2 <= 1 + 1e-7;
  };
  const pts = m.curve.curve;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  let missing = 0;
  for (let gx = Math.floor(x0) - R; gx <= x1 + R; gx += 2) {
    for (let gy = Math.floor(y0) - R; gy <= y1 + R; gy += 2) {
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
      for (let t = 0; t < n && !covered; t++)
        if (inside(gx, gy, P(idx[3 * t]), P(idx[3 * t + 1]), P(idx[3 * t + 2]))) covered = true;
      if (!covered) missing++;
    }
  }
  return missing;
}

test("slider-mesh: kink and fold-back tip have no coverage holes", () => {
  const kink = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 200, true);
  H.eq(countUncovered(kink, 50), 0, "kink fully covered");
  const fold = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }], 200, true);
  checkGeometry(fold, "fold");
  H.eq(countUncovered(fold, 50), 0, "fold tip fully covered");
});

function dblFraction(m, R) {
  // strict-interior double-drawn fraction over the whole body (2px
  // raster): shared tiling edges must not count, only real area overlap.
  const pos = posOf(m);
  const idx = m.bodyGeom.indexBuffer.data;
  const P = (v) => ({ x: pos[4 * v], y: pos[4 * v + 1] });
  const n = idx.length / 3;
  const inside = (px, py, A, B, C) => {
    const d = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    if (Math.abs(d) < 1e-12) return false;
    const l1 = ((B.y - C.y) * (px - C.x) + (C.x - B.x) * (py - C.y)) / d;
    const l2 = ((C.y - A.y) * (px - C.x) + (A.x - C.x) * (py - C.y)) / d;
    return l1 > 1e-7 && l2 > 1e-7 && l1 + l2 < 1 - 1e-7;
  };
  const pts = m.curve.curve;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  let single = 0, dbl = 0;
  for (let gx = Math.floor(x0) - R; gx <= x1 + R; gx += 2) {
    for (let gy = Math.floor(y0) - R; gy <= y1 + R; gy += 2) {
      let c = 0;
      for (let t = 0; t < n; t++) {
        if (inside(gx, gy, P(idx[3 * t]), P(idx[3 * t + 1]), P(idx[3 * t + 2]))) {
          if (++c > 1) break;
        }
      }
      if (c === 1) single++;
      else if (c > 1) dbl++;
    }
  }
  return { single, dbl, frac: dbl / Math.max(1, single + dbl) };
}

test("slider-mesh: pretzel shapes stay bounded (no wholesale doubling)", () => {
  // Legs closer than 2R genuinely intersect; the union trims midlines,
  // trims intruding fans and drops covered micros. Bounds are loose
  // (true pre-fix baselines at R=30: S ~25%, hairpin ~55%), guarding
  // against regressions to fully-doubled gutters, not asserting
  // perfection (seam slivers remain on extreme pretzels).
  const build = (hit) => new SliderMesh(new LinearBezier(hit, true), 30, 0);
  const S = build({ x: 0, y: 0, keyframes: [{ x: 40, y: 0 }, { x: 40, y: 25 }, { x: 0, y: 25 }, { x: 0, y: 50 }], pixelLength: 130 });
  checkGeometry(S, "tight-S");
  const s = dblFraction(S, 30);
  console.log(`    tight-S: single=${s.single} dbl=${s.dbl} (${(s.frac * 100).toFixed(2)}%)`);
  H.assert(s.frac < 0.24, `tight-S double fraction ${(s.frac * 100).toFixed(2)}% < 24%`);
  H.eq(countUncovered(S, 30), 0, "tight-S fully covered");
  const Hp = build({ x: 0, y: 0, keyframes: [{ x: 100, y: 0 }, { x: 100, y: 8 }, { x: 0, y: 8 }], pixelLength: 208 });
  checkGeometry(Hp, "hairpin");
  const h = dblFraction(Hp, 30);
  console.log(`    hairpin: single=${h.single} dbl=${h.dbl} (${(h.frac * 100).toFixed(2)}%)`);
  H.assert(h.frac < 0.16, `hairpin double fraction ${(h.frac * 100).toFixed(2)}% < 16%`);
  H.eq(countUncovered(Hp, 30), 0, "hairpin fully covered");
});

test("slider-mesh: gradient texture uploads as premultiplied", () => {
  // The gradient buffer is already premultiplied; v8 premultiplies
  // "premultiply-alpha-on-upload" data again (dark/saturated sliders).
  const m = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  initMesh(m);
  H.eq(m.sliderTexture.source.alphaMode, "premultiplied-alpha", "declared truthfully");
});
