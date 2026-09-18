// Regression tests: shared paginated list helper (createBeatmapPager).
// Covers: multi-page loading, end-of-list, error/Retry, stale reset after
// genre switches. Uses stub fetch + stub DOM (no network).
// NOTE: plain-script eval at module top; see liked.test.js.
const fs = require("fs");
const H = require("./helpers");

global.window = {};
global.document = H.createDom().document;
eval(fs.readFileSync(global.ROOT + "/scripts/config.js", "utf8"));
eval(fs.readFileSync(global.ROOT + "/scripts/addbeatmaplist.js", "utf8"));

function mklist() {
  const l = H.makeElement("div");
  l.innerHTML = "";
  return l;
}

// fetch stub: list endpoint pages 20 then 5; info endpoint empty diffs.
function installFetch(mode) {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    if (url.includes("beatmapinfo?1=")) return { ok: true, json: async () => ({ data: [] }) };
    if (mode.failOnce && calls.filter((u) => u.includes("beatmaplist")).length === 1) {
      throw new Error("net down");
    }
    const off = parseInt(new URL(url).searchParams.get("1") || "0", 10);
    const n = off === 0 ? 20 : 5;
    if (!mode.fast && calls.filter((u) => u.includes("beatmaplist")).length === 1) {
      await new Promise((r) => setTimeout(r, 30)); // slow first page for stale test
    }
    return {
      ok: true,
      json: async () => ({
        data: Array.from({ length: n }, (_, i) => ({ sid: 1000 + off + i, title: "t", artist: "a", creator: "c", approved: 1 })),
      }),
    };
  };
  return calls;
}
const pagerUrl = (off) => "https://x/beatmaplist?0=20&1=" + off;

test("pager: loads pages, hides button at end, no-ops after", async () => {
  installFetch({});
  window.liked_sid_set = [];
  const list = mklist(), btn = H.makeElement("div");
  btn.innerText = "Load more";
  const pager = createBeatmapPager(list, btn, pagerUrl);
  H.eq((await pager.loadMore()).count, 20, "first page");
  H.eq(btn.innerText, "Load more", "button idle again");
  H.eq((await pager.loadMore()).count, 5, "short page");
  H.eq(btn.style.display, "none", "button hidden at end");
  H.eq((await pager.loadMore()).count, 0, "no-op after end");
});

test("pager: transport error keeps offset and offers Retry", async () => {
  installFetch({ failOnce: true });
  window.liked_sid_set = [];
  const list = mklist(), btn = H.makeElement("div");
  const pager = createBeatmapPager(list, btn, pagerUrl);
  const e1 = await pager.loadMore();
  H.eq(e1.count, -1, "error code");
  H.eq(btn.innerText, "Retry", "retry label");
  const e2 = await pager.loadMore();
  H.eq(e2.count, 20, "retry re-requests same offset");
  H.eq(btn.innerText, "Load more", "label restored");
});

test("pager: reset() invalidates in-flight stale responses", async () => {
  installFetch({});
  window.liked_sid_set = [];
  const list = mklist(), btn = H.makeElement("div");
  const pager = createBeatmapPager(list, btn, pagerUrl);
  const slow = pager.loadMore(); // slow first fetch
  await new Promise((r) => setTimeout(r, 5));
  const fresh = pager.reset(); // clears + reloads (genre switch)
  const [a, b] = await Promise.all([slow, fresh]);
  H.eq(a.count, 0, "stale load yields nothing");
  H.eq(b.count, 20, "fresh load populates");
  H.eq(list.children.length, 20, "no interleaved duplicates");
});

test("pager: one malformed entry does not kill the page", async () => {
  global.fetch = async (url) => {
    if (url.includes("beatmapinfo?1=")) return { ok: true, json: async () => ({ data: [] }) };
    return {
      ok: true,
      json: async () => ({ data: [{ sid: 1, title: "ok", artist: "a", creator: "c", approved: 1 }, null, { sid: 2, title: "ok2", artist: "a", creator: "c", approved: 1 }] }),
    };
  };
  window.liked_sid_set = [];
  const list = mklist(), btn = H.makeElement("div");
  const pager = createBeatmapPager(list, btn, pagerUrl, 20);
  const n = (await pager.loadMore()).count;
  H.eq(n, 2, "two good boxes survive the bad entry");
  H.eq(list.children.length, 2, "both appended");
});
