// demo/video/captions.mjs — writes assets/captions.json [{start,end,text}] from the EDL text and the laid-out voice lines
// (assets/layout.json, written by build.mjs). Word timing comes from assets/transcripts/NN.json (hyperframes transcribe
// output) when present; otherwise the line's length is spread over its words by character count. Run build.mjs again after.
import fs from 'node:fs'
import path from 'node:path'
const here = path.dirname(new URL(import.meta.url).pathname)
const edl = JSON.parse(fs.readFileSync(path.join(here, 'edl.json'), 'utf8'))
const layout = JSON.parse(fs.readFileSync(path.join(here, 'assets/layout.json'), 'utf8'))
const MAXW = 7
const groups = []
let estimated = 0, transcribed = 0
for (const seg of layout.segments) {
  const s = edl.segments.find(x => x.id === seg.id)
  const txt = s.text.split(/\s+/)
  const tf = path.join(here, 'assets/transcripts', `${String(s.line).padStart(2, '0')}.json`)
  let times
  if (fs.existsSync(tf)) {
    const tw = JSON.parse(fs.readFileSync(tf, 'utf8')).filter(w => /[\p{L}\p{N}]/u.test(w.text))
    if (tw.length === txt.length) times = tw.map(w => ({ start: w.start, end: w.end }))
    else { // the transcript heard a different word count: spread the script's words over the spoken span by position
      const t0 = tw[0].start, t1 = tw.at(-1).end
      times = txt.map((_, i) => ({ start: t0 + (t1 - t0) * i / txt.length, end: t0 + (t1 - t0) * (i + 1) / txt.length }))
    }
    transcribed++
  } else {
    const chars = txt.map(w => w.length + 1), total = chars.reduce((a, b) => a + b, 0)
    const lead = 0.15, span = Math.max(0.5, seg.D - 0.35 - lead)
    let acc = 0
    times = chars.map(c => { const st = lead + span * acc / total; acc += c; return { start: st, end: lead + span * acc / total } })
    estimated++
  }
  let cur = [], curStart = 0
  const flush = (endT) => { if (cur.length) groups.push({ start: seg.voiceStart + curStart, end: seg.voiceStart + endT, text: cur.join(' ') }); cur = [] }
  txt.forEach((w, i) => {
    if (!cur.length) curStart = times[i].start
    cur.push(w)
    const brk = /[.!?;:]$/.test(w) || cur.length >= MAXW || (/,$/.test(w) && cur.length >= 4)
    if (brk || i === txt.length - 1) flush(times[i].end)
  })
}
for (let i = 0; i < groups.length; i++) { // a little hang time, never two at once
  const g = groups[i], nx = groups[i + 1]
  g.start = Math.max(0.1, g.start - 0.05)
  g.end += 0.25
  if (nx && g.end > nx.start - 0.02) g.end = nx.start - 0.02
  g.start = Math.round(g.start * 100) / 100; g.end = Math.round(g.end * 100) / 100
}
fs.writeFileSync(path.join(here, 'assets/captions.json'), JSON.stringify(groups, null, 1))
console.log(`${groups.length} caption groups (${transcribed} lines from transcripts, ${estimated} estimated); longest: ${Math.max(...groups.map(g => g.text.length))} chars`)
