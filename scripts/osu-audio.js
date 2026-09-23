// Audio engine (ES module). Relies on browser globals: AudioContext,
// document, game (settings), mp3Parser, showErrorToast.
import SignalsmithStretch from './lib/SignalsmithStretch.mjs';

// Load the same ES module in the AudioWorklet realm. Besides avoiding a
// second generated copy, this keeps worklet loading compatible with sites
// whose CSP disallows executable blob: URLs.
SignalsmithStretch.moduleUrl = new URL('./lib/SignalsmithStretch.mjs', import.meta.url).href;

const PITCH_STRETCH_TIMEOUT_MS = 10000;

function withTimeout(promise, timeoutMs, label, onLateResolve) {
  let timedOut = false;
  let timer;
  const observed = Promise.resolve(promise);
  observed.then(value => {
    if (timedOut && typeof onLateResolve === 'function') {
      try { onLateResolve(value); } catch (e) { /* ignore late cleanup failure */ }
    }
  }, () => { /* the raced path reports the original rejection */ });
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`${label} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    observed.then(value => {
      if (timedOut) return;
      clearTimeout(timer);
      resolve(value);
    }, error => {
      if (timedOut) return;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function releaseStretchNode(node) {
  if (!node) return;
  try { node.disconnect(); } catch (e) {}
  try { node.port.close(); } catch (e) {}
}

function reportPitchFallback(reason) {
  console.warn("Pitch-preserving rate adjustment unavailable; falling back.", reason || "");
  if (typeof showErrorToast === 'function') {
    showErrorToast("Pitch-preserving speed is unavailable in this browser; DT/HT audio will change pitch.");
  }
}

function syncStream(node) {
    // https://stackoverflow.com/questions/10365335/decodeaudiodata-returning-a-null-error
    var buf8 = new Uint8Array(node.buf);
    buf8.indexOf = Array.prototype.indexOf;
    var i = node.sync,
      b = buf8;
    while (1) {
      node.retry++;
      i = b.indexOf(0xff, i);
      if (i == -1 || b[i + 1] & (0xe0 == 0xe0)) break;
      i++;
    }
    if (i != -1) {
      var tmp = node.buf.slice(i);
      delete node.buf;
      node.buf = null;
      node.buf = tmp;
      node.sync = i;
      return true;
    }
    return false;
  }

  function offset_predict_mp3(tags) {
    let default_offset = 22;
    if (!tags || !tags.length) {
      console.warn("mp3 offset predictor: mp3 tag missing");
      return default_offset;
    }
    let frametag = tags[tags.length - 1];
    if (frametag._section.sampleLength != 1152) {
      console.warn("mp3 offset predictor: unexpected sample length");
      return default_offset;
    }
    let vbr_tag = null;
    for (let i = 0; i < tags.length; ++i)
      if (tags[i]._section.type == "Xing") vbr_tag = tags[i];
    if (!vbr_tag) {
      return default_offset;
    }
    if (!vbr_tag.identifier) {
      console.warn("mp3 offset predictor: vbr tag identifier missing");
      return default_offset;
    }
    if (vbr_tag.vbrinfo.ENC_DELAY != 576) {
      console.warn("mp3 offset predictor: vbr ENC_DELAY value unexpected");
      return default_offset;
    }
    let sampleRate = vbr_tag.header.samplingRate;
    if (sampleRate == 32000) return 89 - 1152000 / sampleRate;
    if (sampleRate == 44100) return 68 - 1152000 / sampleRate;
    if (sampleRate == 48000) return 68 - 1152000 / sampleRate;
    console.warn("mp3 offset predictor: sampleRate unexpected");
    return default_offset;
  }

  function preprocAudio(filename, buffer) {
    let suffix = filename.substr(-3);
    if (suffix != "mp3") {
      console.log("preproc audio: ogg", suffix);
      return { startoffset: 19 };
    }
    let tags = mp3Parser.readTags(new DataView(buffer));
    if (tags.length == 3 && tags[1]._section.type == "Xing") {
      console.log("dumbifing", filename);
      let arr = new Uint8Array(buffer.byteLength - tags[1]._section.byteLength);
      arr.set(new Uint8Array(buffer, 0, tags[1]._section.offset), 0);
      let offsetAfter = tags[1]._section.offset + tags[1]._section.byteLength;
      arr.set(
        new Uint8Array(buffer, offsetAfter, buffer.byteLength - offsetAfter),
        tags[0]._section.offset
      );
      buffer = arr.buffer;
      return { startoffset: offset_predict_mp3(tags), newbuffer: arr.buffer };
    }
    return { startoffset: offset_predict_mp3(tags) };
  }

  const audioContext = new AudioContext();
  if (audioContext.state === "suspended") {
    document.body.addEventListener(
      "touchstart",
      (event) => {
        audioContext.resume();
      },
      {
        once: true,
      }
    );
  }
  // If the tab was hidden/suspended, the context clock freezes while rAF
  // stops; resume on visibility so audio and visuals re-sync without a
  // new tab.
  try {
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && audioContext.state === "suspended") {
        try { audioContext.resume(); } catch (e) {}
      }
    });
  } catch (e) { /* ignore */ }

  function OsuAudio(filename, buffer, callback) {
    var self = this;
    this.decoded = null;
    this.source = null;
    this.started = 0;
    this.position = 0;
    this.playing = false;
    this.audio = audioContext;
    this.gain = this.audio.createGain();
    this.gain.connect(this.audio.destination);
    this.playbackRate = Number(game.playbackRate) > 0 ? Number(game.playbackRate) : 1;
    this.preservePitch = game.preservePitch !== false;
    this.duration = null;
    this.stretch = null;
    this.usesTimeStretch = false;
    this.pitchPreserved = this.playbackRate === 1
      ? true
      : this.preservePitch ? null : false;
    this._stretchConnected = false;
    this._stretchStopTimer = null;
    this._sourceGeneration = 0;

    this._configureSource = function (source) {
      source.playbackRate.value = self.playbackRate;
    };
    this._prepareRatePlayback = async function () {
      if (!self.preservePitch || self.playbackRate === 1) return;
      if (!self.audio.audioWorklet || typeof AudioWorkletNode === "undefined") {
        self.pitchPreserved = false;
        reportPitchFallback("AudioWorklet is unavailable");
        return;
      }
      let stretch = null;
      try {
        const channelCount = Math.max(1, self.decoded.numberOfChannels || 1);
        stretch = await withTimeout(
          SignalsmithStretch(self.audio, {
            // Keep one input slot for the processor's inactive-path
            // contract, but explicitly select its uploaded-buffer mode so an
            // unconnected/silent input is never mistaken for live audio.
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [channelCount],
            processorOptions: { internalBufferMode: true },
          }),
          PITCH_STRETCH_TIMEOUT_MS,
          "Pitch-preserving audio initialization",
          releaseStretchNode
        );
        const channels = [];
        const transfer = [];
        for (let channel = 0; channel < channelCount; ++channel) {
          const samples = self.decoded.getChannelData(channel);
          channels.push(samples);
          if (!transfer.includes(samples.buffer)) transfer.push(samples.buffer);
        }
        stretch.connect(self.gain);
        self._stretchConnected = true;
        // Transfer ownership of the decoded sample storage into the worklet.
        // Structured cloning would retain a second full-song copy in memory.
        await withTimeout(
          stretch.addBuffers(channels, transfer),
          PITCH_STRETCH_TIMEOUT_MS,
          "Pitch-preserving audio buffer upload"
        );
        self.stretch = stretch;
        self.usesTimeStretch = true;
        self.pitchPreserved = true;
        self.decoded = null;
      } catch (e) {
        releaseStretchNode(stretch);
        self.stretch = null;
        self.usesTimeStretch = false;
        self.pitchPreserved = false;
        self._stretchConnected = false;
        reportPitchFallback(e);
      }
    };
    this._startSource = function (when, offset) {
      if (self.stretch) {
        if (!self._stretchConnected) {
          self.stretch.connect(self.gain);
          self._stretchConnected = true;
        }
        self.source = self.stretch;
        // Signalsmith 1.3.2's start(duration) path can drop the active
        // segment when AudioContext time has already reached `when`. Schedule
        // an independent wall-clock stop instead; it also lets pause/seek
        // cancel the stop without corrupting the reusable node.
        self.source.start(when, offset, undefined, self.playbackRate);
        if (Number.isFinite(self.duration)) {
          const remaining = Math.max(0, self.duration - offset) / self.playbackRate;
          const delay = Math.max(0, when - self.audio.currentTime) + remaining;
          const generation = ++self._sourceGeneration;
          self._stretchStopTimer = setTimeout(() => {
            self._stretchStopTimer = null;
            if (generation !== self._sourceGeneration ||
                self.source !== self.stretch || !self.playing) return;
            self.position = self.duration;
            self.finish();
          }, delay * 1000);
          if (self._stretchStopTimer && self._stretchStopTimer.unref)
            self._stretchStopTimer.unref();
        }
        return;
      }
      self.source = self.audio.createBufferSource();
      self._configureSource(self.source);
      self.source.buffer = self.decoded;
      self.source.connect(self.gain);
      self.source.start(when, offset);
    };
    this._stopSource = function () {
      if (self._stretchStopTimer) {
        try { clearTimeout(self._stretchStopTimer); } catch (e) {}
        self._stretchStopTimer = null;
      }
      ++self._sourceGeneration;
      if (!self.source) return;
      try { self.source.onended = null; } catch (e) {}
      try { self.source.stop(); } catch (e) {}
      if (self.source !== self.stretch) {
        try { self.source.disconnect(); } catch (e) {}
      }
    };
    this.posoffset = 0;

    let t = preprocAudio(filename, buffer);
    if (t.startoffset) this.posoffset = t.startoffset;
    if (t.newbuffer) buffer = t.newbuffer;
    // Compensate for audio output latency (heard audio lags the
    // AudioContext clock). Without this, hits feel systematically early/late
    // on high-latency devices (the "every song out of sync in 2.0" reports).
    try {
      var outLat = (self.audio.outputLatency || 0) + (self.audio.baseLatency || 0);
      if (outLat > 0 && outLat < 1)
        self._outputLatencyMs = outLat * 1000 * self.playbackRate;
      else self._outputLatencyMs = 0;
    } catch (e) { self._outputLatencyMs = 0; }
    if (self._outputLatencyMs) this.posoffset += self._outputLatencyMs;
    console.log("set start offset to", this.posoffset, "ms");
    console.log("you've set global offset to", game.globalOffset || 0, "ms");
    this.posoffset += game.globalOffset || 0;

    function decode(node) {
      self.audio.decodeAudioData(
        node.buf,
        function (decoded) {
          self.decoded = decoded;
          self.duration = Number(decoded.duration);
          console.log("Song decoded");
          self._prepareRatePlayback().then(() => {
            if (typeof callback !== "undefined") callback(self);
          });
        },
        function (err) {
          console.log("Error");
          if (typeof showErrorToast === "function") {
            showErrorToast("Audio decode failed. Please report by filing an issue on Github");
          } else {
            alert(
              "Audio decode failed. Please report by filing an issue on Github"
            );
          }
          if (syncStream(node)) {
            console.log("Attempting again");
            decode(node);
          }
        }
      );
    }
    decode({ buf: buffer, sync: 0, retry: 0 });

    this.getPosition = function () {
      const p = this._getPosition() - this.posoffset / 1000;
      if (Number.isNaN(p)) {
        // The game clock must never be NaN (it freezes gameplay and prints
        // NaN:NaN timers). Log the components once for diagnosis and fall
        // back to the last good position so the game stays playable.
        if (!self._nanWarned) {
          self._nanWarned = true;
          let info = {};
          try {
            info = {
              playing: self.playing,
              position: self.position,
              currentTime: self.audio && self.audio.currentTime,
              started: self.started,
              rate: self.playbackRate,
              posoffset: self.posoffset,
            };
          } catch (e) { info.err = String(e); }
          console.error("audio clock NaN; components:", JSON.stringify(info));
          if (typeof showErrorToast === "function") {
            showErrorToast("Audio clock glitch detected (" + JSON.stringify(info) + "). If the game misbehaves, please report this.");
          }
        }
        return (typeof self._lastGoodPosition === "number") ? self._lastGoodPosition : 0;
      }
      self._lastGoodPosition = p;
      return p;
    };

    this._getPosition = function _getPosition() {
      if (!self.playing) {
        return self.position;
      } else {
        return (
          self.position +
          (self.audio.currentTime - self.started) * self.playbackRate
        );
      }
    };

    this.play = function play(wait = 0) {
      if (self.audio.state === "suspended") {
        console.warn("Audio suspended. Waiting for touchstart.");
        try { self.audio.resume(); } catch (e) { /* ignore */ }
      }
      // If resuming from a pause during lead-in (position < 0),
      // convert the negative position back into a scheduled wait so
      // audio and visuals stay in sync.
      if (!(wait > 0) && self.position < 0) {
        wait = -self.position * 1000;
      }
      // stop any leaked previous source before starting a new one
      // (prevents overlapping/echoing audio that required a new tab to fix)
      self._stopSource();
      self.source = null;
      self.playing = true;
      self.started = self.audio.currentTime;
      if (wait > 0) {
        self.position = -wait / 1000;
        self._startSource(
          self.audio.currentTime + wait / 1000 / self.playbackRate,
          0
        );
      } else {
        self._startSource(self.audio.currentTime, Math.max(0, self.position));
      }
    };

    this.stop = function stop() {
      try { self._stopSource(); } catch (e) { /* ignore */ }
      self.source = null;
      self.playing = false;
    };

    // Jump audio clock to ms (used by the Skip-intro button).
    this.skipTo = function skipTo(ms) {
      if (!self.decoded && !self.stretch) return false;
      var sec = Math.max(0, ms / 1000);
      if (Number.isFinite(self.duration) && sec >= self.duration) return false;
      var wasPlaying = self.playing;
      try { self._stopSource(); } catch (e) { /* ignore */ }
      self.source = null;
      self.position = sec;
      if (wasPlaying) {
        try {
          self.playing = true;
          self.started = self.audio.currentTime;
          self._startSource(self.audio.currentTime, sec);
        } catch (e) {
          console.error("skipTo failed", e);
          return false;
        }
      }
      return true;
    };

    this.finish = function finish() {
      this.stop();
      if (this.stretch) {
        try { this.stretch.disconnect(); } catch (e) {}
      }
      this._stretchConnected = false;
    };

    this.dispose = function dispose() {
      this.finish();
      if (this.stretch) {
        try { this.stretch.port.close(); } catch (e) {}
        this.stretch = null;
      }
      this.usesTimeStretch = false;
      this.decoded = null;
      this.duration = null;
      try { this.gain.disconnect(); } catch (e) {}
    };

    // return value true: success
    this.pause = function pause() {
      if (!self.playing) return false;
      try {
        self.position = self._getPosition();
      } catch (e) { self.position = self.position || 0; }
      try { self._stopSource(); } catch (e) { /* ignore */ }
      self.source = null;
      self.playing = false;
      return true;
    };
  }

export default OsuAudio;
