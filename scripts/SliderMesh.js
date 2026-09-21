/*
* custom class, extends PIXI.Container
* Renders an osu! slider as two v8 Mesh children (body + head ball cap)
* sharing one GlProgram. Per-frame work is uniform updates only: no manual
* GL, no depth prepass. Fragments self-clip for snaking in clip space
* (z beyond the far plane), and coplanar triangles sharing vertices are
* covered exactly once by rasterization rules, so no depth buffer games
* are needed for clean joints.
*
* constructor params
*   curve: { curve: [{x,y,t}], pointAt(t) }, in osu pixels
*   radius: radius of hit circle, in osu! pixels
*   tintid: color slot index
*/

import * as PIXI from './lib/pixi.mjs';
import { makeSliderBallRamp } from './sliderBall.js';

// GLSL ES 3.00 (v8 compiles custom programs as such; no #version needed,
// mirroring v8's own raw-shader examples).
const vertexSrc = `
in vec4 position;
out float dist;
uniform float dx;
uniform float dy;
uniform float dt;
uniform float ox;
uniform float oy;
uniform float ot;
void main() {
    dist = position.w;
    gl_Position = vec4(position.x, position.y, position.w + 2.0 * float(position.z * dt > ot), 1.0);
    gl_Position.x = gl_Position.x * dx + ox;
    gl_Position.y = gl_Position.y * dy + oy;
}`;

const fragmentSrc = `
in float dist;
uniform sampler2D uSampler2;
uniform float alpha;
uniform float texturepos;
out vec4 finalColor;
void main() {
    finalColor = alpha * texture(uSampler2, vec2(dist, texturepos));
}`;

function makeUniforms() {
    return new PIXI.UniformGroup({
        alpha: { value: 1, type: 'f32' },
        texturepos: { value: 0, type: 'f32' },
        dx: { value: 1, type: 'f32' },
        dy: { value: 1, type: 'f32' },
        ox: { value: 0, type: 'f32' },
        oy: { value: 0, type: 'f32' },
        dt: { value: 0, type: 'f32' },
        ot: { value: 1, type: 'f32' },
    });
}

function makeShader(samplerSource) {
    return new PIXI.Shader({
        glProgram: SliderMesh.prototype.glProgram,
        resources: {
            sliderUniforms: makeUniforms(),
            uSampler2: samplerSource,
        },
    });
}

function makeGeometry(verts, index) {
    const g = new PIXI.Geometry();
    g.addAttribute('position', verts, 4);
    g.addIndex(index);
    return g;
}

function newTextureData(colors, SliderTrackOverride, SliderBorder) {
    const borderwidth = 0.128;
    const innerPortion = 1 - borderwidth;
    const edgeOpacity = 0.8;
    const centerOpacity = 0.3;
    const blurrate = 0.015;
    const width = 200;
    let buff = new Uint8Array(colors.length * width * 4);

    for (let k = 0; k < colors.length; ++k) {
        let tint = (typeof (SliderTrackOverride) != 'undefined') ? SliderTrackOverride : colors[k];
        let bordertint = (typeof (SliderBorder) != 'undefined') ? SliderBorder : 0xffffff;
        let borderR = (bordertint >> 16) / 255;
        let borderG = ((bordertint >> 8) & 255) / 255;
        let borderB = (bordertint & 255) / 255;
        let borderA = 1.0;
        let innerR = (tint >> 16) / 255;
        let innerG = ((tint >> 8) & 255) / 255;
        let innerB = (tint & 255) / 255;
        let innerA = 1.0;
        for (let i = 0; i < width; i++) {
            let position = i / width;
            let R, G, B, A;
            if (position >= innerPortion) {
                R = borderR;
                G = borderG;
                B = borderB;
                A = borderA;
            } else {
                R = innerR;
                G = innerG;
                B = innerB;
                A = innerA * ((edgeOpacity - centerOpacity) * position / innerPortion + centerOpacity);
            }
            R *= A;
            G *= A;
            B *= A;
            if (1 - position < blurrate) {
                R *= (1 - position) / blurrate;
                G *= (1 - position) / blurrate;
                B *= (1 - position) / blurrate;
                A *= (1 - position) / blurrate;
            }
            if (innerPortion - position > 0 && innerPortion - position < blurrate) {
                let mu = (innerPortion - position) / blurrate;
                R = mu * R + (1 - mu) * borderR * borderA;
                G = mu * G + (1 - mu) * borderG * borderA;
                B = mu * B + (1 - mu) * borderB * borderA;
                A = mu * innerA + (1 - mu) * borderA;
            }
            buff[(k * width + i) * 4] = R * 255;
            buff[(k * width + i) * 4 + 1] = G * 255;
            buff[(k * width + i) * 4 + 2] = B * 255;
            buff[(k * width + i) * 4 + 3] = A * 255;
        }
    }
    return { data: buff, width: width, height: colors.length };
}

