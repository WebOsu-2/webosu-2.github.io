// Headless gameplay test: decode a REAL beatmap, boot a REAL Playback,
// advance a manual audio clock and assert the game clock stays finite,
// objects stream in, and nothing throws. Uses fixture files extracted
// from a real .osz (see tests/fixtures/README or regenerate via:
// curl -L -o /tmp/m.osz <mirror>/d/<sid> && unzip -o /tmp/m.osz -d tests/fixtures/map1).
// Skipped gracefully when fixtures are absent (e.g. fresh clones).
"use strict";
const fs = require("fs");
const path = require("path");
const H = require("./helpers");

const FIXDIR = path.join(__dirname, "fixtures", "map1");
try {
  fs.accessSync(path.join(FIXDIR, "audio.mp3"));
} catch (e) {
  test("headless: fixtures absent, skipping", () => {});
  return;
}

global.window = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener() {}, removeEventListener() {},
};
{
  const dom = H.createDom();
  dom.byId.set("game-area", H.makeElement("div"));
  dom.byId.set("pause-menu", H.makeElement("div"));
  global.document = dom.document;
}
global._ = H.ensureUnderscore();
const PIXI = H.loadModule("scripts/lib/pixi.mjs");
// header parsing is covered elsewhere; empty tags => default offset
global.mp3Parser = { readTags: () => [] };
if (!global.__audioCtxStub) global.__audioCtxStub = H.makeAudioContextStub({ currentTime: 1000 });
const ctx = global.__audioCtxStub;
global.AudioContext = function () { return ctx; };
global.FileReader = class {
  readAsArrayBuffer(blob) {
    this.result = blob._buf;
    setTimeout(() => this.onload && this.onload({ target: this }), 0);
  }
};
global.URL.createObjectURL = () => "blob:stub";
global.URL.revokeObjectURL = () => {};
global.Skin = new Proxy({}, { get: () => new PIXI.Texture() });
global.game = null; // set per test (playerActions reads bare `game` too)

function snd() { return { volume: 1, play() {} }; }
function makeGame(over) {
  const game = {
    window: global.window, stage: new PIXI.Container(), scene: null,
    updatePlayerActions() {},
    backgroundDimRate: 0.6, backgroundBlurRate: 0, cursorSize: 1, showhwmouse: false,
    snakein: true, snakeout: true, autofullscreen: false,
    allowMouseButton: true, allowMouseScroll: false,
    K1keycode: 90, K2keycode: 88, ESCkeycode: 27, ESC2keycode: 27,
    masterVolume: 0.6, effectVolume: 1, musicVolume: 1, beatmapHitsound: true,
    globalOffset: 0, backgroundVideo: false,
    easy: false, daycore: false, hardrock: false, nightcore: false, hidden: false,
    doubletime: false, halftime: false,
    autoplay: false, autopilot: false, relax: false,
    hideNumbers: false, hideGreat: false, hideFollowPoints: false,
    mouseX: 256, mouseY: 192, mouse: null,
    K1down: false, K2down: false, M1down: false, M2down: false, down: false,
    paused: false, finished: false, cursor: null,
    sample: {
      1: { hitnormal: snd(), hitwhistle: snd(), hitfinish: snd(), hitclap: snd(), slidertick: snd() },
      2: { hitnormal: snd(), hitwhistle: snd(), hitfinish: snd(), hitclap: snd(), slidertick: snd() },
      3: { hitnormal: snd(), hitwhistle: snd(), hitfinish: snd(), hitclap: snd(), slidertick: snd() },
    },
    sampleSet: 1, sampleComboBreak: snd(),
  };
  Object.assign(game, over || {});
  global.game = game;
  return game;
}

function stubZip(extra) {
  const files = fs.readdirSync(FIXDIR);
  const children = files.map((name) => ({
    name,
    getText(cb) { cb(fs.readFileSync(path.join(FIXDIR, name), "utf8")); },
    getBlob(mime, cb) {
      const buf = fs.readFileSync(path.join(FIXDIR, name));
      cb({ _buf: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), type: mime });
    },
  }));
  if (extra) children.push(extra);
  return {
    children,
    getChildByName(name) {
      const f = children.find((c) => c.name === name);
      return f || null; // zip-fs returns null when missing
    },
  };
}

