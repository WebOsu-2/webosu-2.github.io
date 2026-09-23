/*
 * custom class, extends PIXI.Container
 * Renders an osu! slider with lazer's two-pass path pipeline:
 *
 *  1. coverage prepass: one quad per path segment (extended by the body
 *     radius at both ends so round caps/joins emerge from the field),
 *     drawn with blend equation MAX (ONE/ONE) into a per-slider
 *     RenderTexture. Each fragment writes
 *         clamp(1 - dstToLine(segA, segB, fragPos) / radius, 0, 1)
 *     so the MAX over overlapping quads is the fragment closest to the
 *     path: an exact union of capsules. Overlapping legs, kinks and
 *     folds resolve on the GPU; no CPU boolean geometry, no miter/trim
 *     bookkeeping, no double-drawn borders crossing a fold's interior.
 *
 *  2. composite: one static quad over the path bounds samples the
 *     coverage texture and maps (1 - coverage) through the gradient LUT
 *     (border / inner fill / rim blur), scaled by the slider's global
 *     alpha. The LUT is not monotone (interior alpha dips toward the
 *     center), so colors must be composed AFTER the max, never blended
 *     with it.
 *
 * Snaking rebuilds the prepass quads from the partial path and only
 * re-renders the coverage texture when the geometry (or its pixel size)
 * changes. The playfield transform lives entirely in the composite
 * vertex shader, so window resizes affect only the texture size.
 * Per-frame work for a complete slider is uniform updates only.
 *
 * constructor params
 *   curve: { curve: [{x,y,t}], pointAt(t) }, in osu pixels
 *   radius: radius of hit circle, in osu! pixels
 *   tintid: color slot index
 */

import * as PIXI from './lib/pixi.mjs';

// GLSL ES 1.00 (no #version: v8 rewrites `in`/`out`/`texture`/`finalColor`
// through WebGL1 compatibility defines). Fragment sources must start with
// `precision highp` or v8 prepends its default mediump: the distance field
// would otherwise quantize visibly on high-DPI screens.

// Pass 1 vertex: bounds -> NDC so the quad fills the coverage texture.
// gl_Position.w = 1, so the path/segment varyings interpolate exactly.
const prepassVertexSrc = `
in vec2 position;
in vec2 segA;
in vec2 segB;
out vec2 vPath;
out vec2 vSegA;
out vec2 vSegB;
uniform float scaleX;
uniform float scaleY;
uniform float offX;
uniform float offY;
void main() {
    vPath = position;
    vSegA = segA;
    vSegB = segB;
    gl_Position = vec4(position.x * scaleX + offX, position.y * scaleY + offY, 0.0, 1.0);
}`;

// Pass 1 fragment: coverage of this segment's capsule (verbatim port of
// osu-framework sh_PathPrepass's dstToLine + falloff). MAX blending
// across overlapping fragments picks the smallest distance-to-path.
const prepassFragmentSrc = `precision highp float;
in vec2 vPath;
in vec2 vSegA;
in vec2 vSegB;
uniform float radius;
out vec4 finalColor;

float dstToLine(vec2 p, vec2 a, vec2 b) {
    vec2 dir = b - a;
    float len2 = dot(dir, dir);
    if (len2 < 1e-6) return distance(p, a);
    float t = clamp(dot(p - a, dir), 0.0, len2) / len2;
    return distance(p, a + dir * t);
}

void main() {
    float cov = clamp(1.0 - dstToLine(vPath, vSegA, vSegB) / radius, 0.0, 1.0);
    if (cov <= 0.0) discard;
    finalColor = vec4(cov, cov, cov, cov);
}`;

// Pass 2 vertex: the usual playfield transform of the bounds quad.
const vertexSrc = `
in vec2 position;
in vec2 aUv;
out vec2 vUv;
uniform float dx;
uniform float dy;
uniform float ox;
uniform float oy;
void main() {
    vUv = aUv;
    gl_Position = vec4(position.x * dx + ox, position.y * dy + oy, 0.0, 1.0);
}`;