const DIVIDES = 64;
// Returns plain { verts, index } (no GL objects): butt quad strip with
// degenerate-segment guards, round outer joins, and miter-welded inner
// joins (collapsed to a fan around the kink miter across overlapped spans).
function curvePoints(curve0, radius) {
    let curve = [];
    for (let i = 0; i < curve0.length; ++i)
        if (i === 0 || Math.abs(curve0[i].x - curve0[i - 1].x) > 0.00001 || Math.abs(curve0[i].y - curve0[i - 1].y) > 0.00001)
            curve.push(curve0[i]);
    // Snap near-coincident non-adjacent points (folded paperclips sample
    // out-and-back legs at different resample phases, up to half a step
    // apart): snapping them exact lets overlapping legs share identical
    // quads, which the union below drops whole. Positions move <1.6px
    // (invisible); t is preserved, so ball/snake mapping is unaffected.
    // Segments with both endpoints snapped duplicate earlier geometry,
    // so their quads are skipped outright (exact fold removal).
    const snapped = new Array(curve.length).fill(false);
    for (let i = 0; i < curve.length; ++i) {
        for (let j = 0; j < i - 1; ++j) {
            const dx = curve[i].x - curve[j].x, dy = curve[i].y - curve[j].y;
            if (dx * dx + dy * dy < 1.6 * 1.6) {
                curve[i] = { x: curve[j].x, y: curve[j].y, t: curve[i].t };
                snapped[i] = true;
                break;
            }
        }
    }
    // Degenerate curve (all points coincident): fall back to a tiny
    // segment so we never emit NaN normals / out-of-bounds indices,
    // which previously made sliders flicker or disappear.
    if (curve.length < 2) {
        let p0 = curve0[0] || { x: 0, y: 0, t: 0 };
        curve = [
            { x: p0.x, y: p0.y, t: 0 },
            { x: p0.x + 0.001, y: p0.y, t: 1 },
        ];
    }

    let vert = [];
    let index = [];
    vert.push(curve[0].x, curve[0].y, curve[0].t, 0.0);
    for (let i = 1; i < curve.length; ++i) {
        let x = curve[i].x;
        let y = curve[i].y;
        let t = curve[i].t;
        let lx = curve[i - 1].x;
        let ly = curve[i - 1].y;
        let lt = curve[i - 1].t;
        let dx = x - lx;
        let dy = y - ly;
        let length = Math.hypot(dx, dy);
        // Guard against zero-length segments: unguarded division produced
        // NaN/Infinity normals, corrupting the whole vertex buffer and
        // making curved portions flicker or vanish.
        let inv = length > 1e-6 ? radius / length : 0;
        let ox = -dy * inv;
        let oy = dx * inv;

        vert.push(lx + ox, ly + oy, lt, 1.0);
        vert.push(lx - ox, ly - oy, lt, 1.0);
        vert.push(x + ox, y + oy, t, 1.0);
        vert.push(x - ox, y - oy, t, 1.0);
        vert.push(x, y, t, 0.0);
    }

    function addArc(c, p1, p2, t = 0.0) {
        let theta_1 = Math.atan2(vert[4 * p1 + 1] - vert[4 * c + 1], vert[4 * p1] - vert[4 * c]);
        let theta_2 = Math.atan2(vert[4 * p2 + 1] - vert[4 * c + 1], vert[4 * p2] - vert[4 * c]);
        if (theta_1 > theta_2)
            theta_2 += 2 * Math.PI;
        let theta = theta_2 - theta_1;
        let divs = Math.ceil(DIVIDES * Math.abs(theta) / (2 * Math.PI));
        theta /= divs;
        let last = p1;
        for (let i = 1; i < divs; ++i) {
            vert.push(vert[4 * c] + radius * Math.cos(theta_1 + i * theta),
                vert[4 * c + 1] + radius * Math.sin(theta_1 + i * theta), t, 1.0);
            let newv = vert.length / 4 - 1;
            index.push(c, last, newv);
            last = newv;
        }
        index.push(c, last, p2);
    }

    addArc(0, 1, 2, curve[0].t);
    addArc(5 * curve.length - 5, 5 * curve.length - 6, 5 * curve.length - 7, curve[curve.length - 1].t);
    // Inner-side miter vertices per joint (-1 = none: endpoints, straight
    // or degenerate joints keep butt sections, which tile exactly there).
    // Miter-welding makes adjacent quads share full edges, so the inner
    // side renders with exact single coverage instead of overlapping
    // butt-section lenses (visible as streaks/doubled regions).
    const miterL = new Array(curve.length).fill(-1);
    const miterR = new Array(curve.length).fill(-1);
    function miterAt(i, side) {
        // Intersect the two inner edge lines at joint i. side +1 = left
        // offsets, -1 = right offsets (matching the butt-vertex layout).
        const ux1 = (curve[i].x - curve[i - 1].x);
        const uy1 = (curve[i].y - curve[i - 1].y);
        const ux2 = (curve[i + 1].x - curve[i].x);
        const uy2 = (curve[i + 1].y - curve[i].y);
        const l1 = Math.hypot(ux1, uy1);
        const l2 = Math.hypot(ux2, uy2);
        if (l1 < 1e-6 || l2 < 1e-6) return -1;
        const d1x = ux1 / l1, d1y = uy1 / l1;
        const d2x = ux2 / l2, d2y = uy2 / l2;
        const n1x = -d1y * side, n1y = d1x * side;
        const n2x = -d2y * side, n2y = d2x * side;
        const cx = curve[i].x, cy = curve[i].y;
        const p1x = cx + n1x * radius, p1y = cy + n1y * radius;
        const p2x = cx + n2x * radius, p2y = cy + n2y * radius;
        const denom = d1x * d2y - d1y * d2x;
        let mx, my;
        if (Math.abs(denom) < 1e-9) {
            mx = (p1x + p2x) / 2;
            my = (p1y + p2y) / 2;
        } else {
            const s = ((p2x - p1x) * d2y - (p2y - p1y) * d2x) / denom;
            mx = p1x + s * d1x;
            my = p1y + s * d1y;
            const mdx = mx - cx, mdy = my - cy;
            if (mdx * mdx + mdy * mdy > 9 * radius * radius) {
                mx = (p1x + p2x) / 2;
                my = (p1y + p2y) / 2;
            }
        }
        vert.push(mx, my, curve[i].t, 1.0);
        return vert.length / 4 - 1;
    }
    for (let i = 1; i < curve.length - 1; ++i) {
        let dx1 = curve[i].x - curve[i - 1].x;
        let dy1 = curve[i].y - curve[i - 1].y;
        let dx2 = curve[i + 1].x - curve[i].x;
        let dy2 = curve[i + 1].y - curve[i].y;
        // Skip joints on degenerate (zero-length) segments: their
        // direction is undefined and previously produced NaN arcs.
        const l1 = Math.hypot(dx1, dy1);
        const l2 = Math.hypot(dx2, dy2);
        if (l1 < 1e-6 || l2 < 1e-6) continue;
        const sin = (dx1 * dy2 - dx2 * dy1) / (l1 * l2);
        // Fold-back (hairpin) tip: the path reverses, so neither side is
        // "inner"; without a join the tip shows a semicircular notch past
        // the joint. Emit a round fan over the tip half (CCW from the
        // arrival right-butt to the arrival left-butt passes the tip).
        const cos = (dx1 * dx2 + dy1 * dy2) / (l1 * l2);
        if (Math.abs(sin) < 1e-3 && cos < -0.5) {
            addArc(5 * i, 5 * i - 1, 5 * i - 2, curve[i].t);
            continue;
        }
        // Skip effectively-straight joints: the quads already tile cleanly,
        // and the sliver-thin fan/bevel triangles would rasterize as
        // streaks along the slider side.
        if (Math.abs(sin) < 1e-3) continue;
        let t = sin > 0 ? 1 : -1;
        // The joint's curve parameter goes on the fan: the shader clips
        // snake in/out per-fragment on it, so fans left at t=0 would pop
        // in ahead of the snake head and the slider would fall apart.
        // Outer side keeps the round join (established look); the inner
        // side is miter-welded (shared vertex, exact tiling, no overlap).
        if (t > 0) {
            // outer (right-side) round join
            addArc(5 * i, 5 * i - 1, 5 * i + 2, curve[i].t);
            miterL[i] = miterAt(i, +1);
        }
        else if (t < 0) {
            addArc(5 * i, 5 * i + 1, 5 * i - 2, curve[i].t);
            miterR[i] = miterAt(i, -1);
        }
        // t == 0 unreachable (epsilon skip above); straight joints need no
        // join geometry at all.
    }
    // Collapse concave-side edge verts that fall inside the stroke onto
    // the kink miter. With dense resampling the concave-side overlap of a
    // sharp kink spans many segments (an R x R square for a 90-degree
    // kink), so trimming just the two adjacent quads still leaves the
    // whole square double-drawn (brighter streaks). Joints whose butt edge
    // lies within radius of the far leg collapse to the kink miter, turning
    // the span into a fan around the miter that tiles exactly with the
    // other leg's fan along the miter-to-joint edge. The far-leg search
    // stays within a local window so distant self-intersections (spirals)
    // are never merged. Small turns never trigger this (their edge verts
    // stay within tolerance of radius), keeping gentle curves untouched.
    function distPtSeg(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy;
        let u = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
        u = u < 0 ? 0 : (u > 1 ? 1 : u);
        return Math.hypot(ax + u * dx - px, ay + u * dy - py);
    }
    const snapTol = 1.0;
    const spanWin = Math.ceil(radius / 1.5) + 3;
    for (let k = 1; k < curve.length - 1; ++k) {
        const Mk = (miterL[k] !== -1) ? miterL[k] : miterR[k];
        if (Mk === -1) continue;
        const side = (miterL[k] !== -1) ? +1 : -1;
        const arr = (side > 0) ? miterL : miterR;
        for (let dir = -1; dir <= 1; dir += 2) {
            for (let j = k + dir; j >= 1 && j <= curve.length - 2 &&
                    Math.abs(j - k) <= spanWin; j += dir) {
                // Another kink's own miter wins: keep it and stop the span.
                if (arr[j] !== -1) break;
                const b1 = (side > 0) ? 5 * j - 2 : 5 * j - 1;
                const b2 = (side > 0) ? 5 * j + 1 : 5 * j + 2;
                let inside = false;
                for (let b = 0; b < 2 && !inside; ++b) {
                    const px = vert[4 * (b ? b2 : b1)];
                    const py = vert[4 * (b ? b2 : b1) + 1];
                    if (dir < 0) {
                        for (let s = k + 1; s < curve.length && s <= k + spanWin; ++s) {
                            if (distPtSeg(px, py, curve[s - 1].x, curve[s - 1].y,
                                    curve[s].x, curve[s].y) < radius - snapTol) {
                                inside = true;
                                break;
                            }
                        }
                    } else {
                        for (let s = k; s >= 1 && s >= k - spanWin; --s) {
                            if (distPtSeg(px, py, curve[s - 1].x, curve[s - 1].y,
                                    curve[s].x, curve[s].y) < radius - snapTol) {
                                inside = true;
                                break;
                            }
                        }
                    }
                }
                if (!inside) break;
                arr[j] = Mk;
            }
        }
    }
    // Quad strip between consecutive cross-sections. Each side resolves to
    // the joint miter where one was computed, else the butt edge vertex:
    // shared indices tile exactly, so nothing double-draws.
    // Butt layout per segment k: L_prev=5k-4, R_prev=5k-3, L_curr=5k-2,
    // R_curr=5k-1; centers C_0=0, C_k=5k.
    // tri() drops degenerate triples from collapsed spans (a quad whose
    // both edge verts snapped to the same miter contributes one fan
    // triangle; the other triple is empty and must not be emitted).
    function tri(a, b, c) {
        if (a === b || b === c || c === a) return;
        index.push(a, b, c);
    }
    // Strip triangles start here (everything before is cap/join fans,
    // which trim never touches). segOfTri records the owning segment
    // per strip triple (robust to degenerate skips in collapsed spans).
    const stripStart = index.length;
    const segOfTri = [];
    for (let k = 1; k < curve.length; ++k) {
        // Fully-snapped segments duplicate earlier geometry (folds):
        // skip their quads outright (t mapping lives on the resample
        // array used by playback, which is unaffected).
        if (snapped[k - 1] && snapped[k]) continue;
        const cPrev = (k === 1) ? 0 : 5 * (k - 1);
        const cCurr = 5 * k;
        const lp = (miterL[k - 1] !== -1) ? miterL[k - 1] : 5 * k - 4;
        const lc = (miterL[k] !== -1) ? miterL[k] : 5 * k - 2;
        const rp = (miterR[k - 1] !== -1) ? miterR[k - 1] : 5 * k - 3;
        const rc = (miterR[k] !== -1) ? miterR[k] : 5 * k - 1;
        const before = index.length / 3;
        tri(cPrev, lp, cCurr); tri(lp, lc, cCurr);
        tri(cPrev, rp, cCurr); tri(rp, rc, cCurr);
        for (let q = before; q < index.length / 3; ++q) segOfTri.push(k);
    }
    // Trim strip triangles of side-by-side parallel legs (close S
    // legs, near-folds, spiral arms) against their midline, so each leg
    // keeps its own half and the seam lands mid-gutter instead of
    // double-drawing it. Only parallel pairs with distinctly separated
    // lines trim (folds and micro-kinks would slice lengthwise); only
    // triangles fully flanked by the other segment (every vertex within
    // R and projecting within its range) cut, otherwise the cut-away
    // part might lie beyond its tiled strips (a hole). Caps, joins and
    // non-parallel contacts are left whole for the union below.
    {
        const nseg = curve.length - 1;
        const segA = [], segB = []; // endpoints per segment (1-based)
        for (let s = 1; s <= nseg; ++s) {
            segA.push(curve[s - 1]);
            segB.push(curve[s]);
        }
        const segLen = (s) => Math.hypot(segB[s - 1].x - segA[s - 1].x, segB[s - 1].y - segA[s - 1].y);
        // midline separator of two parallel segment lines, kept side
        // facing mid_a; null unless distinctly separated
        function midline(a, b) {
            const p1 = segA[a - 1], q1 = segB[a - 1], p2 = segA[b - 1], q2 = segB[b - 1];
            const l1 = segLen(a), l2 = segLen(b);
            if (l1 < 1e-9 || l2 < 1e-9) return null;
            const ux = (q1.x - p1.x) / l1, uy = (q1.y - p1.y) / l1;
            const vx = (q2.x - p2.x) / l2, vy = (q2.y - p2.y) / l2;
            if (Math.abs(ux * vy - uy * vx) >= 1e-9) return null;
            const ma = { x: (p1.x + q1.x) / 2, y: (p1.y + q1.y) / 2 };
            const mb = { x: (p2.x + q2.x) / 2, y: (p2.y + q2.y) / 2 };
            const perp = Math.abs((mb.x - ma.x) * uy - (mb.y - ma.y) * ux);
            if (!(perp > 0.5 && perp < 2 * radius + 3)) return null;
            let nx = -uy, ny = ux;
            let c = nx * (ma.x + mb.x) / 2 + ny * (ma.y + mb.y) / 2;
            if (nx * ma.x + ny * ma.y < c) { nx = -nx; ny = -ny; c = -c; }
            return { nx, ny, c };
        }
        const VP = (id) => ({ x: vert[4 * id], y: vert[4 * id + 1], t: vert[4 * id + 2], d: vert[4 * id + 3], id });
        const trims = new Map(); // seg -> [{nx,ny,c,b}]
        for (let a = 1; a <= nseg; ++a) {
            for (let b = a + 2; b <= nseg; ++b) {
                // rough reject: segment bounding boxes beyond 2R+slack
                const ax0 = Math.min(segA[a - 1].x, segB[a - 1].x) - 2 * radius;
                const ax1 = Math.max(segA[a - 1].x, segB[a - 1].x) + 2 * radius;
                const ay0 = Math.min(segA[a - 1].y, segB[a - 1].y) - 2 * radius;
                const ay1 = Math.max(segA[a - 1].y, segB[a - 1].y) + 2 * radius;
                if (Math.max(segA[b - 1].x, segB[b - 1].x) < ax0 || Math.min(segA[b - 1].x, segB[b - 1].x) > ax1 ||
                    Math.max(segA[b - 1].y, segB[b - 1].y) < ay0 || Math.min(segA[b - 1].y, segB[b - 1].y) > ay1)
                    continue;
                const sep = midline(a, b);
                if (!sep) continue;
                if (!trims.has(a)) trims.set(a, []);
                if (!trims.has(b)) trims.set(b, []);
                trims.get(a).push({ nx: sep.nx, ny: sep.ny, c: sep.c, b });
                trims.get(b).push({ nx: -sep.nx, ny: -sep.ny, c: -sep.c, b: a });
            }
        }
        if (trims.size) {
            // Owner of strip triple i is segOfTri[i - S]; each straddling
            // triangle is cut, far-side pieces drop (their coverer is the
            // other leg, trimmed symmetrically at the same midline).
            const S = stripStart / 3;
            const newIdx = index.slice(0, stripStart);
            for (let i = S; i < index.length / 3; ++i) {
                const k = segOfTri[i - S];
                const hs = trims.get(k);
                if (!hs) {
                    newIdx.push(index[3 * i], index[3 * i + 1], index[3 * i + 2]);
                    continue;
                }
                let poly = [VP(index[3 * i]), VP(index[3 * i + 1]), VP(index[3 * i + 2])];
                let cutAny = false;
                for (const h of hs) {
                    const A = segA[h.b - 1], B = segB[h.b - 1];
                    const ex = B.x - A.x, ey = B.y - A.y;
                    const el = ex * ex + ey * ey;
                    const sl = Math.sqrt(el);
                    // Centroid gates (size-independent, so wide fans and
                    // jog quads trim like narrow strips): the centroid must
                    // project within the other segment's range (+/- a few
                    // px) and sit within R of it; otherwise the cut-away
                    // part might lie beyond its tiled strips (a hole).
                    // Failing either gate keeps a safe overdraw sliver.
                    let gated = el > 1e-12;
                    if (gated) {
                        let cx = 0, cy = 0;
                        for (const v of poly) { cx += v.x; cy += v.y; }
                        cx /= poly.length; cy /= poly.length;
                        const u = ((cx - A.x) * ex + (cy - A.y) * ey) / el;
                        if (u < -4 / sl || u > 1 + 4 / sl) gated = false;
                        else {
                            const uc = u < 0 ? 0 : (u > 1 ? 1 : u);
                            const dx = A.x + uc * ex - cx, dy = A.y + uc * ey - cy;
                            if (dx * dx + dy * dy > (radius + 1e-7) * (radius + 1e-7)) gated = false;
                        }
                    }
                    if (!gated) continue;
                    let mn = 1e18, mx = -1e18;
                    for (const v of poly) {
                        const d = h.nx * v.x + h.ny * v.y - h.c;
                        if (d < mn) mn = d;
                        if (d > mx) mx = d;
                    }
                    if (!(mn < -1e-9 && mx > 1e-9)) continue; // no straddle: keep whole
                    cutAny = true;
                    const out = [];
                    for (let e = 0; e < poly.length; ++e) {
                        const P = poly[e], Q = poly[(e + 1) % poly.length];
                        const dp = h.nx * P.x + h.ny * P.y - h.c;
                        const dq = h.nx * Q.x + h.ny * Q.y - h.c;
                        const pin = dp >= -1e-9, qin = dq >= -1e-9;
                        const cut = (P, Q, s) => {
                            const id = vert.length / 4;
                            vert.push(P.x + s * (Q.x - P.x), P.y + s * (Q.y - P.y),
                                P.t + s * (Q.t - P.t), P.d + s * (Q.d - P.d));
                            return { x: vert[4 * id], y: vert[4 * id + 1], t: vert[4 * id + 2], d: vert[4 * id + 3], id };
                        };
                        if (pin && qin) out.push(Q);
                        else if (pin && !qin) out.push(cut(P, Q, dp / (dp - dq)));
                        else if (!pin && qin) { out.push(cut(P, Q, dp / (dp - dq))); out.push(Q); }
                    }
                    poly = out;
                    if (poly.length < 3) break;
                }
                if (!cutAny) {
                    newIdx.push(index[3 * i], index[3 * i + 1], index[3 * i + 2]);
                    continue;
                }
                if (poly.length < 3) continue;
                const ids = poly.map((v) => v.id);
                for (let f = 1; f < ids.length - 1; ++f) {
                    const A = poly[0], B = poly[f], C = poly[f + 1];
                    if (Math.abs((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y)) / 2 < 1e-9) continue;
                    newIdx.push(ids[0], ids[f], ids[f + 1]);
                }
            }
            index.length = 0;
            index.push(...newIdx);
        }
    }
    return unionSingleCoverage(vert, index);
}

