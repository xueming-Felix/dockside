// demo/video/build.mjs — writes index.html and compositions/*.html from edl.json, assets/beats.json (sim clock ↔ take seconds)
// and the voice files' lengths. Re-run after changing the EDL or swapping voice files, then `npx hyperframes check` / `render`.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const here = path.dirname(new URL(import.meta.url).pathname)
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const edl = read('edl.json')
const beats = read('assets/beats.json')
const captions = fs.existsSync(path.join(here, 'assets/captions.json')) ? read('assets/captions.json') : null
const W = 1920, H = 1080, FPS = 30
const TITLE = 4.4, TITLE_X = 0.3 // title card length; its dissolve overlaps the first board clip by TITLE_X
const END = 4.5, END_X = 0.3
const PRE = 0.3, POST = 0.4 // air before and after each voice line
const GROUND = '#0b1220'
const q = (n) => String(Math.round(n * 1000) / 1000)
const snap = (t) => Math.round(t * FPS) / FPS
const dur = (file) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(here, file)]).toString().trim()
const simToMp4 = (s) => { // "HH:MM" | "HH:MM:SS" on the board clock (SS = sim seconds) | a number = seconds into the take
  if (typeof s === 'number') return s
  const [h, m, ss = 0] = s.split(':').map(Number)
  return beats.w0 - beats.wall0 + (h - 8) * 60 + m + ss / 60
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const words = (s, cls = 'w') => s.split(/\s+/).map(w => `<span class="${cls}">${esc(w)}</span>`).join(' ')

// ---- lay the segments out in time: one voice line, one stretch of the take, back to back
let t = snap(TITLE - TITLE_X)
const segs = []
for (const s of edl.segments) {
  const voice = s.voice || `assets/voice/${String(s.line).padStart(2, '0')}.wav`
  const D = dur(voice)
  const clipDur = snap(PRE + D + POST)
  const inSec = simToMp4(s.in)
  let rate = s.rate ?? 1
  if (s.out !== undefined && s.rate === undefined) {
    rate = (simToMp4(s.out) - inSec) / clipDur // fit the beat's window to the line; a little too long is cut, too short is slowed
    if (rate > 1.15) rate = 1
    rate = Math.round(Math.max(0.3, Math.min(4, rate)) * 100) / 100
  }
  const shots = []
  if (s.shots?.length) {
    let off = 0, src = inSec
    s.shots.forEach((sh, i) => {
      const d = i === s.shots.length - 1 ? snap(clipDur - off) : snap(sh.dur)
      shots.push({ start: snap(t + off), dur: d, mediaStart: src, zoom: sh.zoom, rate })
      off += d; src += d * rate
    })
  } else shots.push({ start: t, dur: clipDur, mediaStart: inSec, rate })
  segs.push({ ...s, voice, D, start: t, clipDur, rate, shots, voiceStart: snap(t + PRE) })
  t = snap(t + clipDur)
}
const lastEnd = t
const endStart = snap(lastEnd - END_X)
const total = snap(endStart + END)
const boardStart = snap(TITLE - TITLE_X)

// ---- index.html: media and scene hosts only
const videoStyle = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;object-fit:contain;`
let clips = '', audios = '', z = 2
for (const s of segs) {
  s.shots.forEach((sh, i) => {
    const id = s.shots.length > 1 ? `${s.id}-${i + 1}` : s.id
    const zoom = sh.zoom ? `transform-origin:${sh.zoom.x}px ${sh.zoom.y}px;transform:translate(${q(W / 2 - sh.zoom.x)}px,${q(H / 2 - sh.zoom.y)}px) scale(${sh.zoom.scale});` : ''
    clips += `    <video id="${id}" class="clip" src="${edl.source}" data-start="${q(sh.start)}" data-duration="${q(sh.dur)}" data-media-start="${q(sh.mediaStart)}"${sh.rate !== 1 ? ` data-playback-rate="${q(sh.rate)}"` : ''} data-track-index="1" muted playsinline style="${videoStyle}${zoom}z-index:${z++}"></video>\n`
  })
  audios += `    <audio id="v-${s.id}" class="clip" src="${s.voice}" data-start="${q(s.voiceStart)}" data-duration="${q(s.D)}" data-volume="1" data-track-index="4"></audio>\n`
}
const host = (id, start, duration, kind, zi) => `    <div id="${id}" data-composition-id="${id}" data-composition-src="compositions/${id}.html" data-start="${q(start)}" data-duration="${q(duration)}" data-track-index="${kind === 'captions' ? 3 : 2}" data-track-kind="${kind}" data-width="${W}" data-height="${H}" style="z-index:${zi}"></div>\n`
const index = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Dockside · demo video</title>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
<style>
  html, body { margin: 0; padding: 0; background: ${GROUND}; }
  #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${GROUND}; }
</style>
</head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${q(total)}" data-width="${W}" data-height="${H}" data-fps="${FPS}">
    <div id="ground" style="position:absolute;inset:0;background:${GROUND};z-index:0"></div>
${clips}${audios}${host('title', 0, TITLE, 'graphics', 200)}${host('chips', boardStart, lastEnd - boardStart, 'graphics', 150)}${captions ? host('captions', 0, total, 'captions', 160) : ''}${host('end', endStart, END, 'graphics', 210)}  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = gsap.timeline({ paused: true });
  </script>
</body>
</html>
`

// ---- compositions/title.html
const tag = 'Dock appointments that re-plan themselves,'
const title = `<template>
  <style>
    #root { position: absolute; inset: 0; font-family: Inter, sans-serif; color: #e6edf7; }
    #title-bg { position: absolute; inset: 0; background: ${GROUND}; }
    #title-wrap { position: absolute; left: 160px; top: 0; bottom: 0; width: 1600px; display: flex; flex-direction: column; justify-content: center; }
    #title-name { font-size: 136px; font-weight: 900; letter-spacing: -0.035em; line-height: 1; margin: 0; }
    #title-name .w, #title-tag .w { display: inline-block; }
    #title-tag { font-size: 48px; font-weight: 400; line-height: 1.25; margin: 30px 0 0; max-width: 1500px; color: #c7d2e3; }
    #title-tag .acc { color: #5eead4; }
    #title-meta { font-family: "IBM Plex Mono", monospace; font-size: 28px; color: #7d8aa3; margin: 60px 0 0; }
  </style>
  <div id="root" data-composition-id="title" data-width="${W}" data-height="${H}">
    <div id="title-card" class="clip" data-start="0" data-duration="${q(TITLE)}">
      <div id="title-bg"></div>
      <div id="title-wrap">
        <h1 id="title-name"><span class="w">Dockside</span></h1>
        <p id="title-tag">${words(tag)} ${words('agent to agent.', 'w acc')}</p>
        <p id="title-meta">Haunted Hacks · YC San Francisco · October 31, 2026</p>
      </div>
    </div>
  </div>
  <script>
    (() => {
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#title-name .w", { opacity: 0.55, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.35, ease: "power4.out" }, 0);
      tl.fromTo("#title-tag .w", { opacity: 0, filter: "blur(6px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.13, ease: "power3.out", stagger: 0.067 }, 0.6);
      tl.fromTo("#title-meta", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" }, 1.4);
      tl.to("#title-wrap", { opacity: 0, filter: "blur(8px)", duration: 0.25, ease: "power3.in" }, ${q(TITLE - TITLE_X - 0.05)});
      tl.to("#title-bg", { opacity: 0, duration: ${q(TITLE_X)}, ease: "power2.inOut" }, ${q(TITLE - TITLE_X)});
      window.__timelines["title"] = tl;
    })();
  </script>
</template>
`

// ---- compositions/chips.html: act labels, top of the board, in the gap between the board's title and its clock
const CHIP = 4.6
let chipEls = '', chipTl = ''
for (const s of segs) {
  const c = edl.chips?.[s.id]
  if (!c) continue
  const start = snap(s.start - boardStart + 0.2)
  chipEls += `    <div id="chip-${s.id}" class="clip" data-start="${q(start)}" data-duration="${q(CHIP)}"><div class="chip"><span class="k">${esc(c.kicker)}</span><span class="t">${esc(c.text)}</span></div></div>\n`
  chipTl += `      tl.fromTo("#chip-${s.id} .chip", { opacity: 0, x: 18, filter: "blur(6px)" }, { opacity: 1, x: 0, filter: "blur(0px)", duration: 0.35, ease: "expo.out" }, ${q(start)});\n`
  chipTl += `      tl.to("#chip-${s.id} .chip", { opacity: 0, filter: "blur(6px)", duration: 0.2, ease: "power3.in" }, ${q(start + CHIP - 0.22)});\n`
}
const chips = `<template>
  <style>
    #root { position: absolute; inset: 0; font-family: Inter, sans-serif; }
    .clip { position: absolute; left: 330px; top: 24px; }
    .chip { display: inline-flex; align-items: baseline; gap: 16px; padding: 10px 18px 11px; border-radius: 8px; background: rgba(11,18,32,0.9); border: 1px solid rgba(148,163,184,0.25); white-space: nowrap; }
    .chip .k { font-family: "IBM Plex Mono", monospace; font-size: 28px; color: #7d8aa3; }
    .chip .t { font-size: 32px; font-weight: 600; color: #f1f5fb; letter-spacing: -0.01em; }
  </style>
  <div id="root" data-composition-id="chips" data-width="${W}" data-height="${H}">
${chipEls}  </div>
  <script>
    (() => {
      const tl = gsap.timeline({ paused: true });
${chipTl}      window.__timelines["chips"] = tl;
    })();
  </script>
</template>
`

// ---- compositions/captions.html: one line over the board's replay-slider row, from assets/captions.json [{start,end,text}]
let capFile = null
if (captions) {
  let els = '', tls = ''
  captions.forEach((g, i) => {
    const start = snap(g.start), end = snap(g.end)
    els += `    <div id="cap-${i}" class="clip" data-start="${q(start)}" data-duration="${q(end - start)}"><div class="cap"><span>${esc(g.text)}</span></div></div>\n`
    tls += `      tl.fromTo("#cap-${i} .cap", { opacity: 0 }, { opacity: 1, duration: 0.1, ease: "power2.out" }, ${q(start)});\n`
    tls += `      tl.to("#cap-${i} .cap", { opacity: 0, duration: 0.1, ease: "power2.in" }, ${q(end - 0.1)});\n      tl.set("#cap-${i} .cap", { visibility: "hidden" }, ${q(end)});\n`
  })
  capFile = `<template>
  <style>
    #root { position: absolute; inset: 0; font-family: Inter, sans-serif; }
    .clip { position: absolute; left: 0; right: 0; bottom: 84px; }
    .cap { width: 100%; text-align: center; overflow: visible; }
    .cap span { display: inline-block; font-size: 30px; font-weight: 500; line-height: 1.3; color: #f1f5fb; background: rgba(11,18,32,0.86); padding: 6px 16px; border-radius: 6px; }
  </style>
  <div id="root" data-composition-id="captions" data-width="${W}" data-height="${H}">
${els}  </div>
  <script>
    (() => {
      const tl = gsap.timeline({ paused: true });
${tls}      window.__timelines["captions"] = tl;
    })();
  </script>
</template>
`
}

// ---- compositions/end.html
const end = `<template>
  <style>
    #root { position: absolute; inset: 0; font-family: Inter, sans-serif; color: #e6edf7; }
    #end-bg { position: absolute; inset: 0; background: ${GROUND}; }
    #end-wrap { position: absolute; left: 160px; top: 0; bottom: 0; width: 1600px; display: flex; flex-direction: column; justify-content: center; }
    #end-name { font-size: 96px; font-weight: 900; letter-spacing: -0.035em; line-height: 1; margin: 0; }
    #end-repo { font-family: "IBM Plex Mono", monospace; font-size: 40px; color: #5eead4; margin: 36px 0 0; }
    #end-stack { font-size: 28px; color: #7d8aa3; margin: 48px 0 0; }
  </style>
  <div id="root" data-composition-id="end" data-width="${W}" data-height="${H}">
    <div id="end-card" class="clip" data-start="0" data-duration="${q(END)}">
      <div id="end-bg"></div>
      <div id="end-wrap">
        <h1 id="end-name">Dockside</h1>
        <p id="end-repo">github.com/xueming-Felix/dockside</p>
        <p id="end-stack">Durable Actors on Terse · Agent Relay · OpenAI gpt-5-mini · Bun · React</p>
      </div>
    </div>
  </div>
  <script>
    (() => {
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#end-bg", { opacity: 0 }, { opacity: 1, duration: ${q(END_X)}, ease: "power2.inOut" }, 0);
      tl.fromTo("#end-name", { opacity: 0, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.25, ease: "power4.out" }, ${q(END_X)});
      tl.fromTo("#end-repo", { opacity: 0, filter: "blur(6px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, ease: "power3.out" }, ${q(END_X + 0.15)});
      tl.fromTo("#end-stack", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" }, ${q(END_X + 0.4)});
      window.__timelines["end"] = tl;
    })();
  </script>
</template>
`

fs.mkdirSync(path.join(here, 'compositions'), { recursive: true })
fs.writeFileSync(path.join(here, 'index.html'), index)
fs.writeFileSync(path.join(here, 'compositions/title.html'), title)
fs.writeFileSync(path.join(here, 'compositions/chips.html'), chips)
fs.writeFileSync(path.join(here, 'compositions/end.html'), end)
if (capFile) fs.writeFileSync(path.join(here, 'compositions/captions.html'), capFile)
else fs.rmSync(path.join(here, 'compositions/captions.html'), { force: true })
fs.writeFileSync(path.join(here, 'assets/layout.json'), JSON.stringify({ total, boardStart, endStart, segments: segs.map(s => ({ id: s.id, line: s.line, start: s.start, dur: s.clipDur, voiceStart: s.voiceStart, D: s.D, rate: s.rate, in: s.in, out: s.out ?? null })) }, null, 1))
console.log(`total ${total.toFixed(2)} s (${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')})  board ${boardStart}→${lastEnd}  end card ${endStart}→${total}`)
for (const s of segs) console.log(`${s.start.toFixed(2).padStart(7)}  ${s.id.padEnd(10)} line ${String(s.line).padStart(2)}  voice ${s.D.toFixed(1).padStart(5)} s  take ${q(s.shots[0].mediaStart).padStart(8)} s  rate ${s.rate}`)
