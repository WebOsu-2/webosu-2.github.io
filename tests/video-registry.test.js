// Tests: known-video registry (VIDEO badges independent of providers).
// NOTE: plain-script eval at module top; see liked.test.js.
const fs = require("fs");
const H = require("./helpers");

global.window = { gamesettings: { backgroundVideo: true } };
global.document = H.createDom().document;
const saved = {};
global.localforage = {
  setItem(k, v, cb) { saved[k] = JSON.parse(JSON.stringify(v)); if (cb) cb(null, v); },
  getItem(k, cb) { if (cb) cb(null, saved[k]); },
};
eval(fs.readFileSync(global.ROOT + "/scripts/addbeatmaplist.js", "utf8"));

test("video-registry: record + lookup across number/string sids", () => {
  window.video_sid_set = [];
  recordKnownVideo("1510388");
  H.assert(hasKnownVideo(1510388), "number lookup");
  H.assert(hasKnownVideo("1510388"), "string lookup");
  H.assert(!hasKnownVideo(999), "unknown sid");
  H.deepEq(saved.videosidset, [1510388], "persisted as numbers");
  recordKnownVideo(1510388);
  H.eq(window.video_sid_set.length, 1, "no duplicates");
  recordKnownVideo(null);
  recordKnownVideo(undefined);
  H.eq(window.video_sid_set.length, 1, "junk ignored");
});

test("video-registry: badge from flag or record, never twice", () => {
  window.video_sid_set = [];
  const box = H.makeElement("div");
  boxHasVideoBadge(box, { sid: 5, video: true });
  H.eq(box.children.length, 1, "badge added");
  H.eq(box.children[0].className, "beatmapvideo", "badge class");
  H.eq(box.children[0].innerText, "VIDEO", "badge text");
  boxHasVideoBadge(box, { sid: 5, video: true });
  H.eq(box.children.length, 1, "not duplicated");
  const box2 = H.makeElement("div");
  recordKnownVideo(6);
  boxHasVideoBadge(box2, { sid: 6 });
  H.eq(box2.children.length, 1, "record drives badge without flag");
});

test("video-registry: boxes re-check once registry loads", () => {  window.video_sid_set = undefined; // not loaded yet
  window.video_sid_set_callbacks = [];
  const box = H.makeElement("div");
  boxHasVideoBadge(box, { sid: 7 });
  H.eq(box.children.length, 0, "nothing while unknown");
  H.eq(window.video_sid_set_callbacks.length, 1, "recheck queued");
  window.video_sid_set = [7];
  const cbs = window.video_sid_set_callbacks;
  window.video_sid_set_callbacks = [];
  cbs.forEach((cb) => cb());
  H.eq(box.children.length, 1, "badge appears after load");
});

test("video-registry: no badges while background video is disabled", () => {
  window.gamesettings.backgroundVideo = false;
  window.video_sid_set = [8];
  const box = H.makeElement("div");
  boxHasVideoBadge(box, { sid: 8, video: true });
  H.eq(box.children.length, 0, "hidden when disabled");
  window.gamesettings.backgroundVideo = true;
});
