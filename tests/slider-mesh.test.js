// Unit tests: SliderMesh two-pass geometry + v8 mesh wiring, using the
// real PixiJS bundle headlessly (geometry/uniforms need no GL context).
// The shape lives in the coverage prepass: capsule quads with stride-6
// attributes (position/segA/segB, vec2 each) rendered with MAX blending;
// the composite only maps coverage through the gradient LUT. GlProgram
// construction probes document, so a minimal stub is installed.
"use strict";
const H = require("./helpers");

global.document = { createElement: () => ({ getContext: () => null }) };
global._ = global._ || H.ensureUnderscore();
const SliderMesh = H.loadModule("scripts/SliderMesh.js").default;
const LinearBezier = H.loadModule("scripts/curves/LinearBezier.js").default;

const R = 50;

function meshFromPoints(pts, pixelLength, line) {
  const hit = { x: pts[0].x, y: pts[0].y, keyframes: pts.slice(1), pixelLength: pixelLength || 200 };
  const curve = new LinearBezier(hit, !!line);
  return new SliderMesh(curve, R, 0);
}
function pre(m) {
  return {
    pos: m.prepassGeom.attributes.position.buffer.data,
    segA: m.prepassGeom.attributes.segA.buffer.data,
    segB: m.prepassGeom.attributes.segB.buffer.data,
    idx: Array.from(m.prepassGeom.indexBuffer.data),
  };
}
// Vertices referenced by real triangles (unused index slots are zeroed
// and degenerate to (0,0,0) triangles, which never rasterize).
function usedVerts(m) {
  const g = pre(m);
  const verts = g.pos.length / 2;
  const used = new Set();
  for (let i = 0; i < g.idx.length; i += 3) {
    const [a, b, c] = [g.idx[i], g.idx[i + 1], g.idx[i + 2]];
    if (a === 0 && b === 0 && c === 0) continue;
    for (const v of [a, b, c]) {
      if (!(v >= 0 && v < verts)) throw new Error(`index ${v} out of range [0, ${verts})`);
      used.add(v);
    }
  }
  return { ...g, used };
}
function checkGeometry(m, label) {
  const { pos, segA, segB } = pre(m);
  H.finiteArray(Array.from(pos), label + " positions");
  H.finiteArray(Array.from(segA), label + " segA");
  H.finiteArray(Array.from(segB), label + " segB");
  H.assert(pos.length === segA.length && pos.length === segB.length, label + " attributes share a stride");
  const { used } = usedVerts(m);
  H.assert(used.size >= 4 && used.size % 4 === 0, label + " emits whole quads");
  return { verts: pos.length / 2, quads: used.size / 4 };
}
function initMesh(m) {
  m.initialize([0xff0000, 0x00ff00], R, { dx: 0.01, dy: -0.01, ox: 0, oy: 0 });
}

test("slider-mesh: straight slider geometry is finite and indexed", () => {
  const m = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
  const s = checkGeometry(m, "straight");
  console.log(`    straight: ${s.verts} verts, ${s.quads} quads`);
});

test("slider-mesh: degenerate (coincident) curve cannot produce NaN", () => {
  const hit = { x: 100, y: 100, keyframes: [{ x: 100, y: 100 }], pixelLength: 50 };
  const curve = new LinearBezier(hit, false);
  const m = new SliderMesh(curve, R, 0);
  checkGeometry(m, "degenerate");
});

test("slider-mesh: zero-length middle segment cannot produce NaN", () => {
  // duplicate consecutive point => zero-length segment (deduped before
  // any direction math, so no NaN normals can be produced)
  const m = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
  checkGeometry(m, "zero-seg");
});

