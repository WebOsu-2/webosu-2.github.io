// Integration test: importing the game entry resolves the entire ES
// module graph (curves -> audio -> osu -> sliders/actions/overlays ->
// playback -> initgame) and boots globals. This is the migration safety
// net: any bad import path or load-time crash fails here.
"use strict";
const H = require("./helpers");

test("esm: entry import boots window.Osu/Playback/game", async () => {
  // All globals installed HERE (not at require time): later-required test
  // files overwrite globals, and modules evaluate on first require — which
  // happens below — so setup must immediately precede the import.
  global.window = global;
  global._ = H.ensureUnderscore();
  if (!global.__audioCtxStub) global.__audioCtxStub = H.makeAudioContextStub({ currentTime: 0 });
  global.AudioContext = function () { return global.__audioCtxStub; };
  // Asset loads fail headlessly (relative URLs); swallow only those so a
  // real crash still fails loudly.
  process.on("unhandledRejection", function ignoreAssetLoads(e) {
    const msg = String((e && e.message) || e);
    if (/venera|suits|sprites\.json|fetch|load|URL|Failed/i.test(msg)) return;
    throw e;
  });
  global.sounds = {
    whenLoaded: null,
    // synchronous on purpose: a deferred callback could fire after later
    // tests replaced global.document and crash the whole process.
    load() { if (this.whenLoaded) this.whenLoaded(); },
  };
  global.localforage = { getItem: (k, cb) => cb(null, null), setItem: (k, v, cb) => cb && cb(null, v) };
  {
    const dom = H.createDom();
    for (const id of ["skin-progress", "sound-progress", "script-progress"]) {
      dom.byId.set(id, H.makeElement("div"));
    }
    global.document = dom.document;
    global.addEventListener = () => {};
  }
  await H.loadModule("scripts/initgame.js");
  H.eq(typeof window.Osu, "function", "Osu constructor");
  H.eq(typeof window.Playback, "function", "Playback constructor");
  H.eq(typeof window.game, "object", "game state");
  H.eq(window.scriptReady, true, "scriptReady flag");
  H.eq(window.game.doubletime, false, "doubletime default off");
  H.eq(window.game.halftime, false, "halftime default off");
});
