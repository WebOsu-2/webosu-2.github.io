// ---- Liked (favourites) storage helpers ----
// Historically likedsidset was stored as a Set. Set does not survive JSON
// localStorage fallbacks (becomes {}), which silently wiped favourites.
// We now store a plain Array of sids and transparently migrate old values.
function normalizeLikedList(val) {
    if (!val) return [];
    // legacy in-memory Set (or IndexedDB structured-clone Set)
    if (typeof Set !== "undefined" && val instanceof Set) return Array.from(val).filter(function (x) { return x || x === 0; });
    if (Array.isArray(val)) {
        // dedupe, drop falsy
        var seen = {};
        var out = [];
        for (var i = 0; i < val.length; ++i) {
            var sid = val[i];
            if (!sid && sid !== 0) continue;
            var k = String(sid);
            if (!seen[k]) { seen[k] = true; out.push(sid); }
        }
        return out;
    }
    // corrupted JSON-serialized Set looks like {} — unrecoverable, start fresh
    // (previously this caused "favourites deleted sometimes" / empty tab)
    if (typeof val === "object") {
        // last resort: if it looks array-like with numeric keys, collect values
        var vals = [];
        try {
            var keys = Object.keys(val);
            // plain {} from JSON Set has no useful keys — return []
            if (keys.length && keys.every(function (k) { return String(parseInt(k, 10)) === k; })) {
                for (var j = 0; j < keys.length; ++j) vals.push(val[keys[j]]);
                return normalizeLikedList(vals);
            }
        } catch (e) { /* ignore */ }
        return [];
    }
    return [];
}
function likedHas(sid) {
    var list = window.liked_sid_set;
    if (!list) return false;
    if (typeof Set !== "undefined" && list instanceof Set) return list.has(sid);
    if (Array.isArray(list)) return list.indexOf(sid) !== -1;
    return false;
}
function saveLikedList() {
    var store = (window.localforage) || ((typeof localforage !== "undefined") ? localforage : null);
    if (!store) return;
    try {
        // always persist as Array (JSON-safe)
        var arr = normalizeLikedList(window.liked_sid_set);
        window.liked_sid_set = arr;
        store.setItem("likedsidset", arr, function (err) {
            if (err) console.error("Error saving liked beatmap list");
        });
    } catch (e) {
        console.error("Error saving liked beatmap list", e);
    }
}
function likedAdd(sid) {
    if (!window.liked_sid_set) window.liked_sid_set = [];
    // migrate legacy Set in place
    if (typeof Set !== "undefined" && window.liked_sid_set instanceof Set) {
        window.liked_sid_set = normalizeLikedList(window.liked_sid_set);
    }
    if (!Array.isArray(window.liked_sid_set)) window.liked_sid_set = normalizeLikedList(window.liked_sid_set);
    if (window.liked_sid_set.indexOf(sid) === -1) window.liked_sid_set.push(sid);
    saveLikedList();
}
function likedDelete(sid) {
    if (!window.liked_sid_set) return;
    if (typeof Set !== "undefined" && window.liked_sid_set instanceof Set) {
        window.liked_sid_set.delete(sid);
        // migrate to Array on next save
        saveLikedList();
        return;
    }
    if (Array.isArray(window.liked_sid_set)) {
        var i = window.liked_sid_set.indexOf(sid);
        if (i !== -1) window.liked_sid_set.splice(i, 1);
        saveLikedList();
    }
}
if (!window.liked_sid_set_callbacks) window.liked_sid_set_callbacks = [];
if (!window.video_sid_set_callbacks) window.video_sid_set_callbacks = [];

