# Demo runbook · Person A side

Everything here targets the deployed actor (`actor/.env.cloud`). Swap in the local runtime by dropping the `:cloud` suffixes.

## 14:20 · before the first full run

```sh
# terminal 1: dashboard in demo mode (built page + grants against the deployed actor) → http://127.0.0.1:7110
cd dashboard && bun run build && bun run start:cloud

# terminal 2: Person A's eyes, the raw event tail
cd actor && set -a && source .env.cloud && set +a && bun scripts/listen.ts

# reset the dock to 08:00 at 60x (B's runner does this too; either is fine, last seed wins)
cd actor && set -a && source .env.cloud && set +a && bun scripts/seed.ts
```

Projector: Chrome on http://127.0.0.1:7110/ full screen. The page reconnects by itself if the socket drops; reload only as a last resort (the replay slider's history lives in the page).

## The keys with this seed (shared/pier9.ts)

| Key | Sim | Actor calls (the dispatcher's job) | What the board should do |
|---|---|---|---|
| 1 | 08:05 | `request("carrier-a","T13",4,360)`, `request("carrier-b","T14",4,360)` → offer o1; agents talk; `swap("T14","T13")`, `pay("carrier-b","carrier-a",150)`, `settleThread` | Door 4: T13 at 14:00 then T14 at 15:00 with a dashed border; after SETTLE the two blocks trade places; side payments $150 |
| 2 | 08:30 | `arrive("T3")` (any time up to 08:31; an arrival in the same minute as the 08:30 check still counts) | T3 turns teal (unloading); clock panel shows "10:30 detention T3" |
| 3 | 09:00 | `reportEta("T1",150)`, `reportEta("T4",210)`; `openAuction(2,60,70)`, `openAuction(1,120,130)`; bids; wait for `auction_closed`; `award` | T1 slides to door 4 11:00, T4 to door 3 12:00; two dashed amber auction boxes. a1 closes 09:10 → award T6 (door 2 09:00, detention avoided +$225); a2 closes 10:10, after keys 4 to 6 → award T8 (door 1 10:00) |
| 4 | 09:20 | `setDoor(5,false)` → offer for T5; two rounds in chat; `counter(o, 6, 120)` (or `swap("T5","T9")` after SETTLE) | Door 5 goes striped; T5 jumps to door 6 11:00, then to 10:00 while T9 shifts to 11:00 |
| 5 | 09:40 | only `say()` lines | VERIFY / refused lines in the feed; `refused` in the log if the dispatcher mirrors it |
| 6 | 09:50 | `overrun("T6",75)` → offer for T2; `openThread(th, o, now+10)`; nobody settles; alarm → `thread_expired`; `accept(o)` | T6's block stretches past 11:00; T2 slides to door 2 12:00 with a dashed border (door 4 11:00 is T1's now); the clock panel counts the deadline down to 10:00; the border goes solid on accept |
| 7 | 10:15 | `prioritize("T11")` → offer for T7 ("yield for hot load"); `resolveClaim("T3","waived")`, `pay("carrier-b","broker",80)`, `accept` | T11 jumps to door 1 11:00 with a HOT pill; T7 slides to door 1 12:00 |
| alarm | 10:30 | nothing | T3 turns red; claim $150 waived appears under the Gantt |
| alarm | 11:30 | nothing, then `bid(a3, "T13", 690)` + `award` after 11:40 | T12 goes hatched (no-show); auction a3 appears on door 3 11:00, closes by alarm at 11:40; T13 lands there (arrive it within 10 min or it no-shows too) |
| 8 | any | `request("carrier-d","T15",4,480,{ hosLimitMin: 500 })`: no slot fits before 16:20 | `tomorrow` event; "Tomorrow 08:00: T15" under the Gantt. (T8 itself was pulled to 10:00 by a2, so its own hours never bite in this seed) |
| 9 | 11:40 | `arrive("T9")` earlier, `done("T9")`, `backhaul("T9","broker")` | T9 green; door 6 empty; backhauls 1 |
| 10 | 12:00 | `freeze()` | Clock stops, shows "frozen" |

## The gate routine the runner must do

The dock is honest: a booked truck that nobody `arrive()`s becomes a `noshow` at start + 30 (slot released, auction opened), and an arrived truck that nobody `done()`s gets a `detention` claim 120 min after arrival. So before each key the runner should `arrive()` every booked truck whose slot has started (except T12, the scripted no-show) and `done()` every truck whose slot has ended (except T3, whose detention is the act-3 beat). Auction winners need it too: T6 by 09:30, T8 by 10:30, T13 within ten minutes of its 11:40 award. `actor/scripts/scenario.ts` has a `gate()` helper that does exactly this; it ran the whole day 52/52 green at 300x with every alarm firing on its own.

Expected totals at 12:00 with this seed and the runbook's calls: side payments $430 ($150 + $200 + $80), detention avoided $900, moves 13, backhauls 1, phone calls 0.

## Fallbacks

- An alarm looks late: `tick()` drains every due timer now (the runner should print "waiting for alarm" first and only then fall back).
- Clock: `freeze()`, `resume()`, `setSpeed(n)` (sim minutes per real minute; 60 is the demo speed, 300 makes a full rehearsal take about a minute).
- Runner not ready: `actor/scripts/scenario.ts` plays all three acts by itself against any actor id; `actor/scripts/drive.ts` plays act 1 and the door-down beat in one go.
- Something looks wrong on the board: `bun scripts/peek.ts` prints the actor's truth; the board only renders snapshots.
- Start over: `bun scripts/seed.ts` (any time; the clock restarts at 08:00).
