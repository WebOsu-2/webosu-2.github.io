// Regression tests: NaN hardening across the game clock path.
// A single NaN (bad stored setting, corrupt map line) used to freeze the
// whole game with NaN:NaN timers on first launch.
// NOTE: no "use strict": page scripts are eval'd and must land in scope.
const H = require("./helpers");

test("nan: poisoned stored settings fall back to defaults", () => {
  global.window = global;
  global.localStorage = {
    _s: {
      osugamesettings: JSON.stringify({
        audiooffset: null, dim: "abc", mastervolume: "75",
        apiBrowsing: "mino", unknownFutureKey: 1,
      }),
    },
    getItem(k) { return this._s[k] || null; },
    setItem(k, v) { this._s[k] = String(v); },
  };
  global.addEventListener = () => {};
  global.game = {};
  {
    const dom = H.createDom();
    const byId = dom.byId;
    // settings page ids needed by the binder (ranges get min/max/value)
    const rangeIds = ["dim-range", "blur-range", "cursorsize-range", "mastervolume-range",
      "effectvolume-range", "musicvolume-range", "audiooffset-range"];
    for (const id of rangeIds) {
      const el = H.makeElement("input");
      el.min = "0"; el.max = "100"; el.value = "0";
      byId.set(id, el);
      byId.set(id + "-indicator", H.makeElement("div"));
      byId.set(id + "-value", H.makeElement("div"));
    }
    for (const id of ["showhwmouse-check", "snakein-check", "snakeout-check", "autofullscreen-check",
        "disable-wheel-check", "disable-button-check", "beatmap-hitsound-check",
        "apibrowsing-select", "apidownload-select", "backgroundvideo-check",
        "easy-check", "hardrock-check", "daycore-check", "nightcore-check", "hidden-check",
        "relax-check", "autopilot-check", "autoplay-check",
        "hidenumbers-check", "hidegreat-check", "hidefollowpoints-check"]) {
      byId.set(id, H.makeElement(id.endsWith("-select") ? "select" : "input"));
    }
    for (const id of ["lbutton1select", "rbutton1select", "pausebuttonselect", "pausebutton2select", "restoredefault-btn", "settings-panel"]) {
      byId.set(id, H.makeElement("input"));
    }
    global.document = dom.document;
  }
  eval(require("fs").readFileSync(global.ROOT + "/scripts/config.js", "utf8"));
  eval(require("fs").readFileSync(global.ROOT + "/scripts/settings.js", "utf8"));
  setOptionPanel();
  H.eq(gamesettings.audiooffset, 0, "null offset -> default (was clock poison)");
  H.eq(gamesettings.dim, 60, "garbage dim -> default");
  H.eq(gamesettings.mastervolume, 75, "numeric string still accepted");
  H.eq(gamesettings.apiBrowsing, "mino", "valid non-default kept");
  H.eq("unknownFutureKey" in gamesettings, false, "unknown keys dropped");
  delete global.localStorage;
});

test("nan: audio clock falls back to last good instead of NaN", async () => {
  if (!global.__audioCtxStub) global.__audioCtxStub = H.makeAudioContextStub({ currentTime: 100 });
  global.AudioContext = function () { return global.__audioCtxStub; };
  global.window = global.window || {};
  global.document = global.document || H.createDom().document;
  global.game = { globalOffset: 0 };
  const diags = [];
  global.showErrorToast = (m) => diags.push(m);
  global.alert = () => {};
  const OsuAudio = H.loadModule("scripts/osu-audio.js").default;
  const a = await new Promise((resolve, reject) => {
    const inst = new OsuAudio("s.ogg", new ArrayBuffer(8), () => resolve(inst));
    setTimeout(() => reject(new Error("no decode")), 500);
  });
  a.play(1000);
  const good = a.getPosition();
  H.assert(Number.isFinite(good), "sane clock, got " + good);
  a.posoffset = NaN; // simulate poisoned offset
  const fb = a.getPosition();
  H.eq(fb, good, "falls back to last good instead of NaN");
  H.eq(diags.length, 1, "diagnostic emitted once");
  H.assert(diags[0].indexOf("posoffset") !== -1, "diagnostic names the component");
  a.getPosition();
  H.eq(diags.length, 1, "not spammed");
  a.stop();
  delete global.showErrorToast;
});

test("nan: progress overlay keeps last text on NaN time", () => {
  global.PIXI = H.makePixiStub();
  const ProgressOverlay = H.loadModule("scripts/overlay/progress.js").default;
  const o = new ProgressOverlay({ width: 800, height: 600 }, -1500, 90000);
  o.update(1000);
  H.assert(o.past.text.indexOf("NaN") === -1, "real time renders, got " + o.past.text);
  const before = o.past.text;
  o.update(NaN);
  H.eq(o.past.text, before, "NaN time keeps last text");
});

test("nan: hit objects with non-finite time/coords are dropped", () => {
  global.window = {};
  global.document = { body: { addEventListener() {} }, addEventListener() {}, hidden: false };
  global.game = { globalOffset: 0 };
  if (!global.__audioCtxStub) global.__audioCtxStub = H.makeAudioContextStub({ currentTime: 0 });
  global.AudioContext = function () { return global.__audioCtxStub; };
  global._ = global._ || require("../scripts/lib/underscore.js");
  const Track = H.loadModule("scripts/osu.js").Track;
  const MAP = `osu file format v14
[General]
AudioFilename: s.ogg
Mode: 0
[Metadata]
Title:T
Artist:A
Creator:C
Version:N
BeatmapID:1
BeatmapSetID:10
[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:6
ApproachRate:7
SliderMultiplier:1.4
SliderTickRate:1
[TimingPoints]
0,500,4,1,0,100,1,0
[HitObjects]
100,100,abc,1,0,0:0:0:0:
100,100,1000,1,0,0:0:0:0:
150,150,2000,2,0,B|250:150,notanumber,100
`;
  const t = new Track({}, MAP);
  let done = null;
  t.ondecoded = (s) => { done = s; };
  t.decode();
  H.eq(done.hitObjects.length, 2, "bad circle dropped, bad slider clamped");
  H.assert(done.hitObjects.every((h) => Number.isFinite(h.time)), "all times finite");
  H.eq(done.hitObjects[1].repeat, 1, "bad repeat clamped, got " + done.hitObjects[1].repeat);
});
