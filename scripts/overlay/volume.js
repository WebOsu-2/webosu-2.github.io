/*
* class: VolumeMenu (extends PIXI.Container)
* 
* Construct params
*   gamefield: {width, height} in real pixels
*
*/

// Volume overlay (ES module).
import * as PIXI from '../lib/pixi.mjs';
    class VolumeMenu extends PIXI.Container {
        constructor(windowfield) {
            super();
            this.fadetime = 1000;
            this.visible = false;
            this.alpha = 1;
            this.t0 = 0;

            this.mastertext = new PIXI.BitmapText({ text: 'MASTER', style: { fontFamily: 'Venera', fontSize: 24 } });
            this.mastertext.anchor.set(0.5);
            this.volumetext = new PIXI.BitmapText({ text: '', style: { fontFamily: 'Venera', fontSize: 40 } });
            this.volumetext.anchor.set(0.5);
            this.addChild(this.mastertext);
            this.addChild(this.volumetext);
            
            this.resize(windowfield);
        }

        resize(windowfield) {
            this.mastertext.x = windowfield.width - 100;
            this.mastertext.y = windowfield.height / 2 - 30;
            this.volumetext.x = windowfield.width - 100;
            this.volumetext.y = windowfield.height / 2 + 10;
        }

        setVolume(volume) {
            this.changed = true;
            this.volumetext.text = Math.round(volume).toString();
        }

        update(timestamp) {
            if (this.changed) {
                this.visible = true;
                this.t0 = timestamp;
                this.changed = false;
            }
            if (!this.visible)
                return;
            let dt = timestamp - this.t0;
            if (dt > this.fadetime) {
                this.visible = false;
            } else {
                this.alpha = 1 - Math.pow(dt / this.fadetime, 5);
            }
        }

        destroy(options) {
            super.destroy(options);
        }
    }

    export default VolumeMenu;