// Exact single-coverage union over the strip/fan triangles. Sharp kinks
// are pre-fanned and side-by-side legs pre-trimmed above, but curved
// tight loops, endpoint contacts and trim seams can still cover regions
// 2..N times, which alpha-doubles into streaks. Triangles in real area
// overlap (exact pair test, boundary-exclusive, so clean tiling is
// untouched) are subdivided (3 levels, conforming: shared edges compute
// identical midpoints, deduplicated so neighbors tile exactly and
// rasterize exactly once per GPU fill rules); a micro-triangle is dropped
// only if fully covered by an already-emitted triangle (first coverage
// wins, zero holes by construction). Position/t/dist interpolate
// linearly, so the gradient and snake clipping are unchanged where kept.
// Residual overdraw is a sub-micro-triangle boundary sliver (~1px, same
// order as the rasterizer's own shared-edge pixels).
function unionSingleCoverage(vert, index) {
    const EPS = 1e-9;
    const at = (id) => ({ x: vert[4 * id], y: vert[4 * id + 1], t: vert[4 * id + 2], d: vert[4 * id + 3] });
    const boxOf = (a, b, c) => [
        Math.min(a.x, b.x, c.x), Math.min(a.y, b.y, c.y),
        Math.max(a.x, b.x, c.x), Math.max(a.y, b.y, c.y),
    ];
    const strictOverlapBox = (A, B) => A[0] < B[2] && B[0] < A[2] && A[1] < B[3] && B[1] < A[3];
    const cross = (ax, ay, bx, by) => ax * by - ay * bx;
    const edgeC = (A, B, px, py) => cross(B.x - A.x, B.y - A.y, px - A.x, py - A.y);
    // strict / inclusive point-in-triangle (winding-independent)
    function inTri(px, py, T, strict) {
        const c0 = edgeC(T[0], T[1], px, py);
        const c1 = edgeC(T[1], T[2], px, py);
        const c2 = edgeC(T[2], T[0], px, py);
        if (strict) {
            if (Math.abs(c0) < EPS || Math.abs(c1) < EPS || Math.abs(c2) < EPS) return false;
            return (c0 > 0 && c1 > 0 && c2 > 0) || (c0 < 0 && c1 < 0 && c2 < 0);
        }
        return (c0 >= -EPS && c1 >= -EPS && c2 >= -EPS) ||
            (c0 <= EPS && c1 <= EPS && c2 <= EPS);
    }
    function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
        const d = cross(bx - ax, by - ay, dx - cx, dy - cy);
        if (Math.abs(d) < 1e-12) return false;
        const t = (cross(cx - ax, cy - ay, dx - cx, dy - cy)) / d;
        const u = (cross(cx - ax, cy - ay, bx - ax, by - ay)) / d;
        return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
    }
    // parse, dropping degenerate triples (they rasterize nothing anyway)
    const tris = [];
    for (let i = 0; i < index.length; i += 3) {
        const a = index[i], b = index[i + 1], c = index[i + 2];
        if (a === b || b === c || c === a) continue;
        const T = [at(a), at(b), at(c)];
        const area2 = (T[1].x - T[0].x) * (T[2].y - T[0].y) - (T[2].x - T[0].x) * (T[1].y - T[0].y);
        if (Math.abs(area2) < 1e-9) continue;
        tris.push({ ids: [a, b, c], v: T, box: boxOf(...T) });
    }
    // mark true area overlaps: strict bbox first, then exact pair test
    // (proper edge crossing or strict containment either way)
    const CELL = 16;
    const gkey = (cx, cy) => cx * 4096 + cy;
    function cellsOf(box) {
        const r = [];
        for (let cx = Math.floor(box[0] / CELL); cx <= Math.floor(box[2] / CELL); ++cx)
            for (let cy = Math.floor(box[1] / CELL); cy <= Math.floor(box[3] / CELL); ++cy)
                r.push(gkey(cx, cy));
        return r;
    }
    const marked = new Array(tris.length).fill(false);
    {
        const cellMap = new Map();
        const cellLists = tris.map((tr) => cellsOf(tr.box));
        tris.forEach((tr, ti) => {
            for (const k of cellLists[ti]) {
                let l = cellMap.get(k);
                if (!l) cellMap.set(k, (l = []));
                l.push(ti);
            }
        });
        const seenPair = new Set();
        const centroid = (T) => [(T[0].x + T[1].x + T[2].x) / 3, (T[0].y + T[1].y + T[2].y) / 3];
        const pairHits = (A, B) => {
            for (let i = 0; i < 3; ++i) for (let j = 0; j < 3; ++j) {
                const a0 = A[i], a1 = A[(i + 1) % 3], b0 = B[j], b1 = B[(j + 1) % 3];
                if (segCross(a0.x, a0.y, a1.x, a1.y, b0.x, b0.y, b1.x, b1.y)) return true;
            }
            const [cax, cay] = centroid(A), [cbx, cby] = centroid(B);
            return inTri(cax, cay, B, true) || inTri(cbx, cby, A, true);
        };
        tris.forEach((tr, ti) => {
            for (const k of cellLists[ti]) {
                for (const tj of cellMap.get(k)) {
                    if (tj <= ti) continue;
                    const p = ti * tris.length + tj;
                    if (seenPair.has(p)) continue;
                    seenPair.add(p);
                    const o = tris[tj];
                    if (!strictOverlapBox(tr.box, o.box)) continue;
                    // penetration gate: overlap depth is bounded by the
                    // bbox intersection's smaller side; sub-pixel slivers
                    // subdivide into hundreds of verts for no visual gain
                    const iw = Math.min(tr.box[2], o.box[2]) - Math.max(tr.box[0], o.box[0]);
                    const ih = Math.min(tr.box[3], o.box[3]) - Math.max(tr.box[1], o.box[1]);
                    if (Math.min(iw, ih) < 0.5) continue;
                    if (pairHits(tr.v, o.v)) marked[ti] = marked[tj] = true;
                }
            }
        });
    }
    // conforming midpoint cache: identical edges yield identical vertices
    const midCache = new Map();
    function midId(P, Q) {
        const k = [P.x, P.y, P.t, P.d, Q.x, Q.y, Q.t, Q.d].join(",");
        let id = midCache.get(k);
        if (id === undefined) {
            id = vert.length / 4;
            vert.push((P.x + Q.x) / 2, (P.y + Q.y) / 2, (P.t + Q.t) / 2, (P.d + Q.d) / 2);
            midCache.set(k, id);
        }
        return id;
    }
    function subdivide4(A, B, C, out) {
        const mAB = midId(A.v, B.v), mBC = midId(B.v, C.v), mCA = midId(C.v, A.v);
        const m = (id) => ({ id, v: at(id) });
        const MAB = m(mAB), MBC = m(mBC), MCA = m(mCA);
        out.push([A, MAB, MCA], [MAB, B, MBC], [MCA, MBC, C], [MAB, MBC, MCA]);
    }
    const outIndex = [];
    // emitted pieces, for first-coverage-wins tests (order-dependent:
    // a piece only ever tests against strictly earlier tris, so drop
    // chains terminate at drawn geometry)
    const emitted = []; // { v:[p,p,p], box, ti }
    const emitGrid = new Map();
    function emitInsert(v, box, ti) {
        const ei = emitted.length;
        emitted.push({ v, box, ti });
        for (const k of cellsOf(box)) {
            let l = emitGrid.get(k);
            if (!l) emitGrid.set(k, (l = []));
            l.push(ei);
        }
    }
    const centroidOf = (V) => [
        (V[0].x + V[1].x + V[2].x) / 3,
        (V[0].y + V[1].y + V[2].y) / 3,
    ];
    // exact area overlap, boundary-exclusive (shared tiling edges never
    // count, so clean neighbors pass through untouched)
    function hits(A, B) {
        for (let i = 0; i < 3; ++i) for (let j = 0; j < 3; ++j) {
            const a0 = A[i], a1 = A[(i + 1) % 3], b0 = B[j], b1 = B[(j + 1) % 3];
            if (segCross(a0.x, a0.y, a1.x, a1.y, b0.x, b0.y, b1.x, b1.y)) return true;
        }
        const [cax, cay] = centroidOf(A), [cbx, cby] = centroidOf(B);
        return inTri(cax, cay, B, true) || inTri(cbx, cby, A, true);
    }
    // classify a candidate piece against emitted geometry: 'in' (every
    // corner inside-or-on one emitted triangle -> drop, covered),
    // 'out' (no exact overlap with anything -> keep whole), 'cut'
    // (straddles -> subdivide further, or keep whole at max depth)
    function statusOf(V, box, selfTi) {
        let hit = false;
        const seen = new Set();
        for (const k of cellsOf(box)) {
            const cell = emitGrid.get(k);
            if (!cell) continue;
            for (const ei of cell) {
                if (seen.has(ei)) continue;
                seen.add(ei);
                const e = emitted[ei];
                if (e.ti === selfTi) continue;
                if (e.box[0] > box[2] || e.box[2] < box[0] || e.box[1] > box[3] || e.box[3] < box[1]) continue;
                if (V.every((p) => inTri(p.x, p.y, e.v, false))) return 'in';
                if (hits(V, e.v)) hit = true;
            }
        }
        return hit ? 'cut' : 'out';
    }
    const MAXLV = 3;
    if (typeof globalThis.__UDbg !== "undefined") globalThis.__UDbg.marked = marked.filter(Boolean).length;
    tris.forEach((tr, ti) => {
        const V = tr.ids.map((id) => ({ id, v: at(id) }));
        if (!marked[ti]) {
            outIndex.push(tr.ids[0], tr.ids[1], tr.ids[2]);
            emitInsert(tr.v, tr.box, ti);
            return;
        }
        // Fixed two subdivision levels (16 conforming micros): interior
        // micros drop via containment below, boundary straddlers are
        // kept as ~2px slivers (invisible in motion); deeper recursion
        // explodes on area overlaps without visual gain (bands are the
        // trim stage's job, with exact midlines).
        const stack = [[V[0], V[1], V[2], 0]];
        while (stack.length) {
            const [A, B, C, lv] = stack.pop();
            if (A.id === B.id || B.id === C.id || C.id === A.id) continue;
            const vv = [A.v, B.v, C.v];
            const area2 = (vv[1].x - vv[0].x) * (vv[2].y - vv[0].y) - (vv[2].x - vv[0].x) * (vv[1].y - vv[0].y);
            if (Math.abs(area2) < 1e-9) continue; // degenerate: rasterizes nothing
            const box = boxOf(...vv);
            const st = statusOf(vv, box, ti);
            if (typeof globalThis.__UDbg !== "undefined") globalThis.__UDbg['st_' + st] = (globalThis.__UDbg['st_' + st] || 0) + 1;
            if (st === 'in') continue; // dropped (covered by emitted)
            if (st === 'out' || lv >= MAXLV) {
                outIndex.push(A.id, B.id, C.id);
                emitInsert(vv, box, ti);
                continue;
            }
            const nxt = [];
            subdivide4(A, B, C, nxt);
            for (const [a, b, c] of nxt) stack.push([a, b, c, lv + 1]);
        }
    });
    return { verts: vert, index: outIndex };
}

