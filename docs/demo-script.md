# Dockside · the 5-minute demo script (story mode)

Three scene buttons at the bottom of the dashboard; pick two (scene 3 is optional). Each scene runs its own beats and the narration panel beside the Gantt fills in as it happens: what the dock just did, why it matters (Durable Actor / Agents on Relay / Alarm), and the exact lines the agents exchanged. The presenter reads the panel to the room and points at the board. Keys 1/2/3 start scenes, R resets.

## Setup, five minutes before

Projector: http://100.117.209.6:7110 full screen (or on the laptop: `cd dashboard && bun run build && bun run start:cloud`, then http://127.0.0.1:7110). Click **Reset**: the board snaps to 08:00 and the clock runs slowly (5x), so there is no rush between scenes. The old ten-key board is still there at `?keys=1` if ever needed.

## Open · 20 s

> "A truck needs a time at a warehouse door. Today that's a phone call, and when something goes wrong it's six phone calls. This is Pier 9 Cold Storage: six doors, twelve trucks, eight companies whose agents are all on Agent Relay. The dock itself is a Durable Actor. We won't touch the keyboard except to break things."

## Scene 1 · Two trucks, one door · about 60 s

Click **1**. The panel walks through four steps; say one line per step while it fills:

1. *Durable Actor.* "Two carriers asked for door 4 at two o'clock in the same instant. The dock takes one request at a time, so it can't double-book: T14 got it, T13 got an offer for three o'clock." (Door 4 shows T14 at 14:00 and T13 at 15:00 with a dashed border.)
2. *Agents.* "The loser doesn't call us. Its agent goes straight to the winner with cash." (SWAP? $120 appears in #pier9.)
3. *Agents.* "A counter, then a deal: $150. Two rounds, and the rules stop them there." (COUNTER / AGREE.)
4. *Dispatcher + actor.* "The settlement goes to the dock, which swaps the two slots atomically and records the money." (The blocks trade places; side payments $150.)

Outcome line on the panel: read it.

## Scene 2 · Door 5 goes down · about 60 s

Click **2**.

1. *Durable Actor.* "Door 5 just failed. The dock re-plans in one call: only the reefer truck on it moves, to door 6 at eleven, and the offer names who holds the slot it would rather have." (Door 5 striped; T5 slides to door 6 11:00.)
2. *Agents.* "The cold-chain carrier wants ten o'clock back and offers carrier-b $150 to swap."
3. *Agents.* "$200, agreed. Two rounds, then silence."
4. *Durable Actor.* "The dock checks the deal, door type and priority, pins T5 to ten and bumps T9 to eleven." (T5 and T9 swap on door 6; side payments $350.)

## Scene 3 · Traffic, and the clock decides · about 75 s · optional

Click **3**.

1. "Two of carrier-a's trucks are ninety minutes out. The dock re-plans them and door 2 at nine is suddenly free."
2. "The freed hour goes to auction, closing in a minute: that close is a timer inside the actor."
3. "Three carriers answer: two bid, the reefer carrier passes."
4. Say nothing; the panel shows the alarm step pulsing. When it completes: "Nobody pressed anything. The actor woke itself and closed the auction."
5. "Earliest ready wins: T6 unloads at nine instead of noon. That counter is detention money the carrier will never pay."

## Close · 30 s

> "Every scarce thing in freight, a door, a load, a container, can be a Durable Actor; every company can be an agent on Relay; every clock can be an alarm. Today the dock held the schedule, the agents made the deals, and nobody picked up a phone."

## Questions judges will ask

- **Why an actor and not Postgres?** One request at a time is the double-booking guarantee and why conflicting settlements can't both land; alarms fire while nobody is connected (we left a test actor alone this afternoon and it woke itself five times on schedule); the websocket is the projector.
- **Why Relay and not a webhook?** The carriers don't run our software. Their agents already have an address, and the negotiations happen between them, not through us.
- **What stops agents from colluding or stalling?** Budgets enforced in code, two messages per agent per thread, and a deadline timer in the actor: if they don't agree, the clock decides.
- **Who pays?** The warehouse, per door per month. It's the party eating detention claims today.

## If it breaks

- A scene button shows a red note: click Reset and run the scene again; each scene is self-contained after a Reset (run 1 before 2 if you want the $150 to show on the counter).
- The strip greys out ("driver offline"): the grant server died; `cd dashboard && bun run start:cloud` brings it back, then Reset.
- The board shows "waiting for seed()": click Reset.
- Terminal fallback for the whole day at demo speed: `cd actor && set -a && source .env.cloud && set +a && STAGE=1 bun scripts/scenario.ts pier9-2026-10-31 60`.
