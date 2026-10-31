# Dockside · the 5-minute demo script (story mode)

Three scene buttons at the bottom of the dashboard; pick two (scene 3 is optional). A scene runs one step at a time: after each step the strip shows a pulsing **Next step** button (space, enter or → also work) and waits for you, so you narrate at your own pace. The narration panel beside the Gantt fills in as each step runs: who did it (Durable Actor / Agents on Relay / Alarm / Dispatcher), what happened, why it matters, and the exact lines the agents exchanged, appearing one by one. Every agent line is also posted by that agent in #pier9 on Agent Relay; the carrier tabs in the header show each agent's own Relay inbox. Keys 1/2/3 start scenes, R resets.

## Setup, five minutes before

Projector: http://100.117.209.6:7110 full screen (or on the laptop: `cd dashboard && bun run build && bun run start:cloud`, then http://127.0.0.1:7110). Click **Reset**: the board snaps to 08:00 and the clock runs slowly (5x), so there is no rush between scenes. The old ten-key board is still there at `?keys=1` if ever needed.

## Open · 20 s

> "A truck needs a time at a warehouse door. Today that's a phone call, and when something goes wrong it's six phone calls. This is Pier 9 Cold Storage: six doors, twelve trucks, eight companies whose agents are all on Agent Relay. The dock itself is a Durable Actor. We won't touch the keyboard except to break things."

## Scene 1 · Two trucks, one door · about 90 s

Click **1**, then **Next step** between beats. Say one line per step:

1. *Durable Actor.* "Carrier B asks for door 4 at two o'clock. One call, booked." (T14 appears on door 4 at 14:00.)
2. *Durable Actor.* "Carrier A asks for the same slot in the same instant. The dock takes one request at a time, so it can't double-book: T13 gets an offer for three o'clock instead of an error." (T13 at 15:00 with a dashed border; `collision` in the log.)
3. *Dispatcher.* "The dock announces the offer in the channel and names who holds the slot Carrier A wants." (OFFER line in #pier9; flip to the carrier-a tab if you like: it arrived over Agent Relay.)
4. *Agents.* "The loser doesn't call us. Its agent goes straight to the winner with cash." (SWAP? $120.)
5. *Agents.* "A counter, then a deal: $150. Two rounds, and the rules stop them there." (COUNTER / AGREE.)
6. *Dispatcher + actor.* "The settlement goes to the dock, which swaps the two slots atomically and records the money." (The blocks trade places; side payments $150.)

Outcome line on the panel: read it.

## Scene 2 · Door 5 goes down · about 90 s

Click **2**, then **Next step** between beats.

1. *Durable Actor.* "Door 5 just failed. The dock re-plans in one call: only the reefer truck on it moves, to door 6 at eleven." (Door 5 striped; T5 slides to door 6 11:00.)
2. *Dispatcher.* "The offer to the cold-chain carrier names who holds the ten o'clock it would rather have: Carrier B."
3. *Agents.* "An hour is worth about $200 to the reefer carrier and $60 to Carrier B. There's a deal in there, and nobody has to find it by phone: $150 offered."
4. *Agents.* "$200, agreed. Two rounds, then silence."
5. *Durable Actor.* "The dock checks the deal, door type and priority, pins T5 to ten and bumps T9 to eleven. Both carriers are better off; the warehouse paid nothing." (T5 and T9 swap on door 6; side payments $350; detention avoided +$75 because T5 waits an hour less.)

If asked about the counters: **detention avoided** is the warehouse's number ($75 for every hour a truck's wait got shorter); **side payments** is money moving between carriers, not a cost to anyone in the room.

## Scene 3 · Traffic, and the clock decides · about 75 s · optional

Click **3**, then **Next step** between beats.

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
