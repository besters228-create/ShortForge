import { promises as fs } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";

const root = process.cwd();

async function restore(name, target) {
  const dir = path.join(root, "payload");
  const prefix = name + ".br.b64.part";
  const parts = (await fs.readdir(dir)).filter((x) => x.startsWith(prefix)).sort();
  if (!parts.length) throw new Error("Missing payload for " + name);
  let b64 = "";
  for (const p of parts) b64 += await fs.readFile(path.join(dir, p), "utf8");
  const data = brotliDecompressSync(Buffer.from(b64, "base64"));
  const out = path.join(root, target);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, data);
}

await restore("server.mjs", "server.mjs");
await restore("core.mjs", "core.mjs");
await restore("index.html", "public/index.html");

await fs.mkdir(path.join(root, "catalog"), { recursive: true });
try {
  await fs.access(path.join(root, "catalog", "topics_1000.json"));
} catch {
  await fs.writeFile(
    path.join(root, "catalog", "topics_1000.json"),
    JSON.stringify({ version: "9.7.11", count: 0, topics: [] })
  );
}

await import("./server.mjs");
