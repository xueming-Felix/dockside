# Dockside · stage script, under two minutes

Live board first, then the walkthrough. About 240 spoken words: 1:40 at 145 words a minute. Live 1:00 (0:48 without the carrier tab; the opening is inside it) · walkthrough 0:36 · close 0:08. The same text is the narration for the Devpost video. Judge Q&A stays in [talking-points.md](talking-points.md).

The board runs at 120x in key mode (two sim minutes per real second; `DEMO_SPEED` on the grant server changes it). The trick that makes the live block fit: press **R**, then **3**, and start talking. Key 3 puts the freed 09:00 slot up for auction, and the actor's alarm closes it at 09:10 on the board clock, 35 real seconds after Reset. You talk through the traffic, the door failure and the deal (about 35 s of words) and the alarm lands as the closer of the live block without anyone waiting for it. The collision is not run live: the walkthrough tells it slowly.

## Before you start (not on the clock)

- Projector on http://100.117.209.6:7110, Board tab, full screen.
- Walkthrough tab: press **1** so it sits on *Scenario 1 · Background*, then back to Board. The position is remembered until a reload.
- Keys used: **R** then **3** as you begin (Reset: clock 08:00 at 120×), **4** after the opening, with the clock between 08:30 and 08:45. Digits work on the Board; → or space on the Walkthrough.
- Clock against real time after Reset: 08:30 at 15 s, 09:00 at 30 s, 09:10 at 35 s, 10:00 at 60 s. Lines in #pier9 land half a second apart.
- If the alarm has fired before you get to "watch the clock", drop that line: the Dock log line "auction closed" is already highlighted and the feed says "closed by the clock". Point at it and say the alarm line. If you are still on the Board at 10:10 (65 s), the second auction closes the same way: a bonus, not a problem.

## LIVE · 1:00 · Board

**[press R, then 3, and speak] · Opening · 0:17, clock 08:00 to about 08:35**

> "Pier 9: six doors, twelve trucks, eight companies, each an agent on Agent Relay. The dock is a Durable Actor on Terse. Two trucks are late: it re-planned them and auctioned the freed nine o'clock. Its own alarm closes that at 09:10."

(Within three seconds of key 3: five lines in #pier9, T1 and T4 slide to 11:00 and noon, two auction blocks appear on doors 2 and 1.)

**[press 4 · Door 5 down, clock about 08:35] · 0:18, to about 09:10**

> "Door 5, a reefer door, just failed."

(Door 5 striped; T5 slides to door 6 at 11:00.)

> "One call: only the cold truck moves, to the other reefer door, an hour later."

(#pier9: OFFER, SWAP? $150, COUNTER $200, AGREE, SETTLE, half a second apart; T5 and T9 swap on door 6.)

> "The offer names who holds ten o'clock; the agents settle it themselves: 150, counter 200, agreed. The dock pins T5 back to ten and bumps T9 to eleven. Watch the clock."

(09:10, 35 s after Reset: the Dock log highlights "auction closed"; the feed says "closed by the clock. Door 2 09:00 goes to T6"; T6 jumps from noon to nine; detention avoided rises by $225.)

**Alarm · 0:11**

> "There. Nobody touched anything: the actor woke itself and closed the auction. T6 unloads at nine instead of noon, 225 dollars of detention gone, zero phone calls."

**[click the carrier-b tab] · 0:10 (opt.)**

> "None of this went through us: carrier-b's inbox on Agent Relay, the same lines, delivered with message ids. The agents talk to each other."

(Relay delivers each line a few seconds after the board shows it, so the inbox is fullest here at the end of the block. Back to Board, then the Walkthrough tab.)

## WALKTHROUGH · 0:36 · Walkthrough tab, Scenario 1 (→ or space per screen)

- Background: "Now the mechanism, slowly."
- Step 1: "Carrier B books door 4 at two. One call."
- Step 2: "Carrier A, same slot, same instant. One request at a time: it gets three o'clock and an offer."
- Step 3: "The dispatcher posts the offer and names who holds the slot. (opt.) A deadline timer arms."
- Step 4: "The loser goes straight to the winner: swap for 120."
- Step 5: "Counter 150, agreed. Two messages each, capped in code."
- Step 6: "One SETTLE: swap, pay, settle, in order. A conflicting deal comes back rejected."
- Outcome: "Deal done, no phone."

## CLOSE · 0:08

> "Every scarce thing in freight can be a Durable Actor, every company an agent on Relay, every clock an alarm."

## Alternative walkthrough · Scenario 2, door down · 0:32 (five steps)

Use it if you would rather not repeat the door failure in words; then run key **1** (Collision) live instead of key 4 and say: "Two carriers ask for door 4 at two, in the same instant. One request at a time: one books, the other gets three o'clock and an offer. The loser buys the slot: 120, counter 150, settle. The dock swaps the blocks atomically."

- Background: "The door failure, slowly."
- Step 1: "Door 5 fails. One call: only T5 moves, to door 6 at eleven. No cascade."
- Step 2: "The offer tells the cold-chain carrier who holds ten o'clock: Carrier B. A deadline timer arms."
- Step 3: "An hour is worth 200 to the reefer carrier, 60 to Carrier B. There is a deal in there: 150 offered."
- Step 4: "Counter 200, agreed. Two rounds, then silence."
- Step 5: "The dock checks door type and priority, pins T5 to ten, bumps T9 to eleven. Both carriers better off; the warehouse paid nothing."
- Outcome: "T5 unloads cold at ten. Carrier B took 200 for an hour it values at 60."

## Notes from checking the build (15:10 PDT; timing redone at 120x, 15:40 PDT)

- Live key 1 and Walkthrough scenario 1 are mirror images. Live: carrier-a's T13 books first and carrier-b pays the $150 (carrier-b's budget in the cast table is $0). Walkthrough: carrier-b's T14 books first and carrier-a pays, which matches the personas. The script above never names the carriers in a live collision line, so the presenter cannot be caught out. Aligning them is a six-line change in `dashboard/demo.ts` key 1 (request carrier-b first, carrier-a pays); owner's call, that file is being worked on.
- The diagram version of the Walkthrough is not on :7110 yet (the 15:00 build shows the three-pane version). The redraw keeps the step titles and takeaways, so the lines hold.
- Timing facts behind the plan, from `dashboard/demo.ts`: the key board seeds at 120x (`DEMO_SPEED`, default set in `server.ts`; one real second is two sim minutes); key 3 pressed before 09:00 opens auction a1 closing at 09:10 (`max(09:10, now+10)`) and a2 closing at 10:10; each key's lines land one per sim minute (500 ms real at 120x); the gate holds T1 and T4 out until key 3 runs, so pressing 3 first also avoids T1's 09:30 no-show.
- Measured once on a scratch cloud actor at 120x (15:35 PDT), Relay posting off: key 3 pressed 1 s after Reset was done 3 s later; key 4 pressed at 08:32 (16 s) was done 3.4 s later; the auction_close alarm fired and T6 was awarded 35.2 s after Reset, at 09:10 on the board. The counters do not depend on the speed; the full day on that actor ended with side payments $200 and detention avoided $600.