// ---- Known-video registry ----
// SayoBot never flags video maps, so remember ground truth locally: any
// downloaded set containing a video file gets the VIDEO badge from then
// on, regardless of provider. Stored as a plain Array (see liked note).
function normalizeSidList(val) {
    if (!val) return [];
    if (typeof Set !== "undefined" && val instanceof Set) return Array.from(val);
    if (Array.isArray(val)) return val.filter(function (x) { return x || x === 0; });
    return [];
}
function sidKey(sid) { return String(sid); }
function hasKnownVideo(sid) {    const list = window.video_sid_set;
    if (!Array.isArray(list) || sid === undefined || sid === null) return false;
    const k = sidKey(sid);
    for (let i = 0; i < list.length; ++i) {
        if (sidKey(list[i]) === k) return true;
    }
    return false;
}
function recordKnownVideo(sid) {
    if (sid === undefined || sid === null || sid === "") return;
    if (!Array.isArray(window.video_sid_set)) {
        window.video_sid_set = normalizeSidList(window.video_sid_set);
    }
    if (!hasKnownVideo(sid)) {
        window.video_sid_set.push(typeof sid === "number" ? sid : (Number(sid) || sid));
        try {
            const store = window.localforage || ((typeof localforage !== "undefined") ? localforage : null);
            if (store) store.setItem("videosidset", window.video_sid_set, function () {});
        } catch (e) { /* ignore */ }
    }
}
function boxHasVideoBadge(box, map) {
    if (!box || !map) return;
    function add() {
        if (box.querySelector && box.querySelector(".beatmapvideo")) return;
        // querySelector may not exist on stub/minimal DOM; fall back to scan
        if (!box.querySelector) {
            const kids = box.children || box.childNodes || [];
            for (let i = 0; i < kids.length; ++i) {
                if (kids[i] && kids[i].className === "beatmapvideo") return;
            }
        }
        let el = document.createElement("div");
        el.className = "beatmapvideo";
        el.innerText = "VIDEO";
        el.title = "This beatmap has a background video";
        box.appendChild(el);
    }
    if (map.video || hasKnownVideo(map.sid) || (box.sid !== undefined && hasKnownVideo(box.sid))) {
        add();
        return;
    }
    // video registry may load after the box; re-check once ready
    if (!window.video_sid_set) {
        window.video_sid_set_callbacks.push(function () { boxHasVideoBadge(box, map); });
    }
}

function starname(star) {
    if (typeof (star) == "null") return "unknown";
    if (typeof (star) == "undefined") return "unknown";
    if (star < 2) return "easy";
    if (star < 2.7) return "normal";
    if (star < 4) return "hard";
    if (star < 5.3) return "insane";
    if (star < 6.5) return "expert";
    return "expert-plus";
}

