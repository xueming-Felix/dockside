# Dockside demo video

The Devpost cut, built with [HyperFrames](https://hyperframes.heygen.com): one screen take of the real dashboard, one voice line per beat, four act chips, captions, a title and an end card. Everything here is generated from `edl.json`; edit that, not `index.html`.

| File | What |
|---|---|
| `edl.json` | the edit decision list: 16 segments (narration text, in-point on the board clock, optional out-point for a slowed clip, shots/zoom), chips |
| `build.mjs` | writes `index.html` and `compositions/*.html` from the EDL, `assets/beats.json` and the voice files' lengths |
| `captions.mjs` | writes `assets/captions.json` (word groups) from the EDL text; uses `assets/transcripts/NN.json` when present, else spreads the line by character count |
| `ingest-voice.mjs` | the owner's recording (one file with "line one … line sixteen" markers, or a folder of per-line files) → `assets/voice/NN.wav` + `assets/transcripts/NN.json` |
| `placeholder-voice.sh` | synthetic stand-in lines with macOS `say`, for building the cut before the real voice lands |
| `assets/beats.json` | sim clock ↔ seconds of `assets/take.mp4` (from the shoot) |
| `SPEC.md` | the brief: look, motion, shots, banned defaults, QA frames |

The shoot itself lives in the Mac mini scratchpad (`record.mjs`: headless Chrome, CDP screencast → PNG frames; `assemble.mjs`: frames → CFR 30 fps MP4 + `beats.json`). It drives a second grant server (`DEMO_ACTOR=pier9-video PORT=7120 bun run start:cloud` in `dashboard/`) so the stage actor is untouched: Reset → Auto, 08:00 to 12:00 at 60x, 253 s.

## Rebuild

```sh
cd demo/video
node ingest-voice.mjs ~/Downloads/narration.m4a      # or a folder of 16 files; skip for the synthetic draft
node captions.mjs && node build.mjs
CI=1 npx -y hyperframes@0.8.224 check
CI=1 npx -y hyperframes@0.8.224 snapshot --at 2,22.5,65,137,159 --output renders/snap
CI=1 npx -y hyperframes@0.8.224 render -o renders/dockside-demo.mp4      # ≈ 2x realtime on the M4 mini
```

Requirements on the machine: Node ≥ 22, `brew install ffmpeg whisper-cpp`, Google Chrome. `hyperframes tts` (Kokoro) does not work here (espeak data path bug), hence `say` for the stand-in voice.