function circlePoints(radius) {
    let vert = [];
    let index = [];
    vert.push(0.0, 0.0, 0.0, 0.0);
    for (let i = 0; i < DIVIDES; ++i) {
        let theta = 2 * Math.PI / DIVIDES * i;
        vert.push(radius * Math.cos(theta), radius * Math.sin(theta), 0.0, 1.0);
        index.push(0, i + 1, (i + 1) % DIVIDES + 1);
    }
    return { verts: vert, index: index };
}

// Updated SliderMesh class using ES6 class syntax and extending PIXI.Container.
export default class SliderMesh extends PIXI.Container {
    constructor(curve, radius, tintid) {
        super();
        this.curve = curve;
        const pts = curvePoints(curve.curve, radius);
        this.bodyGeom = makeGeometry(pts.verts, pts.index);
        this.bodyMesh = null;
        this.capMesh = null;
        this.bodyShader = null;
        this.capShader = null;
        this.alpha = 1.0;
        this.tintid = tintid;
        this.startt = 0.0;
        this.endt = 1.0;
        this.ensureMeshes();
    }

    // Shared GPU state lives on the prototype (initialize/resetTransform
    // are called on SliderMesh.prototype, mirroring the old pattern);
    // per-slider meshes build lazily once it exists.
    ensureMeshes() {
        if (this.bodyMesh) return;
        const P = SliderMesh.prototype;
        if (!P.glProgram || !P.sliderTexture || !P.ballTexture || !P.circleGeom) return;
        this.bodyShader = makeShader(P.sliderTexture.source);
        // The head/tail cap is the opaque ball, not the translucent
        // track gradient: the growing snake tip then reads as a solid
        // ball head hiding the clip edge, like desktop osu!.
        this.capShader = makeShader(P.ballTexture.source);
        this.bodyMesh = new PIXI.Mesh({ geometry: this.bodyGeom, shader: this.bodyShader });
        this.capMesh = new PIXI.Mesh({ geometry: P.circleGeom, shader: this.capShader });
        this.capMesh.visible = false;
        this.addChild(this.bodyMesh);
        this.addChild(this.capMesh);
    }

