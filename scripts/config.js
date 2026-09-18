
// scripts/config.js
//
// Beatmap provider registry. Browsing (list/search/info) and downloading
// can each use SayoBot, Mino (catboy.best) or NeriNyan, picked in Settings
// (SayoBot by default for both). NeriNyan offers downloads only: its search
// API is unreachable, so it is not offered for browsing.
//
// Internal list items always look like SayoBot rows:
//   { sid, title, artist, creator, approved, modes, video }
// `modes` is a bitmask with bit0 = osu!std, `video` marks video maps.

// osu! genre/language ids used by osu!api-v2 shaped providers.
function minoGenreIds(mask) {
    // sayobot-style bitmask sum -> osu! genre_id list (null = no filter).
    // 1=All, 4=Games, 8=Animation, 16=Rock, 128=Novelty, 1024=Electronic.
    // 32 (sayobot "Popular") and combined "Others" have no v2 equivalent.
    switch (mask) {
        case 4: return [2];
        case 8: return [3];
        case 16: return [4];
        case 128: return [7];
        case 1024: return [10];
        default: return null;
    }
}
function minoLangIds(mask) {
    // 1=All, 32=Instrumental, 4=English, 8=Japanese, 64=Korean,
    // 16=Chinese, 128=French, 256=German.
    switch (mask) {
        case 32: return [5];
        case 4: return [2];
        case 8: return [3];
        case 64: return [6];
        case 16: return [4];
        case 128: return [7];
        case 256: return [8];
        default: return null;
    }
}
function minoModesOf(set) {
    let m = 0;
    const diffs = (set && set.beatmaps) || [];
    for (let i = 0; i < diffs.length; ++i) {
        m |= (1 << ((diffs[i] && diffs[i].mode_int) || 0));
    }
    return m;
}
function minoSetToInternal(set) {
    return {
        sid: set.id,
        title: set.title,
        artist: set.artist,
        creator: set.creator,
        approved: set.ranked,
        modes: minoModesOf(set),
        video: !!set.video,
        play_count: set.play_count || 0,
        genre_id: set.genre_id,
        language_id: set.language_id,
    };
}
function minoDiffsToDetails(set) {
    const diffs = (set && set.beatmaps) || [];
    return diffs.map(function (b) {
        return {
            bid: b.id,
            mode: b.mode_int,
            star: b.difficulty_rating,
            version: b.version,
            creator: set.creator,
            length: b.total_length,
            BPM: b.bpm,
        };
    });
}
// Hybrid object shaped like sayobot v2 info: an array of difficulties
// carrying the set metadata as extra props.
function minoSetToHybrid(set) {
    const difficulties = minoDiffsToDetails(set);
    return Object.assign(difficulties, {
        sid: set.id,
        title: set.title,
        artist: set.artist,
        creator: set.creator,
        approved: set.ranked,
    });
}

