// Unit tests: beatmap provider registry (SayoBot / Mino / NeriNyan).
// Covers URL builders, list/info normalization incl. the video flag,
// mask parsing, and provider routing defaults.
// NOTE: plain-script eval at module top; see liked.test.js.
const fs = require("fs");
const H = require("./helpers");

global.window = {};
global.document = H.createDom().document;
eval(fs.readFileSync(global.ROOT + "/scripts/config.js", "utf8"));
eval(fs.readFileSync(global.ROOT + "/scripts/addbeatmaplist.js", "utf8"));

function v2set(over) {
  return Object.assign({
    id: 11, title: "T", artist: "A", creator: "C", ranked: 1,
    genre_id: 3, language_id: 3, play_count: 10, video: false,
    beatmaps: [
      { id: 101, mode_int: 0, difficulty_rating: 4.2, version: "Insane", total_length: 100, bpm: 180 },
      { id: 102, mode_int: 3, difficulty_rating: 2.1, version: "Mania", total_length: 100, bpm: 180 },
    ],
  }, over || {});
}

test("providers: sayobot builders reproduce legacy urls", () => {
  const s = API_PROVIDERS.sayobot;
  H.eq(s.searchUrl({ limit: 20, offset: 40, kind: "latest" }).url,
    "https://api.sayobot.cn/beatmaplist?0=20&1=40&2=2&5=1", "latest");
  H.eq(s.searchUrl({ limit: 20, offset: 0, kind: "search", keyword: "a b" }).url,
    "https://api.sayobot.cn/beatmaplist?0=20&1=0&2=4&3=a%20b&5=1", "search encoded");
  H.eq(s.infoUrl(7), "https://api.sayobot.cn/beatmapinfo?1=7", "info");
  H.eq(s.setInfoUrl(7), "https://api.sayobot.cn/v2/beatmapinfo?0=7", "set info");
  H.eq(s.download(7, false), "https://txy1.sayobot.cn/beatmaps/download/mini/7", "mini download");
  // sayobot passthrough normalization
  const rows = [{ sid: 1 }];
  H.deepEq(s.normalizeList({ data: rows }, { offset: 0, limit: 20 }), rows, "passthrough");
});

test("providers: mino normalizes v2 sets incl. video + modes", () => {
  const m = API_PROVIDERS.mino;
  const out = m.normalizeList([v2set({ video: true }), v2set({ id: 12, video: false })],
    { offset: 0, limit: 20, fetchSize: 20 });
  H.eq(out.length, 2, "two rows");
  H.eq(out[0].sid, 11, "sid from id");
  H.eq(out[0].video, true, "video flag kept");
  H.eq(out[1].video, false, "non-video false");
  H.eq(out[0].modes & 1, 1, "std bit set");
  H.eq(out[0].approved, 1, "ranked code passes through");
  // details + hybrid for info flows
  const det = m.normalizeDetails(v2set());
  H.eq(det.length, 2, "two diffs");
  H.eq(det[0].bid, 101, "bid");
  H.eq(det[0].star, 4.2, "stars");
  const set = m.normalizeSet(v2set({ id: 11 }));
  H.eq(set.status, 0, "ok status");
  H.eq(set.data.sid, 11, "hybrid sid");
  H.eq(set.data.length, 2, "hybrid diff count");
  H.deepEq(m.normalizeSet({ error: "x" }), { status: -1, data: null }, "bad response");
});

test("providers: mino popular sorts by plays, genre filters client-side", () => {
  const m = API_PROVIDERS.mino;
  const rows = [
    v2set({ id: 1, play_count: 5 }),
    v2set({ id: 2, play_count: 500 }),
    v2set({ id: 3, play_count: 50 }),
  ];
  const out = m.normalizeList(rows, { offset: 0, limit: 3, fetchSize: 3, kind: "popular" });
  H.deepEq(out.map((s) => s.sid), [2, 3, 1], "plays desc");
  const g = m.normalizeList(
    [v2set({ id: 1, genre_id: 3 }), v2set({ id: 2, genre_id: 4 })],
    { offset: 0, limit: 20, fetchSize: 20, kind: "genre", genre: 8, lang: 1 });
  H.deepEq(g.map((s) => s.sid), [1], "genre 8 -> genre_id 3 only");
});

test("providers: download variants incl. no-video forms", () => {
  H.eq(API_PROVIDERS.mino.download(9, true), "https://catboy.best/d/9", "mino with video");
  H.eq(API_PROVIDERS.mino.download(9, false), "https://catboy.best/d/9n", "mino stripped");
  H.eq(API_PROVIDERS.nerinyan.download(9, true), "https://api.nerinyan.moe/d/9", "nerinyan with video");
  H.eq(API_PROVIDERS.nerinyan.download(9, false), "https://api.nerinyan.moe/d/9?noVideo=1", "nerinyan stripped");
});

test("providers: routing defaults to sayobot, nerinyan never browses", () => {
  delete window.gamesettings;
  H.eq(currentProviders().browseId, "sayobot", "default browse");
  H.eq(currentProviders().downloadId, "mino", "default download");
  window.gamesettings = { apiBrowsing: "nerinyan", apiDownload: "nerinyan" };
  H.eq(currentProviders().browseId, "sayobot", "nerinyan falls back for browse");
  H.eq(currentProviders().downloadId, "nerinyan", "nerinyan kept for download");
  window.gamesettings = { apiBrowsing: "mino", apiDownload: "mino", backgroundVideo: true };
  H.eq(getDownloadUrl(5), "https://catboy.best/d/5", "video on -> full");
  window.gamesettings.backgroundVideo = false;
  H.eq(getDownloadUrl(5), "https://catboy.best/d/5n", "video off -> stripped");
  delete window.gamesettings;
});

test("providers: parseMaskSum handles sums, singles, junk", () => {
  H.eq(parseMaskSum("2+64+256"), 322, "Others sum (old eval result)");
  H.eq(parseMaskSum("8"), 8, "single");
  H.eq(parseMaskSum(16), 16, "number passthrough");
  H.eq(parseMaskSum(null), null, "null");
  H.eq(parseMaskSum("abc"), null, "junk");
});
