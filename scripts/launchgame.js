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
    game.stage.addChild(game.cursor);
  }

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
      game.cursor.bringToFront();
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
