// Regression tests: favourites storage (Set -> Array migration).
// Covers: empty-tab bug, disappearing favourites, load-more foundations.
//
// NOTE: no "use strict" in this file. Page scripts are plain <script>-style
// sources, so they are eval'd once at module top (like page load order:
// config.js then addbeatmaplist.js) with stub globals installed first.
const fs = require("fs");
const H = require("./helpers");

// stub globals BEFORE evaluating page scripts (addbeatmaplist touches
// window.liked_sid_set_callbacks at load time)
global.window = {};
global.document = H.createDom().document;
eval(fs.readFileSync(global.ROOT + "/scripts/config.js", "utf8"));
eval(fs.readFileSync(global.ROOT + "/scripts/addbeatmaplist.js", "utf8"));

function freshStore() {
  const saved = {};
  const store = {
    setItem(k, v, cb) { saved[k] = JSON.parse(JSON.stringify(v)); if (cb) cb(null, saved[k]); },
    getItem(k, cb) { if (cb) cb(null, saved[k]); },
  };
  window.localforage = store;
  global.localforage = store;
  return saved;
}

test("liked: normalize Set, Array, corrupt {} and null", () => {
  freshStore();
  H.deepEq(normalizeLikedList(new Set([123, 456, 123])), [123, 456], "Set migrates w/ dedupe");
  H.deepEq(normalizeLikedList([1, 2, 2, 0, null, 3]), [1, 2, 0, 3], "Array dedupes, drops falsy");
  H.deepEq(normalizeLikedList({}), [], "corrupt JSON-serialized Set -> []");
  H.deepEq(normalizeLikedList(null), [], "null -> []");
  H.deepEq(normalizeLikedList(undefined), [], "undefined -> []");
});

test("liked: add migrates legacy Set to Array and persists Array", () => {
  const saved = freshStore();
  window.liked_sid_set = new Set([10, 20]);
  likedAdd(30);
  H.assert(Array.isArray(window.liked_sid_set), "migrated to Array");
  H.deepEq(window.liked_sid_set, [10, 20, 30], "add keeps entries");
  H.deepEq(saved.likedsidset, [10, 20, 30], "persisted as Array (JSON-safe)");
  H.assert(likedHas(30), "has() finds new entry");
});

test("liked: add dedupes, delete removes, round-trips", () => {
  const saved = freshStore();
  window.liked_sid_set = [1, 2, 3];
  likedAdd(2);
  H.deepEq(window.liked_sid_set, [1, 2, 3], "no duplicate on re-like");
  likedAdd(4);
  H.deepEq(window.liked_sid_set, [1, 2, 3, 4], "append new");
  likedDelete(2);
  H.deepEq(window.liked_sid_set, [1, 3, 4], "delete removes");
  likedDelete(999);
  H.deepEq(window.liked_sid_set, [1, 3, 4], "delete missing is no-op");
  H.deepEq(saved.likedsidset, [1, 3, 4], "saved latest");
});
