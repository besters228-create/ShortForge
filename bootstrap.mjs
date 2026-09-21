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
      "if(logoutBtn){logoutBtn.disabled=!state.session?.isOwner;logoutBtn.style.display=state.session?.isOwner?'':'none'}const ownerLoginBtn=document.getElementById('ownerLoginBtn');if(ownerLoginBtn){ownerLoginBtn.style.display=state.session?.isOwner?'none':'';const ownerLoginLabel=ownerLoginBtn.querySelector('span');if(ownerLoginLabel)ownerLoginLabel.textContent=tri('Войти как владелец','Owner login','Owner sifatida kirish')}const planMini=document.querySelector('.planMini');if(planMini)planMini.textContent=state.session?.isOwner?'OWNER':'FREE';"
    );
  }

  h = h.replace("const statusText=ready?c.ready:c.prepare;", "const statusText=cloudReady?c.ready:localReady?c.ready:c.prepare;");

  // LOCALIZED LANGUAGE NAMES: every language selector follows the active UI language.
  h = h.replace(
    "function opts(obj,val){return Object.entries(obj).map(([k,v])=>\`<option value=\\\"\${k}\\\" \${k===val?'selected':''}>\${e(v)}</option>\`).join('')}",
    "function opts(obj,val){return Object.entries(obj).map(([k,v])=>\`<option value=\\\"\${k}\\\" \${k===val?'selected':''}>\${e(v)}</option>\`).join('')}function languageNames(){return state.lang==='ru'?{ru:'Русский',en:'Английский',uz:'Узбекский'}:state.lang==='uz'?{ru:'Ruscha',en:'Inglizcha',uz:'O‘zbekcha'}:{ru:'Russian',en:'English',uz:'Uzbek'}}"
  );
  h = h.replace(
    '<select id="lang" class="compactSelect"><option value="ru">RU</option><option value="en">EN</option><option value="uz">UZ</option></select>',
    '<select id="lang" class="compactSelect"></select>'
  );
  h = h.replace(
    "document.getElementById('lang').value=state.lang;document.getElementById('themeBtn').textContent=state.theme==='dark'?'☀️':'🌙';",
    "const langSel=document.getElementById('lang');if(langSel){langSel.innerHTML=opts(languageNames(),state.lang);langSel.value=state.lang}document.getElementById('themeBtn').textContent=state.theme==='dark'?'☀️':'🌙';"
  );
  h = h.replace(
    "<select id=\"aLang\"><option value=\"ru\" \${state.lang==='ru'?'selected':''}>Русский</option><option value=\"en\" \${state.lang==='en'?'selected':''}>English</option><option value=\"uz\" \${state.lang==='uz'?'selected':''}>O‘zbek</option></select>",
    "<select id=\"aLang\">\${opts(languageNames(),state.lang)}</select>"
  );
  h = h.replace(
    "opts({ru:'Русский',en:'English',uz:'O‘zbek'},state.lang)",
    "opts(languageNames(),state.lang)"
  );

  // LIGHT THEME CONTRAST FIX: later dark-mode polish rules used to override light variables.
  if (!h.includes("LIGHT THEME CONTRAST FIX")) {
    const lightFix = `
<style id="sf-light-contrast-fix">
/* LIGHT THEME CONTRAST FIX */
html[data-theme="light"] body{
  background:
    radial-gradient(900px 620px at 10% 8%,rgba(116,92,255,.08),transparent 68%),
    radial-gradient(850px 580px at 88% 12%,rgba(33,170,235,.08),transparent 70%),
    linear-gradient(135deg,#f5f8fd 0%,#eef3fa 45%,#e7edf7 100%) !important;
  color:#142033 !important;
}
html[data-theme="light"] .content,
html[data-theme="light"] .main{color:#142033 !important}
html[data-theme="light"] .card,
html[data-theme="light"] .hero,
html[data-theme="light"] .imageControl,
html[data-theme="light"] .progressCard{
  background:#ffffff !important;
  border-color:#d6e0ef !important;
  color:#142033 !important;
  box-shadow:0 18px 45px rgba(44,63,93,.10) !important;
}
html[data-theme="light"] .muted,
html[data-theme="light"] .small,
html[data-theme="light"] .pageHead p,
html[data-theme="light"] .technicalHiddenNote,
html[data-theme="light"] .planCard small{color:#60708a !important}

/* Keep navigation premium-dark in light mode for stable contrast. */
html[data-theme="light"] .side{
  --bg:#070b14;--bg2:#0b1020;--panel:#0e1528;--panel2:#111b32;--panel3:#17223c;
  --line:#263552;--text:#f6f8ff;--muted:#9aacc8;
  background:linear-gradient(180deg,#0b1020,#070b14) !important;
  border-color:#263552 !important;
  color:#f6f8ff !important;
}
html[data-theme="light"] .side .nav button{color:#9aacc8 !important}
html[data-theme="light"] .side .nav button:hover,
html[data-theme="light"] .side .nav button.active{color:#fff !important;background:#17223c !important}
html[data-theme="light"] .side .navGroup,
html[data-theme="light"] .side .version{color:#91a4c2 !important}

/* Keep the top shell dark too; it avoids washed-out controls. */
html[data-theme="light"] .top{
  --panel:#0e1528;--panel2:#111b32;--panel3:#17223c;--line:#263552;--text:#f6f8ff;--muted:#9aacc8;
  background:rgba(7,11,20,.96) !important;
  border-color:#263552 !important;
  color:#f6f8ff !important;
}
html[data-theme="light"] .top input,
html[data-theme="light"] .top select,
html[data-theme="light"] .top .iconBtn,
html[data-theme="light"] .top .pill{
  background:#0e1528 !important;color:#f6f8ff !important;border-color:#263552 !important;
}
html[data-theme="light"] .top input::placeholder{color:#7f91af !important}
html[data-theme="light"] .top .keycap{background:#17223c !important;color:#9aacc8 !important;border-color:#263552 !important}

/* Form fields had a hard-coded dark background in the polish stylesheet. */
html[data-theme="light"] .content input,
html[data-theme="light"] .content select,
html[data-theme="light"] .content textarea{
  background:#ffffff !important;
  color:#142033 !important;
  border-color:#cbd7e8 !important;
  box-shadow:none;
}
html[data-theme="light"] .content input::placeholder,
html[data-theme="light"] .content textarea::placeholder{color:#8291a8 !important}
html[data-theme="light"] .content select option{background:#fff !important;color:#142033 !important}
html[data-theme="light"] .content input:focus,
html[data-theme="light"] .content select:focus,
html[data-theme="light"] .content textarea:focus{
  border-color:#5f79ff !important;
  box-shadow:0 0 0 3px rgba(95,121,255,.13) !important;
}

/* Compact controls and cards. */
html[data-theme="light"] .segmented,
html[data-theme="light"] .cleanProgress,
html[data-theme="light"] .stageDot{background:#eaf0f8 !important}
html[data-theme="light"] .segBtn{color:#5e6f88 !important}
html[data-theme="light"] .segBtn.active{color:#fff !important}
html[data-theme="light"] .planCard,
html[data-theme="light"] .planSummary,
html[data-theme="light"] .chip,
html[data-theme="light"] .refCard{background:#f7f9fd !important;color:#142033 !important}
html[data-theme="light"] .planCard.active{background:#f1efff !important}
html[data-theme="light"] .btn:not(.primary):not(.ok):not(.warn):not(.bad){
  background:#eef3fb !important;color:#1c2b42 !important;border-color:#d2ddeb !important;
}
html[data-theme="light"] .btn.ghost{background:#fff !important}

/* Preview/log remain dark intentionally, but readable. */
html[data-theme="light"] .preview,
html[data-theme="light"] .phone,
html[data-theme="light"] .log{color:#dce8ff !important}
</style>`;
    h = h.replace("</head>", lightFix + "\n</head>");
  }

  if (!h.includes('id="ownerLoginBtn"')) throw new Error("PUBLIC HOTFIX failed: owner button not inserted");
  if (!h.includes("a==='owner-login'")) throw new Error("PUBLIC HOTFIX failed: owner handler not inserted");

  await fs.writeFile(p, h);
}

