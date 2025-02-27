define(["curves/EqualDistanceMultiCurve", "curves/Bezier2"],
function(EqualDistanceMultiCurve, Bezier2) {
    class LinearBeizer extends EqualDistanceMultiCurve {
        constructor(hit, line) {
            super(hit); // calls the EqualDistanceMultiCurve constructor

            let beziers = [];
            let points = [];
            let lastPoi = null;
            // Loop through keyframes (starting at -1 for the initial point)
            for (let i = -1; i < hit.keyframes.length; i++) {
                let tpoi = (i !== -1) ? hit.keyframes[i] : { x: hit.x, y: hit.y };
                if (line) {
                    if (lastPoi !== null) {
                        points.push(tpoi);
                        beziers.push(new Bezier2(points));
                        points = [];
                    }
                } else if (lastPoi !== null && tpoi.x === lastPoi.x && tpoi.y === lastPoi.y) {
                    if (points.length >= 2) {
                        beziers.push(new Bezier2(points));
                    }
                    points = [];
                }
                points.push(tpoi);
                lastPoi = tpoi;
            }
            if (!line && points.length >= 2) {
                beziers.push(new Bezier2(points));
                points = [];
            }
            // Use the inherited init method to set up the curve.
            this.init(beziers);
        }
    }
    return LinearBeizer;
});
