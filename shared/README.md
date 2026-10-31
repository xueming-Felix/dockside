# shared/ — the contract

`types.ts` is the frozen contract from PLAN.md plus additions marked `[added]`; nothing from the plan was renamed or removed. `pier9.ts` is the default seed both sides use. Read this before writing `relay/dock.ts`.

## What Person B should know

- **`DockApi`** in `types.ts` is the full method table with return shapes. `relay/dock.ts` can declare `interface DockClient extends DockApi {}` and have `MockDock` and `TerseDock` both implement it.
- **Actor id** is `pier9-2026-10-31` (`ACTOR_ID`). Terse rejects the colon the plan used.
- **Offers are applied immediately.** When `replan()` moves a truck, its appointment already shows the new slot and an open `Offer` is created for the carrier. `accept()` confirms, `counter(offerId, door, startMin)` re-pins (and may bump lower-priority trucks, returning their new offers), `decline()` sends the truck back to the queue. If a truck moves again, its older open offers become `expired`.
- **Hot loads and counters preempt; nobody else churns.** Trucks keep a feasible slot; only displaced trucks move, and they fill gaps by priority then eta. So after `reportEta()` only the delayed trucks move and their old slots stay empty: that is the moment for `openAuction()`.
- **Alarms** (`Snapshot.timers`, soonest first): `arrival_check` at start + 30 → `noshow` event, slot released, and the actor itself opens an auction (`auction_open` event with `auctionId`) when the slot still has time left; `detention` at arrive + 120 → `detention` + `claim` events (claim $150, growing hourly; a `resolveClaim(truckId, "waived")` made in advance keeps the claim waived); `auction_close` → `auction_closed` (the dispatcher then calls `award`); `thread_deadline` → `thread_expired` (the dispatcher then accepts the standing offer). Watch `events` with `seq` greater than the last seen.
- **Door-down beat is door 5.** T5 (reefer, carrier-c) sits on door 5 at 10:00; `setDoor(5, false)` displaces it to door 6 11:00 and the slot it wants is door 6 10:00, held by carrier-b's T9. (PLAN's key 4 says door 3, a dry door, which could not displace a reefer load.)
- **Key 1 trucks:** the seed has no afternoon trucks; `request("carrier-a", "T13", 4, 360)` and `request("carrier-b", "T14", 4, 360)` create them on the fly (optional 5th argument describes the truck). The second returns an `Offer` for door 4 15:00 and a `collision` event.
- **Stage controls:** `freeze()` for key 10, `resume()`, `setSpeed(n)`, `tick()` as the manual fallback if an alarm looks late, `backhaul(truckId, by)` for key 9.
- **Clock:** `Snapshot.realStart` is the epoch ms of sim 08:00 and `speed` is sim minutes per real minute (60 = one real second per sim minute). `hhmm()` and `parseHHMM()` convert.

## Connecting

**Calls:** `actors.Dock.get(ACTOR_ID).request(...)` and so on, from the generated client.

**Event stream (the dispatcher's websocket):** the generated stub has no backend `connect()`. Take a grant the way a browser would and open a plain WebSocket (Bun and Node 22 both have a global `WebSocket`):

```ts
const { websocketUrl } = await actors.Dock.prepareWebsocket({ actorId: ACTOR_ID, metadata: { role: "dispatcher" } })
const ws = new WebSocket(websocketUrl)
ws.addEventListener("message", e => {
  const snap: Snapshot = JSON.parse(String(e.data))      // a full Snapshot on connect, after every call, after every alarm
  for (const ev of snap.events.filter(x => x.seq > lastSeq)) handle(ev)   // noshow, auction_open, auction_closed, thread_expired, detention…
  lastSeq = snap.events.at(-1)?.seq ?? lastSeq
})
```

`actor/scripts/listen.ts` is exactly this as a CLI tail; `actor/scripts/peek.ts` prints the current state once. Reconnect on close with a fresh grant; grants expire if unused.


Local: `terse actor dev` in `actor/` serves http://127.0.0.1:7100; run `terse actor generate` in your project and `actors.Dock.get(ACTOR_ID)` just works. Deployed: set `TERSE_ACTOR_URL` and `TERSE_API_KEY` in your `.env` (ask Person A for both), then regenerate.
