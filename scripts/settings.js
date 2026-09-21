// ---- settings state ----
// Initialized IMMEDIATELY at script eval (not on DOMContentLoaded):
// list-page inline scripts fetch beatmaps during HTML parsing, before
// DOMContentLoaded fires, and must already see saved choices (provider,
// video flag). Widget binding still waits for the DOM in setOptionPanel.
function storageGet(key) {
  // localStorage access itself throws under private mode / shields that
  // block storage (e.g. Brave mobile): without guards the whole settings
  // init dies and every choice silently reverts to defaults on reload.
  try {
    const s = window.localStorage;
    return s ? s.getItem(key) : null;
  } catch (e) { return null; }
}
function storageSet(key, val) {
  try {
    const s = window.localStorage;
    if (s) s.setItem(key, val);
  } catch (e) { /* session-only settings */ }
}
// Coerce stored settings: a single corrupt/legacy value (e.g. a null or
// non-numeric audio offset) used to poison the audio clock with NaN and
// freeze every game at load. Unknown keys are dropped.
function sanitizeSettings(s) {
  const numericKeys = ["dim", "blur", "cursorsize", "mastervolume",
    "effectvolume", "musicvolume", "audiooffset",
    "K1keycode", "K2keycode", "Kpausekeycode", "Kpause2keycode"];
  const out = {};
  if (!s || typeof s !== "object") return out;
  for (const k of Object.keys(s)) {
    if (!(k in defaultsettings)) continue; // drop unknown/legacy keys
    if (numericKeys.includes(k)) {
      const n = parseFloat(s[k]);
      if (Number.isFinite(n)) out[k] = n;
      // else: fall back to the default already in gamesettings
    } else {
      out[k] = s[k];
    }
  }
  return out;
}
function loadFromLocal() {
  let str = storageGet("osugamesettings");
  if (str) {
    try {
      let s = JSON.parse(str);
      if (s) Object.assign(gamesettings, sanitizeSettings(s));
    } catch (e) { console.error("bad saved settings, using defaults", e); }
  }
}

function saveToLocal() {
  storageSet(
    "osugamesettings",
    JSON.stringify(window.gamesettings)
  );
}

// give inputs initial value; set their callback on change
// give range inputs a visual feedback (a hovering indicator that shows on drag)

var defaultsettings = {
    dim: 60,
    blur: 0,
    cursorsize: 1.0,
    showhwmouse: false,
    snakein: true,
    snakeout: true,
    cursortrail: true,
    cursorpulse: true,
    autofullscreen: false,

    disableWheel: false,
    disableButton: false,
    K1name: "Z",
    K2name: "X",
    Kpausename: "SPACE",
    Kpause2name: "ESC",
    K1keycode: 90,
    K2keycode: 88,
    Kpausekeycode: 32,
    Kpause2keycode: 27,

    mastervolume: 60,
    effectvolume: 100,
    musicvolume: 100,
    audiooffset: 0,
    beatmapHitsound: true,

    // beatmap API providers (see scripts/config.js)
    apiBrowsing: "sayobot",
    apiDownload: "mino",
    backgroundVideo: false,

    easy: false,
    daycore: false,
    hardrock: false,
    nightcore: false,
    doubletime: false,
    halftime: false,
    hidden: false,
    autoplay: false,
    relax: false,
    autopilot: false,

    hideNumbers: false,
    hideGreat: false,
    hideFollowPoints: false,
  };
window.gamesettings = {};
Object.assign(gamesettings, defaultsettings);
gamesettings.refresh = loadFromLocal;
loadFromLocal();

