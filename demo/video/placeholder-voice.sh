#!/bin/bash
# Synthetic stand-in narration (macOS `say`) so the cut can be built before the real voice track lands.
# Usage: bash placeholder-voice.sh [voice] [wpm]   → assets/voice/NN.wav (48 kHz mono)
set -euo pipefail
cd "$(dirname "$0")"
VOICE="${1:-Samantha}"; WPM="${2:-180}"
mkdir -p assets/voice
node -e 'const e=require("./edl.json"); for (const s of e.segments) console.log(String(s.line).padStart(2,"0")+"\t"+s.text)' | while IFS=$'\t' read -r n text; do
  say -v "$VOICE" -r "$WPM" -o "assets/voice/$n.aiff" "$text"
  ffmpeg -y -loglevel error -i "assets/voice/$n.aiff" -ar 48000 -ac 1 -c:a pcm_s16le "assets/voice/$n.wav"
  rm -f "assets/voice/$n.aiff"
done
ls -la assets/voice
