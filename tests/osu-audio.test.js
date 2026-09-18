// Unit tests: OsuAudio lifecycle (pause/stop/skipTo/lead-in resume).
// Covers the desync slice: leaked sources, unpausable lead-in, skip-intro.
// NOTE: plain eval scope like liked.test.js (module is AMD, loaded via shim).
"use strict";
const H = require("./helpers");

// The module under test captures ONE AudioContext at load time and shares
// it across instances (same as the browser). All test files must hand it
// the same singleton or load order changes behavior: hence __audioCtxStub.
if (!global.__audioCtxStub) global.__audioCtxStub = H.makeAudioContextStub({ currentTime: 0 });
const sharedCtx = global.__audioCtxStub;
let ctx = sharedCtx;
global.window = {};
global.document = { body: { addEventListener() {} }, addEventListener() {}, hidden: false };
global.game = { globalOffset: 0 };
global.AudioContext = function () { return sharedCtx; };

const OsuAudio = H.loadAmd("scripts/osu-audio.js", {});

function makeAudio(opts = {}) {
  sharedCtx.currentTime = 100;
  sharedCtx.outputLatency = opts.outputLatency;
  sharedCtx.baseLatency = opts.baseLatency;
  sharedCtx.sources = [];
  return new Promise((resolve, reject) => {
    const a = new OsuAudio("song.ogg", new ArrayBuffer(8), () => resolve(a));
    setTimeout(() => reject(new Error("decode callback never fired")), 500);
  });
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("audio: play schedules wait, pause always succeeds (even in lead-in)", async () => {
  const a = await makeAudio();
  a.play(2000); // 2s lead-in
  H.eq(a.playing, true, "playing");
  H.eq(a.position, -2, "negative position during lead-in");
  await tick();
  H.eq(a.pause(), true, "pause succeeds during lead-in (old code returned false)");
  H.eq(a.playing, false, "stopped");
  H.assert(a.position <= 0, "position kept, got " + a.position);
  a.play(); // resume with no wait arg
  H.eq(a.playing, true, "resumed");
  H.assert(a.position < 0, "lead-in converted back to wait, got " + a.position);
  a.stop();
});

test("audio: play() kills leaked previous source", async () => {
  const a = await makeAudio();
  a.play();
  await tick();
  const first = sharedCtx.sources[sharedCtx.sources.length - 1];
  a.play(); // restart without pause (retry path)
  await tick();
  H.eq(first.stopped, true, "old source stopped, no echo/overlap");
  H.eq(a.playing, true, "new source playing");
  a.stop();
});

test("audio: stop() is idempotent and clears source", async () => {
  const a = await makeAudio();
  a.play();
  await tick();
  a.stop();
  a.stop();
  H.eq(a.playing, false, "not playing");
  H.eq(a.source, null, "source cleared");
  H.eq(a.pause(), false, "pause when idle returns false");
});

test("audio: skipTo seeks while playing and pauses clock when idle", async () => {
  const a = await makeAudio();
  a.play();
  await tick();
  H.eq(a.skipTo(30000), true, "skip works");
  H.eq(a.position, 30, "position jumped");
  H.eq(a.playing, true, "keeps playing");
  a.pause();
  H.eq(a.skipTo(60000), true, "skip while paused");
  H.eq(a.position, 60, "position set");
  H.eq(a.playing, false, "stays paused");
  H.eq(a.skipTo(99999999), false, "beyond duration rejected");
});

test("audio: output latency joins the offset compensation", async () => {
  sharedCtx.currentTime = 50;
  sharedCtx.outputLatency = 0.02;
  sharedCtx.baseLatency = 0.005;
  const a = await new Promise((resolve, reject) => {
    const inst = new OsuAudio("song.ogg", new ArrayBuffer(8), () => resolve(inst));
    setTimeout(() => reject(new Error("not ready")), 500);
  });
  // ogg base 19ms + 25ms latency + 0 global
  H.assert(Math.abs(a.posoffset - 44) < 1e-6, "posoffset ~44ms, got " + a.posoffset);
  await tick();
  a.stop();
});