test("slider-mesh: quads are their segment rectangles extended by radius", () => {
  // Every corner must be exactly one of {end -/+ dir*R +/- normal*R}: the
  // extension along the direction is what leaves room for the round caps
  // (a butt-ended quad would cut the cap flat), and the normal offset of
  // radius is the stroke half-width.
  const m = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
  const { used, pos, segA, segB } = usedVerts(m);
  for (const v of used) {
    const p0x = segA[2 * v], p0y = segA[2 * v + 1];
    const p1x = segB[2 * v], p1y = segB[2 * v + 1];
    const dx = p1x - p0x, dy = p1y - p0y;
    const len = Math.hypot(dx, dy);
    H.assert(len > 1e-6, "quad segment endpoints distinct");
    const ux = dx / len * R, uy = dy / len * R;
    const nx = -uy, ny = ux;
    const expected = [
      [p0x - ux - nx, p0y - uy - ny], [p0x - ux + nx, p0y - uy + ny],
      [p1x + ux - nx, p1y + uy - ny], [p1x + ux + nx, p1y + uy + ny],
    ];
    let best = Infinity;
    for (const [ex, ey] of expected)
      best = Math.min(best, Math.hypot(pos[2 * v] - ex, pos[2 * v + 1] - ey));
    if (best > 1e-3)
      throw new Error(`vertex ${v} at (${pos[2 * v]}, ${pos[2 * v + 1]}) is ${best.toFixed(2)}px off the radius-extended corner set`);
  }
});

test("slider-mesh: initialize builds meshes, sync drives uniforms", () => {
  const m = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
  initMesh(m);
  m.sync(); // meshes build lazily once shared state exists
  H.assert(m.mesh, "composite mesh built");
  H.assert(m.prepassMesh, "prepass mesh built");
  H.eq(m.prepassMesh.blendMode, "max", "coverage pass blends with equation MAX");
  H.eq(m.prepassMesh.parent, m.prepassRoot, "prepass hangs off its own root");
  H.assert(!m.children.includes(m.prepassMesh), "prepass never reaches the stage graph");
  H.eq(m.mesh.parent, m, "composite is the visible child");
  H.assert(m.rt, "coverage texture created headlessly");
  H.eq(m.rt.width, m.rtW, "texture sized to its descriptor");
  H.eq(m.rtDirty, true, "coverage render deferred without a renderer (headless no-op)");
  H.eq(m.meshShader.resources.uCoverage, m.rt.source, "coverage texture bound to uCoverage");
  H.eq(m.meshShader.resources.uSampler2, m.sliderTexture.source, "gradient LUT bound to uSampler2");
  const bu = () => m.meshShader.resources.sliderUniforms.uniforms;
  m.startt = 0.5; m.endt = 1.0; m.alpha = 0.8;
  m.sync();
  H.eq(bu().alpha, 0.8, "alpha pushed");
  H.eq(bu().texturepos, 0.25, "texel center of combo row 0 (2 colors)");
  H.eq(bu().dx, 0.01, "transform pushed");
  H.eq(bu().dy, -0.01, "y-flip pushed");
  H.eq(bu().fadelen, undefined, "no fade uniform (fade applied at composite)");
  H.eq(m.mesh.visible, true, "partial path shown while receding");
  H.eq(m.geoKey, "0.5,1", "geometry keyed by range");
  m.startt = 0.0; m.endt = 1.0;
  m.sync();
  H.eq(m.mesh.visible, true, "shown when full");
  H.eq(m.geoKey, "full", "full path geometry");
  m.startt = 0.0; m.endt = 0.5;
  m.sync();
  H.eq(m.mesh.visible, true, "partial path shown while growing");
  H.eq(m.geoKey, "0,0.5", "grow key");
  m.startt = 0.0; m.endt = 0.0;
  m.sync();
  H.eq(m.mesh.visible, false, "hidden when empty");
  m.destroy();
  H.eq(m.destroyed, true, "destroy completes");
});

test("slider-mesh: combo tint samples its own LUT row center", () => {
  const m = new SliderMesh(meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }]).curve, R, 1);
  initMesh(m);
  m.sync();
  H.eq(m.meshShader.resources.sliderUniforms.uniforms.texturepos, 0.75,
    "row 1 of 2 at its texel center (linear filtering must not bleed rows)");
  m.destroy();
});

