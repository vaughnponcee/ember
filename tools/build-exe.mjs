// Build dist/ember.exe (or dist/ember on macOS/Linux): Node's single executable
// application feature with the editor and games embedded as assets.
//   node tools/build-exe.mjs
// Needs network once for `npx postject` (the official SEA injection tool).
import { execFileSync } from "node:child_process";
import { copyFileSync, readdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

execFileSync(process.execPath, ["build.mjs"], { stdio: "inherit" });

const assets = {};
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f).replaceAll("\\", "/");
    if (statSync(p).isDirectory()) walk(p);
    else if (!p.endsWith(".ts") && !p.includes("sea-prep") && !p.endsWith(".exe")) assets[p] = p;
  }
};
walk("web");
walk("dist/src");
walk("dist/web");

const exe = process.platform === "win32" ? "dist/ember.exe" : "dist/ember";
writeFileSync("dist/sea-config.json", JSON.stringify({
  main: "desktop/main.cjs",
  output: "dist/sea-prep.blob",
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  assets,
}, null, 1));
execFileSync(process.execPath, ["--experimental-sea-config", "dist/sea-config.json"], { stdio: "inherit" });

rmSync(exe, { force: true });
copyFileSync(process.execPath, exe);
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const args = ["--yes", "postject@1.0.0-alpha.6", exe, "NODE_SEA_BLOB", "dist/sea-prep.blob", "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"];
if (process.platform === "darwin") args.push("--macho-segment-name", "NODE_SEA");
execFileSync(process.platform === "win32" ? `${npx} ${args.join(" ")}` : npx, process.platform === "win32" ? [] : args, { stdio: "inherit", shell: process.platform === "win32" });
console.log(`\n${exe}: ${(statSync(exe).size / 1048576).toFixed(1)} MB, ${Object.keys(assets).length} embedded files`);
