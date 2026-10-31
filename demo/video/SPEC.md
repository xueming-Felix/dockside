# SPEC · Dockside demo video (Devpost, under 3:00)

GOAL:    a judge who watches once can say what Dockside does ("the dock re-plans itself and the companies' agents trade around it") and believes the alarms fired on their own.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps, H.264 MP4. Length = the narration (16 lines) + 4.4 s title + 4.5 s end card; target 2:40–2:55.
TIME:    one screen take of the real dashboard (assets/take.mp4, 253 s, headless Chrome 1920x1080, stage driver in Auto at 60x: 1 s = 1 sim minute). No music: nothing to hear it with before the deadline; say so in the delivery note.
LOOK:    the dashboard is the picture; nothing drawn over it except four act chips and one caption line. Ground #0b1220 (the board's own), ink #e6edf7, one accent #5eead4 (teal, one phrase on the title and the repo on the end card). Inter for titles/captions (bundled), IBM Plex Mono for clock-like labels.
OBJECTS: the Gantt (six doors), the #pier9 chatter, the clock with next timers, the five counters, the ten-button strip. All real, none redrawn.
MOTION:  cuts only between beats; a slowed clip (0.3–0.9x) where the agents talk faster than the narrator; one hard punch-in on the counters at 12:00 (static zoom, no camera move). Titles blur in per word (0.13 s, 0.067 s apart), land, hold dead still, blur out 0.2–0.25 s.
SHOTS:   one shot per narration line; in-points on the board clock (edl.json): 08:00 open · 08:05 collision · 08:10 settle · 08:28 broker's truck · 09:00 traffic · 09:10 auction closes · 09:20 door 5 · 09:40 unknown carrier · 09:50 overrun · 10:00 clock decides · 10:10 second auction · 10:15 hot load · 10:28 detention alarm · 11:30→11:40 third auction (time-lapse) · 11:41 backhaul · 12:00 counters.
BANNED:  music beds with no source, glow, particles, any UI redrawn as a mock, a title over a dimmed screenshot, captions covering the Gantt, speech sped up.
QA:      frames 2 s (title), 22.5 s (chip + first caption + 08:05 board), 65 s (09:20), 137 s (counters punch-in), 159 s (end card); ffprobe duration < 180 s; audio present on every voice line.
