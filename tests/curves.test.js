// Unit tests: slider curve math (pure modules, no DOM).
"use strict";
const H = require("./helpers");

global._ = require("../scripts/lib/underscore.js");
const Curve = H.loadModule("scripts/curves/Curve.js").default;
const CurveType = H.loadModule("scripts/curves/CurveType.js").default;
const Bezier2 = H.loadModule("scripts/curves/Bezier2.js").default;
const EqualDistanceMultiCurve = H.loadModule("scripts/curves/EqualDistanceMultiCurve.js").default;
const LinearBezier = H.loadModule("scripts/curves/LinearBezier.js").default;
const CircumscribedCircle = H.loadModule("scripts/curves/CircumscribedCircle.js").default;

test("curves: Curve.lerp interpolates", () => {
  H.eq(Curve.lerp(0, 10, 0.25), 2.5, "lerp");
  H.eq(Curve.lerp(5, 5, 0.9), 5, "degenerate");
});

test("curves: Bezier2 endpoints and midpoint", () => {
  const b = new Bezier2([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  const p0 = b.pointAt(0), p1 = b.pointAt(1), pm = b.pointAt(0.5);
  H.eq(p0.x, 0); H.eq(p1.x, 10);
  H.assert(Math.abs(pm.x - 5) < 1e-9, "linear midpoint, got " + pm.x);
  H.assert(b.totalDistance > 9 && b.totalDistance < 11, "length ~10, got " + b.totalDistance);
});

test("curves: LinearBezier follows an L shape within tolerance", () => {
  const hit = { x: 0, y: 0, keyframes: [{ x: 100, y: 0 }], pixelLength: 100 };
  const c = new LinearBezier(hit, true);
  H.assert(c.curve.length > 2, "has subdivided points");
  const mid = c.pointAt(0.5);
  H.assert(Math.abs(mid.x - 50) < 8, "midpoint near x=50, got " + mid.x);
  H.assert(Math.abs(mid.y) < 8, "midpoint near y=0, got " + mid.y);
  for (const p of c.curve) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error("non-finite curve point");
  }
});

test("curves: perfect-circle (P) slider traces an arc of pixelLength", () => {
  // start (0,0), mid (50,50), end (100,0): circle through these, truncated to 140px
  const hit = { x: 0, y: 0, keyframes: [{ x: 50, y: 50 }, { x: 100, y: 0 }], pixelLength: 140 };
  const c = new CircumscribedCircle(hit);
  H.assert(c.curve.length > 2, "arc points exist");
  let len = 0;
  for (let i = 1; i < c.curve.length; i++) {
    len += Math.hypot(c.curve[i].x - c.curve[i - 1].x, c.curve[i].y - c.curve[i - 1].y);
  }
  H.assert(Math.abs(len - 140) / 140 < 0.05, "arc length ~140, got " + len);
});

test("curves: collinear P points fall back without throwing", () => {
  // CircumscribedCircle returns [] for straight lines; caller falls back.
  const hit = { x: 0, y: 0, keyframes: [{ x: 50, y: 0 }, { x: 100, y: 0 }], pixelLength: 100 };
  const r = new CircumscribedCircle(hit);
  H.assert(Array.isArray(r) && r.length === 0, "straight P yields [] fallback signal");
});