// star: number; numerical representation of star rating
// returns an html element used in difficulty selection menu
function createStarRow(star) {
    let row = document.createElement("div");
    row.className = "star-row";
    for (let i = 0; i < 10; ++i) {
        let container = document.createElement("div");
        container.className = "imgcontainer";
        let img = document.createElement("img");
        container.appendChild(img);
        row.appendChild(container);
        img.src = "star.png";
        let value = Math.min(Math.max(star - i, 0), 1);
        let size = 8 + value * 10;
        let pad = (1 - value) * 5;
        let style = "width:" + size + "px;";
        style += "bottom:" + pad + "px;";
        style += "left:" + pad + "px;";
        if (value == 0) {
            style += "opacity:0.4;";
        }
        img.setAttribute("style", style);
    }
    return row;
}
// creates a difficulty selection menu
function createDifficultyList(boxclicked, event) {
    // check if a list of this kind is already there
    if (window.currentDifficultyList) {
        window.removeEventListener("click", window.currentDifficultyList.clicklistener);
        window.currentDifficultyList.parentElement.removeChild(window.currentDifficultyList);
        window.currentDifficultyList = null;
    }
    // window.showingDifficultyList = true;
    event.stopPropagation();
    // calculate list position on page
    let rect = boxclicked.getBoundingClientRect();
    let x = event.clientX - rect.left;
    let y = event.clientY - rect.top;
    // create list
    let difficultyBox = document.createElement("div");
    window.currentDifficultyList = difficultyBox;
    difficultyBox.className = "difficulty-box";
    difficultyBox.style.left = x + "px";
    difficultyBox.style.top = y + "px";
    boxclicked.appendChild(difficultyBox);
    // close list if clicked outside
    var closeDifficultyList = function () {
        boxclicked.removeChild(difficultyBox);
        window.currentDifficultyList = null;
        window.removeEventListener('click', closeDifficultyList, false);
    };
    window.addEventListener("click", closeDifficultyList, false);
    difficultyBox.clicklistener = closeDifficultyList;
    // fill list
    for (let i = 0; i < boxclicked.data.length; ++i) {
        // add a row
        let difficultyItem = document.createElement("div");
        difficultyItem.className = "difficulty-item";
        difficultyBox.appendChild(difficultyItem);
        difficultyItem.data = boxclicked.data[i];
        // add ring icon representing star
        let ringbase = document.createElement("div");
        let ring = document.createElement("div");
        ringbase.className = "bigringbase";
        ring.className = "bigring";
        ring.classList.add(starname(boxclicked.data[i].star));
        difficultyItem.appendChild(ringbase);
        difficultyItem.appendChild(ring);
        // add version name & mapper
        let line = document.createElement("div");
        let version = document.createElement("div");
        let mapper = document.createElement("div");
        line.className = "versionline";
        version.className = "version";
        mapper.className = "mapper";
        line.appendChild(version);
        line.appendChild(mapper);
        difficultyItem.appendChild(line);
        version.innerText = boxclicked.data[i].version;
        mapper.innerText = "mapped by " + boxclicked.data[i].creator;
        // add row of stars
        difficultyItem.appendChild(createStarRow(boxclicked.data[i].star));
        // add callbacks
        difficultyItem.onhover = function () {

        }
        difficultyItem.setAttribute("tabindex", "0");
        difficultyItem.setAttribute("role", "button");
        difficultyItem.setAttribute("aria-label", "Play " + boxclicked.data[i].version);
        difficultyItem.activate = function () {
            // need game assets ready
            if (!window.scriptReady || !window.soundReady || !window.skinReady) {
                return;
            }
            var box = this.parentElement.parentElement;
            var bid = this.data.bid;
            var version = this.data.version;
            // lazy: fetch full .osz only when a difficulty is picked
            if (!box.oszblob) {
                var self = this;
                if (!box.downloading) {
                    try { self.classList.add("downloading"); } catch (e) {}
                }
                startdownload(box, function () {
                    try { self.classList.remove("downloading"); } catch (e) {}
                    self.activate();
                });
                return;
            }
            launchGame(box.oszblob, bid, version);
        };
        difficultyItem.onclick = function (e) {
            this.activate();
        };
        difficultyItem.onkeydown = function (e) {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                this.activate();
            }
        };
    }
    difficultyBox.onclick = function (e) {
        e.stopPropagation();
    }
}


