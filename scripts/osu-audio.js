// Audio engine (ES module). Relies on browser globals: AudioContext,
// document, game (settings), mp3Parser, showErrorToast.
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
    this.playbackRate = 1.0;
    this.posoffset = 0;

    let t = preprocAudio(filename, buffer);
    if (t.startoffset) this.posoffset = t.startoffset;
    if (t.newbuffer) buffer = t.newbuffer;
    // Compensate for audio output latency (heard audio lags the
    // AudioContext clock). Without this, hits feel systematically early/late
    // on high-latency devices (the "every song out of sync in 2.0" reports).
    try {
      var outLat = (self.audio.outputLatency || 0) + (self.audio.baseLatency || 0);
      if (outLat > 0 && outLat < 1) self._outputLatencyMs = outLat * 1000;
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
          console.log("Song decoded");
          if (typeof callback !== "undefined") {
            callback(self);
          }
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
      if (self.source) {
        try { self.source.onended = null; } catch (e) {}
        try { self.source.stop(); } catch (e) {}
        try { self.source.disconnect(); } catch (e) {}
        self.source = null;
      }
      self.playing = true;
      self.source = self.audio.createBufferSource();
      self.source.playbackRate.value = self.playbackRate;
      self.source.buffer = self.decoded;
      self.source.connect(self.gain);
      self.started = self.audio.currentTime;
      if (wait > 0) {
        self.position = -wait / 1000;
        self.source.start(
          self.audio.currentTime + wait / 1000 / self.playbackRate,
          0
        );
      } else {
        self.source.start(0, Math.max(0, self.position));
      }
    };

    this.stop = function stop() {
      try {
        if (self.source) {
          try { self.source.onended = null; } catch (e) {}
          try { self.source.stop(); } catch (e) {}
          try { self.source.disconnect(); } catch (e) {}
        }
      } catch (e) { /* ignore */ }
      self.source = null;
      self.playing = false;
    };

    // Jump audio clock to ms (used by the Skip-intro button).
    this.skipTo = function skipTo(ms) {
      if (!self.decoded) return false;
      var sec = Math.max(0, ms / 1000);
      try {
        if (sec >= self.decoded.duration) return false;
      } catch (e) { /* ignore duration check */ }
      var wasPlaying = self.playing;
      try {
        if (self.source) {
          try { self.source.onended = null; } catch (e) {}
          try { self.source.stop(); } catch (e) {}
          try { self.source.disconnect(); } catch (e) {}
        }
      } catch (e) { /* ignore */ }
      self.source = null;
      self.position = sec;
      if (wasPlaying) {
        try {
          self.playing = true;
          self.source = self.audio.createBufferSource();
          self.source.playbackRate.value = self.playbackRate;
          self.source.buffer = self.decoded;
          self.source.connect(self.gain);
          self.started = self.audio.currentTime;
          self.source.start(0, sec);
        } catch (e) {
          console.error("skipTo failed", e);
          return false;
        }
      }
      return true;
    };

    // return value true: success
    this.pause = function pause() {
      if (!self.playing) return false;
      try {
        self.position = self._getPosition();
      } catch (e) { self.position = self.position || 0; }
      try {
        if (self.source) {
          try { self.source.onended = null; } catch (e) {}
          try { self.source.stop(); } catch (e) {}
          try { self.source.disconnect(); } catch (e) {}
        }
      } catch (e) { /* ignore */ }
      self.source = null;
      self.playing = false;
      return true;
    };
  }

export default OsuAudio;
