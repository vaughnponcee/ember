// Static dev server for the repo root. node tools/serve.mjs [port]
// Open http://127.0.0.1:8080/web/
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.argv[2] || process.env.PORT || 8080);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".wasm": "application/wasm" };
createServer(async (req, res) => {
  let rel = new URL(req.url, "http://x").pathname;
  if (rel === "/") { res.writeHead(302, { Location: "/web/" }).end(); return; }
  if (rel.endsWith("/")) rel += "index.html";
  const p = normalize(join(root, rel));
  if (!p.startsWith(root)) return res.writeHead(403).end();
  let body;
  try {
    body = await readFile(p); // read first so a missing file never leaves headers half sent
  } catch {
    return res.writeHead(404).end("not found");
  }
  res.writeHead(200, { "Content-Type": types[extname(p)] || "application/octet-stream" }).end(body);
}).listen(port, "127.0.0.1", () => console.log(`ember: http://127.0.0.1:${port}/web/`));
