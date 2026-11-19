/**
 * ember desktop: a single executable that serves the editor and games from
 * inside itself and opens them in a chromeless, GPU-accelerated app window
 * (Edge or Chrome in --app mode). Projects are saved as real files under
 * Documents/ember.
 *
 * Packaged with Node's single executable application feature (see
 * tools/build-exe.mjs). Run from source with: node desktop/main.cjs
 */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

let sea = null;
try { sea = require("node:sea"); if (!sea.isSea()) sea = null; } catch { sea = null; }

const ROOT = path.resolve(__dirname, ".."); // only used when running from source
const PROJECT = process.env.EMBER_PROJECT || path.join(os.homedir(), "Documents", "ember");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".txt": "text/plain" };

fs.mkdirSync(path.join(PROJECT, "scenes"), { recursive: true });
fs.mkdirSync(path.join(PROJECT, "sprites"), { recursive: true });

/** Static file from the packaged assets, or from disk when run from source. */
function readStatic(rel) {
  if (sea) {
    try { return Buffer.from(sea.getAsset(rel)); } catch { return null; }
  }
  const p = path.normalize(path.join(ROOT, rel));
  if (!p.startsWith(ROOT)) return null;
  try { return fs.readFileSync(p); } catch { return null; }
}

/** Resolve a project-relative path, refusing anything that escapes the project folder. */
function projectPath(rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\0")) return null;
  const p = path.normalize(path.join(PROJECT, rel));
  return p.startsWith(PROJECT + path.sep) ? p : null;
}

function body(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (c) => { n += c.length; if (n > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const token = require("node:crypto").randomBytes(16).toString("hex");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");
  try {
    if (url.pathname.startsWith("/api/")) {
      // only the app window, which got the token in its URL, may touch files
      if (req.headers["x-ember-token"] !== token) { res.writeHead(403).end(); return; }
      if (url.pathname === "/api/info") {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ project: PROJECT, desktop: true }));
        return;
      }
      const target = projectPath(url.searchParams.get("path"));
      if (!target) { res.writeHead(400).end("bad path"); return; }
      if (url.pathname === "/api/list" && req.method === "GET") {
        let names = [];
        try { names = fs.readdirSync(target).filter((n) => !n.startsWith(".")); } catch { names = []; }
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(names));
      } else if (url.pathname === "/api/file" && req.method === "GET") {
        let data;
        try { data = fs.readFileSync(target); } catch { res.writeHead(404).end(); return; }
        res.writeHead(200, { "Content-Type": "application/octet-stream" }).end(data);
      } else if (url.pathname === "/api/file" && req.method === "PUT") {
        const data = await body(req);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        // write then rename so a crash never leaves a half-written file
        const tmp = target + ".tmp";
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, target);
        res.writeHead(204).end();
      } else if (url.pathname === "/api/file" && req.method === "DELETE") {
        try { fs.unlinkSync(target); } catch { /* already gone */ }
        res.writeHead(204).end();
      } else res.writeHead(404).end();
      return;
    }
    let rel = url.pathname.slice(1) || "web/launcher.html";
    if (rel.endsWith("/")) rel += "index.html";
    const data = readStatic(rel);
    if (!data) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(rel)] || "application/octet-stream", "Cache-Control": "no-store" }).end(data);
  } catch (e) {
    res.writeHead(500).end(String(e && e.message));
  }
});

function findBrowser() {
  const pf = process.env["ProgramFiles"] || "C:\\Program Files", pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", local = process.env.LOCALAPPDATA || "";
  const candidates = [
    process.env.EMBER_BROWSER,
    path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge",
  ].filter(Boolean);
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const page = process.argv[2] || "web/launcher.html";
  const appUrl = `http://127.0.0.1:${port}/${page}#token=${token}`;
  if (process.env.EMBER_NO_WINDOW) { console.log(`EMBER_URL ${appUrl}`); return; } // tests and servers
  const browser = findBrowser();
  console.log(`ember: project folder ${PROJECT}`);
  if (!browser) {
    console.log(`No Edge or Chrome found. Open this address in a browser:\n  ${appUrl}`);
    return;
  }
  // a dedicated profile makes the window its own process, so closing it ends the app
  const profile = path.join(process.env.LOCALAPPDATA || os.tmpdir(), "ember", "window");
  const child = spawn(browser, [
    `--app=${appUrl}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,900",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling", // keep the game loop at full rate
    "--disable-renderer-backgrounding",
    "--ignore-gpu-blocklist",                 // use the GPU even on older drivers
  ], { stdio: "ignore" });
  child.on("exit", () => { server.close(); process.exit(0); });
});