function setOptionPanel() {
  // re-sync (cheap) in case storage changed since head eval
  loadFromLocal();

  window.gamesettings.loadToGame = function () {
    if (window.game) {
      window.game.backgroundDimRate = this.dim / 100;
      window.game.backgroundBlurRate = this.blur / 100;
      window.game.cursorSize = parseFloat(this.cursorsize);
      window.game.showhwmouse = this.showhwmouse;
      window.game.snakein = this.snakein;
      window.game.snakeout = this.snakeout;
      window.game.cursorTrail = this.cursortrail;
      window.game.cursorPulseEnabled = this.cursorpulse;
      window.game.autofullscreen = this.autofullscreen;

      window.game.allowMouseScroll = !this.disableWheel;
      window.game.allowMouseButton = !this.disableButton;
      window.game.K1keycode = this.K1keycode;
      window.game.K2keycode = this.K2keycode;
      window.game.ESCkeycode = this.Kpausekeycode;
      window.game.ESC2keycode = this.Kpause2keycode;

      window.game.masterVolume = this.mastervolume / 100;
      window.game.effectVolume = this.effectvolume / 100;
      window.game.musicVolume = this.musicvolume / 100;
      window.game.beatmapHitsound = this.beatmapHitsound;
      window.game.globalOffset = parseFloat(this.audiooffset);

      window.game.apiBrowsing = this.apiBrowsing;
      window.game.apiDownload = this.apiDownload;
      window.game.backgroundVideo = !!this.backgroundVideo;

      window.game.easy = this.easy;
      window.game.daycore = this.daycore;
      window.game.hardrock = this.hardrock;
      window.game.nightcore = this.nightcore;
      window.game.doubletime = this.doubletime;
      window.game.halftime = this.halftime;
      window.game.hidden = this.hidden;
      window.game.autoplay = this.autoplay;
      window.game.relax = this.relax;
      window.game.autopilot = this.autopilot;

      window.game.hideNumbers = this.hideNumbers;
      window.game.hideGreat = this.hideGreat;
      window.game.hideFollowPoints = this.hideFollowPoints;
    }
  };
  gamesettings.loadToGame();
  // this will also be called on game side. The latter call makes effect
  if (!document.getElementById("settings-panel")) return;

  // functions that get called when settings are restored to default
  // used for refreshing widgets on the page
  gamesettings.restoreCallbacks = [];
  function settingRow(element) {
    if (!element) return null;
    // .setting is the redesigned row; fall back to the legacy table cell
    // chain for any markup that still uses it.
    if (element.closest) {
      const row = element.closest(".setting");
      if (row) return row;
    }
    return element.parentElement && element.parentElement.parentElement && element.parentElement.parentElement.parentElement;
  }
  function checkdefault(element, item) {
    const row = settingRow(element);
    if (!row || !row.classList) return;
    if (gamesettings[item] == defaultsettings[item])
      row.classList.remove("non-default");
    else
      row.classList.add("non-default");
  }
  // FIXME: checkdefault: 1 to 1 bind
  function bindcheck(id, item) {
    let c = document.getElementById(id);
    if (!c) return;
    c.checked = gamesettings[item];
    gamesettings.restoreCallbacks.push(function () {
      c.checked = gamesettings[item];
      checkdefault(c, item);
    });
    checkdefault(c, item);
    c.onclick = function () {
      gamesettings[item] = c.checked;
      checkdefault(c, item);
      gamesettings.loadToGame();
      saveToLocal();
    };
  }

  // Rate mods are mutually exclusive (stacking 0.75x with 1.5x would
  // produce a nonsense rate): checking one clears the other three.
  function bindRateMods(idsItems) {
    const boxes = idsItems.map(([id, item]) => {
      const c = document.getElementById(id);
      if (c) c.checked = gamesettings[item];
      return c;
    });
    const sync = () => {
      idsItems.forEach(([id, item], i) => {
        if (boxes[i]) {
          boxes[i].checked = gamesettings[item];
          checkdefault(boxes[i], item);
        }
      });
    };
    gamesettings.restoreCallbacks.push(sync);
    sync();
    boxes.forEach((c, i) => {
      if (!c) return;
      c.onclick = function () {
        idsItems.forEach(([, item], j) => {
          gamesettings[item] = (i === j) ? c.checked : false;
        });
        sync();
        gamesettings.loadToGame();
        saveToLocal();
      };
    });
  }
  function bindExclusiveCheck(id1, item1, id2, item2) {
    let c1 = document.getElementById(id1);
    let c2 = document.getElementById(id2);
    c1.checked = gamesettings[item1];
    c2.checked = gamesettings[item2];
    gamesettings.restoreCallbacks.push(function () {
      c1.checked = gamesettings[item1];
      c2.checked = gamesettings[item2];
      checkdefault(c1, item1);
      checkdefault(c2, item2);
    });
    checkdefault(c1, item1);
    checkdefault(c2, item2);
    c1.onclick = function () {
      gamesettings[item1] = c1.checked;
      gamesettings[item2] = false;
      c2.checked = false;
      gamesettings.loadToGame();
      saveToLocal();
      checkdefault(c1, item1);
      checkdefault(c2, item2);
    };
    c2.onclick = function () {
      gamesettings[item2] = c2.checked;
      gamesettings[item1] = false;
      c1.checked = false;
      gamesettings.loadToGame();
      saveToLocal();
      checkdefault(c1, item1);
      checkdefault(c2, item2);
    };
  }
  function bindExclusiveCheck3(id1, item1, id2, item2, id3, item3) {
    let c1 = document.getElementById(id1);
    let c2 = document.getElementById(id2);
    let c3 = document.getElementById(id3);
    c1.checked = gamesettings[item1];
    c2.checked = gamesettings[item2];
    c3.checked = gamesettings[item3];
    gamesettings.restoreCallbacks.push(function () {
      c1.checked = gamesettings[item1];
      c2.checked = gamesettings[item2];
      c3.checked = gamesettings[item3];
      checkdefault(c1, item1);
      checkdefault(c2, item2);
      checkdefault(c3, item3);
    });
    checkdefault(c1, item1);
    checkdefault(c2, item2);
    checkdefault(c3, item3);
    c1.onclick = function () {
      gamesettings[item1] = c1.checked;
      gamesettings[item2] = false;
      gamesettings[item3] = false;
      // c1.checked = false;
      c2.checked = false;
      c3.checked = false;
      gamesettings.loadToGame();
      saveToLocal();
      checkdefault(c1, item1);
      checkdefault(c2, item2);
      checkdefault(c3, item3);
    };
    c2.onclick = function () {
      gamesettings[item1] = false;
      gamesettings[item2] = c2.checked;
      gamesettings[item3] = false;
      c1.checked = false;
      // c2.checked = false;
      c3.checked = false;
      gamesettings.loadToGame();
      saveToLocal();
      checkdefault(c1, item1);
      checkdefault(c2, item2);
      checkdefault(c3, item3);
    };
    c3.onclick = function () {
      gamesettings[item1] = false;
      gamesettings[item2] = false;
      gamesettings[item3] = c3.checked;
      c1.checked = false;
      c2.checked = false;
      // c3.checked = false;
      gamesettings.loadToGame();
      saveToLocal();
      checkdefault(c1, item1);
      checkdefault(c2, item2);
      checkdefault(c3, item3);
    };
  }


  function bindrange(id, item, feedback) {
    let range = document.getElementById(id);
    if (!range) return;
    let indicator = document.getElementById(id + "-indicator");
    let chip = document.getElementById(id + "-value");
    range.addEventListener("mousedown", function () {
      if (indicator) indicator.removeAttribute("hidden");
    });
    range.addEventListener("mouseup",function () {
      if (indicator) indicator.setAttribute("hidden", "");
    });
    range.addEventListener("touchstart", function () {
      if (indicator) indicator.removeAttribute("hidden");
    });
    range.addEventListener("touchend",function () {
      if (indicator) indicator.setAttribute("hidden", "");
    });
    range.oninput = function () {
      let min = parseFloat(range.min);
      let max = parseFloat(range.max);
      let val = parseFloat(range.value);
      let pos = (val - min) / (max - min);
      let length = range.clientWidth - 20;
      if (indicator) {
        indicator.style.left = pos * length + 13 + "px";
        indicator.innerText = feedback(val);
      }
      if (chip) chip.innerText = feedback(val);
      gamesettings[item] = range.value;
      checkdefault(range, item);
    };
    range.value = gamesettings[item];
    gamesettings.restoreCallbacks.push(function () {
      range.value = gamesettings[item];
      range.oninput();
      checkdefault(range, item);
    });
    range.oninput();
    range.onchange = function () {
      gamesettings[item] = range.value;
      gamesettings.loadToGame();
      saveToLocal();
      checkdefault(range, item);
    };
  }

  function bindselect(id, item, options) {
    // options: [{ value, label }] or null to build from API_PROVIDERS.
    let sel = document.getElementById(id);
    if (!sel) return;
    function isAllowed(p) {
      if (id === "apibrowsing-select") return p.browse;
      return true; // download select offers every provider
    }
    let opts = options;
    if (!opts && typeof API_PROVIDERS !== "undefined") {
      opts = Object.keys(API_PROVIDERS)
        .filter(function (k) { return isAllowed(API_PROVIDERS[k]); })
        .map(function (k) { return { value: k, label: API_PROVIDERS[k].name }; });
    }
    if (opts) {
      // rebuild to stay in sync with the registry
      while (sel.firstChild) sel.removeChild(sel.firstChild);
      opts.forEach(function (o) {
        let el = document.createElement("option");
        el.value = o.value;
        el.innerText = o.label;
        sel.appendChild(el);
      });
    }
    // sanitize stored value (e.g. nerinyan kept for downloads, never browse)
    let allowed = Array.prototype.map.call(sel.options, function (o) { return o.value; });
    if (allowed.indexOf(gamesettings[item]) === -1) gamesettings[item] = defaultsettings[item];
    sel.value = gamesettings[item];
    gamesettings.restoreCallbacks.push(function () {
      sel.value = gamesettings[item];
      checkdefault(sel, item);
    });
    checkdefault(sel, item);
    sel.onchange = function () {
      gamesettings[item] = sel.value;
      gamesettings.loadToGame();
      saveToLocal();
      checkdefault(sel, item);
    };
  }

  function bindkeyselector(id, keynameitem, keycodeitem) {
    let btn = document.getElementById(id);
    let activate = function () {
      let t_onkeydown = window.onkeydown;
      window.onkeydown = null;
      let deactivate = function () {
        window.onkeydown = t_onkeydown;
        btn.onclick = activate;
        btn.classList.remove("using");
        document.removeEventListener("keydown", listenkey);
        checkdefault(btn, keynameitem);
      };
      let listenkey = function (e) {
        e = e || window.event;
        e.stopPropagation();
        gamesettings[keycodeitem] = e.keyCode;
        gamesettings[keynameitem] = e.key.toUpperCase();
        if (gamesettings[keynameitem] == " ")
          gamesettings[keynameitem] = "SPACE";
        if (gamesettings[keynameitem] == "ESCAPE")
          gamesettings[keynameitem] = "ESC";
        btn.value = gamesettings[keynameitem];
        gamesettings.loadToGame();
        saveToLocal();
        deactivate();
      };
      btn.classList.add("using");
      document.addEventListener("keydown", listenkey);
      btn.onclick = deactivate;
    };
    checkdefault(btn, keynameitem);
    btn.onclick = activate;
    btn.value = gamesettings[keynameitem];
    gamesettings.restoreCallbacks.push(function () {
      btn.value = gamesettings[keynameitem];
      checkdefault(btn, keynameitem);
    });
  }

  // gameplay settings
  bindrange("dim-range", "dim", function (v) {
    return v + "%";
  });
  bindrange("blur-range", "blur", function (v) {
    return v + "%";
  });
  bindrange("cursorsize-range", "cursorsize", function (v) {
    return v.toFixed(2) + "x";
  });
  bindcheck("showhwmouse-check", "showhwmouse");
  bindcheck("snakein-check", "snakein");
  bindcheck("snakeout-check", "snakeout");
  bindcheck("cursortrail-check", "cursortrail");
  bindcheck("cursorpulse-check", "cursorpulse");
  bindcheck("autofullscreen-check", "autofullscreen");

  // input settings
  bindcheck("disable-wheel-check", "disableWheel");
  bindcheck("disable-button-check", "disableButton");
  bindkeyselector("lbutton1select", "K1name", "K1keycode");
  bindkeyselector("rbutton1select", "K2name", "K2keycode");
  bindkeyselector("pausebutton2select", "Kpause2name", "Kpause2keycode");
  bindkeyselector("pausebuttonselect", "Kpausename", "Kpausekeycode");

  // audio settings
  bindrange("mastervolume-range", "mastervolume", function (v) {
    return v + "%";
  });
  bindrange("effectvolume-range", "effectvolume", function (v) {
    return v + "%";
  });
  bindrange("musicvolume-range", "musicvolume", function (v) {
    return v + "%";
  });
  bindrange("audiooffset-range", "audiooffset", function (v) {
    return Math.round(Number(v)) + "ms";
  });
  bindcheck("beatmap-hitsound-check", "beatmapHitsound");

  // beatmap sources
  bindselect("apibrowsing-select", "apiBrowsing");
  bindselect("apidownload-select", "apiDownload");
  bindcheck("backgroundvideo-check", "backgroundVideo");

  // mods
  bindExclusiveCheck("easy-check", "easy", "hardrock-check", "hardrock");
  bindRateMods([
    ["doubletime-check", "doubletime"],
    ["nightcore-check", "nightcore"],
    ["halftime-check", "halftime"],
    ["daycore-check", "daycore"],
  ]);
  bindExclusiveCheck3(
    "relax-check",
    "relax",
    "autopilot-check",
    "autopilot",
    "autoplay-check",
    "autoplay"
  )
  bindcheck("hidden-check", "hidden");

  // skin
  bindcheck("hidenumbers-check", "hideNumbers");
  bindcheck("hidegreat-check", "hideGreat");
  bindcheck("hidefollowpoints-check", "hideFollowPoints");

  document.getElementById("restoredefault-btn").onclick = function () {
    Object.assign(gamesettings, defaultsettings);
    for (let i = 0; i < gamesettings.restoreCallbacks.length; ++i)
      gamesettings.restoreCallbacks[i]();
    gamesettings.loadToGame();
    saveToLocal();
  };
}

window.addEventListener("DOMContentLoaded", setOptionPanel);

// press any key to search (only on pages with a search box; never steal
// focus or throw on pages without inputs)
window.onkeydown = function (e) {
  if (!e || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.key.length == 1 && e.key != " ") {
    let inputs = document.getElementsByTagName("input");
    if (!inputs || !inputs.length) return;
    let textinput = inputs[0];
    if (document.activeElement === textinput) return;
    // only text-like inputs can receive the keystroke
    if (textinput.type && textinput.type !== "text" && textinput.type !== "search") return;
    textinput.focus();
  }
};