    initialize(colors, radius, transform, SliderTrackOverride, SliderBorder) {
        const P = SliderMesh.prototype;
        P.ncolors = colors.length;
        const td = newTextureData(colors, SliderTrackOverride, SliderBorder);
        P.sliderTexture = new PIXI.Texture({
            // the gradient buffer is already premultiplied (RGB *= A
            // above): declaring it avoids a second premultiply on upload,
            // which darkened/saturated every slider (v8 premultiplies
            // "premultiply-alpha-on-upload" data by default)
            source: new PIXI.BufferImageSource({ resource: td.data, width: td.width, height: td.height, alphaMode: 'premultiplied-alpha' }),
        });
        if (!P.glProgram) {
            P.glProgram = new PIXI.GlProgram({ name: 'slider', vertex: vertexSrc, fragment: fragmentSrc });
        }
        if (!P.circleGeom) {
            const cp = circlePoints(radius);
            P.circleGeom = makeGeometry(cp.verts, cp.index);
        }
        if (!P.ballTexture) {
            // Opaque ball ramp for the cap mesh (single row; the cap
            // shader samples it at texturepos 0.5). Built once: unlike
            // the track gradient it does not depend on combo colors.
            const ramp = makeSliderBallRamp();
            P.ballTexture = new PIXI.Texture({
                source: new PIXI.BufferImageSource({ resource: ramp.data, width: ramp.width, height: ramp.height, alphaMode: 'premultiplied-alpha' }),
            });
        }
        P.baseTransform = transform;
    }