var API_PROVIDERS = {
    sayobot: {
        id: "sayobot",
        name: "SayoBot",
        browse: true,
        download: function (sid, withVideo) {
            // mini builds exclude video; SayoBot has no verified full variant.
            void withVideo;
            return "https://txy1.sayobot.cn/beatmaps/download/mini/" + sid;
        },
        preview: function (sid) { return "https://cdn.sayobot.cn:25225/preview/" + sid + ".mp3"; },
        cover: function (sid) { return "https://cdn.sayobot.cn:25225/beatmaps/" + sid + "/covers/cover.webp"; },
        searchUrl: function (o) {
            const base = "https://api.sayobot.cn/beatmaplist";
            if (o.kind === "latest") return { url: `${base}?0=${o.limit}&1=${o.offset}&2=2&5=1`, fetchSize: o.limit };
            if (o.kind === "popular" || o.kind === "random") return { url: `${base}?0=${o.limit}&1=${o.offset}&2=1&5=1`, fetchSize: o.limit };
            if (o.kind === "search") return { url: `${base}?0=${o.limit}&1=${o.offset}&2=4&3=${encodeURIComponent(o.keyword)}&5=1`, fetchSize: o.limit };
            if (o.kind === "genre") return { url: `${base}?0=${o.limit}&1=${o.offset}&2=4&5=1&7=${o.genre}&8=${o.lang}`, fetchSize: o.limit };
            if (o.kind === "random") return { url: `${base}?0=${o.limit}&1=${o.offset}&2=1&5=1`, fetchSize: o.limit };
            throw new Error("unknown list kind: " + o.kind);
        },
        infoUrl: function (sid) { return "https://api.sayobot.cn/beatmapinfo?1=" + sid; },
        setInfoUrl: function (sid) { return "https://api.sayobot.cn/v2/beatmapinfo?0=" + sid; },
        rawCount: function (json) { return (json && Array.isArray(json.data)) ? json.data.length : 0; },
        normalizeList: function (json, o) {
            const rows = (json && Array.isArray(json.data)) ? json.data : [];
            return rows.slice(0, o.limit);
        },
        normalizeDetails: function (json) {
            return (json && Array.isArray(json.data)) ? json.data : [];
        },
        normalizeSet: function (json) { return json; }, // already {status, data}
    },
    mino: {
        id: "mino",
        name: "Mino (catboy.best)",
        browse: true,
        download: function (sid, withVideo) {
            // "n" suffix strips the video (verified: 18MB -> 4MB on a video map).
            return withVideo ? "https://catboy.best/d/" + sid : "https://catboy.best/d/" + sid + "n";
        },
        preview: function (sid) { return "https://b.ppy.sh/preview/" + sid + ".mp3"; },
        cover: function (sid) { return "https://assets.ppy.sh/beatmaps/" + sid + "/covers/cover.jpg"; },
        searchUrl: function (o) {
            // Popular is sorted client-side from 100-row batches (the API
            // offers no play-sorted order); everything else pages by `limit`.
            // Random jumps to a random page (sayobot-style random offsets
            // don't exist here).
            const fetchSize = (o.kind === "popular") ? 100 : o.limit;
            const page = (o.kind === "random")
                ? Math.floor(Math.random() * 50)
                : Math.floor(o.offset / fetchSize);
            let url = `https://catboy.best/api/v2/search?limit=${fetchSize}&p=${page}&mode=0`;
            if (o.kind === "search") url += "&query=" + encodeURIComponent(o.keyword);
            return { url: url, fetchSize: fetchSize };
        },
        infoUrl: function (sid) { return "https://catboy.best/api/v2/s/" + sid; },
        setInfoUrl: function (sid) { return "https://catboy.best/api/v2/s/" + sid; },
        rawCount: function (json) {
            const arr = Array.isArray(json) ? json : (json && json.beatmapsets);
            return Array.isArray(arr) ? arr.length : 0;
        },
        normalizeList: function (json, o) {
            let arr = Array.isArray(json) ? json.slice() : ((json && Array.isArray(json.beatmapsets)) ? json.beatmapsets.slice() : []);
            if (o.kind === "genre") {
                const g = minoGenreIds(o.genre), l = minoLangIds(o.lang);
                if (g) arr = arr.filter(function (s) { return g.indexOf(s.genre_id) !== -1; });
                if (l) arr = arr.filter(function (s) { return l.indexOf(s.language_id) !== -1; });
            }
            if (o.kind === "popular") {
                arr.sort(function (a, b) { return (b.play_count || 0) - (a.play_count || 0); });
            }
            const start = o.offset % o.fetchSize;
            return arr.slice(start, start + o.limit).map(minoSetToInternal);
        },
        normalizeDetails: function (json) {
            const set = Array.isArray(json) ? json[0] : json;
            if (!set || !set.id) return [];
            return minoDiffsToDetails(set);
        },
        normalizeSet: function (json) {
            const set = Array.isArray(json) ? json[0] : json;
            if (!set || !set.id) return { status: -1, data: null };
            return { status: 0, data: minoSetToHybrid(set) };
        },
    },
    nerinyan: {
        id: "nerinyan",
        name: "NeriNyan",
        browse: false, // no reachable search/info API; downloads only
        download: function (sid, withVideo) {
            return withVideo
                ? "https://api.nerinyan.moe/d/" + sid
                : "https://api.nerinyan.moe/d/" + sid + "?noVideo=1";
        },
        preview: function (sid) { return "https://b.ppy.sh/preview/" + sid + ".mp3"; },
        cover: function (sid) { return "https://assets.ppy.sh/beatmaps/" + sid + "/covers/cover.jpg"; },
        searchUrl: function () { throw new Error("NeriNyan offers no browse API"); },
        infoUrl: function () { throw new Error("NeriNyan offers no info API"); },
        setInfoUrl: function () { throw new Error("NeriNyan offers no info API"); },
        rawCount: function () { return 0; },
        normalizeList: function () { return []; },
        normalizeDetails: function () { return []; },
        normalizeSet: function () { return { status: -1, data: null }; },
    },
};

