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

const OsuAudio = H.loadModule("scripts/osu-audio.js").default;

function makeAudio(opts = {}) {
  sharedCtx.currentTime = 100;
  sharedCtx.outputLatency = opts.outputLatency;
  sharedCtx.baseLatency = opts.baseLatency;
  sharedCtx.numberOfChannels = opts.numberOfChannels || 1;
  sharedCtx.duration = opts.duration || 180;
  sharedCtx.sources = [];
  global.game.playbackRate = opts.playbackRate || 1;
  global.game.preservePitch = opts.preservePitch !== false;
  sharedCtx.audioWorklet = opts.audioWorklet;
  if (opts.audioWorklet) {
    const hadWorklet = sharedCtx.workletNodes && sharedCtx.workletNodes.length > 0;
    sharedCtx.workletReady = !!hadWorklet;
    sharedCtx.workletUrls = sharedCtx.workletUrls || [];
    sharedCtx.workletNodes = sharedCtx.workletNodes || [];
    sharedCtx.audioWorklet.addModule = url => {
      sharedCtx.workletUrls.push(url);
      sharedCtx.workletReady = true;
      return Promise.resolve();
    };
    global.AudioWorkletNode = function (ctx, key, options) {
      if (!ctx.workletReady) throw new Error("processor not registered");
      const node = {
        options,
        startMessages: [],
        stopMessages: [],
        uploadTransfers: null,
        connected: 0,
        disconnected: 0,
        portClosed: false,
        port: {
          onmessage: null,
          close() { node.portClosed = true; },
          postMessage(message, transfer) {
            const id = message[0];
            const method = message[1];
            if (method === "start") node.startMessages.push(message.slice(2));
            else if (method === "stop") node.stopMessages.push([]);
            if (method === "addBuffers") {
              node.uploadTransfers = transfer;
              setTimeout(() => node.port.onmessage({ data: [id, 180] }), 0);
            } else {
              setTimeout(() => node.port.onmessage({ data: [id, null] }), 0);
            }
          },
        },
        connect() { this.connected++; },
        disconnect() { this.disconnected++; },
        stop() {},
        start(...args) { this.startCalls.push(args); },
      };
      setTimeout(() => node.port.onmessage({
        data: ["ready", { start: 5, stop: 1, addBuffers: 1 }],
      }), 0);
      ctx.workletNodes.push(node);
      return node;
    };
  } else {
    global.AudioWorkletNode = undefined;
  }
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

test("audio: source rate fallback is explicit without AudioWorklet", async () => {
  const a = await makeAudio();
  H.eq(a.usesTimeStretch, false, "stub has no AudioWorklet");
  a.playbackRate = 1.5;
  a.preservePitch = true;
  a.play();
  await tick();
  let source = sharedCtx.sources[sharedCtx.sources.length - 1];
  H.eq(source.playbackRate.value, 1.5, "DT fallback rate");
  H.eq(source.detune.value, 0, "no invalid detune compensation");
  a.stop();

  a.playbackRate = 0.75;
  a.play();
  await tick();
  source = sharedCtx.sources[sharedCtx.sources.length - 1];
  H.eq(source.playbackRate.value, 0.75, "HT fallback rate");
  a.stop();

  a.playbackRate = 1.5;
  a.preservePitch = false;
  a.play();
  await tick();
  source = sharedCtx.sources[sharedCtx.sources.length - 1];
  H.eq(source.playbackRate.value, 1.5, "NC rate");
  H.eq(source.detune.value, 0, "NC keeps tempo-linked pitch shift");
  a.stop();
});

test("audio: worklet upload is transferred and survives stop/resume/seek", async () => {
  const a = await makeAudio({
    playbackRate: 1.5,
    preservePitch: true,
    numberOfChannels: 2,
    audioWorklet: {},
  });
  H.eq(a.usesTimeStretch, true, "DT uses the worklet");
  H.eq(a.pitchPreserved, true, "DT reports preserved pitch");
  H.eq(a.stretch.options.numberOfInputs, 1, "processor retains an input slot while using uploaded buffers");
  H.eq(a.stretch.options.processorOptions.internalBufferMode, true, "uploaded-buffer mode is explicit");
  H.eq(a.decoded, null, "decoded samples are released after transfer");
  H.eq(a.stretch.uploadTransfers.length, 2, "channel storage is transferred, not cloned");
  H.assert(sharedCtx.workletUrls[0].indexOf("blob:") === -1, "worklet uses a static module URL");
  H.assert(sharedCtx.workletUrls[0].endsWith("/scripts/lib/SignalsmithStretch.mjs"), sharedCtx.workletUrls[0]);

  a.play();
  H.eq(a.stretch.startMessages.length, 1, "worklet start");
  H.eq(a.stretch.startMessages[0][2], undefined, "worklet start leaves duration scheduling to the lifecycle");
  H.eq(a.stretch.startMessages[0][3], 1.5, "worklet receives playback rate");
  H.assert(a._stretchStopTimer !== null, "natural end has a cancellable stop timer");
  a.pause();
  a.play();
  H.eq(a.stretch.startMessages.length, 2, "worklet resumes after inactive stop");
  a.skipTo(30000);
  H.eq(a.stretch.startMessages[2][1], 30, "seek offset");
  H.eq(a.stretch.startMessages[2][2], undefined, "seek leaves duration scheduling to the lifecycle");
  a.finish();
  H.assert(a.stretch.disconnected > 0, "finished worklet is disconnected without losing retry state");
  a.dispose();
  H.assert(a.stretch === null, "dispose releases stretch reference");
  H.assert(sharedCtx.workletNodes[0].portClosed, "dispose closes worklet port");
});

test("audio: worklet naturally finishes and releases its DSP node", async () => {
  const a = await makeAudio({
    playbackRate: 1.5,
    preservePitch: true,
    duration: 0.05,
    audioWorklet: {},
  });
  a.play();
  await new Promise(resolve => setTimeout(resolve, 100));
  H.eq(a.playing, false, "natural end stops playback state");
  H.eq(a._stretchStopTimer, null, "natural end clears the timer");
  H.assert(a.stretch.disconnected > 0, "natural end disconnects the processor");
  a.dispose();
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

test("audio: output latency is converted to song time at the active rate", async () => {
  const a = await makeAudio({
    outputLatency: 0.02,
    baseLatency: 0.005,
    playbackRate: 1.5,
    preservePitch: true,
  });
  // ogg base 19ms + 25ms wall-clock latency * 1.5 song-time rate
  H.assert(Math.abs(a.posoffset - 56.5) < 1e-6,
    "DT latency offset ~56.5ms, got " + a.posoffset);
  a.stop();
});
