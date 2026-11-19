// Zero-dependency browser build: strip TypeScript types with node:module and
// rewrite ".ts" import specifiers to ".js". Output goes to dist/.
import { stripTypeScriptTypes } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const files = [...readdirSync("src").filter((f) => f.endsWith(".ts")).map((f) => "src/" + f), ...readdirSync("web").filter((f) => f.endsWith(".ts")).map((f) => "web/" + f)];
// Version stamp from the sources: every import gets ?v=<stamp>, so browsers and
// static hosts can never mix a cached old module with new ones after a deploy.
const stamp = createHash("sha1").update(files.map((f) => readFileSync(f, "utf8")).join("\n")).digest("hex").slice(0, 8);
writeFileSync("dist/version.txt", stamp);
let bytes = 0;
for (const f of files) {
  let js = stripTypeScriptTypes(readFileSync(f, "utf8"), { mode: "strip" });
  js = js.replace(/(from\s+["'][^"']+)\.ts(["'])/g, `$1.js?v=${stamp}$2`);
  const out = join("dist", f.replace(/\.ts$/, ".js"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, js);
  bytes += js.length;
}
mkdirSync("dist", { recursive: true });
console.log(`built ${files.length} files into dist/ (version ${stamp}) (${(bytes / 1024).toFixed(1)} KiB)`);
