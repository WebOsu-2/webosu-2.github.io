// Tests: score/combo/acc HUD digits render at finite positions.
// Regression: charspacing was lost in the v7 rewrite, NaN-ing every digit
// position so score, combo and accuracy were invisible in game.
"use strict";
const H = require("./helpers");

global.window = {};
const PIXI = H.loadModule("scripts/lib/pixi.mjs");
// every score-*.png lookup resolves to a real (empty) texture
global.Skin = new Proxy({}, { get: () => new PIXI.Texture() });
const ScoreOverlay = H.loadModule("scripts/overlay/score.js").default;

function makeOverlay() {
  return new ScoreOverlay({ width: 1280, height: 720 }, 5, 1);
}

test("score-hud: hit + update lays out finite digit sprites", () => {
  const o = makeOverlay();
  o.hit(300, 300, 1000);
  o.hit(100, 300, 1100);
  o.update(1200);
  for (const [name, arr] of [["score", o.scoreDigits], ["combo", o.comboDigits], ["acc", o.accuracyDigits]]) {
    H.assert(arr.useLength > 0, name + " has text");
    for (let i = 0; i < arr.useLength; ++i) {
      H.assert(Number.isFinite(arr[i].x), `${name}[${i}].x finite`);
      H.assert(arr[i].visible, `${name}[${i}] visible`);
      H.assert(arr[i].texture, `${name}[${i}] textured`);
    }
  }
  H.eq(o.combo, 2, "combo counts");
});

test("score-hud: accuracy math incl. empty state", () => {
  const o = makeOverlay();
  o.update(100); // no hits yet: must not throw, digits hidden or zeroed
  o.hit(0, 300, 200);
  H.eq(o.combo, 0, "miss resets combo");
  H.eq(o.maxcombo, 0, "maxcombo untouched without hits");
  o.update(300);
});
