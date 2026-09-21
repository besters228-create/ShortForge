import { promises as fs } from "node:fs";
import path from "node:path";

const NL = String.fromCharCode(10);

function requireMarker(text, marker, label) {
  if (!text.includes(marker)) throw new Error("QUALITY_REBUILD marker missing: " + label);
}

function replaceOnce(text, from, to, label) {
  requireMarker(text, from, label);
  return text.replace(from, to);
}

function spliceBetween(text, startMarker, endMarker, replacement, label) {
  const a = text.indexOf(startMarker);
  if (a < 0) throw new Error("QUALITY_REBUILD start marker missing: " + label);
  const b = text.indexOf(endMarker, a + startMarker.length);
  if (b < 0) throw new Error("QUALITY_REBUILD end marker missing: " + label);
  return text.slice(0, a) + replacement + text.slice(b);
}

export async function applyQualityRebuild(root) {
  const serverPath = path.join(root, "server.mjs");
  let s = await fs.readFile(serverPath, "utf8");

  // Product version for this quality rebuild.
  s = s.replace('const VERSION = "9.7.11";', 'const VERSION = "9.7.13";');
  s = s.replace('const VERSION="9.7.11";', 'const VERSION="9.7.13";');

  // ---------------------------------------------------------------------------
  // 1) SEMANTIC / VISUAL LOCK
  // ---------------------------------------------------------------------------
  if (!s.includes("function shortForgeVisualBible(")) {
    const marker = "function localImageFullPrompt(scene={},ctx={}){";
    requireMarker(s, marker, "localImageFullPrompt");
    const helper = [
      "function shortForgeImageQualityMode(v){",
      "  const x=String(v||\"high\").toLowerCase();",
      "  if(x===\"balanced\")return \"medium\";",
      "  if(x===\"photo\")return \"high\";",
      "  if(x===\"photo_plus\")return \"ultra\";",
      "  return [\"light\",\"medium\",\"high\",\"ultra\"].includes(x)?x:\"high\";",
      "}",
      "function shortForgeVisualBible(topic=\"\",language=\"ru\",style=\"cinematic\"){",
      "  const raw=String(topic||\"\").trim(), low=raw.toLowerCase().replace(/ё/g,\"е\");",
      "  const pack=typeof semanticTopicPack===\"function\"?semanticTopicPack(raw,language):null;",
      "  if(/(?:солнц.{0,40}(?:исчез|пропад|погас)|(?:исчез|пропад|погас).{0,40}солнц|sun.{0,40}(?:disappear|vanish|gone)|(?:disappear|vanish).{0,40}sun)/i.test(low)){",
      "    return {id:\"sun_disappears\",summary:\"scientifically grounded visual story about Earth after the Sun suddenly disappears\",must:[\"Earth as the recurring anchor subject\",\"the Sun or its explicit absence when relevant to the scene\",\"deep space and physically plausible astronomical scale\",\"the exact consequence described by the scene\"],forbidden:[\"random people\",\"hooded figures\",\"fantasy characters\",\"religious figures\",\"monsters\",\"unrelated buildings\",\"unrelated water portraits\",\"metaphorical reinterpretation\",\"text\",\"logo\",\"watermark\"],continuity:\"Keep the same realistic Earth identity, astrophotography language, color grade and scientific visual universe across all scenes; change the composition and consequence, not the topic.\"};",
      "  }",
      "  const must=(pack&&Array.isArray(pack.requiredAny)?pack.requiredAny:[]).slice(0,8);",
      "  const forbidden=(pack&&Array.isArray(pack.forbidden)?pack.forbidden:[]).slice(0,10);",
      "  if(!forbidden.length)forbidden.push(\"unrelated people\",\"unrelated objects\",\"text\",\"logo\",\"watermark\");",
      "  return {id:pack?.id||\"generic\",summary:\"literal, coherent visual interpretation of the exact topic: \"+raw,must:must.length?must:[raw||\"the requested subject\"],forbidden,continuity:\"Preserve the same visual language, lighting logic, recurring subjects and world identity between adjacent scenes while using a distinct composition for each shot.\"};",
      "}",
      "function shortForgeSemanticGuard(scene={},ctx={}){",
      "  const topic=String(ctx.topic||ctx.title||scene.topic||scene.visual||scene.prompt||\"\").trim();",
      "  const bible=shortForgeVisualBible(topic,ctx.language||ctx.uiLanguage||\"ru\",ctx.style||\"cinematic\");",
      "  const prev=String(scene.previousVisual||ctx.previousVisual||\"\").trim();",
      "  const must=(bible.must||[]).join(\"; \");",
      "  const forbidden=(bible.forbidden||[]).join(\"; \");",
      "  return \"VISUAL BIBLE: \"+bible.summary+\". MUST INCLUDE/RESPECT: \"+must+\". FORBIDDEN: \"+forbidden+\". CONTINUITY: \"+bible.continuity+(prev?\" Previous shot context: \"+prev+\". Continue the same visual universe without copying the same framing.\":\"\")+\" The image must literally depict the requested event; do not replace the subject with a metaphor, mood portrait or unrelated cinematic object.\";",
      "}",
      ""
    ].join(NL);
    s = s.replace(marker, helper + marker);
  }

  // Strengthen every renderer-side full image prompt with the semantic lock.
  {
    const a = s.indexOf("function localImageFullPrompt(scene={},ctx={}){");
    const b = s.indexOf("function localImagePlatePrompt", a);
    if (a < 0 || b < 0) throw new Error("QUALITY_REBUILD localImageFullPrompt range missing");
    let seg = s.slice(a, b);
    if (!seg.includes("const guard=shortForgeSemanticGuard")) {
      seg = seg.replace(
        "function localImageFullPrompt(scene={},ctx={}){" + NL,
        "function localImageFullPrompt(scene={},ctx={}){" + NL + "  const guard=shortForgeSemanticGuard(scene,ctx);" + NL
      );
      seg = seg.replace(
        " cinematic composition, physically plausible lighting, realistic materials, coherent anatomy, no captions, no logo, no watermark",
        " Semantic lock: ${guard}. cinematic composition, physically plausible lighting, realistic materials, coherent anatomy, no captions, no logo, no watermark"
      );
    }
    s = s.slice(0, a) + seg + s.slice(b);
  }

  // Carry semantic continuity through normalized render scenes.
  s = s.replace(
    "for (let i = 0; i < scenes.length; i++) scenes[i].prompt = defaultScenePrompt(scenes[i], payload, i, scenes.length);",
    "for (let i = 0; i < scenes.length; i++) { scenes[i].previousVisual=i>0?String(scenes[i-1].visual||scenes[i-1].prompt||\"\"):\"\"; scenes[i].prompt = defaultScenePrompt(scenes[i], payload, i, scenes.length); }"
  );

  // defaultScenePrompt receives the same semantic guard, even for manually edited scenes.
  {
    const a = s.indexOf("function defaultScenePrompt(scene, payload, index, total) {");
    const b = s.indexOf(NL + "}", a);
    if (a < 0 || b < 0) throw new Error("QUALITY_REBUILD defaultScenePrompt missing");
    let seg = s.slice(a, b + 2);
    if (!seg.includes("const semanticGuard=shortForgeSemanticGuard")) {
      const ret = seg.indexOf("  return ");
      if (ret < 0) throw new Error("QUALITY_REBUILD defaultScenePrompt return missing");
      seg = seg.slice(0, ret) + "  const semanticGuard=shortForgeSemanticGuard(scene,payload);" + NL + seg.slice(ret);
      const tail = " Natural motion, coherent lighting, physically plausible movement, strong composition. Avoid: ${negative}.";
      if (!seg.includes(tail)) throw new Error("QUALITY_REBUILD defaultScenePrompt tail missing");
      seg = seg.replace(tail, " Natural motion, coherent lighting, physically plausible movement, strong composition. Avoid: ${negative}. Semantic lock: ${semanticGuard}.");
    }
    s = s.slice(0, a) + seg + s.slice(b + 2);
  }

  // Faster visual rhythm for Shorts: ~7-8 shots in 30 seconds instead of five static 6s shots.
  s = s.replace(
    'const targetSceneSeconds = format === "long" ? 20 : 6;',
    'const targetSceneSeconds = format === "long" ? 20 : 4;'
  );

  // Expand the key regression topic to eight distinct beats, so a 30s plan does not
  // repeat the same final frame when the director creates 7-8 scenes.
  {
    const key = 'return make("sun_disappears",';
    const k = s.indexOf(key);
    if (k >= 0) {
      const start = s.lastIndexOf("  if(", k);
      const end = s.indexOf(NL + NL + "  if(", k + key.length);
      if (start >= 0 && end > start) {
        const sunBlock = [
          '  if(/(?:солнц.{0,40}(?:исчез|пропад|погас)|(?:исчез|пропад|погас).{0,40}солнц|sun.{0,40}(?:disappear|vanish|gone)|(?:disappear|vanish).{0,40}sun)/i.test(x)) return make("sun_disappears",',
          '    ["Sun Earth space scientific visualization","Earth sunlight travel time eight minutes visualization","last daylight Earth horizon space","dark Earth from space without sunlight","plants photosynthesis darkness scientific","Earth leaving solar orbit tangent visualization","frozen Earth ocean ice space","dark frozen Earth drifting interstellar space"],',
          '    ["Что будет, если Солнце внезапно исчезнет?","Первые примерно восемь минут мы вообще не заметим перемен: последний свет уже летит к Земле.","Затем солнечный диск исчезнет с неба, и дневная сторона планеты быстро погрузится во тьму.","Фотосинтез остановится почти сразу, и привычные пищевые цепочки начнут разрушаться.","Одновременно исчезнет солнечное притяжение, поэтому Земля перестанет двигаться по прежней орбите.","Планета продолжит движение примерно по касательной к своей бывшей орбите и уйдёт в межзвёздное пространство.","Температура будет снижаться; поверхность и океаны начнут постепенно замерзать.","В итоге Земля станет тёмным холодным миром, летящим без Солнца через космос."],',
          '    ["What would happen if the Sun suddenly disappeared?","For roughly the first eight minutes we would notice nothing because the last sunlight is already travelling toward Earth.","Then the solar disk would vanish from the sky and the daylight side of Earth would rapidly go dark.","Photosynthesis would stop almost immediately and familiar food chains would begin to fail.","At the same time the Sun\'s gravitational pull would disappear, so Earth would no longer follow its old orbit.","The planet would continue roughly tangent to its former orbit and head into interstellar space.","Temperatures would keep falling as the surface and oceans gradually freeze.","Eventually Earth would become a dark frozen world travelling through space without the Sun."],',
          '    ["Wide realistic Sun and Earth establishing shot in deep space, accurate scale language, no people.","Earth still normally illuminated while the final sunlight crosses space, clear scientific cause-and-effect, no fantasy.","Last daylight fading over Earth\'s curved horizon; the Sun is absent after the light-delay moment, realistic astrophotography.","Earth from orbit turning dark, city lights faintly visible on the night side, no person as main subject.","Close scientific scene of real plants losing daylight inside a darkening natural environment, directly tied to photosynthesis stopping, no unrelated portrait.","Wide orbital visualization of Earth leaving its former solar orbit along a tangent with the Sun explicitly absent, realistic scientific composition.","Frozen Earth with expanding ice and dark oceans seen from orbit, physically plausible cold blue-black lighting.","Final wide shot: the same frozen dark Earth drifting alone through interstellar space, no religious, fantasy or human figure."],',
          '    ["солнце","sun","земля","earth","sunlight","свет"],',
          '    ["роман","novel","книга","book","киямат","qiyamat","судный день","judgment day","религи","religion","ислам","islam","ангел","angel","песня","song","фильм","movie","hooded person","hooded figure","fantasy warrior","monster"]);'
        ].join(NL);
        s = s.slice(0, start) + sunBlock + s.slice(end);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2) IMAGE STUDIO QUALITY MODES + NON-STRETCHED ASPECTS
  // ---------------------------------------------------------------------------
  {
    const a = s.indexOf("async function generatePublicPhotoAI(");
    const b = s.indexOf('app.post("/api/image/free"', a);
    if (a < 0 || b < 0) throw new Error("QUALITY_REBUILD public photo helper missing");
    let seg = s.slice(a, b);

    seg = seg.replace(
      '  let rw=1024,rh=1024; const ratio=w/Math.max(1,h);' + NL +
      '  if(ratio<0.85){rw=768;rh=1344}else if(ratio>1.2){rw=1344;rh=768}else if(ratio<0.95){rw=864;rh=1080}',
      [
        '  const qm=shortForgeImageQualityMode(opts.qualityMode);',
        '  const ratio=w/Math.max(1,h); let rw=768,rh=768;',
        '  const portrait=ratio<0.7, landscape=ratio>1.4, fourFive=!portrait&&!landscape&&ratio<0.9;',
        '  const size={light:0,medium:1,high:2,ultra:3}[qm]??2;',
        '  if(portrait){const p=[[512,912],[576,1024],[720,1280],[864,1536]][size];rw=p[0];rh=p[1];}',
        '  else if(landscape){const p=[[912,512],[1024,576],[1280,720],[1536,864]][size];rw=p[0];rh=p[1];}',
        '  else if(fourFive){const p=[[512,640],[640,800],[864,1080],[1024,1280]][size];rw=p[0];rh=p[1];}',
        '  else {const q=[640,768,1024,1280][size];rw=q;rh=q;}'
      ].join(NL)
    );

    if (!seg.includes("async function generateQualityPublicPhoto(")) {
      const qualityHelper = [
        "",
        "async function generateQualityPublicPhoto(prompt,w,h,seed,style=\"cinematic\",opts={}){",
        "  const mode=shortForgeImageQualityMode(opts.qualityMode), attempts={light:1,medium:1,high:2,ultra:3}[mode]||2;",
        "  const guard=shortForgeSemanticGuard({visual:prompt},{topic:opts.topic||prompt,style,language:opts.language||\"ru\"});",
        "  const variants=[",
        "    \"Literal documentary composition. Show the exact named subject and event with no metaphorical substitution.\",",
        "    \"Alternate camera position in the same visual universe. Preserve the same subjects, event, lighting logic and scientific meaning.\",",
        "    \"Stronger cause-and-effect composition with the requested consequence unmistakably visible; no unrelated subject may dominate the frame.\"",
        "  ];",
        "  const candidates=[],errors=[];",
        "  for(let i=0;i<attempts;i++){",
        "    try{",
        "      const candidatePrompt=String(prompt||\"\")+\". \"+guard+\". \"+variants[i%variants.length]+\". Quality tier: \"+mode+\".\";",
        "      const r=await generatePublicPhotoAI(candidatePrompt,w,h,(Number(seed)||1)+i*7919,style,{outputDir:opts.outputDir,qualityMode:mode});",
        "      const st=await fs.stat(r.file);",
        "      const score=Math.min(100,Math.round(st.size/18000))+i;",
        "      candidates.push({...r,score,attempt:i+1,size:st.size});",
        "    }catch(e){errors.push(cleanError(e));}",
        "  }",
        "  if(!candidates.length)throw new Error(errors.filter(Boolean).join(\" | \")||\"PUBLIC_AI_PHOTO_FAILED\");",
        "  candidates.sort((a,b)=>b.score-a.score); const winner=candidates[0];",
        "  for(const c of candidates.slice(1))await fs.rm(c.file,{force:true}).catch(()=>{});",
        "  return {...winner,candidateCount:candidates.length,qualityMode:mode};",
        "}",
        ""
      ].join(NL);
      seg += qualityHelper;
    }

    s = s.slice(0, a) + seg + s.slice(b);
  }

  // Upgrade endpoint state to track the actual tier and candidate count.
  s = s.replace(
    'let img=null,engine="",model="",note="",generationAttempt=1,cloudError="",localError="";',
    'let img=null,engine="",model="",note="",generationAttempt=1,candidateCount=1,qualityMode=shortForgeImageQualityMode(b.qualityMode),cloudError="",localError="";'
  );

  s = s.replace(
    'const pub=await generatePublicPhotoAI(prompt,w,h,seed,b.style||"photorealistic",{outputDir:work});' + NL +
    '        img=pub.file;engine=pub.engine;model=pub.model;generationAttempt=1;note="Generated with Public AI PHOTO.";',
    'const pub=await generateQualityPublicPhoto(prompt,w,h,seed,b.style||"photorealistic",{outputDir:work,qualityMode,topic:b.topic||prompt,language:b.language||b.uiLanguage||"ru"});' + NL +
    '        img=pub.file;engine=pub.engine;model=pub.model;generationAttempt=pub.attempt||1;candidateCount=pub.candidateCount||1;note="Generated with Public AI PHOTO · "+qualityMode.toUpperCase()+".";'
  );

  const fallbackMarker = '    if(!img){' + NL + '      // PHOTO is optional in V9.7.11. Smart Composer creates a native ShortForge visual instead of blocking Image Studio.';
  if (s.includes(fallbackMarker)) {
    s = s.replace(
      fallbackMarker,
      '    if(!img&&["high","ultra"].includes(qualityMode))throw new Error("PHOTO_QUALITY_REQUIRED: "+qualityMode.toUpperCase()+" requires a real AI PHOTO result; weak procedural fallback was rejected.");' + NL +
      fallbackMarker
    );
  }

  s = s.replace(
    'generationAttempt,cloudConfigured:cloudImageConfigured(),localImageConfigured:Boolean(localPhotoState?.ready),qualityMode:String(b.qualityMode||runtime.localImage.quality||"photo")',
    'generationAttempt,candidateCount,cloudConfigured:cloudImageConfigured(),localImageConfigured:Boolean(localPhotoState?.ready),qualityMode'
  );

  // ---------------------------------------------------------------------------
  // 3) MORE EXPRESSIVE NEURAL TTS
  // ---------------------------------------------------------------------------
  {
    const start = s.indexOf("const VOICE_PROFILES = {");
    const end = s.indexOf("async function shapeVoiceWav", start);
    if (start < 0 || end < 0) throw new Error("QUALITY_REBUILD VOICE_PROFILES range missing");
    const profiles = [
      "const VOICE_PROFILES = {",
      "  natural:{labelRu:\"Естественный\",labelEn:\"Natural\",labelUz:\"Tabiiy\",rate:0,pitch:1.00,bass:false,edgePitch:0,edgeVolume:0},",
      "  calm:{labelRu:\"Спокойный\",labelEn:\"Calm\",labelUz:\"Sokin\",rate:-1,pitch:.99,bass:false,edgePitch:-1,edgeVolume:-2},",
      "  male:{labelRu:\"Мужской спокойный\",labelEn:\"Calm male\",labelUz:\"Erkak — sokin\",rate:-1,pitch:.99,bass:false,edgePitch:-1,edgeVolume:0},",
      "  male_deep:{labelRu:\"Мужской глубокий\",labelEn:\"Deep male\",labelUz:\"Erkak — chuqur\",rate:-2,pitch:.96,bass:true,edgePitch:-4,edgeVolume:1},",
      "  male_energetic:{labelRu:\"Мужской энергичный\",labelEn:\"Energetic male\",labelUz:\"Erkak — energiyali\",rate:2,pitch:1.00,bass:false,edgePitch:1,edgeVolume:2},",
      "  female:{labelRu:\"Женский мягкий\",labelEn:\"Soft female\",labelUz:\"Ayol — yumshoq\",rate:0,pitch:1.02,bass:false,edgePitch:1,edgeVolume:0},",
      "  female_energetic:{labelRu:\"Женский энергичный\",labelEn:\"Energetic female\",labelUz:\"Ayol — energiyali\",rate:2,pitch:1.05,bass:false,edgePitch:3,edgeVolume:2},",
      "  narrator:{labelRu:\"Диктор\",labelEn:\"Narrator\",labelUz:\"Diktor\",rate:-1,pitch:.99,bass:false,edgePitch:-1,edgeVolume:0},",
      "  documentary:{labelRu:\"Документальный\",labelEn:\"Documentary\",labelUz:\"Hujjatli\",rate:-1,pitch:.99,bass:false,edgePitch:-1,edgeVolume:0},",
      "  mysterious:{labelRu:\"Таинственный\",labelEn:\"Mysterious\",labelUz:\"Sirli\",rate:-2,pitch:.97,bass:true,edgePitch:-3,edgeVolume:-1},",
      "  serious:{labelRu:\"Серьёзный\",labelEn:\"Serious\",labelUz:\"Jiddiy\",rate:-1,pitch:.98,bass:true,edgePitch:-2,edgeVolume:0},",
      "  energetic:{labelRu:\"Энергичный\",labelEn:\"Energetic\",labelUz:\"Energiyali\",rate:2,pitch:1.02,bass:false,edgePitch:2,edgeVolume:2},",
      "  dramatic:{labelRu:\"Драматичный\",labelEn:\"Dramatic\",labelUz:\"Dramatik\",rate:-2,pitch:.98,bass:true,edgePitch:-2,edgeVolume:2},",
      "  happy:{labelRu:\"Радостный\",labelEn:\"Happy\",labelUz:\"Quvnoq\",rate:2,pitch:1.03,bass:false,edgePitch:3,edgeVolume:1},",
      "  sad:{labelRu:\"Грустный\",labelEn:\"Sad\",labelUz:\"G‘amgin\",rate:-2,pitch:.97,bass:false,edgePitch:-3,edgeVolume:-2}",
      "};",
      "",
    ].join(NL);
    s = s.slice(0, start) + profiles + s.slice(end);
  }

  {
    const start = s.indexOf("async function synthesizeEdgeNeural(");
    const end = s.indexOf(NL + NL + "const PIPER_ROOT", start);
    if (start < 0 || end < 0) throw new Error("QUALITY_REBUILD synthesizeEdgeNeural range missing");
    const edge = [
      "function expressiveTtsText(text,profile=\"narrator\"){",
      "  let x=String(text||\"\").replace(/\\s+/g,\" \").trim();",
      "  if(!x)return x;",
      "  x=x.replace(/([.!?])\\s+/g,\"$1\\n\");",
      "  if([\"dramatic\",\"mysterious\"].includes(profile))x=x.replace(/;\\s*/g,\"; \\n\");",
      "  return x;",
      "}",
      "async function synthesizeEdgeNeural(text,outFile,rate=0,profile=\"narrator\",signal,language=\"ru\") {",
      "  const py=await ensureEdgeTts(signal),voice=edgeVoiceForProfile(profile,language),p=VOICE_PROFILES[profile]||VOICE_PROFILES.natural;",
      "  const pct=clamp(Math.round(Number(rate||0)+(Number(p.rate)||0)*4),-30,30), rateText=(pct>=0?\"+\":\"\")+pct+\"%\";",
      "  const hz=clamp(Math.round(Number(p.edgePitch)||0),-12,12), pitchText=(hz>=0?\"+\":\"\")+hz+\"Hz\";",
      "  const vol=clamp(Math.round(Number(p.edgeVolume)||0),-20,20), volumeText=(vol>=0?\"+\":\"\")+vol+\"%\";",
      "  const spoken=expressiveTtsText(text,profile);",
      "  await spawnChecked(py,[\"-m\",\"edge_tts\",\"--voice\",voice,\"--rate\",rateText,\"--pitch\",pitchText,\"--volume\",volumeText,\"--text\",spoken,\"--write-media\",outFile],{signal,cwd:EDGE_TTS_ROOT});",
      "  const st=await fs.stat(outFile).catch(()=>null);if(!st||st.size<1200)throw new Error(\"Neural TTS returned an empty audio file.\");",
      "  return {engine:\"edge-neural\",voice,profile};",
      "}"
    ].join(NL);
    s = s.slice(0, start) + edge + s.slice(end);
  }

  await fs.writeFile(serverPath, s, "utf8");

  // ---------------------------------------------------------------------------
  // 4) UI: IMAGE QUALITY TIERS, NON-STRETCHED PREVIEW, LOCALIZED VOICES
  // ---------------------------------------------------------------------------
  const uiPath = path.join(root, "public", "index.html");
  let h = await fs.readFile(uiPath, "utf8");

  h = h.replaceAll("V9.7.11", "V9.7.13");

  h = h.replace(
    "const cfg=state.localImageConfig||{},mgr=state.imageEngine||{},cloud=state.cloudImageConfig||state.status?.cloudPhoto||{},quality=cfg.quality||'photo';",
    "const cfg=state.localImageConfig||{},mgr=state.imageEngine||{},cloud=state.cloudImageConfig||state.status?.cloudPhoto||{},quality=state.imageStudioQuality||localStorage.getItem('sf978.imageQuality')||'high';"
  );

  const oldQuality = '<select id="imgQuality"><option value="balanced" ${quality===\'balanced\'?\'selected\':\'\'}>${tri(\'Сбалансировано\',\'Balanced\',\'Muvozanatli\')}</option><option value="photo" ${quality===\'photo\'?\'selected\':\'\'}>PHOTO</option><option value="photo_plus" ${quality===\'photo_plus\'?\'selected\':\'\'}>PHOTO+</option></select>';
  const newQuality = '<select id="imgQuality"><option value="light" ${quality===\'light\'?\'selected\':\'\'}>Light</option><option value="medium" ${quality===\'medium\'?\'selected\':\'\'}>Medium</option><option value="high" ${quality===\'high\'?\'selected\':\'\'}>High</option><option value="ultra" ${quality===\'ultra\'?\'selected\':\'\'}>Ultra</option></select>';
  if (!h.includes(oldQuality)) throw new Error("QUALITY_REBUILD image quality select marker missing");
  h = h.replace(oldQuality, newQuality);

  h = h.replace(
    "qualityMode=document.getElementById('imgQuality')?.value||'photo';",
    "qualityMode=document.getElementById('imgQuality')?.value||'high';state.imageStudioQuality=qualityMode;localStorage.setItem('sf978.imageQuality',qualityMode);"
  );

  // The preview must show the actual image geometry instead of stretching every result
  // to the height of the grid card.
  h = h.replace(
    ".imageResultPremium{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:#09101d;min-height:250px}.imageResultPremium img{width:100%;height:100%;min-height:250px;object-fit:cover;display:block}",
    ".imageResultPremium{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:#09101d;min-height:0}.imageResultPremium img{width:100%;height:auto;max-height:72vh;object-fit:contain;display:block;background:#02050a}"
  );

  // Localize profile names instead of exposing raw English/internal IDs.
  h = h.replace(
    "Object.entries(profiles).map(([k,v])=>\`<option value=\"${e(k)}\" ${state.project.voice.profile===k?'selected':''}>${e(v.label||k)}</option>\`).join('')",
    "Object.entries(profiles).map(([k,v])=>\`<option value=\"${e(k)}\" ${state.project.voice.profile===k?'selected':''}>${e(voiceProfileLabel(k))}</option>\`).join('')"
  );

  {
    const a = h.indexOf("function voiceProfileLabel(id){");
    const b = h.indexOf("function renderVoice()", a);
    if (a < 0 || b < 0) throw new Error("QUALITY_REBUILD voiceProfileLabel range missing");
    const fn = [
      "function voiceProfileLabel(id){",
      " const ru={natural:'Естественный',calm:'Спокойный',male:'Мужской — спокойный',male_deep:'Мужской — глубокий',male_energetic:'Мужской — энергичный',female:'Женский — мягкий',female_energetic:'Женский — энергичный',narrator:'Диктор',documentary:'Документальный',mysterious:'Таинственный',serious:'Серьёзный',energetic:'Энергичный',dramatic:'Драматичный',happy:'Радостный',sad:'Грустный'};",
      " const en={natural:'Natural',calm:'Calm',male:'Male — Calm',male_deep:'Male — Deep',male_energetic:'Male — Energetic',female:'Female — Soft',female_energetic:'Female — Energetic',narrator:'Narrator',documentary:'Documentary',mysterious:'Mysterious',serious:'Serious',energetic:'Energetic',dramatic:'Dramatic',happy:'Happy',sad:'Sad'};",
      " const uz={natural:'Tabiiy',calm:'Sokin',male:'Erkak — sokin',male_deep:'Erkak — chuqur',male_energetic:'Erkak — energiyali',female:'Ayol — yumshoq',female_energetic:'Ayol — energiyali',narrator:'Diktor',documentary:'Hujjatli',mysterious:'Sirli',serious:'Jiddiy',energetic:'Energiyali',dramatic:'Dramatik',happy:'Quvnoq',sad:'G‘amgin'};",
      " return(state.lang==='en'?en:state.lang==='uz'?uz:ru)[id]||id",
      "}",
      ""
    ].join(NL);
    h = h.slice(0, a) + fn + h.slice(b);
  }

  // Helpful tier explanation in the Image Studio control card.
  if (!h.includes("sfImageQualityHint")) {
    h = h.replace(
      '<button class="btn primary full" id="imgGenerateOne"',
      '<div id="sfImageQualityHint" class="muted small" style="margin-top:8px">${tri("Light — быстро · Medium — баланс · High — 2 кандидата · Ultra — до 3 кандидатов и строгий AI-only fallback","Light — fast · Medium — balanced · High — 2 candidates · Ultra — up to 3 candidates with strict AI-only fallback","Light — tez · Medium — muvozanat · High — 2 variant · Ultra — 3 tagacha variant va qat’iy AI-only")}</div><button class="btn primary full" id="imgGenerateOne"'
    );
  }

  await fs.writeFile(uiPath, h, "utf8");
}
