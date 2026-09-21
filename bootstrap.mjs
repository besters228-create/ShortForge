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

function replaceRequired(text, from, to, label) {
  if (!text.includes(from)) throw new Error("PUBLIC HOTFIX patch missing: " + label);
  return text.replace(from, to);
}

await restore("server.mjs", "server.mjs");
await restore("core.mjs", "core.mjs");
await restore("index.html", "public/index.html");

// PUBLIC HOTFIX: Image Studio must not reference an undefined 'format'.
{
  const p = path.join(root, "server.mjs");
  let s = await fs.readFile(p, "utf8");
  s = replaceRequired(
    s,
    'const smartCtx={topic:safeProjectText(b.topic||prompt,1000),style:b.style||"cinematic",format:format,generationMode:"ultra"};',
    'const smartFormat=(b.format==="long"||aspect==="16:9")?"long":"shorts";\\n      const smartCtx={topic:safeProjectText(b.topic||prompt,1000),style:b.style||"cinematic",format:smartFormat,generationMode:"ultra"};',
    "image format"
  );
  s = replaceRequired(
    s,
    "app.use(express.static(PUBLIC));",
    'app.use((req,res,next)=>{ if(req.method==="GET" && (req.path==="/" || req.path.endsWith(".html"))){ res.set("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate"); res.set("Pragma","no-cache"); res.set("Expires","0"); } next(); });\\napp.use(express.static(PUBLIC));',
    "html cache"
  );
  await fs.writeFile(p, s);
}