const Osu = H.loadModule("scripts/osu.js").default;
const Playback = H.loadModule("scripts/playback.js").default;

async function bootTrack(versionMatch, over) {
  const game = makeGame(over);
  game.stage = new PIXI.Container();
  const osu = new Osu(stubZip());
  await new Promise((resolve, reject) => {
    osu.ondecoded = () => resolve();
    osu.onerror = (e) => reject(new Error("osu error: " + e));
    osu.load();
    setTimeout(() => reject(new Error("decode timeout")), 5000);
  });
  osu.filterTracks();
  const track = osu.tracks.find((t) => (t.metadata.Version || "").includes("Normal")) || osu.tracks[0];
  const pb = new Playback(game, osu, track);
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("audio decode timeout")), 5000);
    const prev = osu.onready;
    osu.onready = () => { clearTimeout(to); if (prev) prev(); resolve(); };
    pb.load();
  });
  return { game, osu, track, pb };
}

test("headless: real map boots, clock finite, objects stream", async () => {
  const { pb } = await bootTrack("Normal");
  pb.start();
  let nanFrames = 0, maxUpcoming = 0, lastTime = -Infinity, threw = null;
  for (let f = 0; f < 600; f++) {
    ctx.currentTime += 0.016; // 16ms of audio per frame
    try {
      pb.render(performance.now());
    } catch (e) { threw = threw || e; break; }
    const t = pb.osu.audio.getPosition() * 1000;
    if (!Number.isFinite(t)) nanFrames++;
    else lastTime = t;
    maxUpcoming = Math.max(maxUpcoming, pb.upcomingHits.length);
    if (pb.ended) break;
  }
  if (threw) throw threw;
  H.eq(nanFrames, 0, "no NaN clock frames");
  H.assert(lastTime > 0, "clock advances, got " + lastTime);
  H.assert(maxUpcoming > 0, "hit objects streamed into upcomingHits");
  // progress overlay texts never NaN
  for (const s of [pb.progressOverlay.remaining.text, pb.progressOverlay.past.text]) {
    H.assert(s.indexOf("NaN") === -1, "timer text clean, got " + s);
  }
  pb.destroy();
});

