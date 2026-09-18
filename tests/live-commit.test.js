// Tests: footer live-commit badge (showLiveCommit in scripts/config.js).
// NOTE: plain-script eval at module top; see liked.test.js.
const fs = require("fs");
const H = require("./helpers");

global.window = global;
global.localStorage = {
  _s: {},
  getItem(k) { return this._s[k] || null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; },
};
global.MutationObserver = class { observe() {} disconnect() {} };
let fetchCalls = 0;
let fetchMode = "ok";
global.fetch = async () => {
  fetchCalls++;
  if (fetchMode === "fail") return { ok: false, status: 403 };
  return { ok: true, json: async () => ({ sha: "abc1234567890abcdef" }) };
};
{
  const dom = H.createDom();
  dom.document.readyState = "complete";
  dom.document.documentElement = dom.body;
  dom.document.addEventListener = () => {};
  global.document = dom.document;
  global.__badgeDom = dom;
}
eval(fs.readFileSync(global.ROOT + "/scripts/config.js", "utf8"));

const tick = () => new Promise((r) => setTimeout(r, 10));

function freshBadge() {
  const el = H.makeElement("a");
  el.innerText = "commit …";
  global.__badgeDom.byId.set("live-commit", el);
  return el;
}

test("badge: fills short sha + link from API", async () => {
  global.localStorage.removeItem("livecommit");
  fetchCalls = 0;
  fetchMode = "ok";
  const el = freshBadge();
  showLiveCommit();
  await tick();
  H.eq(fetchCalls, 1, "one api call");
  H.eq(el.innerText, "commit abc1234", "short sha, got " + el.innerText);
  H.assert(el.href.endsWith("/commit/abc1234567890abcdef"), "commit link, got " + el.href);
});

test("badge: caches for an hour, second fill is free", async () => {
  fetchCalls = 0;
  const el = freshBadge();
  // dataset.done was set on the OLD element; fresh element re-triggers
  showLiveCommit();
  await tick();
  H.eq(fetchCalls, 0, "served from cache");
  H.eq(el.innerText, "commit abc1234", "cached value renders");
});

test("badge: api failure keeps placeholder", async () => {
  global.localStorage.removeItem("livecommit");
  fetchMode = "fail";
  const el = freshBadge();
  showLiveCommit();
  await tick();
  H.eq(el.innerText, "commit …", "placeholder kept");
  fetchMode = "ok";
});
