import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = http.createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/") pathname = "/index.html";
    const safe = path.normalize(pathname).replace(/^([.][.][/\\])+/, "");
    const file = path.join(__dirname, safe);
    if (!file.startsWith(__dirname)) throw new Error("bad path");
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  } catch {
    try {
      const data = await readFile(path.join(__dirname, "index.html"));
      res.writeHead(200, {"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
      res.end(data);
    } catch {
      res.writeHead(500);
      res.end("Server error");
    }
  }
});
server.listen(port, "0.0.0.0", () => console.log("AI Uprising 80 running on", port));