test("slider-mesh: prepass projection maps path bounds onto NDC [-1,1]", () => {
  const m = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
  initMesh(m);
  m.sync();
  const u = m.prepassShader.resources.prepassUniforms.uniforms;
  H.eq(u.radius, R, "radius uniform");
  const b = m.bounds;
  const near = (a, e) => Math.abs(a - e) <= 1e-6;
  H.assert(near(u.scaleX * b.x0 + u.offX, -1), "bounds x0 -> ndc -1");
  H.assert(near(u.scaleX * b.x1 + u.offX, 1), "bounds x1 -> ndc +1");
  H.assert(near(u.scaleY * b.y0 + u.offY, -1), "bounds y0 -> texture row 0");
  H.assert(near(u.scaleY * b.y1 + u.offY, 1), "bounds y1 -> texture row max");
  m.destroy();
});

test("slider-mesh: partialPoints truncates with exact head interpolation", () => {
  const { partialPoints } = H.loadModule("scripts/SliderMesh.js");
  const pts = [
    { x: 0, y: 0, t: 0 },
    { x: 100, y: 0, t: 0.5 },
    { x: 200, y: 0, t: 1 },
  ];
  H.deepEq(partialPoints(pts, 0, 1), pts, "full range is identity");
  H.deepEq(partialPoints(pts, 0, 0.5), pts.slice(0, 2), "grid-aligned cut");
  H.deepEq(partialPoints(pts, 0.25, 0.75),
    [{ x: 50, y: 0, t: 0.25 }, { x: 100, y: 0, t: 0.5 }, { x: 150, y: 0, t: 0.75 }],
    "interpolated boundaries");
  H.deepEq(partialPoints(pts, 0.5, 1), pts.slice(1), "recede range");
  H.eq(partialPoints([], 0, 0.5).length, 0, "empty in, empty out");
});

test("slider-mesh: snake rebuild is a finite partial path with cap room", () => {
  // While snaking, the prepass geometry IS the truncated path: quads
  // reach exactly one radius past both ends, so the moving head/tail
  // cap of the distance field can draw full circles (no flat cut).
  const m = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
  initMesh(m);
  m.startt = 0.0; m.endt = 0.5;
  m.sync();
  H.eq(m.geoKey, "0,0.5", "geometry keyed by head");
  H.eq(m.mesh.visible, true, "partial path shown while growing");
  H.eq(m.rebuildGeometry(0.0, 0.5), false, "no rebuild without head movement");
  {
    const { used, pos } = usedVerts(m);
    H.assert(used.size >= 8, "partial path has geometry");
    let minx = Infinity, maxx = -Infinity;
    for (const v of used) {
      for (let k = 0; k < 2; ++k)
        if (!Number.isFinite(pos[2 * v + k])) throw new Error(`snake vert ${v} not finite`);
      if (pos[2 * v] < -R - 1 || pos[2 * v] > 100 + R + 1 ||
          Math.abs(pos[2 * v + 1]) > R + 1)
        throw new Error(`snake vert ${v} outside partial path`);
      minx = Math.min(minx, pos[2 * v]);
      maxx = Math.max(maxx, pos[2 * v]);
    }
    H.assert(Math.abs(maxx - (100 + R)) < 0.1, `nose at head + R (got ${maxx.toFixed(2)})`);
    H.assert(Math.abs(minx - (-R)) < 0.1, `tail cap at path start - R (got ${minx.toFixed(2)})`);
  }
  // receding side rebuilds from the other end
  m.startt = 0.5; m.endt = 1.0;
  m.sync();
  H.eq(m.mesh.visible, true, "shown while receding");
  H.eq(m.geoKey, "0.5,1", "recede key");
  {
    const { used, pos } = usedVerts(m);
    let minx = Infinity, maxx = -Infinity;
    for (const v of used) {
      for (let k = 0; k < 2; ++k)
        if (!Number.isFinite(pos[2 * v + k])) throw new Error(`snake vert ${v} not finite`);
      minx = Math.min(minx, pos[2 * v]);
      maxx = Math.max(maxx, pos[2 * v]);
    }
    H.assert(Math.abs(minx - (100 - R)) < 0.1, `recede head cap at head - R (got ${minx.toFixed(2)})`);
    H.assert(Math.abs(maxx - (200 + R)) < 0.1, `far end keeps its cap (got ${maxx.toFixed(2)})`);
  }
  // degenerate curve still rebuilds finite (fallback segment)
  const hit = { x: 100, y: 100, keyframes: [{ x: 100, y: 100 }], pixelLength: 50 };
  const dm = new SliderMesh(new LinearBezier(hit, false), R, 0);
  initMesh(dm);
  dm.startt = 0.0; dm.endt = 0.5;
  dm.sync();
  H.eq(dm.mesh.visible, true, "degenerate partial shown");
  const dv = usedVerts(dm);
  H.assert(dv.used.size >= 4, "degenerate partial emits fallback quad");
  for (const v of dv.used)
    for (let k = 0; k < 2; ++k)
      if (!Number.isFinite(dv.pos[2 * v + k])) throw new Error(`degenerate vert ${v} not finite`);
  m.destroy(); dm.destroy();
});

