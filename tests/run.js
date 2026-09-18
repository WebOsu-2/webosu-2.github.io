// Minimal zero-dependency test runner for webosu-2.
// Usage: node tests/run.js [substring-filter]
// Each tests/*.test.js file runs in its OWN node process (see run-file.js)
// so files are fully isolated: no shared globals, module state or timers.
// Exit code 0 iff every file passes.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const filter = process.argv[2] || "";
const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .filter((f) => !filter || f.includes(filter));

let totalPass = 0, totalFail = 0;
const failedFiles = [];
for (const f of files) {
  console.log(`\n### ${f}`);
  // if the filter already selected this file, run all its cases
  const caseFilter = f.includes(filter) ? "" : filter;
  try {
    const out = execFileSync(process.execPath,
      [path.join(__dirname, "run-file.js"), path.join(__dirname, f), caseFilter],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    process.stdout.write(out);
    const m = out.match(/__RESULT__ (\d+) (\d+)/);
    if (m) { totalPass += +m[1]; totalFail += +m[2]; }
  } catch (e) {
    process.stdout.write((e.stdout || "").toString());
    process.stderr.write((e.stderr || "").toString());
    const m = ((e.stdout || "").toString().match(/__RESULT__ (\d+) (\d+)/));
    if (m) { totalPass += +m[1]; totalFail += +m[2]; }
    else totalFail += 1;
    failedFiles.push(f);
  }
}
console.log(`\n${totalPass} passed, ${totalFail} failed, ${totalPass + totalFail} total`);
if (failedFiles.length) console.log("failed files: " + failedFiles.join(", "));
process.exit(totalFail ? 1 : 0);
