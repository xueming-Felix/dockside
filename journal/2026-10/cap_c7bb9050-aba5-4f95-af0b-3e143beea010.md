# Source record

```json
{
  "id": "cap_c7bb9050-aba5-4f95-af0b-3e143beea010",
  "event": "outbound.message",
  "speaker": "assistant",
  "occurredAt": "2026-10-31T22:16:13.782Z",
  "sourceId": "cli_aa52cde0b578c08b:om_x100b6152c421f0a10858a0e92e5ddeb",
  "chatId": "oc_7ace179430b101be62241f34b1b98de1",
  "rootMessageId": "om_x100b61508f5a58a1075387abd7a82d1",
  "sessionId": "ec8c8c2a-0420-4231-ae89-75b67589dfda"
}
```

## Content

Stage script, under 2:00 (278 spoken words ≈ 1:55 at 140 wpm, 1:50 at 150). Live first (≈1:15 incl. a 20 s opening), walkthrough ≈0:36, close ≈0:08. Full file with cues: demo/stage-script.md (attached next).

THE TRICK: press R then 3 about ten seconds before your first word. Key 3 auctions the freed 09:00 slot and the actor's alarm closes it at 09:10 = 70 s after Reset. You talk through the door failure and the counters (~60 s), and the alarm lands as the closer, nobody waits for it. The collision is not run live; the walkthrough tells it slowly.

SETUP (off the clock)
• :7110 Board tab, full screen. Walkthrough tab: press 1 so it sits on Scenario 1 · Background, then back to Board (position is remembered).
• ~10 s before you speak: R (Reset, 08:00 at 60x) then 3 (Traffic). Five lines land in #pier9.

LIVE · 1:15 · Board
[opening, clock ≈08:10]
"Pier 9: six doors, twelve trucks, eight companies, each an agent on Agent Relay. The dock is a Durable Actor on Terse. Two trucks are stuck in traffic: the dock re-planned them and auctioned the freed nine o'clock. It closes at 09:10, on the actor's own alarm."

[press 4 · Door 5 down, ≈08:30]
"Door 5, a reefer door, just failed."
(door 5 striped, T5 slides to door 6 at 11:00)
"One call: only the cold truck on it moves, to the other reefer door an hour later. Nothing else churns."
(feed: OFFER, SWAP? $150, COUNTER $200, AGREE, SETTLE)
"The offer names who holds ten o'clock; the two agents settle it themselves: 150, counter 200, agreed. The dock checks door type and priority, pins T5 back to ten, bumps T9 to eleven."

[click carrier-b tab] (optional, 10 s)
"None of this went through us: carrier-b's inbox on Agent Relay, the same lines, delivered with message ids. The agents talk to each other."

[back to Board, ≈09:05]
"200 dollars moved carrier to carrier, 75 of detention the warehouse never pays, zero phone calls. Watch the clock."
(09:10: Dock log highlights "auction closed"; feed: "closed by the clock. Door 2 09:00 goes to T6"; T6 jumps from noon to nine)
"There. Nobody touched anything: the actor woke itself and closed the auction. T6 unloads at nine instead of noon, 225 dollars of detention gone."

WALKTHROUGH · 0:36 · Scenario 1, → per screen
Background: "Now the mechanism, slowly."
1: "Carrier B books door 4 at two. One call."
2: "Carrier A, same slot, same instant. One request at a time: it gets three o'clock and an offer."
3: "The dispatcher posts the offer and names who holds the slot. A deadline timer arms."
4: "The loser goes straight to the winner: swap for 120."
5: "Counter 150, agreed. Two messages each, capped in code."
6: "One SETTLE: swap, pay, settle, in order. A conflicting deal comes back rejected."
Outcome: "Deal done, no phone."

CLOSE · 0:08
"Every scarce thing in freight can be a Durable Actor, every company an agent on Relay, every clock an alarm."

TWO THINGS I FOUND
1. Live key 1 and Walkthrough scenario 1 are mirror images: live, carrier-a's T13 books first and carrier-b pays $150 (carrier-b's budget in the cast table is $0); walkthrough, carrier-b books first and carrier-a pays, which fits the personas. The script never names carriers in a live collision line, so you can't be caught out. Fix is ~6 lines in dashboard/demo.ts key 1 (request carrier-b first); your call, that file is being rebuilt.
2. The diagram Walkthrough isn't on :7110 yet (the 15:00 build is the three-pane version). The redraw keeps step titles and takeaways, so the lines hold.

The file also has a scenario-2 walkthrough variant (0:32) if you'd rather run key 1 live and walk through the door failure instead.
