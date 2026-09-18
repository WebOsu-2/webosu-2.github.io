// delayed js loader

function loadScript(url, callback, aux) {
	let script = document.createElement("script");
	document.head.appendChild(script);
	if (callback)
		script.onload = callback;
	if (aux) {
		for (let key in aux) {
			script.setAttribute(key, aux[key]);
		}
	}
	script.src = url;
}



window.beatmaplistLoadedCallback = function () {
	window.setTimeout(function(){
		loadScript("scripts/lib/zip.js", function(){
			window.zip.workerScriptsPath = 'scripts/lib/';
			loadScript("scripts/lib/zip-fs.js", checkdep);
		});
		loadScript("scripts/lib/pixi.min.js", checkdep);
		loadScript("scripts/lib/mp3parse.min.js", checkdep);
		loadScript("scripts/lib/localforage.min.js", checkdep);
		function checkdep() {
			if (!window.aaaaa) window.aaaaa = 0;
			window.aaaaa += 1;
			if (window.aaaaa == 4) {
				// underscore + sound must EXECUTE before the entry module
				// evaluates (it touches both synchronously), so chain them
				// instead of racing parallel inserts.
				loadScript("scripts/lib/underscore.js", function () {
					loadScript("scripts/lib/sound.js", function () {
						// load the game entry as an ES module (game code in
						// scripts/*.js uses import/export; vendor globals above
						// stay classic scripts). data-main/require.js is gone.
						loadScript("scripts/initgame.js", null, { type: "module" });
					});
				});
				// load Liked list
				if (window.localforage) {
					if (!window.liked_sid_set_callbacks) window.liked_sid_set_callbacks = [];
					localforage.getItem("likedsidset", function(err, item) {
	                    if (!err) {
	                    	// Migrate legacy Set storage to plain Array (JSON-safe).
	                    	// Old Set values serialized via localStorage fallback became {},
	                    	// which wiped favourites. normalizeLikedList is defined in
	                    	// addbeatmaplist.js when that script has loaded; fall back
	                    	// to a local minimal normalization otherwise.
	                    	var normalize = (typeof normalizeLikedList === "function")
	                    		? normalizeLikedList
	                    		: function (val) {
	                    			if (!val) return [];
	                    			if (typeof Set !== "undefined" && val instanceof Set) return Array.from(val);
	                    			if (Array.isArray(val)) return val.filter(function (x) { return x || x === 0; });
	                    			return [];
	                    		};
	                    	window.liked_sid_set = normalize(item);
	                    	// persist migrated form so old corrupt values don't linger
	                    	try {
	                    		if (item && !(Array.isArray(item))) {
	                    			localforage.setItem("likedsidset", window.liked_sid_set, function () {});
	                    		}
	                    	} catch (e) { /* ignore */ }
	                    	var cbs = window.liked_sid_set_callbacks || [];
	                    	for (let i=0; i<cbs.length; ++i) {
	                    		try { cbs[i](); } catch (e) { console.error(e); }
	                    	}
	                    	window.liked_sid_set_callbacks = [];
	                    }
	                    else {
	                    	console.error("failed loading liked list");
	                    	window.liked_sid_set = [];
	                    }
                	});
				}
			}
		}

	}, 0);
}

