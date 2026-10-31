# Dockside · the demo script (two views)

Two views, one page (http://100.117.209.6:7110, tabs in the header):

- **Board** (view 1, the live system): the ten trigger buttons at the bottom, the Gantt, the dock log, the #pier9 feed, the counters. Everything is real: the deployed Dock actor on Terse, every agent line posted by that agent in #pier9 on Agent Relay, alarms firing on their own. Use it for the "it actually runs" part and for questions. Keys 1–9, 0, R, A are shortcuts; Auto plays the whole day hands-free.
- **Walkthrough** (view 2, the explanation): scenarios 1 and 2 frozen as steps. Prev / Next (← → or space) move one beat at a time; each beat shows what the Dock actor did and published, what the two agents' inboxes looked like, and why it matters. Nothing is live there, so nothing can fail or make you wait. Use it to teach the room the mechanism before or after the live run.
- **carrier-a … pier9-ops** tabs: each agent's persona and its own Agent Relay inbox, filled from Relay's event stream with message ids while the live board runs.

Suggested order (five minutes): open on the Walkthrough, scenario 1 (2 minutes); switch to the Board, Reset, run keys 1 and 4 live and flip to a carrier tab while the agents talk (2 minutes); close on the counters.

## Setup, five minutes before

Projector: http://100.117.209.6:7110 full screen. The grant server registers the eight agents on Agent Relay at startup (about 90 s); the strip's status line says "Relay: n/8 agents joining" until they are in. Click **Reset** on the Board once before the run: the board snaps to 08:00 at 120x (two sim minutes per real second; `DEMO_SPEED` on the grant server changes it). If you want the live run slow, it also works to press one key, talk, press the next.

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
