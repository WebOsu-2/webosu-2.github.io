// Unit tests: .osu map parsing + decode-time defaults.
// Covers the robustness slice: missing StackLeniency / timing points /
// hit objects must not crash decode (previously TypeErrors).
"use strict";
const H = require("./helpers");

global.window = {};
global.document = { body: { addEventListener() {} }, addEventListener() {}, hidden: false };
global.game = { globalOffset: 0 };
if (!global.__audioCtxStub) global.__audioCtxStub = H.makeAudioContextStub({ currentTime: 0 });
global.AudioContext = function () { return global.__audioCtxStub; };

const OsuAudio = H.loadAmd("scripts/osu-audio.js", {});
const exposed = H.loadAmd("scripts/osu.js", { "osu-audio": OsuAudio }, {
  find: "    return Osu;",
  replace: "    return { Osu: Osu, Track: Track };",
});
const Track = exposed.Track;

function decode(text) {
  const t = new Track({}, text);
  let done = null;
  t.ondecoded = (self) => { done = self; };
  t.decode();
  if (!done) throw new Error("ondecoded never fired");
  return done;
}

const MAP_BASIC = `osu file format v14
[General]
AudioFilename: song.ogg
Mode: 0
StackLeniency: 0.7
[Metadata]
Title:Test
Artist:A
Creator:C
Version:Normal
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
[Colours]
Combo1 : 96,159,159
[HitObjects]
100,100,1000,1,0,0:0:0:0:
150,150,2000,2,0,B|250:150,1,100
256,192,3000,12,0,3500,0:0:0:0:
`;

test("osu-parse: circle/slider/spinner decode with timing", () => {
  const t = decode(MAP_BASIC);
  H.eq(t.hitObjects.length, 3, "three objects");
  H.eq(t.hitObjects[0].type, "circle", "circle");
  H.eq(t.hitObjects[1].type, "slider", "slider");
  H.eq(t.hitObjects[2].type, "spinner", "spinner");
  const s = t.hitObjects[1];
  H.assert(Math.abs(s.sliderTime - 500 * (100 / 1.4) / 100) < 1e-6, "sliderTime, got " + s.sliderTime);
  H.eq(s.endTime, 2000 + s.sliderTimeTotal, "slider endTime");
  H.assert(Array.isArray(s.curve.curve) && s.curve.curve.length > 1, "slider curve built");
  for (const h of t.hitObjects) {
    if (!Number.isFinite(h.x) || !Number.isFinite(h.endTime)) throw new Error("non-finite hitobject");
  }
});

test("osu-parse: missing StackLeniency defaults to 0.7", () => {
  const t = decode(MAP_BASIC.replace("StackLeniency: 0.7\n", ""));
  H.eq(t.general.StackLeniency, 0.7, "default leniency");
});

test("osu-parse: missing timing points inject 120bpm default", () => {
  const noTP = MAP_BASIC.replace("[TimingPoints]\n0,500,4,1,0,100,1,0\n", "[TimingPoints]\n");
  const t = decode(noTP);
  H.eq(t.timingPoints.length, 1, "one injected point");
  H.eq(t.timingPoints[0].millisecondsPerBeat, 500, "120bpm");
  H.eq(t.hitObjects[1].timing.millisecondsPerBeat, 500, "slider timing usable");
});

test("osu-parse: empty hit objects neither throw nor NaN", () => {
  const empty = MAP_BASIC.replace(/\[HitObjects\][\s\S]*$/, "[HitObjects]\n");
  const t = decode(empty);
  H.eq(t.hitObjects.length, 0, "no objects");
  H.eq(t.length, 0, "zero length");
});

test("osu-parse: missing PreviewTime/Mode get safe defaults", () => {
  const t = decode(MAP_BASIC.replace("Mode: 0\n", ""));
  H.eq(t.general.Mode, 0, "mode default");
  H.eq(t.general.StackLeniency, 0.7, "leniency intact");
});

const MAP_VIDEO = MAP_BASIC.replace("[HitObjects]", `[Events]
Video,0,"bg.avi"
0,0,"bg.jpg",0,0
[HitObjects]`);

test("video: Video event parses filename and offset", () => {
  const t = decode(MAP_VIDEO);
  H.deepEq(t.video, { filename: "bg.avi", offset: 0 }, "string form");
  const t2 = decode(MAP_VIDEO.replace('Video,0,"bg.avi"', '1,1500,"vid.mp4"'));
  H.deepEq(t2.video, { filename: "vid.mp4", offset: 1500 }, "numeric form");
});

test("video: maps without video get null", () => {
  const t = decode(MAP_BASIC);
  H.eq(t.video, null, "no video");
});

test("video: getVideoFile finds entries case-insensitively", () => {
  const Osu = exposed.Osu;
  const seen = {};
  const zip = {
    getChildByName(name) {
      seen.exact = name;
      throw new Error("not found exactly");
    },
    children: [
      { name: "BG.AVI", getBlob(mime, cb) { seen.mime = mime; cb({ type: mime }); } },
    ],
  };
  const osu = new Osu(zip);
  let got = "pending";
  osu.getVideoFile({ video: { filename: "bg.avi", offset: 0 } }, (blob) => { got = blob; });
  H.eq(seen.exact, "bg.avi", "tried exact name first");
  H.eq(got && got.type, "video/x-msvideo", "avi mime, got " + JSON.stringify(got));
  let miss = "pending";
  osu.getVideoFile({ video: { filename: "nope.mp4", offset: 0 } }, (blob) => { miss = blob; });
  H.eq(miss, null, "missing file -> null");
  let novid = "pending";
  osu.getVideoFile({}, (blob) => { novid = blob; });
  H.eq(novid, null, "no video info -> null");
});