// Pass 2 fragment: coverage -> gradient LUT. The cutout at cov == 0
// keeps the body from touching fragments outside the path (lazer's
// `dstFromEdge > 0` cutout); the LUT already fades to alpha 0 at the
// rim, so the edge stays seamless.
const fragmentSrc = `precision highp float;
in vec2 vUv;
uniform sampler2D uCoverage;
uniform sampler2D uSampler2;
uniform float alpha;
uniform float texturepos;
out vec4 finalColor;
void main() {
    float cov = texture(uCoverage, vUv).r;
    if (cov <= 0.0) discard;
    finalColor = alpha * texture(uSampler2, vec2(1.0 - cov, texturepos));
}`;

function makeCompositeUniforms() {
    return new PIXI.UniformGroup({
        alpha: { value: 1, type: 'f32' },
        texturepos: { value: 0, type: 'f32' },
        dx: { value: 1, type: 'f32' },
        dy: { value: -1, type: 'f32' },
        ox: { value: 0, type: 'f32' },
        oy: { value: 0, type: 'f32' },
    });
}

// Prepass projection (bounds -> NDC) depends only on the static path
// bounds, never on the playfield transform, so these are set once.
function makePrepassUniforms(b, radius) {
    // degenerate bounds (radius 0) would otherwise divide by zero
    const sx = b.x1 > b.x0 ? 2 / (b.x1 - b.x0) : 0;
    const sy = b.y1 > b.y0 ? 2 / (b.y1 - b.y0) : 0;
    return new PIXI.UniformGroup({
        scaleX: { value: sx, type: 'f32' },
        scaleY: { value: sy, type: 'f32' },
        offX: { value: -1 - b.x0 * sx, type: 'f32' },
        offY: { value: -1 - b.y0 * sy, type: 'f32' },
        radius: { value: radius, type: 'f32' },
    });
}

// osu!-style snaking: the visible prepass geometry is rebuilt from the
// truncated point list (partial path) instead of clipping the full body
// in the shader, so the moving head is a true round cap of the same
// distance field — seamless by construction, like lazer's SliderBody.
export function partialPoints(pts, fromT, toT) {
    // pts sorted by .t (curve grid); keeps [fromT, toT] with exact
    // interpolated boundary points so caps land precisely on the head.
    const out = [];
    const n = pts.length;
    if (!n) return out;
    const at = (t) => {
        if (t <= pts[0].t) return { x: pts[0].x, y: pts[0].y, t };
        const last = pts[n - 1];
        if (t >= last.t) return { x: last.x, y: last.y, t };
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (pts[mid].t <= t) lo = mid; else hi = mid;
        }
        const a = pts[lo], b = pts[hi];
        const span = b.t - a.t;
        const u = span > 1e-12 ? (t - a.t) / span : 0;
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, t };
    };
    if (fromT > pts[0].t + 1e-12) out.push(at(fromT));
    for (let i = 0; i < n; ++i)
        if (pts[i].t >= fromT && pts[i].t <= toT) out.push(pts[i]);
    if (toT < pts[n - 1].t - 1e-12) out.push(at(toT));
    // An on-grid cut duplicates that grid point (kept + interpolated);
    // drop exact consecutive duplicates (same-position folds with
    // different t are kept: only all-equal triples merge).
    return out.filter((p, i) => i === 0 ||
        Math.abs(p.x - out[i - 1].x) > 1e-9 ||
        Math.abs(p.y - out[i - 1].y) > 1e-9 ||
        Math.abs(p.t - out[i - 1].t) > 1e-12);
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

