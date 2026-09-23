// osu!standard gameplay-mod resolution and legacy-coordinate transforms.

export const PLAYFIELD_HEIGHT = 384;

const RATE_MODS = [
    { flag: 'doubletime', rate: 1.5, preservePitch: true },
    { flag: 'nightcore', rate: 1.5, preservePitch: false },
    { flag: 'halftime', rate: 0.75, preservePitch: true },
    { flag: 'daycore', rate: 0.75, preservePitch: false },
];

// Persisted settings can predate the current exclusivity rules (or be edited
// by hand), so gameplay must still resolve to one valid combination. The UI
// order is also the defensive priority order.
export function resolveGameplayMods(flags = {}) {
    const selected = RATE_MODS.find(mod => !!flags[mod.flag]) || null;
    const hardrock = !!flags.hardrock;
    // Match playerActions.js's deterministic priority for corrupt input
    // states: an explicit autoplay flag wins over the assisted input modes.
    const inputMode = flags.autoplay ? 'autoplay'
        : flags.relax ? 'relax'
        : flags.autopilot ? 'autopilot'
        : null;
    return {
        rateMod: selected ? selected.flag : null,
        playbackRate: selected ? selected.rate : 1,
        preservePitch: selected ? selected.preservePitch : true,
        // HR and EZ are incompatible. Prefer HR if corrupt state enabled both.
        hardrock,
        easy: !hardrock && !!flags.easy,
        inputMode,
    };
}

function reflectPointY(point) {
    return { x: point.x, y: PLAYFIELD_HEIGHT - point.y };
}

function pointAtCurve(points, value) {
    if (!points.length) return { x: 0, y: 0, t: 0 };
    const t = Math.max(0, Math.min(1, Number(value) || 0));
    if (t <= 0 || points.length === 1) {
        const first = points[0];
        return { x: first.x, y: first.y, t };
    }
    const last = points[points.length - 1];
    if (t >= 1) return { x: last.x, y: last.y, t };

    let lo = 0;
    let hi = points.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        const midT = Number.isFinite(points[mid].t)
            ? points[mid].t
            : mid / (points.length - 1);
        if (midT <= t) lo = mid;
        else hi = mid;
    }
    const a = points[lo];
    const b = points[hi];
    const aT = Number.isFinite(a.t) ? a.t : lo / (points.length - 1);
    const bT = Number.isFinite(b.t) ? b.t : hi / (points.length - 1);
    const span = bT - aT;
    const u = span > 1e-12 ? (t - aT) / span : 0;
    return {
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        t,
    };
}

function reflectCurve(curve, hit) {
    if (!curve) return curve;

    const reflected = Object.assign(Object.create(Object.getPrototypeOf(curve)), curve);
    reflected.curve = (curve.curve || []).map(point => ({
        ...point,
        ...reflectPointY(point),
    }));
    reflected.hitObject = hit;

    if (typeof curve.pointAt === 'function') {
        if (reflected.curve.length) {
            reflected.pointAt = t => pointAtCurve(reflected.curve, t);
        } else {
            const pointAt = curve.pointAt.bind(curve);
            reflected.pointAt = t => reflectPointY(pointAt(t));
        }
    }
    return reflected;
}

// osu!stable HR reflects the playfield across its horizontal axis (X-axis in
// stable terminology): X is unchanged and Y -> 384 - Y. Stacking has already
// been applied by Track.decode(), matching lazer's post-conversion mod order.
export function cloneHitForMods(source, mods) {
    const hit = Object.assign({}, source);
    if (!mods.hardrock) return hit;

    Object.assign(hit, reflectPointY(hit));
    if (hit.type === 'slider') {
        hit.keyframes = (hit.keyframes || []).map(reflectPointY);
        hit.curve = reflectCurve(hit.curve, hit);
    }
    return hit;
}
