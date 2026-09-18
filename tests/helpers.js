// Shared test helpers: assertions, AMD module loader, DOM/Audio/PIXI stubs.
// All stubs are minimal on purpose: just enough for the repo's game scripts.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = global.ROOT || path.resolve(__dirname, "..");

// ---------- assertions ----------
function assert(cond, msg) {
  if (!cond) throw new Error("assert failed: " + (msg || "condition"));
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(`assert eq failed: ${JSON.stringify(a)} !== ${JSON.stringify(b)}${msg ? " (" + msg + ")" : ""}`);
}
function deepEq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`assert deepEq failed: ${sa} !== ${sb}${msg ? " (" + msg + ")" : ""}`);
}
function finiteArray(arr, msg) {
  assert(Array.isArray(arr), (msg || "array") + " is array");
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) throw new Error(`${msg || "array"}[${i}] is not finite: ${arr[i]}`);
  }
}

// ---------- AMD loader ----------
// Repo scripts use RequireJS-style define(deps, factory). This executes the
// file with a capturing `define` and resolves known deps. Pass { patch } as
// {find, replace} to tweak test-only copies (source on disk is untouched).
const amdCache = new Map();
function loadAmd(relPath, depMap = {}, patch = null) {
  const key = relPath + JSON.stringify(Object.keys(depMap).sort()) + "|" + (patch ? patch.find : "");
  if (amdCache.has(key)) return amdCache.get(key);
  let src = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  if (patch) {
    if (!src.includes(patch.find)) throw new Error(`patch target missing in ${relPath}`);
    src = src.replace(patch.find, patch.replace);
  }
  let captured = null;
  const define = (...args) => {
    // define(factory) or define(deps, factory)
    if (args.length === 1) captured = { deps: [], factory: args[0] };
    else captured = { deps: args[0], factory: args[1] };
  };
  define.amd = {};
  new Function("define", src)(define);
  if (!captured) throw new Error(`no define() call in ${relPath}`);
  const resolved = captured.deps.map((d) => {
    if (Object.prototype.hasOwnProperty.call(depMap, d)) return depMap[d];
    if (d === "underscore") return require(path.join(ROOT, "scripts/lib/underscore.js"));
    if (d.startsWith("curves/")) return loadAmd(`scripts/${d}.js`, depMap);
    throw new Error(`unresolved AMD dep '${d}' in ${relPath}`);
  });
  const exported = captured.factory(...resolved);
  amdCache.set(key, exported);
  return exported;
}
function clearAmdCache() { amdCache.clear(); }

// ---------- DOM stub ----------
function makeElement(tag = "div") {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    children: [],
    clientWidth: 200,
    style: {},
    dataset: {},
    _attrs: {},
    _text: "",
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      contains(c) { return this._s.has(c); },
    },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    removeAttribute(k) { delete this._attrs[k]; },
    appendChild(c) {
      this.children.push(c);
      if (this.tagName === "SELECT" && c && Object.prototype.hasOwnProperty.call(c, "value")) {
        this.options.push(c);
      }
      return c;
    },
    removeChild(c) { const i = this.children.indexOf(c); if (i !== -1) this.children.splice(i, 1); return c; },
    remove() { this._removed = true; },
    get firstChild() { return this.children.length ? this.children[0] : null; },
    closest() { return null; },
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    click() { if (typeof this.onclick === "function") this.onclick({}); },
    set innerText(v) { this._text = String(v); },
    get innerText() { return this._text; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    get innerHTML() { return this._html || ""; },
    get isConnected() { return !this._removed; },
    parentNode: null,
    // media-ish
    volume: 0, currentTime: 0,
    pause() {}, play() { return Promise.resolve(); },
    // input-ish
    value: "", checked: false,
    // select-ish
    options: [],
    // img-ish
    src: "", alt: "", loading: "", width: 0, height: 0,
    onclick: null, onkeydown: null, oninput: null, onchange: null,
  };
  return el;
}
function createDom() {
  const byId = new Map();
  const body = makeElement("body");
  const document = {
    _byId: byId,
    body,
    hidden: false,
    activeElement: null,
    createElement: (t) => makeElement(t),
    getElementById: (id) => byId.get(id) || null,
    getElementsByTagName: () => [],
    addEventListener() {},
    removeEventListener() {},
  };
  return { document, body, byId };
}
// Installs fresh window/document globals; returns them. Old globals restored via returned fn.
function installDom() {
  const { document, body, byId } = createDom();
  const prev = { window: global.window, document: global.document, localforage: global.localforage, fetch: global.fetch };
  global.window = {};
  global.document = document;
  return {
    window: global.window, document, body, byId,
    restore() {
      global.window = prev.window; global.document = prev.document;
      global.localforage = prev.localforage; global.fetch = prev.fetch;
    },
  };
}

// ---------- AudioContext stub ----------
// NOTE: modules like osu-audio capture ONE context at load time, and test
// files share a process, so every file must serve the same singleton or
// results depend on file load order. Pattern:
//   if (!global.__audioCtxStub) global.__audioCtxStub = makeAudioContextStub(...);
//   global.AudioContext = function () { return global.__audioCtxStub; };
// then configure global.__audioCtxStub per test (currentTime/latency).
function makeAudioContextStub(opts = {}) {
  const ctx = {
    state: opts.state || "running",
    currentTime: opts.currentTime || 0,
    outputLatency: opts.outputLatency,
    baseLatency: opts.baseLatency,
    destination: {},
    resumed: 0,
    resume() { this.resumed++; this.state = "running"; return Promise.resolve(); },
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; },
    sources: [],
    createBufferSource() {
      const s = {
        playbackRate: { value: 1 },
        buffer: null, onended: null,
        connect() {}, disconnect() {},
        started: null, stopped: false,
        start(when, offset) { this.started = { when, offset }; },
        stop() { this.stopped = true; },
      };
      ctx.sources.push(s);
      return s;
    },
    decodeMode: opts.decodeMode || "ok", // "ok" | "fail"
    decodeAudioData(buf, ok, err) {
      // async like the real API (also avoids reentrancy during construction)
      setTimeout(() => {
        if (this.decodeMode === "ok") ok({ duration: opts.duration || 180 });
        else if (typeof err === "function") err(new Error("decode failed"));
      }, 0);
    },
  };
  return ctx;
}

// ---------- PIXI stub (just enough for SliderMesh geometry) ----------
function makePixiStub() {
  class Geometry {
    constructor() { this.attrs = {}; this.index = null; }
    addAttribute(name, arr, size) { this.attrs[name] = { data: Array.from(arr), size }; return this; }
    addIndex(idx) { this.index = Array.from(idx); return this; }
    dispose() {}
  }
  class Container {}
  return {
    Geometry, Container,
    Texture: { fromBuffer: () => ({}) },
    Shader: { from: () => ({}) },
    State: { for2d: () => ({}) },
    settings: {},
    DRAW_MODES: { TRIANGLES: 4 },
    BLEND_MODES: { NORMAL: 0, ADD: 1 },
  };
}

module.exports = { assert, eq, deepEq, finiteArray, loadAmd, clearAmdCache, makeElement, createDom, installDom, makeAudioContextStub, makePixiStub, ROOT };
