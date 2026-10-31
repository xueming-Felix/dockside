// record.mjs — shoots the Dockside board: headless Chrome at 1920x1080, CDP screencast → lossless PNG frames,
// plus a timeline of the stage driver's state so every beat has an exact timestamp for the cut.
import { chromium } from '/Users/xuemingxu/workspace/sources/botmux/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE || 'http://127.0.0.1:7120'
const ACTOR = process.env.ACTOR || 'pier9-video'
const OUT = path.resolve(process.env.OUT || './take1')
const MAX_SEC = Number(process.env.MAX_SEC || 330)   // safety stop
const TAIL_SEC = Number(process.env.TAIL_SEC || 8)   // keep rolling after Freeze
const DRY_SEC = Number(process.env.DRY_SEC || 0)     // >0: stop after this many seconds regardless
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
log('board online')

// roll camera
const cdp = await context.newCDPSession(page)
const frames = []
let n = 0
const t0 = Date.now()
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  const i = n++
  const ts = typeof metadata?.timestamp === 'number' ? metadata.timestamp : Date.now() / 1000
  const file = `f${String(i).padStart(6, '0')}.png`
  fs.writeFileSync(path.join(FRAMES, file), Buffer.from(data, 'base64'))
  frames.push({ i, file, ts, wall: (Date.now() - t0) / 1000 })
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
})
await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 1920, maxHeight: 1080 })
await sleep(1200)

// Reset: click the strip's Reset, wait until the driver reports a fresh seed at 08:00
await page.click('.ctl.reset button')
const tReset = (Date.now() - t0) / 1000
let s
for (let i = 0; i < 80; i++) { await sleep(250); s = await state(); if (s.seeded && s.simMin <= 1 && s.keys.every(k => k.status === 'ready')) break }
log(`reset clicked at +${tReset.toFixed(2)}s; seeded=${s.seeded} simMin=${s.simMin}`)
await sleep(1500)

// Auto: the driver presses the remaining keys at their scheduled sim times
await page.click('.ctl.auto button')
const tAuto = (Date.now() - t0) / 1000
log(`auto on at +${tAuto.toFixed(2)}s`)

const timeline = [], marks = [], seenLog = new Set()
let frozenAt = null
while (true) {
  const wall = (Date.now() - t0) / 1000
  let st
  try { st = await state() } catch (e) { log(`state error ${e.message}`); await sleep(500); continue }
  timeline.push({ wall, simMin: st.simMin, running: st.running, done: st.keys.filter(k => k.status === 'done').map(k => k.n), failed: st.keys.filter(k => k.status === 'failed').map(k => `${k.n}:${k.note || ''}`) })
  for (const l of st.log) if (!seenLog.has(l)) { seenLog.add(l); marks.push({ wall, simMin: st.simMin, log: l }); log(`driver: ${l}`) }
  if (st.keys.find(k => k.n === 10)?.status === 'done' && frozenAt === null) { frozenAt = wall; log(`frozen at +${wall.toFixed(1)}s`) }
  if (frozenAt !== null && wall - frozenAt >= TAIL_SEC) break
  if (DRY_SEC && wall >= DRY_SEC) break
  if (wall >= MAX_SEC) { log('MAX_SEC reached'); break }
  await sleep(400)
}
await cdp.send('Page.stopScreencast')
await sleep(400)
fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames))
fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify({ base: BASE, actor: ACTOR, t0, tReset, tAuto, frozenAt, timeline, marks }, null, 1))
fs.writeFileSync(path.join(OUT, 'record.log'), logLines.join('\n'))
log(`frames=${frames.length} seconds=${((Date.now() - t0) / 1000).toFixed(1)} out=${OUT}`)
await browser.close()
