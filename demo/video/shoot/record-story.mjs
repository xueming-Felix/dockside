// record-story.mjs — shoots the story-mode demo: Reset, then scenes in order, each waited to completion; every step's
// activation and completion is time-stamped from the driver's state so the cut can land each narration line on its step.
import { chromium } from '/Users/xuemingxu/workspace/sources/botmux/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE || 'http://127.0.0.1:7120'
const ACTOR = process.env.ACTOR || 'pier9-video'
const OUT = path.resolve(process.env.OUT || './story1')
const SCENES = (process.env.SCENES || 'collision,doordown,auction').split(',')
const GAP_SEC = Number(process.env.GAP_SEC || 4)      // board breathes between scenes
const TAIL_SEC = Number(process.env.TAIL_SEC || 8)
const HEAD_SEC = Number(process.env.HEAD_SEC || 6)    // the fresh board at 08:00 before scene 1
const MAX_SEC = Number(process.env.MAX_SEC || 420)
const DRY_SEC = Number(process.env.DRY_SEC || 0)
const FRAMES = path.join(OUT, 'frames')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(FRAMES, { recursive: true })
const logLines = []
const log = (s) => { const line = `${new Date().toISOString()} ${s}`; console.log(line); logLines.push(line) }
const state = async () => { const r = await fetch(`${BASE}/api/demo/state`, { cache: 'no-store' }); return r.json() }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--hide-scrollbars'] })
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const page = await context.newPage()
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log(`console.${m.type()}: ${m.text().slice(0, 200)}`) })
page.on('pageerror', e => log(`pageerror: ${e.message}`))
await page.goto(`${BASE}/?actor=${encodeURIComponent(ACTOR)}`, { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.waitForSelector('.controls:not(.offline)', { timeout: 30000 })
const st0 = await state()
log(`board online; driver mode=${st0.mode} scenes=${(st0.scenes || []).map(s => s.id).join(',')}`)
if (st0.mode !== 'story') { log('driver is not in story mode; abort'); await browser.close(); process.exit(2) }

const cdp = await context.newCDPSession(page)
const frames = []
let n = 0
const t0 = Date.now()
const wallNow = () => (Date.now() - t0) / 1000
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  const i = n++
  const file = `f${String(i).padStart(6, '0')}.png`
  fs.writeFileSync(path.join(FRAMES, file), Buffer.from(data, 'base64'))
  frames.push({ i, file, ts: metadata?.timestamp, wall: wallNow() })
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
})
await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 1920, maxHeight: 1080 })
await sleep(1000)

const marks = [] // { kind: reset|scene-start|step-active|step-done|scene-done, scene, step, wall, ... }
const timeline = []
await page.click('.ctl.reset button')
const tReset = wallNow()
let s
for (let i = 0; i < 80; i++) { await sleep(250); s = await state(); if (s.seeded && s.simMin <= 1 && (s.scenes || []).every(sc => sc.status === 'ready')) break }
marks.push({ kind: 'reset', wall: tReset })
log(`reset clicked at +${tReset.toFixed(2)}s; seeded=${s.seeded} simMin=${s.simMin}`)
await sleep(HEAD_SEC * 1000)

const seenSteps = new Map()
async function runScene(id) {
  const btn = page.locator('.controls.scenes .ctl button', { hasText: s.scenes.find(sc => sc.id === id)?.title || id })
  await btn.first().click()
  const tStart = wallNow()
  marks.push({ kind: 'scene-start', scene: id, wall: tStart })
  log(`scene ${id} clicked at +${tStart.toFixed(2)}s`)
  seenSteps.clear()
  while (true) {
    const wall = wallNow()
    let st
    try { st = await state() } catch (e) { log(`state error ${e.message}`); await sleep(400); continue }
    const sc = (st.scenes || []).find(x => x.id === id)
    const story = st.story && st.story.sceneId === id ? st.story : null
    timeline.push({ wall, simMin: st.simMin, running: st.running, scene: id, status: sc?.status, steps: story ? story.steps.map(x => x.status[0]).join('') : '' })
    if (story) for (const step of story.steps) {
      const prev = seenSteps.get(step.i)
      if (prev !== step.status) {
        seenSteps.set(step.i, step.status)
        if (step.status === 'active' || step.status === 'done' || step.status === 'failed') {
          marks.push({ kind: `step-${step.status}`, scene: id, step: step.i, wall, at: step.at, title: step.title, tech: step.tech, what: step.what, why: step.why, lines: step.lines })
          log(`  ${id} step ${step.i} ${step.status} at +${wall.toFixed(2)}s  [${step.tech}] ${step.title}`)
        }
      }
    }
    if (sc && (sc.status === 'done' || sc.status === 'failed')) {
      marks.push({ kind: 'scene-done', scene: id, wall, status: sc.status, outcome: sc.outcome, note: sc.note })
      log(`scene ${id} ${sc.status} at +${wall.toFixed(2)}s  outcome: ${sc.outcome || sc.note || ''}`)
      break
    }
    if (DRY_SEC && wall >= DRY_SEC) return false
    if (wall >= MAX_SEC) { log('MAX_SEC reached'); return false }
    await sleep(300)
  }
  return true
}
let ok = true
for (const id of SCENES) {
  ok = await runScene(id)
  if (!ok) break
  await sleep(GAP_SEC * 1000)
  if (DRY_SEC && wallNow() >= DRY_SEC) break
}
await sleep(TAIL_SEC * 1000)
await cdp.send('Page.stopScreencast')
await sleep(400)
fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames))
fs.writeFileSync(path.join(OUT, 'story-marks.json'), JSON.stringify({ base: BASE, actor: ACTOR, t0, tReset, marks, timeline }, null, 1))
fs.writeFileSync(path.join(OUT, 'record.log'), logLines.join('\n'))
log(`frames=${frames.length} seconds=${wallNow().toFixed(1)} out=${OUT}`)
await browser.close()