// Plain { pos, segA, segB, index, quads } (no GL objects): one quad per
// segment, extended by radius at both ends. The rectangle of segment AB
// extended by +/-radius along its direction contains the whole capsule
// (round caps included: |component| of any corner offset is at least
// radius per axis), so the union of the quads covers every point within
// radius of the path — the GPU max of the per-fragment distance field
// over them is the exact slider shape. Consecutive near-coincident
// points are dropped (their neighbors' quads cover the joint disc), and
// a fully degenerate curve falls back to a tiny segment so we never
// emit an empty mesh or NaN normals.
function capsuleQuads(pts0, radius) {
    let pts = [];
    for (let i = 0; i < pts0.length; ++i)
        if (i === 0 || Math.abs(pts0[i].x - pts0[i - 1].x) > 0.00001 ||
                Math.abs(pts0[i].y - pts0[i - 1].y) > 0.00001)
            pts.push(pts0[i]);
    if (pts.length < 2) {
        const p0 = pts0[0] || { x: 0, y: 0 };
        pts = [{ x: p0.x, y: p0.y }, { x: p0.x + 0.001, y: p0.y }];
    }
    const quads = pts.length - 1;
    const pos = new Float32Array(quads * 8);
    const segA = new Float32Array(quads * 8);
    const segB = new Float32Array(quads * 8);
    const index = new Uint32Array(quads * 6);
    for (let k = 0; k < quads; ++k) {
        const p0 = pts[k], p1 = pts[k + 1];
        const dx = p1.x - p0.x, dy = p1.y - p0.y;
        const len = Math.hypot(dx, dy);
        const inv = radius / len;
        const ux = dx * inv, uy = dy * inv;   // unit direction * radius
        const nx = -uy, ny = ux;              // unit normal * radius
        const a0x = p0.x - ux, a0y = p0.y - uy; // segment ends extended +/-radius
        const a1x = p1.x + ux, a1y = p1.y + uy;
        const v = k * 8;
        pos[v] = a0x - nx; pos[v + 1] = a0y - ny;
        pos[v + 2] = a0x + nx; pos[v + 3] = a0y + ny;
        pos[v + 4] = a1x - nx; pos[v + 5] = a1y - ny;
        pos[v + 6] = a1x + nx; pos[v + 7] = a1y + ny;
        for (let c = 0; c < 4; ++c) {
            segA[v + 2 * c] = p0.x; segA[v + 2 * c + 1] = p0.y;
            segB[v + 2 * c] = p1.x; segB[v + 2 * c + 1] = p1.y;
        }
        const t = k * 6, w = k * 4;
        index[t] = w; index[t + 1] = w + 1; index[t + 2] = w + 2;
        index[t + 3] = w + 2; index[t + 4] = w + 1; index[t + 5] = w + 3;
    }
    return { pos, segA, segB, index, quads };
}

function boundsOf(pos) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pos.length; i += 2) {
        if (pos[i] < x0) x0 = pos[i];
        if (pos[i] > x1) x1 = pos[i];
        if (pos[i + 1] < y0) y0 = pos[i + 1];
        if (pos[i + 1] > y1) y1 = pos[i + 1];
    }
    return { x0, y0, x1, y1 };
}

// Prepass buffers are sized for the full path: a partial path never has
// more points than the grid it is cut from (partialPoints keeps <= n).
function makePrepassGeometry(quadCap) {
    const g = new PIXI.Geometry();
    g.addAttribute('position', new Float32Array(quadCap * 8), 2);
    g.addAttribute('segA', new Float32Array(quadCap * 8), 2);
    g.addAttribute('segB', new Float32Array(quadCap * 8), 2);
    g.addIndex(new Uint32Array(quadCap * 6));
    return g;
}

function makeCompositeGeometry(b) {
    const g = new PIXI.Geometry();
    g.addAttribute('position', new Float32Array([
        b.x0, b.y0, b.x1, b.y0, b.x0, b.y1, b.x1, b.y1,
    ]), 2);
    g.addAttribute('aUv', new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2);
    g.addIndex([0, 1, 2, 2, 1, 3]);
    return g;
}

function getRenderer() {
    try {
        if (typeof window === 'undefined' || !window.app) return null;
        return window.app.renderer || null;
    } catch (e) {
        return null;
    }
}

// Coverage texture pixel size: one texel per device pixel of playfield
// (so the composite needs no resolution over its bilinear upscale), with
// a hard cap so a playfield-spanning slider on a huge display cannot
// allocate an absurd texture. Falls back to 1 texel per osu pixel until
// the renderer is known (headless tests, app still booting); the size is
// re-checked every sync, so the texture upgrades itself in place.
const MAX_RT_DIM = 2048;
function coverageSize(bounds, renderer, T) {
    let s = 1;
    if (renderer && T) {
        const rw = Number(renderer.width), rh = Number(renderer.height);
        if (rw > 0 && rh > 0)
            s = Math.max(Math.abs(T.dx) * rw / 2, Math.abs(T.dy) * rh / 2);
    }
    if (!(s > 0)) s = 1;
    const w = Math.min(MAX_RT_DIM, Math.max(1, Math.ceil((bounds.x1 - bounds.x0) * s)));
    const h = Math.min(MAX_RT_DIM, Math.max(1, Math.ceil((bounds.y1 - bounds.y0) * s)));
    return [w, h];
}