function currentProviders() {
    const gs = (typeof window !== "undefined" && window.gamesettings) || {};
    let browseId = gs.apiBrowsing || "sayobot";
    let downloadId = gs.apiDownload || "sayobot";
    if (!API_PROVIDERS[browseId] || !API_PROVIDERS[browseId].browse) browseId = "sayobot";
    if (!API_PROVIDERS[downloadId]) downloadId = "sayobot";
    return {
        browse: API_PROVIDERS[browseId],
        download: API_PROVIDERS[downloadId],
        browseId: browseId,
        downloadId: downloadId,
    };
}
function backgroundVideoEnabled() {
    try {
        return !!(window.gamesettings && window.gamesettings.backgroundVideo);
    } catch (e) { return false; }
}

// Helper functions for URL construction (provider-routed)
function getDownloadUrl(sid) {
    const p = currentProviders();
    return p.download.download(sid, backgroundVideoEnabled());
}

function getPreviewUrl(sid) {
    return currentProviders().browse.preview(sid);
}

function getCoverUrl(sid) {
    return currentProviders().browse.cover(sid);
}

function getInfoUrl(sid) {
    return currentProviders().browse.infoUrl(sid);
}

function getInfoUrlV2(sid) {
    return currentProviders().browse.setInfoUrl(sid);
}

// buildListUrl(kind, offset, extra) -> { url, fetchSize, opts } for pages/pager.
// kind: latest | popular | search | genre | random.
// extra: { limit, keyword, genre, lang }
function buildListUrl(kind, offset, extra) {
    const p = currentProviders();
    extra = extra || {};
    const o = {
        limit: extra.limit || 20,
        offset: offset || 0,
        kind: kind,
        keyword: extra.keyword || "",
        genre: extra.genre,
        lang: extra.lang,
    };
    const r = p.browse.searchUrl(o);
    return {
        url: r.url,
        fetchSize: r.fetchSize,
        opts: { kind: kind, offset: o.offset, limit: o.limit, genre: o.genre, lang: o.lang },
    };
}

// Live commit badge for the footer: replaces the old hardcoded version
// number with the currently deployed master commit (linked). Result is
// cached for an hour to stay far under the API rate limit.
function showLiveCommit() {
    let el = null;
    try { el = document.getElementById("live-commit"); } catch (e) { return; }
    if (!el || el.dataset.done) return;
    el.dataset.done = "1";
    const REPO = "WebOsu-2/webosu-2.github.io";
    function render(sha) {
        try {
            el.innerText = "commit " + sha.slice(0, 7);
            el.href = "https://github.com/" + REPO + "/commit/" + sha;
        } catch (e) { /* ignore */ }
    }
    try {
        const raw = window.localStorage && window.localStorage.getItem("livecommit");
        if (raw) {
            const cached = JSON.parse(raw);
            if (cached && cached.sha && Date.now() - cached.time < 3600 * 1000) {
                render(cached.sha);
                return;
            }
        }
    } catch (e) { /* ignore */ }
    try {
        fetch("https://api.github.com/repos/" + REPO + "/commits/master")
            .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
            .then(function (c) {
                if (!c || !c.sha) throw new Error("bad response");
                try { window.localStorage.setItem("livecommit", JSON.stringify({ sha: c.sha, time: Date.now() })); } catch (e) {}
                render(c.sha);
            })
            .catch(function () { /* keep placeholder text */ });
    } catch (e) { /* ignore */ }
}
(function watchLiveCommit() {
    try {
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", showLiveCommit);
        } else {
            showLiveCommit();
        }
        // the footer is injected via fetch() after load; fill the badge then
        const obs = new MutationObserver(function () { showLiveCommit(); });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(function () { try { obs.disconnect(); } catch (e) {} }, 30000);
    } catch (e) { /* ignore */ }
})();

// Non-blocking error toast (replaces alert() so background work like
// downloads/decodes never traps the user in a modal dialog).
function showErrorToast(msg, ms) {
    try {
        var t = document.createElement("div");
        t.innerText = msg;
        t.setAttribute("role", "alert");
        t.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;max-width:min(92vw,560px);padding:10px 16px;background:rgba(20,16,20,.92);color:#ffd9d9;border:1px solid #b63258;border-radius:10px;font-size:14px;box-shadow:0 4px 18px rgba(0,0,0,.4);";
        document.body.appendChild(t);
        setTimeout(function () {
            try { t.remove(); } catch (e) { if (t.parentNode) t.parentNode.removeChild(t); }
        }, ms || 4500);
    } catch (e) {
        try { console.error(msg); } catch (err) {}
    }
}
