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
  "showhwmouse-check", "snakein-check", "snakeout-check", "cursortrail-check", "cursorpulse-check", "autofullscreen-check",
  "disable-wheel-check", "disable-button-check",
  "lbutton1select", "rbutton1select", "pausebuttonselect", "pausebutton2select",
  "mastervolume-range", "mastervolume-range-indicator", "mastervolume-range-value",
  "effectvolume-range", "effectvolume-range-indicator", "effectvolume-range-value",
  "musicvolume-range", "musicvolume-range-indicator", "musicvolume-range-value",
  "audiooffset-range", "audiooffset-range-indicator", "audiooffset-range-value",
  "beatmap-hitsound-check",
  "apibrowsing-select", "apidownload-select", "backgroundvideo-check",
  "easy-check", "hardrock-check", "daycore-check", "nightcore-check",
  "doubletime-check", "halftime-check",
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
  H.eq(gamesettings.apiDownload, "mino", "download default");
  H.eq(gamesettings.backgroundVideo, false, "video default off");
  H.eq(gamesettings.cursortrail, true, "trail default on");
  H.eq(gamesettings.cursorpulse, true, "pulse default on");
  H.eq(gamesettings.doubletime, false, "DT default off");
  H.eq(gamesettings.halftime, false, "HT default off");
});

test("settings: rate mods are mutually exclusive", () => {
  // Stacking 0.75x with 1.5x would produce a nonsense rate; checking one
  // clears the other three (boxes and stored values alike).
  setOptionPanel();
  const box = (id) => document.getElementById(id);
  box("doubletime-check").checked = true;
  box("doubletime-check").onclick();
  H.eq(gamesettings.doubletime, true, "DT on");
  H.eq(gamesettings.nightcore, false, "NC cleared");
  H.eq(gamesettings.halftime, false, "HT cleared");
  H.eq(gamesettings.daycore, false, "DC cleared");
  H.eq(box("nightcore-check").checked, false, "NC box cleared");
  box("halftime-check").checked = true;
  box("halftime-check").onclick();
  H.eq(gamesettings.halftime, true, "HT on");
  H.eq(gamesettings.doubletime, false, "DT cleared");
  H.eq(box("doubletime-check").checked, false, "DT box cleared");
  H.eq(JSON.parse(window.localStorage.getItem("osugamesettings")).halftime, true, "persisted");
});

test("settings: cursor visual toggles persist", () => {
  setOptionPanel();
  const trail = document.getElementById("cursortrail-check");
  trail.checked = false;
  trail.onclick();
  H.eq(gamesettings.cursortrail, false, "trail toggle saved");
  const pulse = document.getElementById("cursorpulse-check");
  pulse.checked = false;
  pulse.onclick();
  H.eq(gamesettings.cursorpulse, false, "pulse toggle saved");
  H.eq(JSON.parse(window.localStorage.getItem("osugamesettings")).cursorpulse, false, "persisted");
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

test("settings: saved choices are live before DOMContentLoaded", () => {
  // List-page inline scripts fetch during HTML parsing, before the
  // DOMContentLoaded binder runs. A selected Mino must already route.
  // (Re-evaluating the scripts simulates a fresh page load.)
  const fs = require("fs");
  delete global.window.gamesettings;
  global.localStorage._s.osugamesettings = JSON.stringify({ apiBrowsing: "mino", apiDownload: "nerinyan" });
  eval(fs.readFileSync(global.ROOT + "/scripts/config.js", "utf8"));
  eval(fs.readFileSync(global.ROOT + "/scripts/settings.js", "utf8"));
  H.eq(window.gamesettings.apiBrowsing, "mino", "browsing immediate");
  H.eq(currentProviders().browseId, "mino", "router sees mino pre-DOM");
  H.eq(currentProviders().downloadId, "nerinyan", "download immediate");
  H.assert(buildListUrl("latest", 0, { limit: 20 }).url.indexOf("catboy.best") !== -1, "mino url pre-DOM");
});

test("settings: blocked storage (private mode/shields) degrades gracefully", () => {
  // Fresh boot with unreadable storage: must not throw, must default.
  const fs = require("fs");
  delete global.window.gamesettings;
  const realStorage = global.localStorage;
  global.localStorage = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
  };
  try {
    eval(fs.readFileSync(global.ROOT + "/scripts/settings.js", "utf8"));
    setOptionPanel(); // must not throw; falls back to defaults
    H.eq(gamesettings.apiDownload, "mino", "defaults when unreadable");
    const dl = document.getElementById("apidownload-select");
    dl.value = "nerinyan";
    dl.onchange(); // must not throw; applies for this session
    H.eq(gamesettings.apiDownload, "nerinyan", "session applies without storage");
  } finally {
    global.localStorage = realStorage;
  }
});