var NSaddBeatmapList = {

    addlikeicon: function (box) {
        let icon = document.createElement("div");
        icon.className = "beatmaplike";
        icon.setAttribute("hidden", "");
        icon.setAttribute("tabindex", "0");
        icon.setAttribute("role", "button");
        icon.setAttribute("aria-label", "Favourite beatmap");
        box.appendChild(icon);
        // keyboard activation mirrors click
        icon.onkeydown = function (e) {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                if (typeof icon.onclick === "function") icon.onclick(e);
            }
        };
        box.initlike = function () {
            if (!window.liked_sid_set || !box.sid) {
                return;
            }
            // migrate legacy Set to Array once loaded
            if (typeof Set !== "undefined" && window.liked_sid_set instanceof Set) {
                window.liked_sid_set = normalizeLikedList(window.liked_sid_set);
            }
            if (likedHas(box.sid)) {
                icon.classList.add("icon-heart");
                icon.setAttribute("aria-pressed", "true");
                icon.onclick = box.undolike;
            }
            else {
                icon.classList.add("icon-heart-empty");
                icon.setAttribute("aria-pressed", "false");
                icon.onclick = box.like;
            }
            icon.removeAttribute("hidden");
        }
        box.like = function (e) {
            e.stopPropagation();
            likedAdd(box.sid);
            icon.classList.add("hint-liked");
            icon.setAttribute("aria-pressed", "true");
            icon.onclick = box.undolike;
            icon.classList.remove("icon-heart-empty");
            icon.classList.add("icon-heart");
        }
        box.undolike = function (e) {
            e.stopPropagation();
            likedDelete(box.sid);
            icon.onclick = box.like;
            icon.classList.remove("icon-heart");
            icon.classList.add("icon-heart-empty");
            icon.classList.remove("hint-liked");
            icon.setAttribute("aria-pressed", "false");
        }
        if (window.liked_sid_set) {
            box.initlike();
        }
        else {
            if (!window.liked_sid_set_callbacks)
                window.liked_sid_set_callbacks = [];
            window.liked_sid_set_callbacks.push(box.initlike);
        }
    },

    // map contains key: sid, title, artist, creator
    addpreviewbox: function (map, list) {
        function approvedText(status) {
            if (status == 4) return "LOVED";
            if (status == 3) return "QUALIFIED";
            if (status == 2) return "APPROVED";
            if (status == 1) return "RANKED";
            if (status == 0) return "PENDING";
            if (status == -1) return "WIP";
            if (status == -2) return "GRAVEYARD";
            return "UNKNOWN";
        }
        // create container of beatmap on web page
        let pBeatmapBox = document.createElement("div");
        pBeatmapBox.setdata = map;
        pBeatmapBox.sid = map.sid;
        let pBeatmapCover = document.createElement("img");
        let pBeatmapCoverOverlay = document.createElement("div");
        let pBeatmapTitle = document.createElement("div");
        let pBeatmapArtist = document.createElement("div");
        let pBeatmapCreator = document.createElement("div");
        let pBeatmapApproved = document.createElement("div");
        pBeatmapBox.className = "beatmapbox";
        pBeatmapCover.className = "beatmapcover";
        pBeatmapCoverOverlay.className = "beatmapcover-overlay";
        pBeatmapTitle.className = "beatmaptitle";
        pBeatmapArtist.className = "beatmapartist";
        pBeatmapCreator.className = "beatmapcreator";
        pBeatmapApproved.className = "beatmapapproved";
        pBeatmapBox.appendChild(pBeatmapCover);
        pBeatmapBox.appendChild(pBeatmapCoverOverlay);
        pBeatmapBox.appendChild(pBeatmapTitle);
        pBeatmapBox.appendChild(pBeatmapArtist);
        pBeatmapBox.appendChild(pBeatmapCreator);
        pBeatmapBox.appendChild(pBeatmapApproved);
        NSaddBeatmapList.addlikeicon(pBeatmapBox);
        // set beatmap title & artist display (prefer ascii title)
        pBeatmapTitle.innerText = map.title;
        pBeatmapArtist.innerText = map.artist;
        pBeatmapCreator.innerText = "mapped by " + map.creator;
        pBeatmapCover.alt = "cover" + map.sid;
        pBeatmapCover.src = getCoverUrl(map.sid);
        pBeatmapCover.loading = "lazy";
        pBeatmapCover.width = 130;
        pBeatmapCover.height = 130;
        pBeatmapApproved.innerText = approvedText(map.approved);
        // little "VIDEO" label for beatmaps shipping a background video.
        // map.video comes from providers exposing the flag (e.g. Mino);
        // hasKnownVideo() covers sets confirmed from a previous download.
        boxHasVideoBadge(pBeatmapBox, map);
        if (list) {
            list.appendChild(pBeatmapBox);
        }
        return pBeatmapBox;
    },

    addStarRings: function (box, data) {
        // get star ratings
        let stars = [];
        for (let i = 0; i < data.length; ++i) {
            stars.push(data[i].star);
        }
        let row = document.createElement("div");
        row.className = "beatmap-difficulties";
        box.appendChild(row);
        // show all of them if can be fit in
        if (stars.length <= 13) {
            for (let i = 0; i < stars.length; ++i) {
                let difficultyRing = document.createElement("div");
                difficultyRing.className = "difficulty-ring";
                let s = starname(stars[i]);
                if (s.length > 0)
                    difficultyRing.classList.add(s);
                row.appendChild(difficultyRing);
            }
        }
        // show only highest star and count otherwise
        else {
            let difficultyRing = document.createElement("div");
            difficultyRing.className = "difficulty-ring";
            let s = starname(stars[stars.length - 1]);
            if (s.length > 0)
                difficultyRing.classList.add(s);
            row.appendChild(difficultyRing);
            let cnt = document.createElement("span");
            cnt.className = "difficulty-count";
            cnt.innerText = stars.length;
            row.appendChild(cnt);
        }
        if (data.length == 0) {
            let cnt = document.createElement("span");
            cnt.className = "difficulty-count";
            cnt.innerText = "no std map";
            row.appendChild(cnt);
        }
    },

    addLength: function (box, data) {
        // show length & bpm
        let length = 0;
        let bpm = 0;
        for (let i = 0; i < data.length; ++i) {
            length = Math.max(length, data[i].length);
            bpm = Math.max(bpm, data[i].BPM);
        }
        // let pBeatmapBPM = document.createElement("div");
        // pBeatmapBPM.className = "beatmapbpm";
        // box.appendChild(pBeatmapBPM);
        // pBeatmapBPM.innerText = Math.round(bpm) + "♪";
        let pBeatmapLength = document.createElement("div");
        pBeatmapLength.className = "beatmaplength";
        box.appendChild(pBeatmapLength);
        pBeatmapLength.innerText = Math.floor(length / 60) + ":" + (length % 60 < 10 ? "0" : "") + (length % 60);
    },

    addMoreInfo: function (box, data) {
        // remove all but osu std mode
        data = data.filter(function (o) { return o.mode == 0; });
        data = data.sort(function (a, b) { return Math.sign(a.star - b.star); });
        box.data = data;
        NSaddBeatmapList.addStarRings(box, data);
        NSaddBeatmapList.addLength(box, data);
    },

    // async
    requestMoreInfo: async function (box) {
        const url = getInfoUrl(box.sid);

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error("HTTP " + response.status);
            const res = await response.json();
            NSaddBeatmapList.addMoreInfo(box, currentProviders().browse.normalizeDetails(res));
        } catch (error) {
            console.error("Error fetching additional info for beatmap:", error);
        }
    }
}

