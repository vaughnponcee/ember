// Zero-dependency browser build: strip TypeScript types with node:module and
// rewrite ".ts" import specifiers to ".js". Output goes to dist/.
import { stripTypeScriptTypes } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const files = [...readdirSync("src").filter((f) => f.endsWith(".ts")).map((f) => "src/" + f), ...readdirSync("web").filter((f) => f.endsWith(".ts")).map((f) => "web/" + f)];
let bytes = 0;
for (const f of files) {
  let js = stripTypeScriptTypes(readFileSync(f, "utf8"), { mode: "strip" });
  js = js.replace(/(from\s+["'][^"']+)\.ts(["'])/g, "$1.js$2");
  const out = join("dist", f.replace(/\.ts$/, ".js"));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, js);
  bytes += js.length;
}
console.log(`built ${files.length} files into dist/ (${(bytes / 1024).toFixed(1)} KiB)`);
