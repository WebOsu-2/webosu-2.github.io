// Runs ONE test file in this process: collects cases via global.test,
// executes sequentially, prints machine-readable results.
// Invoked by tests/run.js (one process per file = full isolation:
// separate module registries, globals and timers, so files can never
// flake each other through shared state or in-flight async work).
"use strict";
const path = require("path");

global.ROOT = path.resolve(__dirname, "..");

const cases = [];
global.test = (name, fn) => cases.push({ name, fn });

const file = process.argv[2];
const filter = process.argv[3] || "";
require(file);

(async () => {
  let pass = 0, fail = 0;
  for (const c of cases) {
    if (filter && !c.name.includes(filter)) continue;
    try {
      await c.fn();
      pass++;
      console.log("ok - " + c.name);
    } catch (e) {
      fail++;
      console.log("FAIL - " + c.name);
      console.log(String((e && e.stack) || e).split("\n").map((l) => "    " + l).join("\n"));
    }
  }
  console.log(`__RESULT__ ${pass} ${fail}`);
  process.exit(fail ? 1 : 0);
})();
