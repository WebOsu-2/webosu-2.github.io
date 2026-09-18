// Static test: inline <script> blocks in every page must parse.
// (A duplicated `let` in genres.html once shipped exactly this way.)
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const PAGES = [
  "index.html", "favourites.html", "search.html", "latest.html",
  "popular.html", "genres.html", "history.html", "settings.html",
];

function inlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].trim()) out.push(m[1]);
  }
  return out;
}

test("html-inline: every page has parseable inline scripts", () => {
  const failures = [];
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(global.ROOT, page), "utf8");
    const blocks = inlineScripts(html);
    if (!blocks.length) throw new Error(page + ": no inline scripts found (regex broken?)");
    blocks.forEach((code, i) => {
      const tmp = path.join(os.tmpdir(), `inline-${process.pid}-${i}.js`);
      fs.writeFileSync(tmp, code);
      try {
        execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
      } catch (e) {
        failures.push(`${page} block #${i}: ${(e.stderr || e.message || "").toString().split("\n")[0]}`);
      } finally {
        try { fs.unlinkSync(tmp); } catch (_) {}
      }
    });
  }
  if (failures.length) throw new Error("inline syntax failures:\n" + failures.join("\n"));
});

test("html-inline: list pages load config before addbeatmaplist", () => {
  // favourites.html once missed scripts/config.js, so every box threw on
  // getCoverUrl/getInfoUrlV2 and the tab rendered empty.
  for (const page of ["index.html", "favourites.html", "search.html", "latest.html", "popular.html", "genres.html"]) {
    const html = fs.readFileSync(path.join(global.ROOT, page), "utf8");
    const tags = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
    const ci = tags.indexOf("scripts/config.js");
    const ai = tags.indexOf("scripts/addbeatmaplist.js");
    if (ai !== -1 && !(ci !== -1 && ci < ai)) {
      throw new Error(`${page}: scripts/config.js must load before scripts/addbeatmaplist.js`);
    }
  }
});
