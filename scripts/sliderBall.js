// Procedural osu!-style slider ball + cursor trail textures.
//
// The atlas sliderb.png center is ~12% opaque black: the clipped body
// edge shows straight through the "thumb", reading as the slider being
// cut off underneath it. Stable's ball is an opaque white core with
// pronounced top-light shading (bright crown fading to a dim base), a
// soft specular sheen upper-left, a defined gray rim and a feathered
// edge, sized to the track width. Shading stays grayscale (stable's
// ball is untinted white); tests pin the core near-white.
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
                // opaque core: radial falloff (255 -> 237), pronounced
                // top-light gradient (crown +20, base -20, fading out at
                // the rim so it meets the gray rim exactly), plus a soft
                // specular sheen upper-left
                const u = d / 96;
                const dir = ((CENTER - y) / 96) * (1 - u * u) * 20;
                const hx = x - (CENTER - 30), hy = y - (CENTER - 38);
                const hd = Math.hypot(hx, hy) / 55;
                const sheen = hd >= 1 ? 0 : 8 * (1 - hd * hd) * (1 - hd * hd);
                rgb = Math.round(Math.min(255, Math.max(0, 255 - 18 * u * u + dir + sheen)));
                alpha = 255;
            } else if (d <= 108) {
                // defined gray rim (237 -> 140), still opaque
                const u = (d - 96) / 12;
                rgb = Math.round(237 - 97 * u);
                alpha = 255;
            } else if (d < 126) {
                // soft feathered edge to transparent
                const u = (d - 108) / 18;
                rgb = 140;
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
