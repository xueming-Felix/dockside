// assemble.mjs <takeDir> — PNG frames + timeline → CFR 30 fps H.264 MP4, plus beats.json (sim clock ↔ mp4 seconds) and beat stills.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const dir = path.resolve(process.argv[2] || 'take1')
const frames = JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8'))
const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'))
const wall0 = frames[0].wall
// sim minute m (0 = 08:00) is on screen from wall w0 + m; the driver reports floor(elapsed), so w0 = min(wall - simMin)
const w0 = Math.min(...tl.timeline.filter(s => s.simMin > 0).map(s => s.wall - s.simMin))
const simToMp4 = (m) => +(w0 + m - wall0).toFixed(3)
const hhmm = (m) => `${String(8 + Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`
let list = 'ffconcat version 1.0\n'
for (let i = 0; i < frames.length; i++) {
  const d = i + 1 < frames.length ? Math.max(0.001, frames[i + 1].wall - frames[i].wall) : 2
  list += `file 'frames/${frames[i].file}'\nduration ${d.toFixed(4)}\n`
}
list += `file 'frames/${frames.at(-1).file}'\n`
fs.writeFileSync(path.join(dir, 'list.ffconcat'), list)
const mp4 = path.join(dir, 'take.mp4')
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.ffconcat', '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'fast', '-crf', '15', '-movflags', '+faststart', mp4], { cwd: dir, stdio: 'inherit' })
const keyMarks = tl.marks.filter(m => /key \d+ .*: done|collision|closed by alarm|went quiet|no-show auction|arrive T13/.test(m.log)).map(m => ({ wall: m.wall, mp4: +(m.wall - wall0).toFixed(2), log: m.log }))
const beats = { w0, wall0, tReset: tl.tReset, tAuto: tl.tAuto, frozenAt: tl.frozenAt, lastWall: frames.at(-1).wall, simToMp4: 'mp4 = w0 + simMin - wall0', keyMarks,
  sim: Object.fromEntries([0, 5, 10, 28, 60, 70, 80, 100, 110, 120, 130, 135, 148, 200, 210, 220, 221, 240].map(m => [hhmm(m), simToMp4(m)])) }
fs.writeFileSync(path.join(dir, 'beats.json'), JSON.stringify(beats, null, 1))
// stills at each beat, straight from the frames: the first frame at or after the beat's wall time
fs.mkdirSync(path.join(dir, 'beats'), { recursive: true })
for (const m of [0, 5, 10, 28, 60, 70, 80, 100, 110, 120, 130, 135, 148, 200, 210, 220, 221, 240]) {
  const w = w0 + m + 0.6
  const f = frames.find(x => x.wall >= w) || frames.at(-1)
  fs.copyFileSync(path.join(dir, 'frames', f.file), path.join(dir, 'beats', `${hhmm(m).replace(':', '')}.png`))
}
console.log(JSON.stringify(beats, null, 1))
console.log(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,r_frame_rate,nb_frames', '-of', 'compact', mp4]).toString())