// Temporary render diagnostics: source excerpts go only to Railway logs when explicitly enabled.
if (process.env.SF_RENDER_DIAG === "1") {
  const dbg = await fs.readFile(path.join(root, "server.mjs"), "utf8");
  const keys = [
    "FORGE SELF-MOTION",
    "Подготавливаем локальный IMAGE-FIRST рендер",
    "write EPIPE",
    "stdin.write",
    ".stdin",
    "spawn(",
    "ffmpeg",
    "renderScene",
    "renderLocal",
    "const sw",
    "const sh",
    "const fps",
    "const frames",
    "const q=",
    "selfMotion",
    "SELF-MOTION",
    "final render"
  ];
  for (const key of keys) {
    const i = dbg.indexOf(key);
    if (i >= 0) console.log("\n[SF_RENDER_DIAG:"+key+"]\n" + dbg.slice(Math.max(0,i-1800), Math.min(dbg.length,i+4200)) + "\n[/SF_RENDER_DIAG]\n");
  }
  const wi=dbg.indexOf("child.stdin.write(frame)");
  if(wi>=0){
    const fn=dbg.lastIndexOf("async function",wi);
    console.log("\n[SF_RENDER_DIAG:SELF_MOTION_FULL]\n"+dbg.slice(fn>=0?fn:Math.max(0,wi-9000),Math.min(dbg.length,wi+3500))+"\n[/SF_RENDER_DIAG]\n");
  }
}

await fs.mkdir(path.join(root, "catalog"), { recursive: true });
try {
  await fs.access(path.join(root, "catalog", "topics_1000.json"));
} catch {
  await fs.writeFile(path.join(root, "catalog", "topics_1000.json"), JSON.stringify({ version: "9.7.11", count: 0, topics: [] }));
}

await import("./server.mjs");
