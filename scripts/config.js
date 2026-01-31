
// scripts/config.js
const BEATMAP_PROVIDER = {
    // Beatmap .osz download
    DOWNLOAD: "https://txy1.sayobot.cn/beatmaps/download/mini/",
    
    // Audio preview (mp3)
    PREVIEW: "https://cdn.sayobot.cn:25225/preview/",
    
    // Cover image
    COVER: "https://cdn.sayobot.cn:25225/beatmaps/",
    
    // Beatmap info API (single map details)
    API_INFO: "https://api.sayobot.cn/beatmapinfo?1=",
    API_INFO_V2: "https://api.sayobot.cn/v2/beatmapinfo?0=",
    
    // Beatmap list API (browsing/searching)
    API_LIST: "https://api.sayobot.cn/beatmaplist"
};

// Helper functions for URL construction
function getDownloadUrl(sid) {
    return `${BEATMAP_PROVIDER.DOWNLOAD}${sid}`;
}

function getPreviewUrl(sid) {
    return `${BEATMAP_PROVIDER.PREVIEW}${sid}.mp3`;
}

function getCoverUrl(sid) {
    return `${BEATMAP_PROVIDER.COVER}${sid}/covers/cover.webp`;
}

function getInfoUrl(sid) {
    return `${BEATMAP_PROVIDER.API_INFO}${sid}`;
}

function getInfoUrlV2(sid) {
    return `${BEATMAP_PROVIDER.API_INFO_V2}${sid}`;
}

/*

// scripts/config.js

const BEATMAP_PROVIDER = {
    // Beatmap .osz download 
    // WE MUST USE A CORS-FRIENDLY MIRROR HERE. 
    // osu.direct blocks browser fetches, but NeriNyan allows them.
    DOWNLOAD: "https://api.nerinyan.moe/d/",
    
    // Audio preview (mp3) - redirected to official osu! assets
    PREVIEW: "https://b.ppy.sh/preview/",
    
    // Cover image - redirected to official osu! assets
    COVER: "https://assets.ppy.sh/beatmaps/",
    
    // Beatmap info API (osu.direct uses the same endpoint for set info)
    API_INFO: "https://osu.direct/api/v2/s/",
    API_INFO_V2: "https://osu.direct/api/v2/s/",
    
    // Beatmap list API (searching)
    API_LIST: "https://osu.direct/api/v2/search"
};

// Helper functions for URL construction
function getDownloadUrl(sid) {
    // NeriNyan supports adding &noVideo=1 to save bandwidth
    return `${BEATMAP_PROVIDER.DOWNLOAD}${sid}?noVideo=1`;
}

function getPreviewUrl(sid) {
    return `${BEATMAP_PROVIDER.PREVIEW}${sid}.mp3`;
}

function getCoverUrl(sid) {
    // osu! official assets use .jpg for covers
    return `${BEATMAP_PROVIDER.COVER}${sid}/covers/cover.jpg`;
}

function getInfoUrl(sid) {
    return `${BEATMAP_PROVIDER.API_INFO}${sid}`;
}

function getInfoUrlV2(sid) {
    return `${BEATMAP_PROVIDER.API_INFO_V2}${sid}`;
}

(function patchFetchForOsuDirect() {
    const originalFetch = window.fetch;

    window.fetch = async function(...args) {
        const url = args[0] instanceof Request ? args[0].url : args[0];

        // 1. Intercept osu.direct API calls (Search & Info) to reformat JSON
        if (typeof url === "string" && url.includes("osu.direct/api/v2/")) {
            const response = await originalFetch.apply(this, args);
            const originalJson = response.json.bind(response);
            
            // Override .json() to adapter osu!api v2 format -> Sayobot format
            response.json = async () => {
                const data = await originalJson();
                
                // Case A: Search results (API_LIST)
                if (data.beatmapsets && Array.isArray(data.beatmapsets)) {
                    return {
                        data: data.beatmapsets.map(set => ({
                            sid: set.id,
                            title: set.title,
                            artist: set.artist,
                            creator: set.creator,
                            approved: set.ranked
                        }))
                    };
                }

                // Case B: Beatmapset info (API_INFO / API_INFO_V2)
                if (data.id && data.beatmaps) {
                    const difficulties = data.beatmaps.map(b => ({
                        bid: b.id,
                        mode: b.mode_int,
                        star: b.difficulty_rating,
                        version: b.version,
                        creator: data.creator,
                        length: b.total_length,
                        BPM: b.bpm
                    }));

                    const setMetadata = {
                        sid: data.id,
                        title: data.title,
                        artist: data.artist,
                        creator: data.creator,
                        approved: data.ranked
                    };
                    
                    // Return hybrid object
                    return {
                        status: 0,
                        data: Object.assign(difficulties, setMetadata)
                    };
                }
                return data;
            };
            return response;
        }

        // 2. Normal fetch for everything else (including downloads)
        return originalFetch.apply(this, args);
    };
})();
//*/
