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
// Returns plain { verts, index } (no GL objects): same triangulation as
// before, including degenerate-segment guards and inner joint bevels.
function curvePoints(curve0, radius) {
    let curve = [];
    for (let i = 0; i < curve0.length; ++i)
        if (i === 0 || Math.abs(curve0[i].x - curve0[i - 1].x) > 0.00001 || Math.abs(curve0[i].y - curve0[i - 1].y) > 0.00001)
            curve.push(curve0[i]);
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

        let n = 5 * i + 1;
        index.push(n - 6, n - 5, n - 1, n - 5, n - 1, n - 3);
        index.push(n - 6, n - 4, n - 1, n - 4, n - 1, n - 2);
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
        // Skip effectively-straight joints: the quads already tile cleanly,
        // and the sliver-thin fan/bevel triangles would rasterize as
        // streaks along the slider side.
        const sin = (dx1 * dy2 - dx2 * dy1) / (l1 * l2);
        if (Math.abs(sin) < 1e-3) continue;
        let t = sin > 0 ? 1 : -1;
        // The joint's curve parameter goes on the fan: the shader clips
        // snake in/out per-fragment on it, so fans left at t=0 would pop
        // in ahead of the snake head and the slider would fall apart.
        if (t > 0) {
            // outer (right-side) round join
            addArc(5 * i, 5 * i - 1, 5 * i + 2, curve[i].t);
            // inner (left-side) bevel: without this, tight curves show
            // a wedge-shaped gap ("corner cut off") on the inside.
            index.push(5 * i, 5 * i + 1, 5 * i - 2);
        }
        else if (t < 0) {
            addArc(5 * i, 5 * i + 1, 5 * i - 2, curve[i].t);
            index.push(5 * i, 5 * i - 1, 5 * i + 2);
        }
        // t == 0: straight joint, quads already meet cleanly; adding a
        // zero-area arc would only risk z-fighting flicker.
    }
    return { verts: vert, index: index };
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
        if (!P.glProgram || !P.sliderTexture || !P.circleGeom) return;
        this.bodyShader = makeShader(P.sliderTexture.source);
        this.capShader = makeShader(P.sliderTexture.source);
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
        cu.texturepos = this.tintid / this.ncolors;
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
