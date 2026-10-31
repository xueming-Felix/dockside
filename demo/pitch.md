# Dockside · stage script, 5 minutes

**Roles:** Person B drives the scenario runner on laptop 2 and watches the feed. Person A narrates from laptop 1 with the dashboard on the projector. Nobody types a prompt. The feed is the show; the best moments are the ones where A says nothing.

## At a glance

| # | Segment | Clock | Budget | Keys |
|---|---------|-------|--------|------|
| 1 | Open | 0:00 to 0:20 | 20s | 1 at the end |
| 2 | Act 1 · collision and first deal | 0:20 to 1:00 | 40s | (1 running), 2 silently |
| 3 | Act 2 · the cascade | 1:00 to 3:00 | 120s | 3, [alarm], 4, 5, 6, [alarm] |
| 4 | Act 3 · the hot load | 3:00 to 4:20 | 80s | 7, [alarm] hands off, [alarm] hands off |
| 5 | Close | 4:20 to 5:00 | 40s | 8, 9, 10 as time allows |

**[alarm] hands off** = B does not press anything. The runner prints "waiting for alarm" with a countdown. Same key number is the manual fallback only if the alarm has not fired by the expected second.

## Beats

### 1. Open · 20s

- **Key:** none until the end of the line, then **1**
- **Say:** "A truck needs a time at a warehouse door. Today that's a phone call, and when something goes wrong it's six phone calls. This is Pier 9 Cold Storage: six doors, twelve trucks, and eight companies whose agents are all on Agent Relay. We won't touch the keyboard except to break things."
- **Point at:** the Gantt (6 doors, 12 trucks booked 08:00 to 13:00), then the empty chatter feed.

### 2. Act 1 · the collision and the first deal · 40s

- **Key:** 1 is already running (08:05, two requests for door 4 at 14:00)
- **Say:** "Two carriers just asked for door 4 at two o'clock in the same instant. The dock is a Durable Actor, one request at a time, so this can't double-book. One got it, one got three o'clock. Now watch: the one who lost is going straight to the winner with cash."
- **Point at:** the `collision` line in the feed, then the Carrier A to Carrier B thread (SWAP?, COUNTER $150, AGREE).
- **Wait for:** the SETTLE line.
- **Say:** "$150 changed hands, the actor swapped them atomically, and we weren't asked."
- **Point at:** two Gantt blocks swapping at once; side payments counter at $150.
- **Key:** **2** silently (08:30, T3 arrives; detention clock starts, fires in act 3).

### 3. Act 2 · the cascade · 120s

**Key 3** (09:00, T1 and T4 stuck in traffic)

- **Say:** "Traffic. Two slots just opened at once, so the dock put them up for auction."
- **Point at:** AUCTION a3 and a4 in the feed; bids from Carrier B (T6) and Carrier D (T8); Carrier C passes. The clock panel shows the `auction_close` timer.
- **[alarm] hands off.** Say nothing until the alarm closes it (09:10).
- **Say:** "That close was an alarm inside the actor, not a human."
- **Point at:** two new blocks on the Gantt (T6, T8).

**Key 4** (09:20, door 3 closed)

- **Say:** "Door 3 is out. The reefer truck can't use a dry door; its agent knows exactly who holds the slot it needs."
- **Point at:** the OFFER naming Carrier B (T9) as holder of door 5 at 14:00; the Carrier C and Carrier B thread: SWAP? $150, COUNTER $200, AGREE $200.
- **Wait for:** two rounds, then SETTLE.
- **Point at:** the swap on the Gantt; side payments now $350.

**Key 5** (09:40, Carrier X requests door 2 at 11:00 for L12)

- **Say:** "An unknown carrier wants a door. The warehouse asks the broker. Refused, and the dock never heard about it."
- **Point at:** VERIFY to the broker, the broker's "no", pier9-ops "refused", the `refused` event. Gantt unchanged.

**Key 6** (09:50, T6 overruns +45) · cut candidate

- Then **[alarm] hands off**: let the `thread_deadline` fire (10:00).
- **Point at:** Carrier B accepts; Carrier A's SWAP gets no taker; the thread goes quiet; the deadline timer on the clock panel.
- **Say:** "Those two couldn't agree, so the clock decided."

### 4. Act 3 · the hot load · 80s

**Key 7** (10:15, T11 hot load L17 prioritized)

- **Say:** "The shipper needs this load today. Four agents, one thread: the broker will yield, but only for a detention waiver and someone's noon slot. Watch the warehouse sign off."
- **Point at:** one thread with shipper, broker, Carrier B, pier9-ops; "waiver approved"; the shipper's SETTLE with three parts; the hot load moving to 11:00.

**[alarm] hands off** (10:30, detention alarm for T3)

- **Say:** "And that alarm fired on its own for the truck everyone forgot. The claim landed and the waiver from the deal applied itself."
- **Point at:** T3 block turning red, the `detention` event, the claim showing `waived`.

**[alarm] hands off** (11:00, arrival check for T12: no-show)

- **Say:** nothing. Let the no-show auction run without comment.
- **Point at:** `noshow`, AUCTION a5, bids from Carrier A and Carrier D, alarm closes it, award.

### 5. Close · 40s

- **Keys:** 8 to 10 as time allows. Keys 8 and 9 are cut candidates; key 10 always.
  - 8 (11:20): T8 slot ends after 15:30, `tomorrow`, pier9-ops books 08:00 tomorrow.
  - 9 (11:40): T9 done, `empty`, broker offers a backhaul, Carrier B accepts.
  - 10 (12:00): freeze the clock.
- **Point at:** the counters: detention avoided, side payments, moves, phone calls 0.
- **Say:** "Nine exceptions, five negotiations, three auctions, four alarms, zero phone calls. Every scarce thing in freight, a door, a load, a container, is a Durable Actor; every company is an agent on Relay; every clock is an alarm. We built the receiver's dock today. The broker's desk is next."

## Cut rule

- If the run is past **5:30**, drop **keys 6, 8 and 9**.
- Never let a thread run past two rounds.

## Never cut

1. The collision and swap (key 1)
2. The door-down two-round swap (key 4)
3. The detention alarm firing on its own (10:30)
4. The chatter feed

These four are the judging rubric in visible form: serialized state, agents negotiating, the actor waking itself, and the room seeing all of it.

## Judge Q&A

**Why an actor and not Postgres?** One request at a time is the double-booking guarantee and the reason two conflicting settlements can't both land; alarms fire while nobody is connected; the websocket is the projector.

**Why Relay and not a webhook?** The carriers don't run our software; their agents already have an address, and the negotiations happen between them, not through us.

**What stops agents from colluding or stalling?** Budgets enforced in code, two messages per thread, and a deadline timer in the actor.

**Who pays?** The warehouse, per door per month; it's the party eating detention claims today.