// Parses genre/lang selector values like "2+64+256" into bitmask sums.
// (The old code eval()'d these attributes; Number() alone returns NaN.)
function parseMaskSum(v) {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    let sum = 0, any = false;
    const parts = String(v).split("+");
    for (let i = 0; i < parts.length; ++i) {
        const p = parts[i].trim();
        if (!p) continue;
        const n = Number(p);
        if (!Number.isFinite(n)) return null;
        sum += n;
        any = true;
    }
    return any ? sum : null;
}

// async
// adds symbols of these beatmap packs to webpage
// listurl: url of api request that returns a list of beatmap packs
// list: DOM element to insert beatmaps into
// filter, maxsize: does't apply if not specified
// isCancelled: optional () => bool; when true after the list fetch, nothing
//   is appended and {count:0, end:false, cancelled:true} is returned
// listOpts: optional { kind, offset, limit, fetchSize, genre, lang } describing
//   the request for provider normalization (Mino sorts/filters client-side).
// returns: { count, end } — boxes appended, and whether the provider reports
//   end-of-data. On transport error appends a note and returns {count:-1}.
// Note that some beatmaps may not contain std mode, so we request more maps than we need
async function addBeatmapList(listurl, list, filter, maxsize, isCancelled, listOpts) {
    if (!list) list = document.getElementById("beatmap-list");
    if (!list) {
        console.error("addBeatmapList: no target list element");
        return { count: -1, end: false };
    }
    const browse = currentProviders().browse;
    const opts = listOpts || {};
    const limit = maxsize || opts.limit || 20;

    // request beatmap pack list
    let res;
    try {
        const response = await fetch(listurl);
        if (!response.ok) throw new Error("HTTP " + response.status);
        res = await response.json();
    } catch (error) {
        console.error("Error fetching beatmap list:", error);
        let note = document.createElement("div");
        note.innerText = "Could not load beatmaps (network error). Please retry.";
        list.appendChild(note);
        return { count: -1, end: false };
    }
    let sets;
    try {
        sets = browse.normalizeList(res, {
            offset: opts.offset || 0,
            limit: limit,
            fetchSize: opts.fetchSize || limit,
            kind: opts.kind,
            genre: opts.genre,
            lang: opts.lang,
        });
    } catch (error) {
        console.error("Error normalizing beatmap list:", error);
        return { count: -1, end: false };
    }
    if (!Array.isArray(sets)) sets = [];
    const end = browse.rawCount(res) < (opts.fetchSize || limit);
    if (isCancelled && isCancelled()) return { count: 0, end: end, cancelled: true };
    let rows = sets;

    if (filter) {
        rows = rows.filter(filter);
    }
    if (maxsize) {
        rows = rows.slice(0, maxsize);
    }

    // add widget to webpage as soon as list is fetched.
    // One malformed entry must not kill the whole page (per-box guard).
    const items = [];
    for (let i = 0; i < rows.length; ++i) {
        try {
            items.push({ data: rows[i], box: NSaddBeatmapList.addpreviewbox(rows[i], list) });
        } catch (e) {
            console.error("Skipping malformed beatmap entry:", e);
        }
    }

    // fetch extra info concurrently with a small pool.
    // (Previously serial: one slow round-trip per beatmap.)
    let next = 0;
    const CONCURRENCY = 5;
    async function worker() {
        while (next < items.length) {
            const idx = next++;
            const b = items[idx].box;
            b.sid = items[idx].data.sid;
            try {
                await NSaddBeatmapList.requestMoreInfo(b);
            } catch (e) {
                console.error(e);
            }
            // bind after info arrives (difficulty menu needs box.data);
            // IIFE avoids the classic loop-closure bug.
            // Click = preview audio only. Full .osz downloads on difficulty pick.
            b.onclick = (function (bb) {
                return function (e) {
                    createDifficultyList(bb, e);
                    try { startpreview(bb); } catch (err) { console.error(err); }
                };
            })(b);
        }
    }
    const workers = [];
    for (let w = 0; w < Math.min(CONCURRENCY, items.length); ++w) workers.push(worker());
    await Promise.all(workers);

    if (window.beatmaplistLoadedCallback) {
        window.beatmaplistLoadedCallback();
        window.beatmaplistLoadedCallback = null;
        // to make sure it's called only once
    }
    return { count: items.length, end: end };
}

