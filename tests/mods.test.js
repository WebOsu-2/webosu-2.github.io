"use strict";
const H = require("./helpers");
const { resolveGameplayMods, cloneHitForMods } = H.loadModule("scripts/mods.js");

test("mods: rate variants resolve to one stable-compatible mode", () => {
    const cases = [
        [{}, null, 1, true],
        [{ doubletime: true }, "doubletime", 1.5, true],
        [{ nightcore: true }, "nightcore", 1.5, false],
        [{ halftime: true }, "halftime", 0.75, true],
        [{ daycore: true }, "daycore", 0.75, false],
    ];
    for (const [flags, name, rate, preservePitch] of cases) {
        const mods = resolveGameplayMods(flags);
        H.eq(mods.rateMod, name, `rate mod for ${JSON.stringify(flags)}`);
        H.eq(mods.playbackRate, rate, `rate for ${JSON.stringify(flags)}`);
        H.eq(mods.preservePitch, preservePitch, `pitch mode for ${JSON.stringify(flags)}`);
    }
});

test("mods: corrupt combinations resolve deterministically", () => {
    let mods = resolveGameplayMods({ doubletime: true, halftime: true, daycore: true });
    H.eq(mods.rateMod, "doubletime");
    H.eq(mods.playbackRate, 1.5);

    mods = resolveGameplayMods({ easy: true, hardrock: true });
    H.eq(mods.hardrock, true, "HR wins an invalid EZ+HR state");
    H.eq(mods.easy, false, "EZ is cleared");

    mods = resolveGameplayMods({ autoplay: true, relax: true, autopilot: true });
    H.eq(mods.inputMode, "autoplay", "AT wins an invalid assisted-input state");
});

test("mods: Hard Rock vertically reflects the complete slider without mutation", () => {
    const source = {
        type: "slider",
        x: 100,
        y: 50,
        time: 1234,
        keyframes: [{ x: 180, y: 70 }, { x: 260, y: 110 }],
        curve: {
            curve: [
                { x: 100, y: 50, t: 0 },
                { x: 180, y: 70, t: 0.5 },
                { x: 260, y: 110, t: 1 },
            ],
            pointAt(t) {
                const p = this.curve[Math.min(this.curve.length - 1, Math.round(t * 2))];
                // P-slider pointAt closures retain their pre-stacking geometry.
                return { x: p.x, y: p.y - 10 };
            },
        },
    };

    const hit = cloneHitForMods(source, { hardrock: true });
    H.eq(hit.x, 100, "HR preserves X");
    H.eq(hit.y, 334, "HR reflects Y around 192");
    H.eq(hit.keyframes[0].y, 314);
    H.eq(hit.keyframes[1].y, 274);
    H.eq(hit.curve.curve[1].y, 314);
    H.eq(hit.curve.pointAt(0.5).y, 314);
    H.eq(hit.curve.hitObject, hit, "curve points at the gameplay clone");
    H.assert(hit.curve !== source.curve, "curve is not shared");
    H.assert(hit.keyframes !== source.keyframes, "keyframes are not shared");

    H.eq(source.x, 100, "source X unchanged");
    H.eq(source.y, 50, "source Y unchanged");
    H.eq(source.keyframes[0].y, 70, "source keyframes unchanged");
    H.eq(source.curve.curve[1].y, 70, "source curve unchanged");
});