test("slider-mesh: partial rebuilds never exceed the fixed buffer capacity", () => {
  // Prepass buffers are allocated once for the full path; a partial path
  // is cut from the same grid, so it can never need more quads.
  const m = meshFromPoints(
    [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 120, y: 40 }], 220, true);
  initMesh(m);
  const cap = m.quadCap;
  H.eq(m.prepassGeom.attributes.position.buffer.data.length, cap * 8,
    "position buffer sized for capacity");
  for (const [a, b] of [[0, 0.2], [0.2, 0.5], [0.5, 1], [0, 1], [0.35, 0.35], [0, 0.01], [0.99, 1]]) {
    m.rebuildGeometry(a, b);
    const { used } = usedVerts(m);
    H.assert(used.size <= cap * 4, `range ${a},${b}: ${used.size} verts <= capacity ${cap * 4}`);
    H.assert(used.size >= 4, `range ${a},${b}: emits a quad`);
  }
  m.destroy();
});

function countUncovered(m, R) {
  // every pixel within R-1 of the centerline must sit inside a quad
  // (guards holes in the coverage field's support); 2px raster for speed.
  const { pos, idx } = pre(m);
  const P = (v) => ({ x: pos[2 * v], y: pos[2 * v + 1] });
  const tris = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const [a, b, c] = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]];
    if (a === 0 && b === 0 && c === 0) continue;
    tris.push([a, b, c]);
  }
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
      for (let t = 0; t < tris.length && !covered; t++)
        if (inside(gx, gy, P(tris[t][0]), P(tris[t][1]), P(tris[t][2]))) covered = true;
      if (!covered) missing++;
    }
  }
  return missing;
}

test("slider-mesh: kink and fold-back tip have no coverage holes", () => {
  const kink = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 200, true);
  H.eq(countUncovered(kink, R), 0, "kink fully covered");
  const fold = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }], 200, true);
  checkGeometry(fold, "fold");
  H.eq(countUncovered(fold, R), 0, "fold tip fully covered");
});

test("slider-mesh: pretzel shapes have no coverage holes", () => {
  // Overlapping legs are resolved by the GPU MAX pass, so the CPU only
  // has to guarantee support: every pixel within radius of the path
  // falls in at least one quad, where the coverage field is computed.
  const build = (hit) => new SliderMesh(new LinearBezier(hit, true), 30, 0);
  const S = build({ x: 0, y: 0, keyframes: [{ x: 40, y: 0 }, { x: 40, y: 25 }, { x: 0, y: 25 }, { x: 0, y: 50 }], pixelLength: 130 });
  checkGeometry(S, "tight-S");
  H.eq(countUncovered(S, 30), 0, "tight-S fully covered");
  const Hp = build({ x: 0, y: 0, keyframes: [{ x: 100, y: 0 }, { x: 100, y: 8 }, { x: 0, y: 8 }], pixelLength: 208 });
  checkGeometry(Hp, "hairpin");
  H.eq(countUncovered(Hp, 30), 0, "hairpin fully covered");
  S.destroy(); Hp.destroy();
});

test("slider-mesh: gradient texture uploads as premultiplied", () => {
  // The gradient buffer is already premultiplied; v8 premultiplies
  // "premultiply-alpha-on-upload" data again (dark/saturated sliders).
  const m = meshFromPoints([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  initMesh(m);
  H.eq(m.sliderTexture.source.alphaMode, "premultiplied-alpha", "declared truthfully");
  m.destroy();
});