test("headless: enabled video becomes a texture sprite, canvas untouched", async () => {
  global.window.app = { view: { style: {} }, renderer: { background: { color: 0x111111, alpha: 1 } } };
  global.HTMLVideoElement = global.HTMLVideoElement || class HTMLVideoElement {};
  const createdVideos = [];
  const docCreate = document.createElement.bind(document);
  document.createElement = (tag) => {
    const el = docCreate(tag);
    if (String(tag).toLowerCase() === "video") {
      Object.setPrototypeOf(el, global.HTMLVideoElement.prototype);
      createdVideos.push(el);
    }
    return el;
  };
  try {
    const game = makeGame({ backgroundVideo: true });
    const mp4bytes = fs.readFileSync(path.join(FIXDIR, "audio.mp3"));
    const osu = new Osu(stubZip({
      name: "bg.mp4",
      getText(cb) { cb(""); },
      getBlob(mime, cb) { cb({ _buf: mp4bytes.buffer.slice(mp4bytes.byteOffset, mp4bytes.byteOffset + mp4bytes.byteLength), type: mime }); },
    }));
    await new Promise((resolve, reject) => {
      osu.ondecoded = () => resolve();
      osu.onerror = (e) => reject(new Error("osu error: " + e));
      osu.load();
      setTimeout(() => reject(new Error("decode timeout")), 5000);
    });
    osu.filterTracks();
    const track = osu.tracks.find((t) => (t.metadata.Version || "").includes("Normal")) || osu.tracks[0];
    track.video = { filename: "bg.mp4", offset: 0 };
    const createdVideos = [];
    const docCreate = document.createElement.bind(document);
  document.createElement = (tag) => {
    const el = docCreate(tag);
    if (String(tag).toLowerCase() === "video") {
      Object.setPrototypeOf(el, global.HTMLVideoElement.prototype);
      createdVideos.push(el);
    }
    return el;
  };
  global.HTMLVideoElement = global.HTMLVideoElement || class HTMLVideoElement {};
    const pb = new Playback(game, osu, track);
    H.eq(createdVideos.length, 1, "one video element created (detached, not DOM)");
    const area = document.getElementById("game-area");
    H.eq(area.children.filter((c) => c.className === "bg-video").length, 0, "no DOM overlay");
    createdVideos[0].dispatchEvent("canplay"); // metadata ready -> build sprite
    H.assert(pb.bgVideo && pb.bgVideo.el, "video layer registered");
    H.assert(pb.background && pb.background.visible !== false, "cover swapped for video sprite");
    H.eq(global.window.app.renderer.background.alpha, 1, "canvas stays opaque");
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("audio decode timeout")), 5000);
      const prev = osu.onready;
      osu.onready = () => { clearTimeout(to); if (prev) prev(); resolve(); };
      pb.load();
    });
    pb.start();
    for (let f = 0; f < 150; f++) {
      ctx.currentTime += 0.016;
      pb.render(performance.now());
    }
    // video clock follows audio (offset 0 here)
    const want = pb.osu.audio.getPosition();
    H.assert(want > 0, "past lead-in, got " + want);
    H.assert(Math.abs(createdVideos[0].currentTime - want) < 0.2,
      "video synced to audio, got " + createdVideos[0].currentTime + " vs " + want);
    pb.destroy();
  } finally {
    delete global.window.app;
    document.createElement = docCreate;
  }
});

test("headless: video element error toasts, cover stays, game plays on", async () => {
  global.window.app = { view: { style: {} }, renderer: { background: { color: 0x111111, alpha: 1 } } };
  const toasts = [];
  global.showErrorToast = (m) => toasts.push(m);
  const createdVideos = [];
  const docCreate = document.createElement.bind(document);
  document.createElement = (tag) => {
    const el = docCreate(tag);
    if (String(tag).toLowerCase() === "video") createdVideos.push(el);
    return el;
  };
  try {
    const game = makeGame({ backgroundVideo: true });
    const mp4bytes = fs.readFileSync(path.join(FIXDIR, "audio.mp3"));
    const osu = new Osu(stubZip({
      name: "bg.mp4",
      getText(cb) { cb(""); },
      getBlob(mime, cb) { cb({ _buf: mp4bytes.buffer.slice(mp4bytes.byteOffset, mp4bytes.byteOffset + mp4bytes.byteLength), type: mime }); },
    }));
    await new Promise((resolve, reject) => {
      osu.ondecoded = () => resolve();
      osu.onerror = (e) => reject(new Error("osu error: " + e));
      osu.load();
      setTimeout(() => reject(new Error("decode timeout")), 5000);
    });
    osu.filterTracks();
    const track = osu.tracks.find((t) => (t.metadata.Version || "").includes("Normal")) || osu.tracks[0];
    track.video = { filename: "bg.mp4", offset: 0 };
    const pb = new Playback(game, osu, track);
    H.eq(createdVideos.length, 1, "video element created");
    const vid = createdVideos[0];
    vid.dispatchEvent("error"); // unplayable file
    H.assert(toasts.some((m) => m.indexOf("failed to play") !== -1), "explains failure, got " + JSON.stringify(toasts));
    H.eq(pb.bgVideo, null, "dead layer unregistered");
    H.eq(global.window.app.renderer.background.alpha, 1, "canvas stays opaque");
    if (pb.background) H.eq(pb.background.visible, true, "cover intact");
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("audio decode timeout")), 5000);
      const prev = osu.onready;
      osu.onready = () => { clearTimeout(to); if (prev) prev(); resolve(); };
      pb.load();
    });
    pb.start();
    let maxUpcoming = 0, lastTime = -Infinity;
    for (let f = 0; f < 300; f++) {
      ctx.currentTime += 0.016;
      pb.render(performance.now());
      const t = pb.osu.audio.getPosition() * 1000;
      if (Number.isFinite(t)) lastTime = t;
      maxUpcoming = Math.max(maxUpcoming, pb.upcomingHits.length);
      if (pb.ended) break;
    }
    H.assert(lastTime > 0, "audio advances despite dead video");
    H.assert(maxUpcoming > 0, "objects stream despite dead video");
    pb.destroy();
  } finally {
    delete global.window.app;
    delete global.showErrorToast;
    document.createElement = docCreate;
  }
});

