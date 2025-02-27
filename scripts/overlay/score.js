/*
* class: ScoreOverlay (extends PIXI.Container)
* responsible for calculating & displaying combo, score, HP, accuracy...
* 
* Construct params
*   gamefield: {width, height} in real pixels
*
* properties
*   tint: 24-bit integer color of display
*   
*/

define([], function () {
    function addPlayHistory(summary) {
        if (!window.playHistory1000) {
            window.playHistory1000 = [];
        }
        window.playHistory1000.push(summary);
        if (window.playHistory1000.length > 1000)
            window.playHistory1000.shift();
        // save history
        if (window.localforage) {
            localforage.setItem("playhistory1000", window.playHistory1000, function (err, val) {
                if (err) {
                    console.error("Error saving play history");
                }
            });
        }
    }

    function grade(acc) {
        if (acc >= 1) return 'SS';
        if (acc >= 0.95) return 'S';
        if (acc >= 0.9) return 'A';
        if (acc >= 0.8) return 'B';
        if (acc >= 0.7) return 'C';
        return 'D';
    }

    class LazyNumber {
        constructor(value = 0) {
            this.value = value;
            this.target = value;
            this.lasttime = -1000000; // playback can start before time=0
        }
        static get lag() { return 200; }
        update(time) {
            this.value += (this.target - this.value) * (1 - Math.exp((this.lasttime - time) / LazyNumber.lag));
            this.lasttime = time;
        }
        set(time, value) {
            this.update(time);
            this.target = value;
        }
        valueAt(time) {
            this.update(time);
            return this.value;
        }
    }

    class ScoreOverlay extends PIXI.Container {
        constructor(windowfield, HPdrain, scoreMultiplier) {
            super();
            this.field = windowfield;
            this.HPdrain = HPdrain;
            this.scaleMul = windowfield.height / 800;
            this.scoreMultiplier = scoreMultiplier;

            this.score = 0; // already multiplied by scoreMultiplier
            this.combo = 0;
            this.maxcombo = 0;
            this.judgeTotal = 0;
            this.maxJudgeTotal = 0;
            this.HP = 1;
            this.fullcombo = true;
            // accuracy = judgeTotal / maxJudgeTotal
            this.onfail = null;
            this.judgecnt = {
                great: 0,
                good: 0,
                meh: 0,
                miss: 0,
            };

            this.score4display = new LazyNumber(this.score);
            this.combo4display = new LazyNumber(this.combo);
            this.accuracy4display = new LazyNumber(1);
            this.HP4display = new LazyNumber(this.HP);

            // Utility to create sprite arrays
            this.scoreDigits = this.newSpriteArray(10, 0.4, 0xddffff); // 9999999999
            this.comboDigits = this.newSpriteArray(6, 0.2, 0xddffff);   // 99999x
            this.accuracyDigits = this.newSpriteArray(7, 0.2, 0xddffff); // 100.00%
            this.HPbar = this.newSpriteArray(3, 0.5);
            this.HPbar[0].texture = Skin["hpbarleft.png"];
            this.HPbar[1].texture = Skin["hpbarright.png"];
            this.HPbar[2].texture = Skin["hpbarmid.png"];
            this.HPbar[0].anchor.x = 1;
            this.HPbar[0].scale.x = this.field.width / 500;
            this.HPbar[1].scale.x = this.field.width / 500;
            this.HPbar[0].y = -7 * this.scaleMul;
            this.HPbar[1].y = -7 * this.scaleMul;
            this.HPbar[2].y = -7 * this.scaleMul;
        }

        newSpriteArray(len, scaleMul = 1, tint = 0xffffff) {
            let a = new Array(len);
            for (let i = 0; i < len; ++i) {
                a[i] = new PIXI.Sprite();
                a[i].scale.x = a[i].scale.y = this.scaleMul * scaleMul;
                a[i].anchor.set(0, 0);
                a[i].alpha = 1;
                a[i].tint = tint;
                this.addChild(a[i]);
            }
            return a;
        }

        resize(windowfield) {
            this.field = windowfield;
            this.scaleMul = windowfield.height / 800;
            const f = (arr, mul) => {
                arr.forEach(sprite => { sprite.scale.x = sprite.scale.y = mul; });
            };
            f(this.scoreDigits, this.scaleMul * 0.4);
            f(this.comboDigits, this.scaleMul * 0.2);
            f(this.accuracyDigits, this.scaleMul * 0.2);
            f(this.HPbar, this.scaleMul * 0.5);
            this.HPbar[0].scale.x = this.field.width / 500;
            this.HPbar[1].scale.x = this.field.width / 500;
            this.HPbar[0].y = -7 * this.scaleMul;
            this.HPbar[1].y = -7 * this.scaleMul;
            this.HPbar[2].y = -7 * this.scaleMul;
        }

        HPincreasefor(result) {
            switch (result) {
                case 0:
                    return -0.02 * this.HPdrain;
                case 50:
                    return 0.01 * (4 - this.HPdrain);
                case 100:
                    return 0.01 * (8 - this.HPdrain);
                case 300:
                    return 0.01 * (10.2 - this.HPdrain);
                default:
                    return 0;
            }
        }

        hit(result, maxresult, time) {
            if (maxresult === 300) {
                if (result === 300) this.judgecnt.great++;
                if (result === 100) this.judgecnt.good++;
                if (result === 50) this.judgecnt.meh++;
                if (result === 0) this.judgecnt.miss++;
            }
            this.judgeTotal += result;
            this.maxJudgeTotal += maxresult;
            this.score += this.scoreMultiplier * result * (1 + this.combo / 25);
            let oldCombo = this.combo;
            this.combo = (result > 0) ? this.combo + 1 : 0;
            if (result === 0) {
                this.fullcombo = false;
                if (oldCombo > 20) {
                    window.game.sampleComboBreak.volume = window.game.masterVolume * window.game.effectVolume;
                    window.game.sampleComboBreak.play();
                }
            }
            this.maxcombo = Math.max(this.maxcombo, this.combo);
            if (this.HP >= 0) this.HP += this.HPincreasefor(result);
            this.HP = Math.min(1, this.HP);

            this.score4display.set(time, this.score);
            this.combo4display.set(time, this.combo);
            this.accuracy4display.set(time, this.judgeTotal / this.maxJudgeTotal);
            this.HP4display.set(time, Math.max(0, this.HP));
        }

        setSpriteArrayText(arr, str) {
            let width = 0;
            if (str.length > arr.length)
                console.error("displaying string failed");
            for (let i = 0; i < str.length; ++i) {
                let ch = str[i] === "%" ? "percent" : str[i];
                let textname = "score-" + ch + ".png";
                arr[i].texture = Skin[textname];
                arr[i].knownwidth = arr[i].scale.x * (Skin[textname].width + this.charspacing);
                arr[i].visible = true;
                width += arr[i].knownwidth;
            }
            for (let i = str.length; i < arr.length; ++i) {
                arr[i].visible = false;
            }
            arr.width = width;
            arr.useLength = str.length;
        }

        setSpriteArrayPos(arr, x, y) {
            let curx = x;
            if (arr.useLength > 0) {
                for (let i = 0; i < arr.useLength; ++i) {
                    arr[i].x = curx + arr[i].scale.x * this.charspacing / 2;
                    arr[i].y = y;
                    curx += arr[i].knownwidth;
                }
            } else {
                throw "wtf!";
            }
        }

        update(time) {
            if (Number.isNaN(time)) {
                console.error("score overlay update with time = NaN");
                return;
            }
            let HPpos = this.HP4display.valueAt(time) * this.field.width;
            this.HPbar[0].x = HPpos;
            this.HPbar[1].x = HPpos;
            this.HPbar[2].x = HPpos;
            this.setSpriteArrayText(this.scoreDigits, Math.round(this.score4display.valueAt(time)).toString().padStart(6, '0'));
            this.setSpriteArrayText(this.comboDigits, Math.round(this.combo4display.valueAt(time)).toString() + "x");
            this.setSpriteArrayText(this.accuracyDigits, (this.accuracy4display.valueAt(time) * 100).toFixed(2) + "%");

            let basex = this.field.width * 0.5;
            let basey = this.field.height * 0.017;
            let unit = Math.min(this.field.width / 640, this.field.height / 480);
            this.setSpriteArrayPos(this.scoreDigits, basex - this.scoreDigits.width / 2, basey);
            this.setSpriteArrayPos(this.accuracyDigits, basex - this.scoreDigits.width / 2 - this.accuracyDigits.width - 16 * unit, basey + 3 * unit);
            this.setSpriteArrayPos(this.comboDigits, basex + this.scoreDigits.width / 2 + 16 * unit, basey + 3 * unit);
        }

        showSummary(metadata, hiterrors, retryCallback, quitCallback) {
            // Note: For clarity, this method code has been kept similar to your original.
            function errortext(a) {
                let sum = 0;
                for (let i = 0; i < a.length; ++i)
                    sum += a[i];
                let avg = sum / a.length;
                let sumsqerr = 0;
                for (let i = 0; i < a.length; ++i)
                    sumsqerr += (a[i] - avg) ** 2;
                let stdev = Math.sqrt(sumsqerr / a.length);
                let sgnavg = avg.toFixed(0);
                if (sgnavg[0] !== '-')
                    sgnavg = '+' + sgnavg;
                return sgnavg + "±" + stdev.toFixed(0) + "ms";
            }
            function modstext(game) {
                let l = [];
                if (game.easy) l.push("EZ");
                if (game.daycore) l.push("DC");
                if (game.hidden) l.push("HD");
                if (game.hardrock) l.push("HR");
                if (game.nightcore) l.push("NC");
                if (game.relax) l.push("RL");
                if (game.autopilot) l.push("AP");
                if (game.autoplay) l.push("AT");
                return l.length === 0 ? "" : l.join('+');
            }
            function newdiv(parent, classname, text) {
                let div = document.createElement("div");
                if (parent) parent.appendChild(div);
                if (classname) div.className = classname;
                if (text) div.innerText = text;
                return div;
            }
            let acc = this.judgeTotal / this.maxJudgeTotal;
            let rank = this.HP < 0 ? "F" : (acc >= 1 ? 'SS'
                : acc >= 0.95 ? 'S'
                : acc >= 0.9 ? 'A'
                : acc >= 0.8 ? 'B'
                : acc >= 0.7 ? 'C' : 'D');
            let grading = newdiv(null, "grading");
            grading.classList.add("transparent");
            document.body.appendChild(grading);
            let top = newdiv(grading, "top");
            let info = newdiv(top, "beatmap-info");
            newdiv(info, "title", metadata.Title);
            newdiv(info, "artist", metadata.Artist);
            newdiv(info, "version", metadata.Version);
            newdiv(info, "mapper", "mapped by " + metadata.Creator);
            newdiv(info, "version", modstext(window.game));
            newdiv(top, "ranking", "Ranking");
            newdiv(top, "grade " + rank, rank);
            let left = newdiv(grading, "left");
            newdiv(left, "block score", Math.round(this.score).toString());
            newdiv(left, "block acc", (acc * 100).toFixed(2) + "%");
            newdiv(left, "block err", errortext(hiterrors));
            newdiv(left, "block great", this.judgecnt.great.toString());
            newdiv(left, "block good", this.judgecnt.good.toString());
            newdiv(left, "block meh", this.judgecnt.meh.toString());
            newdiv(left, "block miss", this.judgecnt.miss.toString());
            newdiv(left, "block placeholder");
            newdiv(left, "block combo", this.maxcombo.toString() + "x");
            if (this.fullcombo)
                newdiv(left, "fullcombo");
            let b1 = newdiv(grading, "btn retry");
            newdiv(b1, "inner", "Retry");
            b1.onclick = () => {
                grading.remove();
                retryCallback();
            }
            let b2 = newdiv(grading, "btn quit");
            newdiv(b2, "inner", "Quit");
            b2.onclick = () => {
                grading.remove();
                quitCallback();
            }
            window.setTimeout(() => { grading.classList.remove("transparent"); }, 100);

            // Generate summary data
            let summary = {
                sid: metadata.BeatmapSetID,
                bid: metadata.BeatmapID,
                title: metadata.Title,
                version: metadata.Version,
                mods: modstext(window.game),
                grade: rank,
                score: Math.round(this.score).toString(),
                combo: this.maxcombo.toString(),
                acc: (acc * 100).toFixed(2) + "%",
                time: new Date().getTime()
            }
            // Add play history...
            if (!window.playHistory1000) window.playHistory1000 = [];
            window.playHistory1000.push(summary);
            if (window.playHistory1000.length > 1000)
                window.playHistory1000.shift();
            if (window.localforage) {
                window.localforage.setItem("playhistory1000", window.playHistory1000, function (err, val) {
                    if (err) console.error("Error saving play history");
                });
            }
        }

        // Optionally override destroy if you need to clean up custom properties
        destroy(options) {
            super.destroy(options);
        }
    }

    return ScoreOverlay;
});
