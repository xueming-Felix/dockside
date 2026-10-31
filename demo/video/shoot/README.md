# Shooting the board

Headless Chrome records the real dashboard; no screen, no cursor, re-shootable in minutes. Playwright is imported from the Botmux checkout (`/Users/xuemingxu/workspace/sources/botmux/node_modules/playwright`, 1.62) and uses the installed Google Chrome (`channel: "chrome"`), so nothing is downloaded.

```sh
# a second grant server on its own cloud actor, so the stage actor on 7110 is never touched
cd dashboard && DEMO_ACTOR=pier9-video PORT=7120 HOST=127.0.0.1 bun run start:cloud

cd demo/video/shoot
OUT=take1 node record.mjs            # ten-key day: Reset → Auto, 08:00 → 12:00 at 60x, ~250 s; writes frames/, frames.json, timeline.json
OUT=story1 node record-story.mjs     # story mode: Reset → scene 1, 2, 3; writes story-marks.json with every step's activation time
node assemble.mjs take1              # frames → take.mp4 (CFR 30 fps, H.264 CRF 15) + beats.json (sim clock ↔ seconds) + beats/*.png stills
```

Frames arrive over the CDP screencast as lossless PNG whenever the page repaints (about 14 fps on this board), so the take is crisp and about 2 GB for four minutes; delete `frames/` once `take.mp4` exists.
