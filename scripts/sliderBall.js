// Procedural osu!-style slider ball + cursor trail textures.
//
// The atlas sliderb.png center is ~12% opaque black: the clipped body
// edge shows straight through the "thumb", reading as the slider being
// cut off underneath it. Stable's ball is an opaque white core with
// subtle shading, a thin gray rim and a soft feathered edge, sized to
// the track width.
//
// Pure functions (no PIXI import) so tests can assert the profiles
// headlessly. Buffers are premultiplied RGBA: declare alphaMode
// 'premultiplied-alpha' on upload, or v8 double-premultiplies and the
// sprite renders dark (same lesson as the slider gradient texture).
export const BALL_SIZE = 256;
const CENTER = (BALL_SIZE - 1) / 2; // 127.5: pixel-center symmetric

export function makeSliderBallData() {
    const S = BALL_SIZE;
    const buff = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; ++y) {
        for (let x = 0; x < S; ++x) {
            const d = Math.hypot(x - CENTER, y - CENTER);
            let rgb, alpha;
            if (d <= 96) {
                // opaque core, barely-there radial shading (255 -> 237)
                const u = d / 96;
                rgb = Math.round(255 - 18 * u * u);
                alpha = 255;
            } else if (d <= 108) {
                // thin gray rim (237 -> 160), still opaque
                const u = (d - 96) / 12;
                rgb = Math.round(237 - 77 * u);
                alpha = 255;
            } else if (d < 126) {
                // soft feathered edge to transparent
                const u = (d - 108) / 18;
                rgb = 160;
                alpha = Math.round(255 * (1 - u));
            } else {
                rgb = 0;
                alpha = 0;
            }
            // premultiply (white/gray source: rgb >= alpha blend base)
            const o = (y * S + x) * 4;
            buff[o] = Math.round(rgb * alpha / 255);
            buff[o + 1] = Math.round(rgb * alpha / 255);
            buff[o + 2] = Math.round(rgb * alpha / 255);
            buff[o + 3] = alpha;
        }
    }
    return { data: buff, width: S, height: S };
}

// 1D radial profile of the ball above, for the slider head/tail cap
// mesh: the cap shader samples (dist, texturepos) like the body
// gradient (u = center->edge, v = row), so the ball becomes a single
// opaque row. Opaque core to 0.84R, gray rim, feathered edge to 0.98R:
// the growing snake tip then renders as a solid ball head hiding the
// clip edge, instead of a translucent disk with a visible cut behind it.
export const BALL_RAMP_WIDTH = 256;
export function makeSliderBallRamp() {
    const W = BALL_RAMP_WIDTH;
    const buff = new Uint8Array(W * 4);
    for (let i = 0; i < W; ++i) {
        const u = i / (W - 1); // 0 = center, 1 = rim
        const d = u * 128; // match makeSliderBallData radii (px at 256)
        let rgb, alpha;
        if (d <= 96) {
            const k = d / 96;
            rgb = Math.round(255 - 18 * k * k);
            alpha = 255;
        } else if (d <= 108) {
            rgb = Math.round(237 - 77 * (d - 96) / 12);
            alpha = 255;
        } else if (d < 126) {
            rgb = 160;
            alpha = Math.round(255 * (126 - d) / 18);
        } else {
            rgb = 0;
            alpha = 0;
        }
        buff[i * 4] = Math.round(rgb * alpha / 255);
        buff[i * 4 + 1] = Math.round(rgb * alpha / 255);
        buff[i * 4 + 2] = Math.round(rgb * alpha / 255);
        buff[i * 4 + 3] = alpha;
    }
    return { data: buff, width: W, height: 1 };
}

// Alpha tightening for the baked cursor art (see initgame): maps soft
// mid-tone alpha toward a crisp edge while leaving fully transparent
// and fully opaque pixels exactly intact, so the cursor shape is
// unchanged but downscaled cursors render sharp instead of muddy.
// Pure math (headless-testable); canvas plumbing lives in initgame.
export function crispAlpha(a) {
    if (a <= 0 || a >= 255) return a;
    const u = a / 255;
    // smoothstep(0.3, 0.7): gentler than a hard cutoff, keeps a ~2px AA
    // ramp at skin resolution instead of the baked ~26px mush
    const t = Math.max(0, Math.min(1, (u - 0.3) / 0.4));
    return Math.round(255 * (t * t * (3 - 2 * t)));
}

// Soft round dot for the cursor trail (stable fades small dots behind
// the cursor). Alpha falls off smoothly; same premultiplied contract.
export const TRAIL_SIZE = 64;
export function makeTrailData() {
    const S = TRAIL_SIZE;
    const buff = new Uint8Array(S * S * 4);
    const c = (S - 1) / 2;
    for (let y = 0; y < S; ++y) {
        for (let x = 0; x < S; ++x) {
            const d = Math.hypot(x - c, y - c) / c; // 0 center .. ~1.42 corner
            // solid-ish core fading to transparent at the rim
            const a = d >= 1 ? 0 : Math.round(255 * Math.pow(1 - d * d, 1.5));
            const o = (y * S + x) * 4;
            buff[o] = a;
            buff[o + 1] = a;
            buff[o + 2] = a;
            buff[o + 3] = a;
        }
    }
    return { data: buff, width: S, height: S };
}