// Updated SliderMesh class using ES6 class syntax and extending PIXI.Container.
export default class SliderMesh extends PIXI.Container {
    constructor(curve, radius, tintid) {
        super();
        this.curve = curve;
        this.radius = radius;
        this.tintid = tintid;
        this.alpha = 1.0;
        this.startt = 0.0;
        this.endt = 1.0;

        // Fixed-capacity prepass buffers; the full path is the largest
        // state (partial paths are cut from the same grid).
        this.quadCap = Math.max(1, Math.max(2, curve.curve.length) - 1);
        const full = capsuleQuads(curve.curve, radius);
        this.bounds = boundsOf(full.pos);
        this.prepassGeom = makePrepassGeometry(this.quadCap);
        this.prepassMesh = null;
        this.prepassShader = null;
        this.prepassRoot = null;

        this.mesh = null;
        this.meshShader = null;
        this.meshGeom = null;
        this.rt = null;
        this.rtW = 0;
        this.rtH = 0;

        this.geoKey = null;  // "full" | "startt,endt": what the prepass shows
        this.rtDirty = true; // coverage texture must be re-rendered
        this.uploadCapsules(full);
        this.geoKey = "full";
        this.ensureMeshes();
    }

    // Shared GPU state lives on the prototype (initialize/resetTransform
    // are called on SliderMesh.prototype, mirroring the old pattern);
    // per-slider meshes build lazily once it exists.
    ensureMeshes() {
        if (this.mesh) return;
        const P = SliderMesh.prototype;
        if (!P.glProgram || !P.prepassProgram || !P.sliderTexture) return;

        this.prepassShader = new PIXI.Shader({
            glProgram: P.prepassProgram,
            resources: {
                prepassUniforms: makePrepassUniforms(this.bounds, this.radius),
            },
        });
        this.prepassMesh = new PIXI.Mesh({
            geometry: this.prepassGeom,
            shader: this.prepassShader,
        });
        // MAX blending merges overlapping capsules into one coverage
        // field (ONE/ONE/MAX); the stage never sees this container.
        this.prepassMesh.blendMode = 'max';
        this.prepassRoot = new PIXI.Container();
        this.prepassRoot.addChild(this.prepassMesh);

        this.ensureRenderTarget();
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
        if (!P.prepassProgram) {
            P.prepassProgram = new PIXI.GlProgram({ name: 'slider-prepass', vertex: prepassVertexSrc, fragment: prepassFragmentSrc });
        }
        P.baseTransform = transform;
    }

    resetTransform(transform) {
        SliderMesh.prototype.baseTransform = transform;
    }

    // Push per-frame state (called every frame from updateSlider): the
    // visibility/geometry choice for startt/endt, then the coverage
    // re-render only when the prepass actually changed. The playfield
    // transform is applied by the composite vertex shader, so a resize
    // never needs a new coverage texture unless its pixel size changed.
    sync() {
        if (this.destroyed) return;
        this.ensureMeshes();
        const T = SliderMesh.prototype.baseTransform;
        if (!T || !this.mesh) return;

        let show = true;
        let fromT = null, toT = null; // fromT === null: the full path
        if (this.startt === 0.0 && this.endt === 1.0) {
            // complete slider: full path
        } else if (this.endt === 1.0) {
            if (this.startt !== 1.0) { fromT = this.startt; toT = 1.0; }
            else show = false;
        } else if (this.startt === 0.0) {
            if (this.endt !== 0.0) { fromT = 0.0; toT = this.endt; }
            else show = false;
        } else {
            console.error("can't snake both end of slider");
            show = false;
        }
        this.mesh.visible = show;
        if (!show) return;

        if (this.rebuildGeometry(fromT, toT)) this.rtDirty = true;
        this.ensureRenderTarget();

        const u = this.meshShader.resources.sliderUniforms.uniforms;
        u.alpha = this.alpha;
        // texel center of this slider's LUT row (linear filtering would
        // otherwise blend it half-way into the neighboring combo row)
        u.texturepos = (this.tintid + 0.5) / SliderMesh.prototype.ncolors;
        u.dx = T.dx;
        u.dy = T.dy;
        u.ox = T.ox;
        u.oy = T.oy;

        if (this.rtDirty) {
            const renderer = getRenderer();
            if (renderer) {
                renderer.render({
                    container: this.prepassRoot,
                    target: this.rt,
                    clear: true,
                    clearColor: 0x000000,
                });
                this.rtDirty = false;
            }
        }
    }