    resetTransform(transform) {
        SliderMesh.prototype.baseTransform = transform;
    }

    // Push per-frame state (called every frame from updateSlider):
    // body/cap visibility, snake clipping uniforms, color slot.
    sync() {
        this.ensureMeshes();
        const T = SliderMesh.prototype.baseTransform;
        if (!T || !this.bodyShader) return;
        const bu = this.bodyShader.resources.sliderUniforms.uniforms;
        bu.alpha = this.alpha;
        bu.texturepos = this.tintid / this.ncolors;
        bu.dx = T.dx;
        bu.dy = T.dy;
        let ox0 = T.ox;
        let oy0 = T.oy;
        bu.ox = ox0;
        bu.oy = oy0;
        const cu = this.capShader.resources.sliderUniforms.uniforms;
        cu.alpha = this.alpha;
        cu.texturepos = 0.5; // ball ramp is a single row: sample its middle
        cu.dx = T.dx;
        cu.dy = T.dy;
        cu.dt = 0;
        cu.ot = 1;

        if (this.startt === 0.0 && this.endt === 1.0) {
            bu.dt = 0;
            bu.ot = 1;
            this.bodyMesh.visible = true;
            this.capMesh.visible = false;
        } else if (this.endt === 1.0) {
            if (this.startt !== 1.0) {
                bu.dt = -1;
                bu.ot = -this.startt;
                this.bodyMesh.visible = true;
            } else {
                this.bodyMesh.visible = false;
            }
            const p = this.curve.pointAt(this.startt);
            cu.ox = ox0 + p.x * T.dx;
            cu.oy = oy0 + p.y * T.dy;
            this.capMesh.visible = true;
        } else if (this.startt === 0.0) {
            if (this.endt !== 0.0) {
                bu.dt = 1;
                bu.ot = this.endt;
                this.bodyMesh.visible = true;
            } else {
                this.bodyMesh.visible = false;
            }
            const p = this.curve.pointAt(this.endt);
            cu.ox = ox0 + p.x * T.dx;
            cu.oy = oy0 + p.y * T.dy;
            this.capMesh.visible = true;
        } else {
            console.error("can't snake both end of slider");
        }
    }

    destroy(options) {
        try {
            if (this.bodyGeom) this.bodyGeom.destroy();
        } catch (e) { /* ignore */ }
        this.bodyGeom = null;
        try {
            if (this.bodyShader) this.bodyShader.destroy();
        } catch (e) { /* ignore */ }
        try {
            if (this.capShader) this.capShader.destroy();
        } catch (e) { /* ignore */ }
        this.bodyShader = this.capShader = null;
        this.bodyMesh = this.capMesh = null;
        super.destroy(options);
    }
}
