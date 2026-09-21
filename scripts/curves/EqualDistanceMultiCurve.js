import Curve from './Curve.js';

export const CURVE_POINTS_SEPERATION = 3;

// Adapted from EqualDistanceMultiCurve.java from github://itdelatrisu/opsu
export default class EqualDistanceMultiCurve {
    constructor(hit) {
        Curve.call(this, hit);
        this.ncurve = 0;
        this.startAngle = 0;
        this.endAngle = 0;
    }
    init(curves) {
        if (!curves || !curves.length || !curves[0] || !curves[0].curve || !curves[0].curve.length) {
            // Degenerate slider (e.g. all control points coincident):
            // collapse to the head position instead of throwing, so one
            // troll/corrupt slider can't make the whole map unloadable.
            const hx = (this.hitObject && this.hitObject.x) || 0;
            const hy = (this.hitObject && this.hitObject.y) || 0;
            this.ncurve = 1;
            this.curve = [{ x: hx, y: hy, t: 0 }, { x: hx, y: hy, t: 1 }];
            return;
        }
        var pixelLength = this.hitObject.pixelLength; // This is the expected value of length
        if (pixelLength < 0) console.error("osu curve: negative slider length");
        // number of segments, which have approximately same length
        var gridCount = Math.floor(pixelLength / CURVE_POINTS_SEPERATION) + 1;
        // Bezier-junction distances along the raw path. Path kinks live
        // exactly here, so they become resample vertices: otherwise a
        // resample chord straddles the kink and its wide quad overlaps
        // neighboring quads (visible as streaks/doubled regions).
        var junctions = [0];
        var acc = 0;
        for (var ci = 0; ci < curves.length; ++ci) {
            acc += curves[ci].totalDistance || 0;
            junctions.push(acc);
        }
        // sample distances: uniform grid plus exact kinks
        var dists = [];
        for (var i = 0; i <= gridCount; i++) dists.push(i * pixelLength / gridCount);
        for (var ji = 0; ji < junctions.length; ++ji) {
            var jd = junctions[ji];
            if (jd < 0 || jd > pixelLength) continue;
            var covered = false;
            for (var di = 0; di < dists.length; ++di) {
                if (Math.abs(dists[di] - jd) < 1e-6) { covered = true; break; }
            }
            if (!covered) dists.push(jd);
        }
        dists.sort(function (a, b) { return a - b; });

        this.curve = [];
        var distanceAt = 0; // accumulated length of new curve
        var curPoint = 0;
        var curCurveIndex = 0;
        var curCurve = curves[0]; // current pointer of raw curve array
        var lastCurve = curCurve.curve[0];
        var lastDistanceAt = 0;
        var exhausted = false;

        for (var si = 0; si < dists.length; ++si) {
            var prefDistance = dists[si]; // expected current accumulated length
            while (!exhausted && distanceAt < prefDistance) {
                lastDistanceAt = distanceAt;
                lastCurve = curCurve.curve[curPoint];
                curPoint++;

                if (curPoint >= curCurve.ncurve) {
                    if (curCurveIndex < curves.length - 1) {
                        curCurveIndex++;
                        curCurve = curves[curCurveIndex];
                        curPoint = 0;
                    } else {
                        curPoint = curCurve.ncurve - 1;
                        if (lastDistanceAt === distanceAt) {
                            if (distanceAt < pixelLength * 0.97) {
                                console.warn("[curve] L/B shorter than given", distanceAt / pixelLength);
                            }
                            // out of points even though the preferred distance hasn't been reached
                            exhausted = true;
                            break;
                        }
                    }
                }
                if (!exhausted) distanceAt += curCurve.curveDistance[curPoint];
            }
            if (exhausted) break;
            var thisCurve = curCurve.curve[curPoint];

            // linear interpolate between lastCurve & thisCurve
            // this can always be done when lastCurve != thisCurve, since lastCurve is always available
            // lastDistanceAt <= prefDistance <= distanceAt
            var t = prefDistance / pixelLength;
            if (lastCurve == thisCurve) {
                // copy (don't alias the raw point): raw Bezier points have
                // no `t`, and an undefined t becomes NaN in the slider
                // vertex buffer, breaking snake in/out clipping.
                this.curve.push({ x: thisCurve.x, y: thisCurve.y, t: t });
            }
            else {
                const EPSILON = 0.001;
                if (Math.abs(distanceAt - lastDistanceAt) < EPSILON) {
                    // Fall back to a simple average along this segment or re-use the previous point.
                    this.curve.push({
                        x: (lastCurve.x + thisCurve.x) / 2,
                        y: (lastCurve.y + thisCurve.y) / 2,
                        t: t
                    });
                } else {
                    // For more robust interpolation, consider using Catmull-Rom interpolation if neighboring points exist.
                    // For simplicity, using linear interpolation as a base here.
                    let u = (prefDistance - lastDistanceAt) / (distanceAt - lastDistanceAt);
                    this.curve.push({
                        x: Curve.lerp(lastCurve.x, thisCurve.x, u),
                        y: Curve.lerp(lastCurve.y, thisCurve.y, u),
                        t: t
                    });
                }
            }
        }
        if (!this.curve.length) {
            const hx = (this.hitObject && this.hitObject.x) || 0;
            const hy = (this.hitObject && this.hitObject.y) || 0;
            this.curve = [{ x: hx, y: hy, t: 0 }, { x: hx, y: hy, t: 1 }];
        }
        // segment count follows the actual points (kinks add a few)
        this.ncurve = this.curve.length - 1;
    }
    pointAt(t) {
        // binary search on curve parameter (points are not uniformly
        // spaced once kinks join the grid)
        if (!(t > 0)) {
            const p0 = this.curve[0];
            return { x: p0.x, y: p0.y };
        }
        const last = this.curve[this.curve.length - 1];
        if (t >= 1) return { x: last.x, y: last.y };
        let lo = 0, hi = this.curve.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (this.curve[mid].t <= t) lo = mid; else hi = mid;
        }
        const a = this.curve[lo], b = this.curve[hi];
        const span = b.t - a.t;
        const u = span > 1e-12 ? (t - a.t) / span : 0;
        return {
            x: Curve.lerp(a.x, b.x, u),
            y: Curve.lerp(a.y, b.y, u)
        };
    }
}