// Convenience: build the provider URL for a list kind and fetch it.
// kind: latest | popular | search | genre | random
// o: { limit, offset, keyword, genre, lang, filter, maxsize, isCancelled, list }
function addBeatmapKind(kind, list, o) {
    o = o || {};
    if (!list) list = document.getElementById("beatmap-list");
    const r = buildListUrl(kind, o.offset || 0, {
        limit: o.limit || 20,
        keyword: o.keyword,
        genre: o.genre,
        lang: o.lang,
    });
    return addBeatmapList(r.url, list, o.filter, o.maxsize, o.isCancelled, {
        kind: kind,
        offset: o.offset || 0,
        limit: o.limit || 20,
        fetchSize: r.fetchSize,
        genre: o.genre,
        lang: o.lang,
    });
}

// ---- Shared paginated list helper ----
// Replaces the copy-pasted `var cur / btnmore.onclick` blocks on every list
// page. Handles loading/disabled states, end-of-list, errors ("Retry"),
// double-click storms and stale responses after reset (genre switches).
// buildRequest(offset) must return { url, opts } where opts carries
// { kind, limit, fetchSize, genre, lang } for provider normalization
// (a plain url string is also accepted for back-compat: opts={offset}).
// Returns { loadMore, reset } where loadMore resolves { count, end }.
function createBeatmapPager(listEl, moreBtn, buildRequest, pageSize) {
    pageSize = pageSize || 20;
    if (!listEl) listEl = document.getElementById("beatmap-list");
    let offset = 0;
    let loading = false;
    let ended = false;
    let epoch = 0;
    function paintBtn() {
        if (!moreBtn) return;
        if (ended) {
            // hide via display only: never drop the inline width style
            moreBtn.style.display = "none";
            return;
        }
        moreBtn.style.display = "";
        if (loading) {
            moreBtn.innerText = "Loading…";
            moreBtn.classList.add("disabled");
        } else {
            moreBtn.classList.remove("disabled");
            moreBtn.innerText = (moreBtn.dataset && moreBtn.dataset.error === "1") ? "Retry" : "Load more";
        }
    }
    function setError(on) {
        if (moreBtn && moreBtn.dataset) moreBtn.dataset.error = on ? "1" : "";
    }
    async function loadMore() {
        if (loading || ended || !listEl) return { count: 0, end: ended };
        loading = true;
        setError(false);
        paintBtn();
        const my = epoch;
        let req = buildRequest(offset);
        if (typeof req === "string") req = { url: req, opts: {} };
        req.opts = req.opts || {};
        if (req.opts.offset === undefined) req.opts.offset = offset;
        if (req.opts.limit === undefined) req.opts.limit = pageSize;
        // fetchSize may exceed the page (Mino popular fetches 100-row
        // batches and slices 20); buildListUrl reports it via req.fetchSize.
        if (req.opts.fetchSize === undefined) {
            req.opts.fetchSize = (req.fetchSize !== undefined) ? req.fetchSize : pageSize;
        }
        let r;
        try {
            r = await addBeatmapList(req.url, listEl, null, null, function () { return my !== epoch; }, req.opts);
        } catch (e) {
            console.error(e);
            r = { count: -1, end: false };
        }
        if (my !== epoch) return { count: 0, end: false }; // superseded by reset()
        loading = false;
        if (r && r.cancelled) return { count: 0, end: false };
        const n = (r && typeof r.count === "number") ? r.count : 0;
        const end = !!(r && r.end);
        if (n < 0) {
            // transport error: stay on the same offset so Retry re-requests it
            setError(true);
            paintBtn();
            return { count: n, end: false };
        }
        offset += pageSize;
        if (end || n < pageSize) ended = true;
        paintBtn();
        return { count: n, end: ended };
    }
    function reset() {
        epoch++; // invalidate in-flight loads
        offset = 0;
        loading = false;
        ended = false;
        setError(false);
        if (listEl) listEl.innerHTML = "";
        paintBtn();
        return loadMore();
    }
    if (moreBtn) moreBtn.onclick = loadMore;
    paintBtn();
    return { loadMore: loadMore, reset: reset };
}

