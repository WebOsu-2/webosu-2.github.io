async function launchOSU(osu, beatmapid, version) {
  // NOTE: PIXI comes from window.PIXI, bridged by the initgame entry
  // module (v8 ships no global build). Difficulty launch is gated on
  // window.scriptReady, so the bridge always exists by the time we run.
  // select track
  let trackid = -1;
  // mode can be 0 or undefined
  for (let i = 0; i < osu.tracks.length; ++i)
    if (
      osu.tracks[i].metadata.BeatmapID == beatmapid ||
      (!osu.tracks[i].mode && osu.tracks[i].metadata.Version == version)
    )
      trackid = i;
  console.log("launching", beatmapid, version);
  if (trackid == -1) {
    console.error("no such track");
    console.log("available tracks are:");
    for (let i = 0; i < osu.tracks.length; ++i)
      console.log(
        osu.tracks[i].metadata.BeatmapID,
        osu.tracks[i].mode,
        osu.tracks[i].metadata.Version
      );
    return;
  }
  // prevent launching multiple times
  if (window.app) return;
  // remember sets confirmed to ship a video (drives the VIDEO badge)
  try {
    if (typeof recordKnownVideo === "function" && osu && osu.tracks) {
      for (let i = 0; i < osu.tracks.length; ++i) {
        const tr = osu.tracks[i];
        if (tr && tr.video && tr.video.filename) {
          recordKnownVideo(tr.metadata && tr.metadata.BeatmapSetID);
        }
      }
    }
  } catch (e) { /* ignore */ }
  console.log("launching PIXI app");
  // launch PIXI app (v8: options move to async init; force WebGL since
  // custom shaders target it)
  let viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  let app = (window.app = new PIXI.Application());
  try {
    await app.init({
      width: window.innerWidth,
      height: viewportHeight,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      backgroundColor: 0x111111,
      preference: 'webgl',
    });
  } catch (e) {
    console.error("WebGL init failed:", e);
    window.app = null;
    try {
      if (typeof showErrorToast === "function") showErrorToast("Could not start WebGL: gameplay is disabled on this device/browser.");
      else alert("Could not start WebGL on this device.");
    } catch (err) { /* ignore */ }
    return;
  }

  // Add a resize listener to update the canvas dimensions dynamically
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      if (app && app.renderer) {
        let vpHeight = window.visualViewport.height || window.innerHeight;
        app.renderer.resize(window.innerWidth, vpHeight);
      }
    });
  } else {
    window.addEventListener("resize", () => {
      if (app && app.renderer) {
        app.renderer.resize(window.innerWidth, window.innerHeight);
      }
    });
  }

  // remember where the page is scrolled to
  let scrollTop = document.body.scrollTop;
  // block right-click menu in game (removed again on quit)
  let contextmenuHandler = function (e) {
    e.preventDefault();
    return false;
  };
  document.addEventListener("contextmenu", contextmenuHandler);
  document.body.classList.add("gaming");
  // update game settings
  if (window.gamesettings) {
    window.gamesettings.refresh();
    window.gamesettings.loadToGame();
  }

  // load cursor
  if (!game.showhwmouse || game.autoplay) {
    game.cursor = new PIXI.Sprite(Skin["cursor.png"]);
    game.cursor.anchor.x = game.cursor.anchor.y = 0.5;
    game.cursor.scale.x = game.cursor.scale.y = 0.3 * game.cursorSize;
    game.cursor._baseScale = 0.3 * game.cursorSize;
    game.stage.addChild(game.cursor);
  }

  // Cursor trail (desktop osu! fades small dots behind the cursor):
  // pooled sprites fed from a procedural soft-dot texture, driven off
  // game.mouseX/Y so it works with sprite, hardware and autoplay cursors.
  game.trail = [];
  game.trailCursor = 0;
  game.trailLastX = -1e9;
  game.trailLastY = -1e9;
  game.trailLastT = 0;
  game.cursorPulse = 0;
    if (game.cursorTrail === false) {
      game.trail = [];
    } else try {
      if (typeof window.makeTrailData === "function") {
        const td = window.makeTrailData();
        game.trailTex = new PIXI.Texture({
          source: new PIXI.BufferImageSource({ resource: td.data, width: td.width, height: td.height, alphaMode: 'premultiplied-alpha' }),
        });
        for (let i = 0; i < 20; ++i) {
          const p = new PIXI.Sprite(game.trailTex);
          p.anchor.set(0.5);
          p.visible = false;
          p.blendMode = 'add';
          p.age = 1e9;
          game.stage.addChild(p);
          game.trail.push(p);
        }
      }
    } catch (e) { game.trail = []; }

  // switch page to game view
  if (game.autofullscreen) document.documentElement.requestFullscreen();
  let pGameArea = document.getElementById("game-area");
  var pMainPage = document.getElementById("main-page");
  var pNav = document.getElementById("main-nav");
  pGameArea.appendChild(app.view);
  // rasterize the skin cursor at the chosen size so the hardware cursor
  // honors cursorSize continuously (the old 3-bucket .cur files are only
  // a fallback when the image can't load)
  function setHardwareCursorFallback() {
    if (game.cursorSize < 0.65) pGameArea.classList.add("showhwmousetiny");
    else if (game.cursorSize < 0.95) pGameArea.classList.add("showhwmousesmall");
    else pGameArea.classList.add("showhwmousemedium");
  }
  function setHardwareCursor() {
    try {
      // Sensible pointer size that still honors cursorSize: 48px at 1.0x,
      // rendered at device pixels so HiDPI displays stay sharp (browsers
      // cap cursor bitmaps around ~128px, hence the clamp).
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      const size = Math.max(24, Math.min(128, Math.round(48 * game.cursorSize * dpr)));
      const img = new Image();
      img.onload = function () {
        try {
          const c = document.createElement("canvas");
          c.width = c.height = size;
          const g = c.getContext("2d");
          g.clearRect(0, 0, size, size);
          g.imageSmoothingEnabled = true;
          g.imageSmoothingQuality = "high";
          g.drawImage(img, 0, 0, size, size);
          const hot = Math.floor(size / 2);
          pGameArea.style.cursor = `url("${c.toDataURL()}") ${hot} ${hot}, crosshair`;
        } catch (e) { setHardwareCursorFallback(); }
      };
      img.onerror = setHardwareCursorFallback;
      img.src = "sprites/cursor.png";
    } catch (e) { setHardwareCursorFallback(); }
  }
  if (game.autoplay || game.autopilot) {
    pGameArea.classList.remove("shownomouse");
    pGameArea.classList.remove("showhwmousemedium");
    pGameArea.classList.remove("showhwmousesmall");
    pGameArea.classList.remove("showhwmousetiny");
  } else if (game.showhwmouse) {
    pGameArea.classList.remove("shownomouse");
    setHardwareCursor();
  } else {
    pGameArea.classList.add("shownomouse");
    pGameArea.classList.remove("showhwmousemedium");
    pGameArea.classList.remove("showhwmousesmall");
    pGameArea.classList.remove("showhwmousetiny");
  }
  pMainPage.setAttribute("hidden", "");
  pNav.setAttribute("style", "display: none");
  pGameArea.removeAttribute("hidden");

  var gameLoop;
  // set quit callback
  window.quitGame = function () {
    if (!window.app) return; // already quit / never launched
    try { pGameArea.style.cursor = ""; } catch (e) { /* ignore */ }
    // Hard-stop any gameplay audio and preview <audio> elements so
    // quitting without reload never leaves sound playing/desynced.
    try {
      if (window.playback && window.playback.osu && window.playback.osu.audio) {
        var a = window.playback.osu.audio;
        if (typeof a.stop === "function") a.stop();
        else if (typeof a.pause === "function") a.pause();
      }
    } catch (e) { /* ignore */ }
    try {
      let audios = document.getElementsByTagName("audio");
      // live collection: copy first
      let list = Array.prototype.slice.call(audios);
      for (let i = 0; i < list.length; ++i) {
        try {
          if (list[i].softstop) list[i].softstop();
          else { try { list[i].pause(); } catch (e) {} try { list[i].remove(); } catch (e) {} }
        } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
    try {
      if (contextmenuHandler) document.removeEventListener("contextmenu", contextmenuHandler);
    } catch (e) { /* ignore */ }
    // this shouldn't be called before playback is cleaned up
    // restore webpage state
    pGameArea.setAttribute("hidden", "");
    pMainPage.removeAttribute("hidden");
    pNav.removeAttribute("style");
    document.body.classList.remove("gaming");
    // restore page scroll position
    document.body.scrollTop = scrollTop;
    // TODO application level clean up
    if (game.cursor) {
      game.stage.removeChild(game.cursor);
      game.cursor.destroy();
      game.cursor = null;
    }
    game.trail = [];
    game.trailTex = null;
    window.app.destroy(true, { children: true, texture: false });
    window.app = null;
    gameLoop = null;
    window.cancelAnimationFrame(window.animationRequestID);
  };

  // load playback
  var playback;
  try {
    playback = new Playback(window.game, osu, osu.tracks[trackid]);
  } catch (e) {
    console.error("playback init failed:", e);
    try {
      if (typeof showErrorToast === "function") showErrorToast("Could not start this difficulty (" + (e && e.message ? e.message : "empty track") + ").");
      else alert("Could not start this difficulty.");
    } catch (err) {}
    try { if (window.quitGame) window.quitGame(); } catch (err) {}
    return;
  }
  game.scene = playback;
  playback.onload = function () {
    // stop beatmap preview
    let audios = document.getElementsByTagName("audio");
    for (let i = 0; i < audios.length; ++i) audios[i].softstop();
  };
  if (playback.load() === false) return; // audio missing: already toasted + cleaned up

  // start main loop
  gameLoop = function (timestamp) {
    if (game.scene) {
      game.scene.render(timestamp);
    }
    if (game.cursor) {
      // Handle cursor
      game.cursor.x = (game.mouseX / 512) * gfx.width + gfx.xoffset;
      game.cursor.y = (game.mouseY / 384) * gfx.height + gfx.yoffset;
      // Click pulse (desktop cursor grows while held); gateable in
      // settings, always eases back so a stuck button can't wedge it big.
      // Inflate ramps softly (~140ms) instead of popping; deflate keeps
      // its snappier ~180ms ease.
      const dtPulse = Math.min(100, Math.max(0, timestamp - (game.cursorLastT || timestamp)));
      game.cursorLastT = timestamp;
      if (game.cursorPulseEnabled === false) game.cursorPulse = 0;
      else if (game.down) game.cursorPulse = Math.min(1, (game.cursorPulse || 0) + dtPulse / 140);
      else game.cursorPulse = Math.max(0, (game.cursorPulse || 0) - dtPulse / 180);
      const cs = (game.cursor._baseScale || 0.3 * game.cursorSize) * (1 + 0.3 * game.cursorPulse);
      game.cursor.scale.x = game.cursor.scale.y = cs;
      game.cursor.bringToFront();
    }
    if (game.trail && game.trail.length && game.trailTex) {
      // Trail follows the mapped mouse even with a hardware cursor
      const tx = (game.mouseX / 512) * gfx.width + gfx.xoffset;
      const ty = (game.mouseY / 384) * gfx.height + gfx.yoffset;
      const dtTrail = Math.min(100, Math.max(0, timestamp - (game.trailLastT || timestamp)));
      game.trailLastT = timestamp;
      // First frame: snap (no one has moved the mouse yet; spawning
      // here would stamp a dot at the default corner position).
      if (game.trailLastX < -1e8) {
        game.trailLastX = tx;
        game.trailLastY = ty;
      }
      const moved = Math.hypot(tx - game.trailLastX, ty - game.trailLastY);
      // Small additive glow dots, throttled so slow moves don't pile
      // into a blob: discrete fading sparks like desktop osu!.
      if (moved > 4 && dtTrail > 10) {
        const p = game.trail[game.trailCursor % game.trail.length];
        game.trailCursor++;
        p.x = tx;
        p.y = ty;
        p.age = 0;
        p.peak = game.down ? 0.7 : 0.55;
        p.visible = true;
        game.trailLastX = tx;
        game.trailLastY = ty;
      }
      const base = 0.38 * game.cursorSize;
      for (const p of game.trail) {
        if (!p.visible) continue;
        p.age += dtTrail;
        const u = p.age / 240;
        if (u >= 1) { p.visible = false; continue; }
        p.alpha = (p.peak || 0.55) * (1 - u);
        p.scale.x = p.scale.y = base * (1 - 0.55 * u);
      }
    }
    app.renderer.render(game.stage);
    window.animationRequestID = window.requestAnimationFrame(gameLoop);
  };
  window.animationRequestID = window.requestAnimationFrame(gameLoop);
}

function launchGame(osublob, beatmapid, version) {
  // unzip osz & parse beatmap
  let fs = new zip.fs.FS();
  fs.root.importBlob(
    osublob,
    function () {
      let osu = new Osu(fs.root);
      osu.ondecoded = function () {
        launchOSU(osu, beatmapid, version);
      };
      osu.onerror = function () {
        console.error("osu parse error");
      };
      osu.load();
    },
    function (err) {
      console.error("unzip failed");
    }
  );
}
