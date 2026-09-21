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
  // Keep the useful tail of ffmpeg errors. The old helper kept the beginning
  // (version banner) and cut off the actual failure line at the end.
  const cleanOld='function cleanError(err) { return String(err?.message || err || "Unknown error").replace(/\\s+/g, " ").slice(0, 1200); }';
  const cleanNew='function cleanError(err) { const x=String(err?.message || err || "Unknown error").replace(/\\s+/g, " "); return x.length>2400?x.slice(-2400):x; }';
  if(s.includes(cleanOld)) s=s.replace(cleanOld,cleanNew);

  // BOUND X264 THREADS: Railway exposes host CPU count to x264, which selected ~60
  // threads inside a 2-vCPU/1-GB service. Limit libx264 to 2 threads for every
  // runFfmpeg encode on the public deployment.
  const runFfmpegHead='async function runFfmpeg(args, opts = {}) {\n  if (!ffmpegPath)';
  const runFfmpegBound='async function runFfmpeg(args, opts = {}) {\n  const publicFfmpegBound=Boolean(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID||process.env.SF_PUBLIC_MODE==="1");\n  if(publicFfmpegBound&&Array.isArray(args)&&args.includes("libx264")&&!args.includes("-threads")){const pidx=args.indexOf("-preset");const cidx=args.indexOf("-c:v");const at=pidx>=0?pidx:(cidx>=0?cidx+2:Math.max(0,args.length-1));args.splice(at,0,"-threads","2");}\n  if (!ffmpegPath)';
  if(s.includes(runFfmpegHead)) s=s.replace(runFfmpegHead,runFfmpegBound);

  // RENDER STABILITY HOTFIX: Railway has a 1 GB memory limit. Raw 1080p RGB frames
  // can make ffmpeg close its stdin, which surfaces as write EPIPE. Keep the requested
  // final profile, but use a memory-safe internal raster on public Railway and let
  // normalizeClip produce the requested final dimensions.
  const renderHead =
    'const seconds=Math.max(.8,Number(partSeconds)||5),portrait=ctx.format==="shorts",q=localQualityProfile(ctx);\n  const [sw,sh]=portrait?q.short:q.wide,fps=q.fps,frames=Math.max(1,Math.round(seconds*fps));';
  const renderHeadFixed =
    'const seconds=Math.max(.8,Number(partSeconds)||5),portrait=ctx.format==="shorts",q=localQualityProfile(ctx);\n  const [targetW,targetH]=portrait?q.short:q.wide;\n  const publicMemorySafe=Boolean(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID||process.env.SF_PUBLIC_MODE==="1");\n  const [sw,sh]=publicMemorySafe&&!ctx.draft?(portrait?[540,960]:[960,540]):[targetW,targetH];\n  const fps=publicMemorySafe&&!ctx.draft?Math.min(24,q.fps):q.fps,frames=Math.max(1,Math.round(seconds*fps));';
  if(s.includes(renderHead)) s=s.replace(renderHead,renderHeadFixed);

  // Cloud PHOTO can still generate at the requested target resolution because that
  // path does not stream raw RGB frames through Node.
  s=s.replace(
    'generateCloudPhotoWithRetries(localImageFullPrompt(scene,ctx),sw,sh,seed,ctx.signal',
    'generateCloudPhotoWithRetries(localImageFullPrompt(scene,ctx),targetW,targetH,seed,ctx.signal'
  );
  s=s.replaceAll(
    'generateLocalImageModel(localImageFullPrompt(scene,ctx)+suffix,sw,sh,ctx.style||"photorealistic"',
    'generateLocalImageModel(localImageFullPrompt(scene,ctx)+suffix,targetW,targetH,ctx.style||"photorealistic"'
  );
  s=s.replaceAll(
    'generateLocalImageModel(localImagePlatePrompt(scene,ctx)+suffix,sw,sh,ctx.style||"photorealistic"',
    'generateLocalImageModel(localImagePlatePrompt(scene,ctx)+suffix,targetW,targetH,ctx.style||"photorealistic"'
  );

  // When publicMemorySafe is active, encoding the internal raw stream must be fast
  // and bounded. Final normalizeClip applies the requested Max/Ultra profile later.
  const rawPresetOld='ctx.draft?"ultrafast":q.preset,"-crf",String(ctx.draft?28:q.crf)';
  const rawPresetNew='ctx.draft?"ultrafast":publicMemorySafe?"ultrafast":q.preset,"-crf",String(ctx.draft?28:publicMemorySafe?23:q.crf)';
  s=s.replace(rawPresetOld,rawPresetNew);
  const rawThreadOld='"-c:v","libx264","-preset",ctx.draft?"ultrafast":publicMemorySafe?"ultrafast":q.preset';
  const rawThreadNew='"-c:v","libx264",...(publicMemorySafe?["-threads","2"]:[]),"-preset",ctx.draft?"ultrafast":publicMemorySafe?"ultrafast":q.preset';
  s=s.replace(rawThreadOld,rawThreadNew);

  // Swallow the pipe's secondary EPIPE event and report the actual ffmpeg close/error
  // instead of crashing the job with a misleading write EPIPE.
  const spawnOld='const child=spawn(ffmpegPath,args,{stdio:["pipe","ignore","pipe"],cwd:ROOT});let stderr="",closed=false;';
  const spawnNew='const child=spawn(ffmpegPath,args,{stdio:["pipe","ignore","pipe"],cwd:ROOT});let stderr="",closed=false,stdinError=""; child.stdin.on("error",e=>{stdinError=cleanError(e)});';
  s=s.replace(spawnOld,spawnNew);
  const closeOld='else code===0?resolve():reject(new Error(stderr.slice(-4000)||\`FFmpeg exited ${code}\`));';
  const closeNew='else code===0?resolve():reject(new Error(stderr.slice(-4000)||stdinError||\`FFmpeg exited ${code}\`));';
  s=s.replace(closeOld,closeNew);
  const epipeCatchOld='}catch(e){try{child.stdin.destroy();}catch{}stop();reject(e);}})();';
  const epipeCatchNew='}catch(e){if(e?.code==="EPIPE"){try{child.stdin.destroy();}catch{}return;}try{child.stdin.destroy();}catch{}stop();reject(e);}})();';
  s=s.replace(epipeCatchOld,epipeCatchNew);

  if(s.includes(renderHead)) throw new Error("RENDER HOTFIX failed: old 1080p raw render head remains");
  if(!s.includes("publicMemorySafe")) throw new Error("RENDER HOTFIX failed: public memory-safe mode missing");

  // RESEARCH FIX: stripHtml depended on a missing htmlText helper.
  if(!s.includes("function htmlText(v){")){
    const stripMarker='function stripHtml(v){';
    if(!s.includes(stripMarker)) throw new Error("RESEARCH HOTFIX: stripHtml marker missing");
    const htmlHelper='function htmlText(v){ return String(v||"").replace(/<[^>]*>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,"\\\"").replace(/&#39;|&apos;/gi,"\\\'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/\\s+/g," ").trim(); }\\n';
    s=s.replace(stripMarker,htmlHelper+stripMarker);
  }

  // SELF-MOTION is a connected renderer even when optional Local PHOTO is offline.
  s=s.replace('connected:photoReady,','connected:true,');

  // FINAL FPS FIX: concat muxing was falling back to 25 fps. Force the final stitched
  // MP4 to a stable 30 fps, matching Max/Ultra UI and scene normalization.
  const stitchOld='await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:v", "libx264"';
  const stitchNew='await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", "fps=30", "-r", "30", "-c:v", "libx264"';
  if(s.includes(stitchOld)) s=s.replace(stitchOld,stitchNew);

  // PUBLIC AI PHOTO: use a real semantic image model before procedural Smart Composer.
  if(!s.includes("async function generatePublicPhotoAI(")){
    const imageEndpoint='app.post("/api/image/free", async (req,res)=> {';
    if(!s.includes(imageEndpoint)) throw new Error("PHOTO HOTFIX: image endpoint marker missing");
    const publicAiHelper=[
      'async function expandPublicPhotoPrompt(prompt,style="cinematic"){',
      '  const user=safeProjectText(prompt,1600).trim();',
      '  const instruction="You are a cinematic image prompt engineer. Rewrite the user request into one precise English image-generation prompt. Preserve the exact meaning. Do not invent people, astronauts, buildings, text or unrelated objects unless explicitly requested. For scientific what-if topics, show physically relevant objects and consequences. Specify composition, lighting, materials, scale, camera and photorealism. Output only the prompt. User request: "+user+"\\nStyle: "+safeProjectText(style,120);',
      '  try{const r=await fetch("https://text.pollinations.ai/"+encodeURIComponent(instruction),{headers:{"User-Agent":"ShortForge/9.7.12-public"},signal:AbortSignal.timeout(18000)});if(r.ok){const x=safeProjectText(await r.text(),2600).trim();if(x.length>40)return x;}}catch{}',
      '  return user+", "+safeProjectText(style,120)+", hyper-realistic cinematic photography, physically plausible lighting, accurate materials, detailed textures, strong composition, high dynamic range, sharp focal subject, no text, no watermark, no logo";',
      '}',
      'async function generatePublicPhotoAI(prompt,w,h,seed,style="cinematic",opts={}){',
      '  const expanded=await expandPublicPhotoPrompt(prompt,style);',
      '  let rw=1024,rh=1024; const ratio=w/Math.max(1,h);',
      '  if(ratio<0.85){rw=768;rh=1344}else if(ratio>1.2){rw=1344;rh=768}else if(ratio<0.95){rw=864;rh=1080}',
      '  const url="https://image.pollinations.ai/prompt/"+encodeURIComponent(expanded)+"?width="+rw+"&height="+rh+"&seed="+(Number(seed)||1)+"&nologo=true&model=flux";',
      '  const r=await fetch(url,{headers:{"User-Agent":"ShortForge/9.7.12-public","Accept":"image/*"},signal:AbortSignal.timeout(65000)});',
      '  if(!r.ok)throw new Error("PUBLIC_AI_PHOTO_HTTP_"+r.status);',
      '  const ct=String(r.headers.get("content-type")||""); if(!ct.startsWith("image/"))throw new Error("PUBLIC_AI_PHOTO_BAD_CONTENT");',
      '  const buf=Buffer.from(await r.arrayBuffer()); if(buf.length<12000)throw new Error("PUBLIC_AI_PHOTO_EMPTY");',
      '  const dir=opts.outputDir||IMAGES_DIR; await fs.mkdir(dir,{recursive:true});',
      '  const file=path.join(dir,"public-ai-"+crypto.randomUUID()+".jpg"); await fs.writeFile(file,buf);',
      '  return {file,engine:"pollinations-flux",model:"FLUX via Pollinations",expandedPrompt:expanded};',
      '}',
      ''
    ].join("\\n");
    s=s.replace(imageEndpoint,publicAiHelper+imageEndpoint);
  }

  const smartFallback='    if(!img){\\n      // PHOTO is optional in V9.7.11. Smart Composer creates a native ShortForge visual instead of blocking Image Studio.';
  if(s.includes(smartFallback) && !s.includes("Generated with Public AI PHOTO.")){
    const aiAttempt=[
      '    if(!img&&String(process.env.SHORTFORGE_PUBLIC_AI_PHOTO||"1")!=="0"){',
      '      try{',
      '        const pub=await generatePublicPhotoAI(prompt,w,h,seed,b.style||"photorealistic",{outputDir:work});',
      '        img=pub.file;engine=pub.engine;model=pub.model;generationAttempt=1;note="Generated with Public AI PHOTO.";',
      '      }catch(e){localError=[localError,cleanError(e)].filter(Boolean).join(" | ");}',
      '    }',
      ''
    ].join("\\n");
    s=s.replace(smartFallback,aiAttempt+smartFallback);
  }

  s=s.replace('fallbackUsed:false,photorealistic:engine!=="forge-smart-composer"', 'fallbackUsed:engine==="forge-smart-composer",photorealistic:engine!=="forge-smart-composer"');
  s=s.replace('provider:engine==="cloudflare-workers-ai"?"cloud":engine==="forge-smart-composer"?"smart":"local"', 'provider:engine==="cloudflare-workers-ai"?"cloud":engine==="pollinations-flux"?"public-ai":engine==="forge-smart-composer"?"smart":"local"');
  s=s.replace('license:engine==="cloudflare-workers-ai"?"Generated with Cloudflare Workers AI":"Generated by ShortForge"', 'license:engine==="cloudflare-workers-ai"?"Generated with Cloudflare Workers AI":engine==="pollinations-flux"?"AI-generated image":"Generated by ShortForge"');

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

  // ROBUST LANGUAGE FIX: previous exact opts() replacement could miss. Insert by stable head() marker.
  if(!h.includes("function languageNames(){")){
    const headMarker="function head(title,sub,actions=''){";
    if(!h.includes(headMarker)) throw new Error("LANG HOTFIX: head() marker missing");
    h=h.replace(headMarker,"function languageNames(){return state.lang==='ru'?{ru:'Русский',en:'Английский',uz:'Узбекский'}:state.lang==='uz'?{ru:'Ruscha',en:'Inglizcha',uz:'O‘zbekcha'}:{ru:'Russian',en:'English',uz:'Uzbek'}}"+headMarker);
  }

  // STORYBOARD INTERNAL-ONLY: keep planning and scene structures in code, but do not
  // route normal users to the standalone storyboard editor.
  h = h.replace("state.planProgress=null;state.section='storyboard';render()", "state.planProgress=null;state.section='create';render()");
  h = h.replace("['studio','🎬'],['storyboard','🧩'],", "['studio','🎬'],");
  h = h.replace("['home','create','studio','storyboard','timeline']", "['home','create','studio','timeline']");
  h = h.replace(
    "function render(){if(state.section==='users'&&!state.session?.isOwner)state.section='home';",
    "function render(){if(state.section==='storyboard')state.section='create';if(state.section==='users'&&!state.session?.isOwner)state.section='home';"
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

await fs.mkdir(path.join(root, "catalog"), { recursive: true });
{
  const catalogPath=path.join(root,"catalog","topics_1000.json");
  let existing=null; try{existing=JSON.parse(await fs.readFile(catalogPath,"utf8"))}catch{}
  if(!Array.isArray(existing?.topics)||existing.topics.length===0){
    const topics=[
      {id:"sun-disappears",category:"space",canonical_ru:"Солнце исчезает",canonical_en:"Sun disappears",aliases:["что будет если солнце исчезнет","если солнце погаснет","sun disappears","sun vanishes"],queries:["Sun Earth scientific visualization","Earth without sunlight"],visuals:["Sun and Earth in deep space","Earth going dark after sunlight delay","frozen dark Earth drifting through space"],forbidden:["religious figure","fictional character"]},
      {id:"black-hole",category:"space",canonical_ru:"чёрная дыра",canonical_en:"black hole",aliases:["черная дыра","black hole","event horizon"],queries:["black hole accretion disk astrophotography","gravitational lensing black hole"],visuals:["black hole with accretion disk","gravitational lensing star field"],forbidden:["cartoon"]},
      {id:"universe",category:"space",canonical_ru:"Вселенная",canonical_en:"Universe",aliases:["вселенная","universe","космос"],queries:["deep universe galaxies","cosmic web visualization"],visuals:["deep field galaxies","cosmic web"],forbidden:[]},
      {id:"earth",category:"science",canonical_ru:"Земля",canonical_en:"Earth",aliases:["земля","планета земля","earth"],queries:["Earth from space NASA style","Earth atmosphere"],visuals:["detailed Earth from orbit","Earth atmosphere limb"],forbidden:[]},
      {id:"moon",category:"space",canonical_ru:"Луна",canonical_en:"Moon",aliases:["луна","moon"],queries:["Moon surface realistic","Earth Moon system"],visuals:["Moon surface","Moon and Earth"],forbidden:[]},
      {id:"mars",category:"space",canonical_ru:"Марс",canonical_en:"Mars",aliases:["марс","mars"],queries:["Mars landscape realistic","Mars from orbit"],visuals:["Mars landscape","Mars planet"],forbidden:[]},
      {id:"tornado",category:"weather",canonical_ru:"торнадо",canonical_en:"tornado",aliases:["торнадо","смерч","tornado"],queries:["tornado storm photography"],visuals:["tornado over landscape"],forbidden:["cartoon"]},
      {id:"ocean",category:"nature",canonical_ru:"океан",canonical_en:"ocean",aliases:["океан","море","ocean"],queries:["deep ocean cinematic","ocean waves"],visuals:["deep ocean","storm waves"],forbidden:[]},
      {id:"human-body",category:"biology",canonical_ru:"человеческое тело",canonical_en:"human body",aliases:["тело человека","организм человека","human body"],queries:["human anatomy medical visualization"],visuals:["scientific anatomy visualization"],forbidden:[]},
      {id:"physics",category:"science",canonical_ru:"физика",canonical_en:"physics",aliases:["физика","physics"],queries:["physics scientific visualization"],visuals:["physical process visualization"],forbidden:[]},
      {id:"technology",category:"technology",canonical_ru:"технологии",canonical_en:"technology",aliases:["технологии","technology","ии","ai"],queries:["advanced technology cinematic"],visuals:["modern technology detail"],forbidden:[]},
      {id:"history",category:"history",canonical_ru:"история",canonical_en:"history",aliases:["история","history"],queries:["historical reconstruction cinematic"],visuals:["historical environment reconstruction"],forbidden:[]}
    ];
    await fs.writeFile(catalogPath,JSON.stringify({version:"9.7.12-public",count:topics.length,topics},null,2));
  }
}

await import("./server.mjs");
