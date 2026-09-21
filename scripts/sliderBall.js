// Procedural osu!-style slider ball texture (replaces the atlas
// sliderb.png, whose center is ~12% opaque black: the clipped body edge
// shows straight through the "thumb", reading as the slider being cut
// off underneath it). Stable's ball is an opaque white core with subtle
// shading, a thin gray rim and a soft feathered edge, sized to the track
// width; this matches that look and also fixes the green cursor-predict
// dot (black texture x green tint rendered black).
//
// Pure function (no PIXI import) so tests can assert the profile
// headlessly. Returns premultiplied RGBA: declare alphaMode
// 'premultiplied-alpha' on upload, or v8 double-premultiplies and the
// ball renders dark (same lesson as the slider gradient texture).
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