// PUBLIC HOTFIX: owner login + reliable language/theme UI + honest Smart Composer status.
{
  const p = path.join(root, "public", "index.html");
  let h = await fs.readFile(p, "utf8");
  h = h.replace("ShortForge V9.7.11 — PHOTO + LANG + UPDATE","ShortForge V9.7.11 — PUBLIC HOTFIX");
  h = replaceRequired(
    h,
    '<button data-profile-action="plan">✦ <span id="profileMenuPlan">Тариф</span><span class="planMini">FREE</span></button>\\n      <button data-profile-action="settings">⚙ <span id="profileMenuSettings">Настройки</span></button>',
    '<button data-profile-action="plan">✦ <span id="profileMenuPlan">Тариф</span><span class="planMini">FREE</span></button>\\n      <button id="ownerLoginBtn" data-profile-action="owner-login">◆ <span id="profileMenuOwnerLogin">Войти как владелец</span></button>\\n      <button data-profile-action="settings">⚙ <span id="profileMenuSettings">Настройки</span></button>',
    "owner login button"
  );
  h = replaceRequired(
    h,
    "const pm={profile:tri('Профиль','Profile','Profil'),plan:tri('Тариф','Plan','Tarif'),settings:tri('Настройки','Settings','Sozlamalar'),logout:tri('Выйти','Sign out','Chiqish')};\\n  const ids={profile:'profileMenuProfile',plan:'profileMenuPlan',settings:'profileMenuSettings',logout:'profileMenuLogout'};for(const [k,id] of Object.entries(ids)){const el=document.getElementById(id);if(el)el.textContent=pm[k]}",
    "const pm={profile:tri('Профиль','Profile','Profil'),plan:tri('Тариф','Plan','Tarif'),ownerLogin:tri('Войти как владелец','Owner login','Owner sifatida kirish'),settings:tri('Настройки','Settings','Sozlamalar'),logout:tri('Выйти','Sign out','Chiqish')};\\n  const ids={profile:'profileMenuProfile',plan:'profileMenuPlan',ownerLogin:'profileMenuOwnerLogin',settings:'profileMenuSettings',logout:'profileMenuLogout'};for(const [k,id] of Object.entries(ids)){const el=document.getElementById(id);if(el)el.textContent=pm[k]}",
    "owner login labels"
  );
  h = replaceRequired(
    h,
    "if(profileName)profileName.textContent=state.session?.isOwner?(state.session.ownerName||'Alex'):tri('Гость','Guest','Mehmon');if(profilePlan)profilePlan.textContent=state.session?.isOwner?'OWNER':'Free';if(profileAvatar)profileAvatar.textContent=(profileName?.textContent||'G').trim().slice(0,1).toUpperCase();if(logoutBtn)logoutBtn.disabled=!state.session?.isOwner;",
    "if(profileName)profileName.textContent=state.session?.isOwner?(state.session.ownerName||'Alex'):tri('Гость','Guest','Mehmon');if(profilePlan)profilePlan.textContent=state.session?.isOwner?'OWNER':'Free';if(profileAvatar)profileAvatar.textContent=(profileName?.textContent||'G').trim().slice(0,1).toUpperCase();if(logoutBtn){logoutBtn.disabled=!state.session?.isOwner;logoutBtn.style.display=state.session?.isOwner?'':'none'}const ownerLoginBtn=document.getElementById('ownerLoginBtn');if(ownerLoginBtn)ownerLoginBtn.style.display=state.session?.isOwner?'none':'';const planMini=document.querySelector('.planMini');if(planMini)planMini.textContent=state.session?.isOwner?'OWNER':'FREE';",
    "profile owner state"
  );
  h = replaceRequired(h,"const statusText=ready?c.ready:c.prepare;","const statusText=cloudReady?c.ready:localReady?c.ready:c.prepare;","image status");
  h = replaceRequired(
    h,
    "function bindShellUi(){const pb=document.getElementById('profileButton'),pm=document.getElementById('profileMenu');if(pb&&pm){pb.onclick=ev=>{ev.stopPropagation();pm.classList.toggle('hidden')};document.querySelectorAll('[data-profile-action]').forEach(b=>b.onclick=async()=>{const a=b.dataset.profileAction;if(a==='settings'||a==='profile'||a==='plan'){state.section='settings';pm.classList.add('hidden');render()}else if(a==='logout'&&state.session?.isOwner){await api('/api/owner/logout',{method:'POST',body:'{}'});state.session={isOwner:false,ownerName:null};state.visitors=null;state.section='home';pm.classList.add('hidden');render()}})}}",
    "function bindShellUi(){const pb=document.getElementById('profileButton'),pm=document.getElementById('profileMenu');if(pb&&pm){pb.onclick=ev=>{ev.stopPropagation();pm.classList.toggle('hidden')};document.querySelectorAll('[data-profile-action]').forEach(b=>b.onclick=async()=>{const a=b.dataset.profileAction;if(a==='settings'||a==='profile'||a==='plan'){state.section='settings';pm.classList.add('hidden');render()}else if(a==='owner-login'&&!state.session?.isOwner){const key=prompt(tri('Введите ключ владельца','Enter owner key','Owner kalitini kiriting'));if(!key)return;try{await api('/api/owner/login',{method:'POST',body:JSON.stringify({key})});await refreshAll();state.section='home';pm.classList.add('hidden');render();toast(tri('Режим владельца включён','Owner mode enabled','Owner rejimi yoqildi'))}catch(err){toast(err.message)}}else if(a==='logout'&&state.session?.isOwner){await api('/api/owner/logout',{method:'POST',body:'{}'});state.session={isOwner:false,ownerName:null};state.visitors=null;state.section='home';pm.classList.add('hidden');render()}})}}",
    "owner login handler"
  );
  h = replaceRequired(
    h,
    "document.getElementById('lang').onchange=x=>{state.lang=x.target.value;savePrefs();render()};document.getElementById('themeBtn').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';savePrefs();render()};",
    "document.getElementById('lang').addEventListener('change',x=>{const next=['ru','en','uz'].includes(x.target.value)?x.target.value:'ru';state.lang=next;savePrefs();sync();render()});document.getElementById('themeBtn').addEventListener('click',()=>{state.theme=state.theme==='dark'?'light':'dark';savePrefs();sync();render()});",
    "lang/theme handlers"
  );
  await fs.writeFile(p, h);
}

await fs.mkdir(path.join(root, "catalog"), { recursive: true });
try {
  await fs.access(path.join(root, "catalog", "topics_1000.json"));
} catch {
  await fs.writeFile(path.join(root, "catalog", "topics_1000.json"), JSON.stringify({ version: "9.7.11", count: 0, topics: [] }));
}

await import("./server.mjs");
