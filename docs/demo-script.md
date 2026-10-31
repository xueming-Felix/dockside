# Dockside · the 5-minute demo script

Three ways to drive it, same narration. **Buttons** (the stage default): the control strip at the bottom of the dashboard has one button per key (1 Collision 08:05 … 10 Freeze 12:00) plus Reset and Auto; the presenter clicks, the room sees the click and the board react. Each button runs that key's actor calls and the agents' lines; a driver inside the grant server does the dispatcher's alarm work (awards on auction close, accepts on thread expiry, bids on the no-show auction, lets trucks in and out on time). Keys 1–9, 0, R and A work as keyboard shortcuts on the dashboard. **Auto**: press Auto (or run `STAGE=1 bun scripts/scenario.ts <actor> 60` from a terminal) and the keys fire at their scheduled times. **Manual**: Person B's runner presses keys and the Relay agents talk. Times below are the **board clock** (top of the dashboard), so the narrator reads the board, not a stopwatch.

Press each button at or after its scheduled time, before the next one's. Three have a deadline: key 3 before 09:30 (T1 would no-show), key 4 before 10:00 (T5 would be at the door), key 7 before 11:00 (T7 would be at the door). If a button shows a red note, read it, press Reset if the beat matters, and carry on.

## Setup, five minutes before

```sh
# projector: the dashboard against the deployed actor (already running on the Mac mini: http://100.117.209.6:7110)
cd dashboard && bun run build && bun run start:cloud        # if it is not running; then open http://127.0.0.1:7110 full screen
```

Click **Reset** on the strip: the board snaps to 08:00 at 60x and every button goes back to ready. The clock is now running, so start the opener within a few seconds and click **1** on "six doors". If anything goes wrong mid-run, Reset again and restart the narration from the top; the whole day is four minutes.

Terminal fallback if the strip is unreachable: `cd actor && set -a && source .env.cloud && set +a && STAGE=1 bun scripts/scenario.ts pier9-2026-10-31 60` plays the same beats on the scripted timing and leaves the clock frozen at 12:00.

## Open · 20 s · before pressing Enter

> "A truck needs a time at a warehouse door. Today that's a phone call, and when something goes wrong it's six phone calls. This is Pier 9 Cold Storage: six doors, twelve trucks, and eight companies whose agents are all on Agent Relay. We won't touch the keyboard except to break things."

Click **1** on "six doors" (Reset was clicked a moment before, so the board already shows 08:00).

## Act 1 · the collision · 08:05 to 08:30

| Board clock | On screen | Say |
|---|---|---|
| 08:05 | Door 4: T13 appears at 14:00, T14 at 15:00 with a dashed border; `collision` in the dock log | "Two carriers just asked for door 4 at two o'clock in the same instant. The dock is a Durable Actor, one request at a time, so it can't double-book. One got it, one got three o'clock. Now watch the one who lost go straight to the winner with cash." |
| 08:06 | #pier9: SWAP? $120 → COUNTER $150 → AGREE → SETTLE; the two blocks trade places; side payments $150 | Wait for the SETTLE line. "$150 changed hands, the actor swapped them atomically, and nobody asked us." |
| 08:28 | T3 turns teal at door 1; the clock panel lists "10:28 detention T3" | Nothing. (If you must: "The broker's truck just checked in at door 1. Remember it.") |

## Act 2 · the cascade · 09:00 to 10:10

