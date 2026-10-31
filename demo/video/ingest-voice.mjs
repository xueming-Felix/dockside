// demo/video/ingest-voice.mjs <recording.(m4a|wav|mp3|...)> | <dir of per-line files>
// Turns the owner's narration into assets/voice/NN.wav (48 kHz mono, loudness-normalised) plus assets/transcripts/NN.json
// (word timings local to each line, for captions). One file: the reader says "line one", pauses, reads, pauses; the
// markers are found in the whisper transcript and the lines are cut between them. A directory: files sorted by name
// are lines 1..N. Then: node captions.mjs && node build.mjs && npm run check && npm run render
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const here = path.dirname(new URL(import.meta.url).pathname)
const edl = JSON.parse(fs.readFileSync(path.join(here, 'edl.json'), 'utf8'))
const N = edl.segments.length
const src = path.resolve(process.argv[2] || '')
if (!src || !fs.existsSync(src)) { console.error('usage: node ingest-voice.mjs <recording|dir>'); process.exit(1) }
const voiceDir = path.join(here, 'assets/voice'), trDir = path.join(here, 'assets/transcripts')
fs.mkdirSync(voiceDir, { recursive: true }); fs.mkdirSync(trDir, { recursive: true })
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString()
const dur = (f) => +run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).trim()
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18 }
const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')

function transcribe(file) { // whisper via the hyperframes CLI; it writes assets/transcript.json next to the project
  run('npx', ['-y', 'hyperframes@0.8.224', 'transcribe', file, '--language', 'en', '--json'], { cwd: here, env: { ...process.env, CI: '1' } })
  const out = path.join(here, 'assets/transcript.json')
  const words = JSON.parse(fs.readFileSync(out, 'utf8'))
  return (Array.isArray(words) ? words : words.words || []).filter(w => typeof w.start === 'number')
}

function cut(file, start, end, n) { // one line → normalised wav; start/end in seconds of the source file
  const wav = path.join(voiceDir, `${String(n).padStart(2, '0')}.wav`)
  const tmp = wav + '.tmp.wav'
  run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, start)), '-to', String(end), '-i', file, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', tmp])
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-af', 'highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
  fs.rmSync(tmp)
  return wav
}

let report = []
if (fs.statSync(src).isDirectory()) {
  const files = fs.readdirSync(src).filter(f => /\.(m4a|mp3|wav|aac|aiff|caf|ogg|mp4|mov)$/i.test(f)).sort()
  if (files.length !== N) console.warn(`warning: ${files.length} files for ${N} lines`)
  files.slice(0, N).forEach((f, i) => {
    const file = path.join(src, f), n = i + 1
    const words = transcribe(file)
    const first = words[0]?.start ?? 0, last = words.at(-1)?.end ?? dur(file)
    const start = Math.max(0, first - 0.2), end = Math.min(dur(file), last + 0.3)
    cut(file, start, end, n)
    fs.writeFileSync(path.join(trDir, `${String(n).padStart(2, '0')}.json`), JSON.stringify(words.map(w => ({ text: w.text, start: +(w.start - start).toFixed(3), end: +(w.end - start).toFixed(3) }))))
    report.push(`${n}\t${f}\t${(end - start).toFixed(1)}s\t${words.length} words`)
  })
} else {
  const words = transcribe(src)
  // markers: "line <n>" (n as a word or a digit); the marker spans the "line" word and the number word(s)
  const markers = []
  for (let i = 0; i < words.length - 1; i++) {
    if (norm(words[i].text) !== 'line') continue
    let j = i + 1, n = NUM[norm(words[j].text)] ?? (/^\d+$/.test(norm(words[j].text)) ? +norm(words[j].text) : null)
    if (n === null) continue
    markers.push({ n, i, j, start: words[i].start, end: words[j].end })
  }
  const seen = new Set(), uniq = markers.filter(m => m.n >= 1 && m.n <= N && !seen.has(m.n) && seen.add(m.n)).sort((a, b) => a.start - b.start)
  if (uniq.length !== N) console.warn(`warning: found markers for lines ${uniq.map(m => m.n).join(',')} (expected 1..${N})`)
  const total = dur(src)
  uniq.forEach((m, k) => {
    const next = uniq[k + 1]
    const body = words.filter(w => w.start >= m.end && (!next || w.end <= next.start))
    if (!body.length) { console.warn(`line ${m.n}: no words between markers`); return }
    const start = Math.max(m.end + 0.08, body[0].start - 0.2), end = Math.min(next ? next.start - 0.15 : total, body.at(-1).end + 0.3)
    cut(src, start, end, m.n)
    fs.writeFileSync(path.join(trDir, `${String(m.n).padStart(2, '0')}.json`), JSON.stringify(body.map(w => ({ text: w.text, start: +(w.start - start).toFixed(3), end: +(w.end - start).toFixed(3) }))))
    report.push(`${m.n}\t${start.toFixed(1)}–${end.toFixed(1)}s\t${(end - start).toFixed(1)}s\t${body.length} words\t${body.slice(0, 6).map(w => w.text).join(' ')} …`)
  })
}
console.log(report.join('\n'))
const have = fs.readdirSync(voiceDir).filter(f => /^\d\d\.wav$/.test(f)).length
console.log(`${have}/${N} voice lines in assets/voice; next: node captions.mjs && node build.mjs && npm run check`)
