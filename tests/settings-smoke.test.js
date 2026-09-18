// Smoke test: boot the real settings binder against stub DOM.
// Catches ID typos between settings.html and scripts/settings.js, broken
// bindings, and restore-to-default crashes.
// NOTE: plain-script eval at module top; see liked.test.js.
const fs = require("fs");
const H = require("./helpers");

const IDS = [
  "settings-panel",
  "dim-range", "dim-range-indicator", "dim-range-value",
  "blur-range", "blur-range-indicator", "blur-range-value",
  "cursorsize-range", "cursorsize-range-indicator", "cursorsize-range-value",
  "showhwmouse-check", "snakein-check", "snakeout-check", "autofullscreen-check",
  "disable-wheel-check", "disable-button-check",
  "lbutton1select", "rbutton1select", "pausebuttonselect", "pausebutton2select",
  "mastervolume-range", "mastervolume-range-indicator", "mastervolume-range-value",
  "effectvolume-range", "effectvolume-range-indicator", "effectvolume-range-value",
  "musicvolume-range", "musicvolume-range-indicator", "musicvolume-range-value",
  "audiooffset-range", "audiooffset-range-indicator", "audiooffset-range-value",
  "beatmap-hitsound-check",
  "apibrowsing-select", "apidownload-select", "backgroundvideo-check",
  "easy-check", "hardrock-check", "daycore-check", "nightcore-check",
  "hidden-check", "relax-check", "autopilot-check", "autoplay-check",
  "hidenumbers-check", "hidegreat-check", "hidefollowpoints-check",
  "restoredefault-btn",
];

// window must BE the global object here: settings.js mixes bare
// `gamesettings` with `window.gamesettings` exactly like a browser.
global.window = global;
global.localStorage = {
  _s: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
  setItem(k, v) { this._s[k] = String(v); },
};
global.addEventListener = function () {};
global.game = {};
{
  const dom = H.createDom();
  for (const id of IDS) {
    const tag = id.endsWith("-select") ? "select" : (/range$/.test(id) ? "input" : (/check$/.test(id) ? "input" : "div"));
    const el = H.makeElement(tag);
    if (/range$/.test(id)) { el.min = "0"; el.max = "100"; el.value = "0"; }
    dom.byId.set(id, el);
  }
  // non-range inputs used as buttons need a value field (stub has it)
  global.document = dom.document;
}
eval(fs.readFileSync(global.ROOT + "/scripts/config.js", "utf8"));
eval(fs.readFileSync(global.ROOT + "/scripts/settings.js", "utf8"));

test("settings: binder boots against the redesigned page ids", () => {
  setOptionPanel(); // must not throw
  H.eq(typeof gamesettings, "object", "gamesettings created");
  H.eq(gamesettings.apiBrowsing, "sayobot", "provider default");
  H.eq(gamesettings.apiDownload, "sayobot", "download default");
  H.eq(gamesettings.backgroundVideo, false, "video default off");
});

test("settings: provider selects built from registry, change persists", () => {
  setOptionPanel();
  const browse = document.getElementById("apibrowsing-select");
  const dl = document.getElementById("apidownload-select");
  const browseVals = browse.options.map((o) => o.value);
  const dlVals = dl.options.map((o) => o.value);
  H.assert(browseVals.includes("sayobot") && browseVals.includes("mino"), "browse options: " + browseVals);
  H.assert(!browseVals.includes("nerinyan"), "nerinyan not browsable");
  H.assert(dlVals.includes("nerinyan"), "nerinyan downloadable: " + dlVals);
  dl.value = "mino";
  dl.onchange();
  H.eq(gamesettings.apiDownload, "mino", "selection saved");
  H.eq(JSON.parse(window.localStorage.getItem("osugamesettings")).apiDownload, "mino", "persisted");
});

test("settings: range chips show values, restore works", () => {
  setOptionPanel();
  const chip = document.getElementById("audiooffset-range-value");
  H.eq(chip.innerText, "0ms", "offset chip, got " + chip.innerText);
  gamesettings.dim = 99; // dirty a value
  document.getElementById("restoredefault-btn").onclick();
  H.eq(gamesettings.dim, 60, "restored to default");
});

test("settings: blocked storage (private mode/shields) degrades gracefully", () => {
  const realStorage = global.localStorage;
  global.localStorage = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
  };
  try {
    setOptionPanel(); // must not throw; falls back to defaults
    H.eq(gamesettings.apiDownload, "sayobot", "defaults when unreadable");
    const dl = document.getElementById("apidownload-select");
    dl.value = "mino";
    dl.onchange(); // must not throw; applies for this session
    H.eq(gamesettings.apiDownload, "mino", "session applies without storage");
  } finally {
    global.localStorage = realStorage;
  }
});