    // Show the prepass for [fromT, toT] (null = full path) unless it
    // already shows it; returns true if the geometry changed.
    rebuildGeometry(fromT, toT) {
        const key = fromT === null ? "full" : fromT + "," + toT;
        if (key === this.geoKey) return false;
        const pts = fromT === null ? this.curve.curve
            : partialPoints(this.curve.curve, fromT, toT);
        const out = capsuleQuads(pts, this.radius);
        // Cannot happen within the capacity bounds (a partial path never
        // exceeds the grid it is cut from); keeps the previous frame.
        if (out.quads > this.quadCap) return false;
        this.uploadCapsules(out);
        this.geoKey = key;
        return true;
    }

    uploadCapsules(out) {
        const g = this.prepassGeom;
        const pos = g.getBuffer('position').data;
        const segA = g.getBuffer('segA').data;
        const segB = g.getBuffer('segB').data;
        pos.set(out.pos);
        segA.set(out.segA);
        segB.set(out.segB);
        g.getBuffer('position').update();
        g.getBuffer('segA').update();
        g.getBuffer('segB').update();
        const idx = g.indexBuffer.data;
        idx.set(out.index);
        idx.fill(0, out.index.length); // unused slots degenerate to tris of one vertex
        g.indexBuffer.update();
    }

    // (Re)create the coverage texture when its pixel size changes — on
    // the first sync with a live renderer and on window/resolution
    // changes. The composite binds the texture, so it is rebuilt too.
    ensureRenderTarget() {
        const P = SliderMesh.prototype;
        const [w, h] = coverageSize(this.bounds, getRenderer(), P.baseTransform);
        if (this.rt && this.rtW === w && this.rtH === h) return;
        if (this.rt) {
            try { this.rt.destroy(true); } catch (e) { /* ignore */ }
        }
        this.rt = PIXI.RenderTexture.create({ width: w, height: h });
        this.rtW = w;
        this.rtH = h;
        this.buildComposite();
        this.rtDirty = true;
    }

    // The visible pass: bounds quad sampling the coverage texture
    // through the gradient LUT. Rebuilt whenever the coverage texture is
    // (the shader owns the texture reference).
    buildComposite() {
        const P = SliderMesh.prototype;
        const drop = (mesh, shader, geom) => {
            try { if (mesh) this.removeChild(mesh); } catch (e) { /* ignore */ }
            try { if (mesh) mesh.destroy(); } catch (e) { /* ignore */ }
            try { if (shader) shader.destroy(); } catch (e) { /* ignore */ }
            try { if (geom) geom.destroy(); } catch (e) { /* ignore */ }
        };
        drop(this.mesh, this.meshShader, this.meshGeom);
        this.mesh = null;
        this.meshShader = null;
        this.meshGeom = null;

        this.meshGeom = makeCompositeGeometry(this.bounds);
        this.meshShader = new PIXI.Shader({
            glProgram: P.glProgram,
            resources: {
                sliderUniforms: makeCompositeUniforms(),
                uCoverage: this.rt.source,
                uSampler2: P.sliderTexture.source,
            },
        });
        this.mesh = new PIXI.Mesh({ geometry: this.meshGeom, shader: this.meshShader });
        this.mesh.visible = false;
        this.addChild(this.mesh);
    }

    destroy(options) {
        const drop = (fn) => { try { fn(); } catch (e) { /* ignore */ } };
        drop(() => { if (this.mesh) this.removeChild(this.mesh); });
        drop(() => { if (this.mesh) this.mesh.destroy(); });
        this.mesh = null;
        drop(() => { if (this.meshShader) this.meshShader.destroy(); });
        this.meshShader = null;
        drop(() => { if (this.meshGeom) this.meshGeom.destroy(); });
        this.meshGeom = null;
        drop(() => { if (this.prepassMesh) this.prepassMesh.destroy(); });
        this.prepassMesh = null;
        drop(() => { if (this.prepassRoot) this.prepassRoot.destroy(); });
        this.prepassRoot = null;
        drop(() => { if (this.prepassShader) this.prepassShader.destroy(); });
        this.prepassShader = null;
        drop(() => { if (this.prepassGeom) this.prepassGeom.destroy(); });
        this.prepassGeom = null;
        drop(() => { if (this.rt) this.rt.destroy(true); }); // true: free the GPU source too
        this.rt = null;
        super.destroy(options);
    }
}