function addBeatmapSid(sid, list) {
    if (!list) list = document.getElementById("beatmap-list");
    if (sid === undefined || sid === null || sid === "") {
        console.warn("addBeatmapSid: invalid sid", sid);
        return Promise.resolve(null);
    }
    const url = getInfoUrlV2(sid);

    return fetch(url)
        .then(function (response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
        })
        .then(res => {
            const set = currentProviders().browse.normalizeSet(res);
            if (!set || set.status === -1 || !set.data) {
                console.warn("Beatmap not found with sid", sid);
                return null;
            }
            // use data of first track as set data
            const box = NSaddBeatmapList.addpreviewbox(res.data, list);
            box.sid = res.data.sid;
            NSaddBeatmapList.requestMoreInfo(box);
            box.onclick = function (e) {
                // Click = preview audio only. Full .osz downloads on difficulty pick.
                createDifficultyList(box, e);
                try { startpreview(box); } catch (err) { console.error(err); }
            };
            if (window.beatmaplistLoadedCallback) {
                window.beatmaplistLoadedCallback();
                window.beatmaplistLoadedCallback = null;
                // to make sure it's called only once
            }
            return box;
        })
        .catch(function (error) {
            console.error("addBeatmapSid failed for sid " + sid + ":", error);
            return null;
        });
}
