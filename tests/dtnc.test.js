// Unit tests: DT/NC rate scaling (scaleChartForRate).
// The audio runs at 1.5x (NC) / 0.75x (DC); the chart must be compressed
// onto that clock while judgement windows stay rate-independent.
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
const scale = exposed.Osu.scaleChartForRate;

function decode(text) {
  const t = new Track({}, text);
  let done = null;
  t.ondecoded = (s) => { done = s; };
  t.decode();
  if (!done) throw new Error("ondecoded never fired");
  return done;
}

const MAP = `osu file format v14
[General]
AudioFilename: song.ogg
Mode: 0
StackLeniency: 0.7
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
1000,250,4,1,0,100,1,0
[HitObjects]
100,100,1000,1,0,0:0:0:0:
150,150,2000,2,0,B|250:150,1,100
256,192,3000,12,0,3500,0:0:0:0:
`;

test("rate: NC compresses times, slider durations and timing offsets", () => {
  const t = decode(MAP);
  const s = scale(t.hitObjects, t.timingPoints, 1.5);
  H.eq(s.hits[0].time, 1000 / 1.5, "circle time");
  H.eq(s.hits[2].time, 3000 / 1.5, "spinner start");
  H.eq(s.hits[2].endTime, 3500 / 1.5, "spinner end");
  const sl = s.hits[1];
  H.assert(Math.abs(sl.sliderTimeTotal - (t.hitObjects[1].sliderTimeTotal / 1.5)) < 1e-9, "slider duration");
  H.eq(sl.endTime, sl.time + sl.sliderTimeTotal, "slider end consistent");
  H.eq(s.timingPoints[1].offset, 1000 / 1.5, "timing offset");
  H.eq(s.timingPoints[1].millisecondsPerBeat, 250 / 1.5, "bpm scaled");
  H.eq(s.timingPoints[1].trueMillisecondsPerBeat, 250 / 1.5, "true bpm scaled");
  // hit.timing reassigned onto the scaled points
  H.eq(sl.timing.offset, 1000 / 1.5, "slider timing point follows");
});

test("rate: daycore expands times", () => {
  const t = decode(MAP);
  const s = scale(t.hitObjects, t.timingPoints, 0.75);
  H.eq(s.hits[0].time, 1000 / 0.75, "expanded");
  H.eq(s.timingPoints[0].millisecondsPerBeat, 500 / 0.75, "bpm expanded");
});

test("rate: inputs are never mutated (retries stay idempotent)", () => {
  const t = decode(MAP);
  const beforeHits = JSON.stringify(t.hitObjects.map((h) => [h.time, h.endTime]));
  const beforeTP = JSON.stringify(t.timingPoints.map((p) => [p.offset, p.millisecondsPerBeat]));
  const s = scale(t.hitObjects, t.timingPoints, 1.5);
  H.eq(JSON.stringify(t.hitObjects.map((h) => [h.time, h.endTime])), beforeHits, "hits untouched");
  H.eq(JSON.stringify(t.timingPoints.map((p) => [p.offset, p.millisecondsPerBeat])), beforeTP, "points untouched");
  // scaling twice must equal scaling once (no double-scale path)
  const s2 = scale(t.hitObjects, t.timingPoints, 1.5);
  H.eq(JSON.stringify(s2.hits.map((h) => h.time)), JSON.stringify(s.hits.map((h) => h.time)), "stable");
});