test("headless: legacy avi skips video, toasts, game plays as normal", async () => {
  const toasts = [];
  global.showErrorToast = (m) => toasts.push(m);
  try {
    const game = makeGame({ backgroundVideo: true });
    const osu = new Osu(stubZip());
    await new Promise((resolve, reject) => {
      osu.ondecoded = () => resolve();
      osu.onerror = (e) => reject(new Error("osu error: " + e));
      osu.load();
      setTimeout(() => reject(new Error("decode timeout")), 5000);
    });
    osu.filterTracks();
    const track = osu.tracks.find((t) => (t.metadata.Version || "").includes("Normal")) || osu.tracks[0];
    track.video = { filename: "old.avi", offset: 0 }; // legacy container
    const pb = new Playback(game, osu, track);
    const area = document.getElementById("game-area");
    H.eq(area.children.filter((c) => c.className === "bg-video").length, 0, "no video element for avi");
    H.assert(toasts.some((m) => m.indexOf(".avi") !== -1), "explains legacy format, got " + JSON.stringify(toasts));
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("audio decode timeout")), 5000);
      const prev = osu.onready;
      osu.onready = () => { clearTimeout(to); if (prev) prev(); resolve(); };
      pb.load();
    });
    pb.start();
    let maxUpcoming = 0, lastTime = -Infinity;
    for (let f = 0; f < 300; f++) {
      ctx.currentTime += 0.016;
      pb.render(performance.now());
      const t = pb.osu.audio.getPosition() * 1000;
      if (Number.isFinite(t)) lastTime = t;
      maxUpcoming = Math.max(maxUpcoming, pb.upcomingHits.length);
      if (pb.ended) break;
    }
    H.assert(lastTime > 0, "audio advances, got " + lastTime);
    H.assert(maxUpcoming > 0, "objects stream, avi is display-only");
    pb.destroy();
  } finally {
    delete global.showErrorToast;
  }
});

test("headless: rate mods keep song-time chart, set playback rate", async () => {
  // The song clock (audio position x rate) and the decoded chart are both
  // in song time at any rate, so hit times must NOT be rescaled (scaling
  // them once made daycore/nightcore unplayable). Each rate mod only sets
  // the audio rate; rate mods never stack.
  const { osu, track } = await bootTrack("Normal");
  const raw0 = track.hitObjects[0].time;
  H.assert(Number.isFinite(raw0), "fixture has timed objects");
  const cases = [
    [{}, 1.0],
    [{ doubletime: true }, 1.5],
    [{ nightcore: true }, 1.5],
    [{ halftime: true }, 0.75],
    [{ daycore: true }, 0.75],
  ];
  for (const [flags, rate] of cases) {
    const game = makeGame(flags);
    game.stage = new PIXI.Container();
    const pb = new Playback(game, osu, track);
    H.eq(pb.playbackRate, rate, `rate for ${JSON.stringify(flags)}`);
    H.eq(pb.hits[0].time, raw0, `hits unscaled for ${JSON.stringify(flags)}`);
    H.eq(pb.hits[pb.hits.length - 1].time,
      track.hitObjects[track.hitObjects.length - 1].time, "tail unscaled");
    pb.destroy();
  }
});