| Board clock | On screen | Say |
|---|---|---|
| 09:00 | T1 slides to door 4 11:00, T4 to door 3 12:00; two dashed amber AUCTION boxes on door 2 09:00 and door 1 10:00; bids in the feed | "Traffic. Two of Carrier A's trucks are ninety minutes out, so two slots just opened, and the dock put them up for auction." Then nothing until the first box closes. |
| 09:10 | Auction on door 2 closes; T6 jumps from noon to door 2 09:00; detention avoided $225 | "That close was an alarm inside the actor, not a person. Carrier B's truck just moved from noon to nine o'clock: three hours of detention it will never pay." |
| 09:20 | Door 5 goes striped; T5 slides to door 6 11:00; feed: SWAP? $150 → COUNTER $200 → AGREE, cold chain → SETTLE; T5 lands on door 6 10:00, T9 shifts to 11:00; side payments $350 | "Door 5 is out. That's a reefer door; the cold load can't use a dry door, and its agent knows exactly who holds the slot it needs." Two rounds, then: "Two hundred dollars, two rounds, and the board re-plans around the deal." |
| 09:40 | Feed only: REQUEST from carrier-x, VERIFY, NO from the broker, refused | "An unknown carrier wants a door for a load that isn't theirs. The warehouse asks the broker. Refused, and the dock never heard about it." |
| 09:50 | T6's block stretches past 11:00; T2 slides to door 2 12:00 with a dashed border; the clock panel counts a thread deadline down | "Paperwork. Carrier B's truck is running long at door 2, so the truck behind it gets pushed to noon and opens a thread looking for a trade. Nobody bites." |
| 10:01 | `thread expired` in the log; T2's border goes solid | "Those two couldn't agree, so the clock decided." |
| 10:10 | Auction on door 1 closes; T8 lands on door 1 10:00 | "Second auction closed itself; the owner-operator takes ten o'clock." |

## Act 3 · the hot load · 10:15 to 12:00

| Board clock | On screen | Say |
|---|---|---|
| 10:15 | T11 jumps to door 1 11:00 with a HOT pill; T7 slides to 12:00 with a dashed border; feed: who can yield → broker's terms → carrier-b sells noon for $80 → waiver approved → SETTLE; side payments $430 | "The shipper needs this load today. Four agents, one thread: the broker will yield eleven o'clock, but only for a detention waiver and someone's noon slot. Carrier B sells its noon for eighty dollars. Watch the warehouse sign off." |
| 10:28 | T3 turns red; under the Gantt: "T3 detention $150 · waived" | "And that alarm fired on its own, for the truck everyone forgot. Two hours at the door, the claim landed at $150, and the waiver from the deal applied itself." |
| 11:20 | "Tomorrow 08:00: T15" under the Gantt | Optional: "A driver whose hours end before the slot does: the dock won't book what can't be driven. Tomorrow, eight o'clock." Skip if behind. |
| 11:30 | T12 goes hatched (no-show); an AUCTION box appears on door 3 11:00; a bid lands | Nothing. Let the room notice. |
| 11:40 | The box closes; T13 lands on door 3 11:00 | "Third auction of the day, and nobody pressed anything." |
| 11:41 | T9 turns green; door 6 empty; backhauls 1 | "Empty door, empty truck, and the broker loads it with a backhaul on the way out." |
| 12:00 | Clock stops, "frozen" | Close. |

## Close · 40 s

Point at the counters: side payments $430, detention avoided $900, moves 13, backhauls 1, phone calls 0.

> "Ten exceptions, five negotiations, three auctions, six alarms that fired on their own, zero phone calls. Every scarce thing in freight, a door, a load, a container, is a Durable Actor; every company is an agent on Relay; every clock is an alarm. We built the receiver's dock today. The broker's desk is next."

## Questions judges will ask

- **Why an actor and not Postgres?** One request at a time is the double-booking guarantee and why two conflicting settlements can't both land; alarms fire while nobody is connected (we left it alone for two minutes this afternoon and it woke itself five times); the websocket is the projector.
- **Why Relay and not a webhook?** The carriers don't run our software. Their agents already have an address, and the negotiations happen between them, not through us.
- **What stops agents from colluding or stalling?** Budgets enforced in code, two messages per agent per thread, and a deadline timer in the actor: if they don't agree, the clock decides.
- **Who pays?** The warehouse, per door per month. It's the party eating detention claims today.

## If it breaks

- A button fails or the strip goes grey ("driver offline"): the grant server died; `bun run start:cloud` in dashboard/ brings it back in two seconds, then Reset. Terminal fallback: the STAGE script above.
- An alarm seems late: the script waits ten real seconds, then calls `tick()` itself and says so in its own terminal. On stage, say nothing; it catches up.
- Dashboard shows "waiting for seed()" or disconnects: it reconnects on its own; reload the page only if it stays dark for ten seconds.
- Running long: skip buttons 8 and 9 (PLAN's own cuts) and click 10 at 12:00; in Auto mode start the close at 11:30 while it finishes behind you.
