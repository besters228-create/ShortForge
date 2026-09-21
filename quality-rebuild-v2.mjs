import { promises as fs } from "node:fs";
import path from "node:path";

export async function applyQualityRebuildV2(root){
  const serverPath=path.join(root,"server.mjs");
  let s=await fs.readFile(serverPath,"utf8");

  if(!s.includes("function sfCanonicalScientificPrompt(")){
    const marker="function shortForgeSemanticGuard(scene={},ctx={}){";
    if(!s.includes(marker))throw new Error("QUALITY_V2 semantic marker missing");
    const helper=[
      'function sfCanonicalScientificPrompt(prompt="",topic=""){',
      '  const p=String(prompt||"").trim(),t=String(topic||p).trim(),low=(t+" "+p).toLowerCase().replace(/ё/g,"е");',
      '  const sunGone=/(?:солнц.{0,45}(?:исчез|пропад|погас)|(?:исчез|пропад|погас).{0,45}солнц|sun.{0,45}(?:disappear|vanish|gone)|(?:disappear|vanish|gone).{0,45}sun)/i.test(low);',
      '  if(!sunGone)return p;',
      '  const common="NASA-style scientific astrophotography, one realistic spherical Earth, physically plausible clouds oceans atmosphere and lighting, exact round planetary silhouette, deep black space with restrained natural stars, realistic scale, documentary science image, no surrealism, no metaphor, no people, no characters, no extra planets, no duplicate Earth, no nested spheres, no planetary rings, no artificial halo, no oversized lens flare, no text, no logo, no watermark, no fisheye, no anamorphic distortion, no oval planet";',
      '  if(/(?:8\\s*мин|восемь\\s+мин|eight\\s+min|последн.{0,20}свет|last\\s+sunlight|light.{0,20}travel)/i.test(low))return "Earth is still illuminated by the final sunlight already travelling through space; the distant Sun is a small physically plausible source, clear light-travel-time moment without labels. "+common;',
      '  if(/(?:фотосинт|photosynth|растен|plant)/i.test(low))return "Real green plants on Earth as natural daylight abruptly fades after the Sun disappears, scientifically grounded loss-of-sunlight scene, no person. "+common.replace("one realistic spherical Earth, ","");',
      '  if(/(?:орбит|orbit|касатель|tangent|притяж|gravity)/i.test(low))return "One spherical Earth departing its former solar orbit along a tangent after the Sun is absent, wide scientific orbital-motion view without arrows or labels, empty dark region where the Sun used to be. "+common;',
      '  if(/(?:замерз|лед|frozen|freeze|ice|холод|cold)/i.test(low))return "The same single spherical Earth after prolonged loss of the Sun, dark frozen oceans and expanding ice visible from orbit, faint starlight only. "+common;',
      '  if(/(?:темнот|dark|daylight|дневн)/i.test(low))return "One spherical Earth seen from orbit at the moment sunlight is gone, daylight side becoming dark, subtle atmospheric rim and faint city lights, Sun absent from frame. "+common;',
      '  return "One spherical planet Earth is the unmistakable main subject in deep space immediately after the Sun has suddenly disappeared; the place where the Sun should be is empty and dark, residual atmospheric rim light fading, loss of sunlight visually clear. "+common;',
      '}',
      ''
    ].join(String.fromCharCode(10));
    s=s.replace(marker,helper+marker);
  }

  s=s.replace(
    'const expanded=await expandPublicPhotoPrompt(prompt,style);',
    'const expanded=opts.skipExpand?safeProjectText(prompt,3600).trim():await expandPublicPhotoPrompt(prompt,style);'
  );

  s=s.replace(
    'const guard=shortForgeSemanticGuard({visual:prompt},{topic:opts.topic||prompt,style,language:opts.language||"ru"});',
    'const topic=String(opts.topic||prompt||"").trim(),canonical=sfCanonicalScientificPrompt(prompt,topic),guard=shortForgeSemanticGuard({visual:canonical},{topic,style,language:opts.language||"ru"});'
  );

  s=s.replace(
    'const candidatePrompt=String(prompt||"")+". "+guard+". "+variants[i%variants.length]+". Quality tier: "+mode+".";',
    'const candidatePrompt=canonical+". "+guard+". "+variants[i%variants.length]+". Preserve natural proportions and true circular geometry of spherical objects. Quality tier: "+mode+".";'
  );

  s=s.replace(
    'const r=await generatePublicPhotoAI(candidatePrompt,w,h,(Number(seed)||1)+i*7919,style,{outputDir:opts.outputDir,qualityMode:mode});',
    'const r=await generatePublicPhotoAI(candidatePrompt,w,h,(Number(seed)||1)+i*7919,style,{outputDir:opts.outputDir,qualityMode:mode,skipExpand:["high","ultra"].includes(mode)});'
  );

  s=s.replace(
    'scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}',
    'scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1'
  );

  await fs.writeFile(serverPath,s,"utf8");

  const uiPath=path.join(root,"public","index.html");
  let h=await fs.readFile(uiPath,"utf8");
  h=h.replace("ShortForge V9.7.13 — QUALITY REBUILD","ShortForge V9.7.13 — QUALITY REBUILD 2");
  await fs.writeFile(uiPath,h,"utf8");
}
