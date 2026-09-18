// Minimal zero-dependency test runner for webosu-2.
// Usage: node tests/run.js [substring-filter]
// Test files (tests/*.test.js) register cases via global test(name, fn).
// fn may return a Promise for async cases. Exit code 0 iff all pass.
"use strict";
const fs = require("fs");
const path = require("path");

global.ROOT = path.resolve(__dirname, "..");

const cases = [];
global.test = (name, fn) => cases.push({ name, fn });

const filter = process.argv[2] || "";
const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.js"))
  .sort();
for (const f of files) {
  if (filter && !f.includes(filter)) continue;
  require(path.join(__dirname, f));
}

(async () => {
  let pass = 0, fail = 0;
  const failures = [];
  for (const c of cases) {
    try {
      await c.fn();
      pass++;
      console.log("ok - " + c.name);
    } catch (e) {
      fail++;
      failures.push({ name: c.name, err: e });
      console.log("FAIL - " + c.name);
      console.log("    " + String((e && e.stack) || e).split("\n").join("\n    "));
    }
  }
  console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
  process.exit(fail ? 1 : 0);
})();
