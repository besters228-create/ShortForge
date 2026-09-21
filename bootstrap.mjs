import { promises as fs } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";

const root = process.cwd();

async function restore(name, target) {
  const dir = path.join(root, "payload");
  const full = path.join(dir, name + ".br.b64");
  let b64;
  try {
    b64 = await fs.readFile(full, "utf8");
  } catch {
    const prefix = name + ".br.b64.part";
    const parts = (await fs.readdir(dir)).filter((x) => x.startsWith(prefix)).sort();
    if (!parts.length) throw new Error("Missing payload for " + name);
    b64 = "";
    for (const p of parts) b64 += await fs.readFile(path.join(dir, p), "utf8");
  }
  const data = brotliDecompressSync(Buffer.from(b64.trim(), "base64"));
  const out = path.join(root, target);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, data);
}

await restore("server.mjs", "server.mjs");
await restore("core.mjs", "core.mjs");
await restore("index.html", "public/index.html");

// Public hotfix: Image Studio Smart Composer fallback must not reference an undefined variable.
{
  const p = path.join(root, "server.mjs");
  let s = await fs.readFile(p, "utf8");
  const bad = 'const smartCtx={topic:safeProjectText(b.topic||prompt,1000),style:b.style||"cinematic",format:format,generationMode:"ultra"};';
  if (s.includes(bad)) {
    s = s.replace(
      bad,
      'const smartFormat=(b.format==="long"||aspect==="16:9")?"long":"shorts";\n      const smartCtx={topic:safeProjectText(b.topic||prompt,1000),style:b.style||"cinematic",format:smartFormat,generationMode:"ultra"};'
    );
  }
  if (s.includes("format:format,generationMode")) {
    throw new Error("PUBLIC HOTFIX failed: undefined format remains");
  }

  // Never let the browser keep an obsolete HTML shell after a Railway deploy.
  if (!s.includes('Cache-Control","no-store')) {
    const marker = "app.use(express.static(PUBLIC));";
    if (s.includes(marker)) {
      s = s.replace(
        marker,
        'app.use((req,res,next)=>{if(req.method==="GET"&&(req.path==="/"||req.path.endsWith(".html"))){res.set("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");res.set("Pragma","no-cache");res.set("Expires","0")}next()});\n' + marker
      );
    }
  }
  await fs.writeFile(p, s);
}

// Public hotfix UI: owner login entry + honest PHOTO/Smart Composer status.
// Language and theme logic already works; no-cache above ensures the fresh shell is loaded.
{
  const p = path.join(root, "public", "index.html");
  let h = await fs.readFile(p, "utf8");

  h = h.replace("ShortForge V9.7.11 — PHOTO + LANG + UPDATE", "ShortForge V9.7.11 — PUBLIC HOTFIX");

  if (!h.includes('id="ownerLoginBtn"')) {
    h = h.replace(
      '<button data-profile-action="settings">',
      '<button id="ownerLoginBtn" data-profile-action="owner-login">◆ <span>Войти как владелец</span></button>\n      <button data-profile-action="settings">'
    );
  }

  if (!h.includes("a==='owner-login'")) {
    const logoutBranch = "else if(a==='logout'&&state.session?.isOwner)";
    if (h.includes(logoutBranch)) {
      h = h.replace(
        logoutBranch,
        "else if(a==='owner-login'&&!state.session?.isOwner){const key=prompt(tri('Введите ключ владельца','Enter owner key','Owner kalitini kiriting'));if(!key)return;try{await api('/api/owner/login',{method:'POST',body:JSON.stringify({key})});await refreshAll();state.section='home';pm.classList.add('hidden');render();toast(tri('Режим владельца включён','Owner mode enabled','Owner rejimi yoqildi'))}catch(err){toast(err.message)}}else if(a==='logout'&&state.session?.isOwner)"
      );
    }
  }

  const oldLogoutState = "if(logoutBtn)logoutBtn.disabled=!state.session?.isOwner;";
  if (h.includes(oldLogoutState)) {
    h = h.replace(
      oldLogoutState,
      "if(logoutBtn){logoutBtn.disabled=!state.session?.isOwner;logoutBtn.style.display=state.session?.isOwner?'':'none'}const ownerLoginBtn=document.getElementById('ownerLoginBtn');if(ownerLoginBtn)ownerLoginBtn.style.display=state.session?.isOwner?'none':'';const planMini=document.querySelector('.planMini');if(planMini)planMini.textContent=state.session?.isOwner?'OWNER':'FREE';"
    );
  }

  h = h.replace("const statusText=ready?c.ready:c.prepare;", "const statusText=cloudReady?c.ready:localReady?c.ready:c.prepare;");

  if (!h.includes('id="ownerLoginBtn"')) throw new Error("PUBLIC HOTFIX failed: owner button not inserted");
  if (!h.includes("a==='owner-login'")) throw new Error("PUBLIC HOTFIX failed: owner handler not inserted");

  await fs.writeFile(p, h);
}

await fs.mkdir(path.join(root, "catalog"), { recursive: true });
try {
  await fs.access(path.join(root, "catalog", "topics_1000.json"));
} catch {
  await fs.writeFile(path.join(root, "catalog", "topics_1000.json"), JSON.stringify({ version: "9.7.11", count: 0, topics: [] }));
}

await import("./server.mjs");
