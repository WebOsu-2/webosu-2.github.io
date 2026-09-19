/*
* class: ProgressOverlay (extends PIXI.Container)
* 
* Construct params
*   gamefield: {width, height} in real pixels
*
*/

// Progress overlay (ES module).
import * as PIXI from '../lib/pixi.mjs';
    class ProgressOverlay extends PIXI.Container {
        constructor(windowfield, starttime, endtime) {
            super();
            this.starttime = starttime;
            this.endtime = endtime;

            // remaining time, in lower right corner
            this.remaining = new PIXI.BitmapText({ text: "", style: { fontFamily: 'Venera', fontSize: 16 } });
            this.remaining.tint = 0xddffff;
            this.remaining.anchor.set(1);
            this.addChild(this.remaining);
            this.past = new PIXI.BitmapText({ text: "", style: { fontFamily: 'Venera', fontSize: 16 } });
            this.past.tint = 0xddffff;
            this.past.anchor.set(0, 1);
            this.addChild(this.past);

            this.resize(windowfield);
        }

        resize(windowfield) {
            this.remaining.x = windowfield.width - 10;
            this.remaining.y = windowfield.height - 10;
            this.past.x = 10;
            this.past.y = windowfield.height - 10;
        }

        static timeformat(seconds) {
            let s = Math.round(seconds);
            let prefix = '';
            if (s < 0) {
                prefix = '-';
                s = -s;
            }
            return prefix + Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
        }

        update(time) {
            if (Number.isNaN(time)) return; // clock glitch: keep last text
            this.remaining.text = ProgressOverlay.timeformat(Math.max(0, (this.endtime - time) / 1000));
            this.past.text = ProgressOverlay.timeformat((time - this.starttime) / 1000);
        }

        destroy(options) {
            super.destroy(options);
        }
    }

    export default ProgressOverlay;
