define([], function () {
    return class LoadingMenu extends PIXI.Container {
        constructor(windowfield, track) {
            super();
            this.fadetime = 200;
            this.alpha = 1;
            this.hidden = false;

            // Background setup
            this.bg = new PIXI.Sprite(Skin['hpbarright.png']);
            this.bg.rotation = Math.PI / 2;
            this.bg.anchor.set(0.5);
            this.bg.scale.set(0.6, 500);
            this.bg.alpha = 0.8;
            this.addChild(this.bg);

            this.titletext = new PIXI.BitmapText(track.metadata.Title || '-', {

                fontName: 'Venera',

                fontSize: 24

            });
            this.artisttext = new PIXI.BitmapText(track.metadata.Artist || '-', {

                fontName: 'Venera',

                fontSize: 14

            });
            this.versiontext = new PIXI.BitmapText(track.metadata.Version || '-', {

                fontName: 'Venera',

                fontSize: 14

            });
            this.sourcetext = new PIXI.BitmapText(`Source: ${track.metadata.Source || '-'}`, {

                fontName: 'Venera',

                fontSize: 14

            });
            this.mappertext = new PIXI.BitmapText(`Mapper: ${track.metadata.Creator || '-'}`, {

                fontName: 'Venera',

                fontSize: 14

            });

            // Configure text anchors
            [this.titletext, this.artisttext, this.versiontext, this.sourcetext, this.mappertext].forEach(text => {
                text.anchor.set(0.5);
                this.addChild(text);
            });

            // Loading spinner
            this.loading = new PIXI.Sprite(Skin['dot.png']);
            this.loading.anchor.set(0.5, 0.3);
            this.loading.scale.set(1, 0.6);
            this.addChild(this.loading);

            this.resize(windowfield);
        }

        resize(windowfield) {
            this.bg.x = windowfield.width / 2;
            this.bg.y = windowfield.height / 2;

            this.titletext.y = windowfield.height / 2 - 90;
            this.artisttext.y = windowfield.height / 2 - 60;
            this.versiontext.y = windowfield.height / 2 + 60;
            this.sourcetext.y = windowfield.height / 2 + 85;
            this.mappertext.y = windowfield.height / 2 + 110;

            this.loading.position.set(windowfield.width / 2, windowfield.height / 2);

            // Horizontal positions set once since they're all centered
            const centerX = windowfield.width / 2;
            this.titletext.x = centerX;
            this.artisttext.x = centerX;
            this.versiontext.x = centerX;
            this.sourcetext.x = centerX;
            this.mappertext.x = centerX;
        }

        hide() {
            this.hidden = true;
        }

        updateloading(timestamp) {
            this.loading.rotation = timestamp / 128;
        }

        update(timestamp) {
            if (!this.visible) return;

            if (!this.hidden) {
                this.updateloading(timestamp);
                return;
            }

            if (!this.t0) {
                this.t0 = timestamp;
                this.changed = false;
            }

            const dt = timestamp - this.t0;
            this.alpha = dt > this.fadetime ? 0 : 1 - dt / this.fadetime;
            this.visible = dt <= this.fadetime;
        }

        destroy(options) {
            super.destroy(options);
            // Explicitly remove references
            this.bg = null;
            this.loading = null;
            // Add similar cleanup for other elements if needed
        }
    };
});