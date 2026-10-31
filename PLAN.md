# Dockside Build Plan

> Haunted Hacks · Sat Oct 31, 2026 · two people · hacking 11:00 to 4:00. The same plan with the diagrams rendered in place: [docs/plan.html](docs/plan.html).

One actor, one dispatcher, eight scripted agents, one dashboard. Person A owns the state and the screen; Person B owns the messaging and the show. They meet at one frozen file.

[Person A] actor & board   [Person B] relay & cast   [Both] contract, integration, pitch

## Before 11:00 · setup only, no project code

The rules allow installing, signing in, and running vendor quickstarts. Do all of it before hacking starts so 11:00 is a clean start.

### [A] Laptop 1

- [ ] Bun 1.4.2+, Node 22+, `bunx terse-cli@latest install`, `terse auth login`
- [ ] Run the Terse counter quickstart end to end once, including `terse deploy`, so the deploy path is known
- [ ] Create an API token in app.useterse.ai; keep it in a password manager
- [ ] Create the GitHub repo `dockside` with folders `actor/` `dashboard/` `relay/` `shared/` and an empty README
- [ ] Vite + React scaffold knowledge ready (you'll scaffold at 1:20, not now)

### [B] Laptop 2

- [ ] Agent Relay desktop app installed and signed in; find the workspace key for the SDK (agentrelay.com/docs/typescript-sdk)
- [ ] `npm view @agent-relay/sdk` and skim its README; note `register`, `sendMessage`, `addListener('message.created')`
- [ ] OpenAI key from the $100 credits in `OPENAI_API_KEY`; confirm `gpt-5-mini` answers
- [ ] Devpost account created; team formed on Devpost
- [ ] Screen-recording tool tested (QuickTime or OBS) with mic

Agree out loud before 11:00: the warehouse is **Pier 9 Cold Storage**, six doors (1 to 4 dry, 5 and 6 reefer), the day runs 08:00 to 18:00, the clock runs at 60x, detention is $75 an hour after two free hours. Everything downstream uses those numbers.

## Five decisions · agreed by the team, 09:06

[Agreed] All five are settled. Nobody reopens them during the day; if one turns out wrong, it goes on the cut list, not back into discussion.

1.  **One actor for the whole warehouse-day, not one per door. [Agreed]** Door-down and hot-load replans cross doors, and actor-to-actor calls aren't documented. The actor id is `pier9:2026-10-31`. Still "one scarce shared thing, one request at a time."
2.  **The actor never talks to Relay. [Agreed]** A dispatcher process (B) is the bridge: it calls the actor through the generated client, watches the actor's websocket for new events, and does all Relay sends and receives. The actor stays pure state + replan + alarms, which is what the Durable Actors judges want to see.
3.  **Agents are Node processes on the Relay SDK, personas driven by gpt-5-mini. [Agreed]** Eight agents in one process, each registered with `relay.workspace.register`, each answering offers through a persona prompt with structured output. Fast, deterministic, no terminals. Upgrade path: one real Claude Code session (desktop-registered) plays Carrier A if the 11:00 spike proves it can see the SDK agents.
4.  **Simulated clock inside the actor, one alarm, a timer table behind it. [Agreed]** Terse gives one alarm per actor and "setting it again replaces it", so the actor keeps a `timers` list, always sets the alarm to the earliest unfired timer, and drains due timers in `onAlarm`. 1 real second = 1 sim minute.
5.  **Person B codes against a mock actor until 12:30. [Agreed]** `relay/dock.ts` declares a `DockClient` interface with two implementations: `MockDock` (in-memory, same signatures) and `TerseDock` (wraps the generated client). B is never blocked on A, and A is never interrupted by B.
6.  **Agents negotiate with each other, not through the dispatcher. [Added 09:10]** Every offer opens a thread in `#pier9`. Agents swap, bid, bargain and vouch in that thread directly, agent to agent. The dispatcher only mirrors the chatter and acts on four line types: `SETTLE`, `BID`, `VERIFY`, and the plain `accept / counter / decline`. The actor validates every settlement, so two agents who settle conflicting deals in the same second get one accepted and one `REJECTED`. Each thread has a deadline timer in the actor: if the agents don't agree, the clock decides.

## Who owns what

![Two columns. Person A owns the Dock actor on Terse Cloud and the dashboard; the actor broadcasts snapshots to the dashboard over a websocket. Person B owns the dispatcher, the persona agents and the scenario runner; the dispatcher calls the actor through the generated client and receives its websocket events, and talks to the persona agents over Agent Relay. A shared types file, frozen at 11:20, sits between the columns.](docs/diagrams/ownership.svg)

*Each person commits only inside their own folders. The only file both touch is shared/types.ts , and after 11:20 it changes only by saying so across the table.*

## The contract · type this in together at 11:00

Sim minutes count from 08:00 (`0` = 08:00, `360` = 14:00). Slots are 60 minutes. Relay handles are the carriers' agent names.

    // shared/types.ts
    export type DoorType = "dry" | "reefer"
    export type Door  = { id: number; type: DoorType; open: boolean }
    export type Truck = { id: string; carrier: string; load: string; type: DoorType;
                         priority: 0 | 1 | 2; etaMin: number; hosLimitMin?: number }
    export type Appt  = { truckId: string; door: number; startMin: number;
                         status: "booked" | "arrived" | "unloading" | "done" | "noshow" | "tomorrow" }
    export type Offer = { id: string; truckId: string; carrier: string; door: number; startMin: number;
                         reason: string; status: "open" | "accepted" | "countered" | "declined" | "expired" }
    export type Claim = { truckId: string; carrier: string; minutes: number; amount: number;
                         status: "filed" | "approved" | "waived" }
    export type Auction = { id: string; door: number; startMin: number; closesMin: number;
                           bids: { truckId: string; readyMin: number }[]; winner?: string }
    export type Thread  = { id: string; offerId: string; deadlineMin: number;
                           status: "open" | "settled" | "expired" }
    export type Chat  = { seq: number; atMin: number; from: string; to: string; thread?: string; text: string }
    export type Event = { seq: number; atMin: number; kind:
      "collision" | "replanned" | "offer" | "noshow" | "detention" | "tomorrow" | "empty" | "hot" |
      "swap" | "overrun" | "auction_open" | "auction_closed" | "thread_expired" | "refused";
      truckId?: string; offerId?: string; auctionId?: string; threadId?: string; detail: string }
    export type Snapshot = { simMin: number; speed: number; doors: Door[]; trucks: Truck[];
      appts: Appt[]; offers: Offer[]; auctions: Auction[]; threads: Thread[]; claims: Claim[];
      chatter: Chat[]; events: Event[];
      counters: { detentionAvoidedUsd: number; sidePaymentsUsd: number; phoneCalls: 0;
                  moves: number; backhauls: number } }

### Actor methods [A implements] [B calls]

| Method                                                                                                               | What it does                                                                                                                                               | Returns                   |
|----------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------|
| `seed(scenario)`                                                                                                     | Resets state, loads doors and trucks, sets `realStart`, schedules arrival-check timers                                                                     | `Snapshot`                |
| `request(carrier, truckId, door, startMin)`                                                                          | Books if free; if taken, returns an `Offer` for the earliest feasible slot and emits a `collision` event                                                   | `{ appt?, offer? }`       |
| `reportEta(truckId, etaMin)`                                                                                         | Runs `replan()`; every moved appointment becomes an open `Offer` to its carrier                                                                            | `{ offers }`              |
| `setDoor(door, open)`                                                                                                | Same, after closing or reopening a door                                                                                                                    | `{ offers }`              |
| `prioritize(truckId)`                                                                                                | Sets priority 2, replans, emits `hot`; offers to the bumped carriers carry `reason: "yield for hot load"`                                                  | `{ offers }`              |
| `accept(offerId)`                                                                                                    | Commits the appointment                                                                                                                                    | `{ ok }`                  |
| `counter(offerId, door, startMin)`                                                                                   | Pins that truck to the requested slot if feasible by bumping lower-priority trucks (which become new offers); else rejects with a reason                   | `{ ok, reason?, offers }` |
| `decline(offerId)`                                                                                                   | Truck goes to the queue; replan                                                                                                                            | `{ offers }`              |
| `swap(truckA, truckB)` [new]                                                                                       | Exchanges the two appointments if both are movable and door types fit. Atomic: the second of two conflicting swaps fails. Emits `swap`                     | `{ ok, reason? }`         |
| `overrun(truckId, extraMin)` [new]                                                                                 | Truck at the door runs long; its slot stretches; replan everything behind it                                                                               | `{ offers }`              |
| `openAuction(door, startMin, closesMin)` · `bid(auctionId, truckId, readyMin)` · `award(auctionId, truckId)` [new] | A freed slot goes to auction; the `auction_close` timer emits `auction_closed`; the dispatcher picks the winner (earliest ready, then priority) and awards | `{ auction }`             |
| `openThread(threadId, offerId, deadlineMin)` · `settleThread(threadId)` [new]                                      | Tracks a negotiation; the `thread_deadline` timer emits `thread_expired` and the dispatcher auto-accepts the standing offer                                | `{ thread }`              |
| `pay(from, to, usd)` [new]                                                                                         | Records a side payment agreed in a settlement; `sidePaymentsUsd` counter                                                                                   | `{ ok }`                  |
| `arrive(truckId)` · `done(truckId)`                                                                                  | Starts the detention timer · frees the door, emits `empty`                                                                                                 | `{ ok }`                  |
| `fileClaim(truckId)` · `resolveClaim(truckId, "approved" | "waived")`                                                | Detention money                                                                                                                                            | `{ claim }`               |
| `say(from, to, text)`                                                                                                | Mirrors a Relay message into `chatter` so the dashboard shows it                                                                                           | `{ seq }`                 |
| `snapshot()`                                                                                                         | Full state; also sent on `onConnect` and broadcast after every mutation and every alarm                                                                    | `Snapshot`                |

### Relay message grammar [B owns]

Everything happens in `#pier9`, one thread per offer or auction, so the dispatcher and the dashboard see every word. The first token of a line is the verb; the dispatcher parses with one regex per verb and ignores anything else. The free text after the dash is what the chatter feed shows.

    # dispatcher → #pier9 (opens a thread; names who holds what the carrier wants)
    OFFER o21 truck T5 door 6 at 16:00 — door 3 out of service. Holder of door 5 14:00: @carrier-b (T9). Thread closes 09:30.
    AUCTION a3 door 2 at 09:00 — slot freed by T1 breakdown. Closes 09:10. BID a3 <truck> ready <HH:MM>
    VERIFY @carrier-x load L12? — unknown carrier requesting door 2 at 11:00          # asked of the broker

    # agent → agent, inside the thread (the dispatcher only mirrors these)
    SWAP? @carrier-b — T5 takes door 5 14:00, T9 takes door 6 16:00, we cover $150 of your detention.
    COUNTER $200 — 16:00 pushes my driver's next pickup.
    AGREE $200 — cold chain is worth it.

    # agent → dispatcher (the only lines the dispatcher acts on)
    SETTLE o21: T5 door 5 14:00 · T9 door 6 16:00 · pay carrier-c→carrier-b $200
    BID a3 T6 ready 08:50
    VERIFY no — L12 is tendered to @carrier-b, nobody else.
    accept o21 | counter o21 door 5 at 14:00 | decline o21
    REJECTED o21 — door 5 14:00 was taken by a2 award (dispatcher, after the actor says no)

Rules that keep it from stalling: two messages per agent per thread, then silence; every thread has a 10 sim-minute deadline in the actor; the dispatcher validates a `SETTLE` by calling the actor in order (`swap`, then `pay`, then `resolveClaim`) and posts `REJECTED` with the actor's reason if any step fails. Every line in both directions is mirrored with `say()` by the dispatcher, never by the agents.

## One exception through the loop · the door goes down

![Sequence across four lanes: dispatcher, Dock actor, reefer agent over Relay, dashboard. The dispatcher calls setDoor(3, closed). The actor replans, moving reefer truck T5 to door 6 at 16:00, broadcasts a snapshot to the dashboard, and returns offer o21. The dispatcher sends the offer to the reefer agent over Relay. The agent counters for door 5 at 14:00. The dispatcher calls counter(o21, 5, 360) and say(). The actor pins T5, bumps dry truck T2 to door 1 at 15:00, returns ok plus offer o22, and broadcasts again. The dispatcher repeats for o22.](docs/diagrams/door-down-loop.svg)

*Every exception is this same loop. The scenario runner injects the first call; everything after it is the dispatcher reacting to return values and websocket events. Nothing in the actor knows Relay exists.*

## Three ways agents talk to each other

The loop above is the base case: one agent, one offer, one reply. The demo gets its drama from three patterns layered on top of it, all in `#pier9` threads, all settled through the actor.

![Three patterns side by side. Swap: two carrier agents exchange SWAP, COUNTER and AGREE messages directly, then one posts SETTLE and the Dock actor runs swap() atomically. Auction: the dispatcher posts a freed slot to the channel, three carriers bid, an auction_close alarm ends it, and the actor awards the slot. Coalition: shipper, broker and a carrier bargain in one thread, the warehouse agent arbitrates the detention waiver, and the settlement runs swap(), pay() and resolveClaim() on the actor.](docs/diagrams/agent-patterns.svg)

*Coral boxes and dashed arrows are agents on Relay talking to each other; the dispatcher is not in these pictures because it only listens. Blue is the actor validating the outcome. The amber alarm is the actor ending an auction nobody is watching.*

| Pattern   | Triggered by                                                          | Who talks                                                | What the actor does                                                                   | What the room sees                                                                                         |
|-----------|-----------------------------------------------------------------------|----------------------------------------------------------|---------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| Swap      | An offer whose text names who holds the slot the carrier really wants | Two carriers, up to two rounds, money on the table       | `swap()` atomically; `pay()` for the side payment                                     | Two agents strike a deal in the feed while the dispatcher says nothing; the Gantt swaps two blocks at once |
| Auction   | A freed slot: breakdown, no-show, overrun recovered                   | Dispatcher posts, every carrier may bid once             | `openAuction()`, `auction_close` timer, `award()`                                     | Three bids land in ten sim-seconds, then an alarm closes it and the winner's block appears                 |
| Coalition | A hot load that needs someone to yield                                | Shipper, broker, a carrier, and the warehouse as arbiter | `swap()`, `pay()`, `resolveClaim(waived)` in one validated settlement                 | Four agents in one thread; a three-way trade; the warehouse signs off; the hot load moves to 11:00         |
| Vetting   | An unknown carrier requests a slot                                    | Dispatcher asks the broker; warehouse refuses            | Nothing; the request never reaches the actor                                          | Agents collaborating on trust, which is Relay's "you choose who gets in" in action                         |
| Deadline  | Any thread that goes quiet                                            | Nobody, which is the point                               | `thread_deadline` timer → `thread_expired`; the dispatcher accepts the standing offer | "If the agents don't agree, the clock decides." Shown once, in act 2, on purpose                           |

## The day, hour by hour

![Timeline from 10:00 to 17:00 with three lanes. Person A: setup, contract, actor core, alarms and deploy, lunch, dashboard, integration, README and Freestyle, final run, judging. Person B: setup, contract, Relay spike, dispatcher on mock, personas, lunch, scenario runner and end-to-end, integration, backup video, Devpost, judging. Sync points at 11:20 contract frozen, 12:30 actor deployed, 14:30 first full run, 16:00 submit.](docs/diagrams/day-timeline.svg)

*Four sync points, each a one-sentence handshake: the contract is frozen; the actor URL and key are in B's .env ; a full four-minute run worked once; the Devpost form is submitted.*

## [Person A] Actor & board

### 11:20 to 12:30 · actor core

- `terse init dockside --template counter`; rename to `Dock extends Actor<{ role: string }, never, Snapshot>`
- `@Persisted` fields for every collection in `Snapshot`; reassign arrays, never mutate in place (in-place changes don't save)
- `emit()` helper: build the snapshot, `this.broadcast(snapshot)`; call it at the end of every method
- `request()` with the collision path; `replan()` as a pure function in `actor/src/replan.ts` with its own tiny test file
- `scripts/drive.ts`: seeds, fires two requests for the same slot, closes door 3, prints the offers. This is your test harness; you never need Relay

### 12:30 to 1:00 · alarms, deploy, hand-off

- `@Persisted timers: { atMin, kind, truckId, fired }[]`; `scheduleNext()` sets `this.alarm.set(realAt(earliest))`
- `onAlarm()`: drain every timer with `atMin <= simNow()`, handle, `scheduleNext()`, `emit()`. Alarms fire while dormant, so this works even if nobody is connected
- Timer kinds: `arrival_check` (start + 30 → `noshow`, release slot, open an auction) · `detention` (arrived + 120 → event, auto `fileClaim`) · `auction_close` (→ `auction_closed` event, nothing else; the dispatcher awards) · `thread_deadline` (→ `thread_expired` event)
- The five new methods: `swap` (check both movable, door types fit, then exchange; reject with a reason otherwise), `overrun` (stretch the slot, replan behind it), `openAuction / bid / award` (a record plus a timer), `openThread / settleThread` (a record plus a timer), `pay` (a counter). About 30 minutes; do them after deploy if the deploy is slow, since B is on the mock until 1:20 anyway
- `terse deploy`; `terse actor generate` in `relay/`; paste `TERSE_ACTOR_URL` and key into B's `.env`. Sync point.

### 1:20 to 2:30 · dashboard

- Vite + React, one page, dark background (it's a projector). Fetch a websocket grant from a 20-line Express route that calls `prepareWebsocket`; render straight from `Snapshot`
- **Gantt**: 6 rows, 10 hour-columns, trucks as blocks; CSS transition on `left` so moves slide; amber when late, red when in detention, green when done
- **Chatter feed**: `chatter` newest at the bottom, auto-scroll, from → to in monospace, replies indented under their thread, SETTLE and REJECTED lines highlighted. The single most important panel
- **Clock**: big `HH:MM` from `simMin`, with the next three timers listed under it (an auction closing and a thread deadline look great here)
- **Counters**: detention avoided ($), side payments ($), phone calls (always 0), moves, backhauls
- If time: **replay**: keep every snapshot in an array; a slider scrubs through them. This is the stage insurance

### replan(), kept deliberately dumb

- Fixed: appointments in `arrived`, `unloading`, `done` never move
- Order the rest by priority desc, then `etaMin` asc, then current start asc
- For each: earliest hour slot ≥ max(eta, now) on an open door of matching type; prefer its current door if still free, to minimize moves
- Dry trucks may use a reefer door only when no dry door is free; reefer trucks never use a dry door
- If start + 60 \> `hosLimitMin` → status `tomorrow`, event, no offer
- Diff = every (door, start) that changed → open `Offer`, event `replanned`, `moves++`. Detention avoided += 75 × hours a queued truck moved earlier
- `counter()` = pin one truck to a slot, run the same function with that pin, succeed only if no higher-priority truck moved

## [Person B] Relay & cast

### 11:20 to 11:50 · the Relay spike, 30-minute timebox

1.  One script: `new AgentRelay({ workspaceKey })`, register `dock` and `carrier-a`, `dock.sendMessage({ to: '@carrier-a', text })`, `addListener('message.created')` prints it. Two agents talking in one process.
2.  Same, with the two agents in two processes on two laptops.
3.  Does the desktop-registered Claude Code session on laptop 1 appear in the roster and receive a DM from `dock`? Yes → Carrier A is real Claude Code in the demo. No → every agent is SDK, and that is fine.

If step 1 fails on the cloud workspace, create a fresh SDK workspace with `AgentRelay.createWorkspace` and move on. Do not spend past 11:50 on this.

### 11:50 to 12:30 · dispatcher against the mock

- `relay/dock.ts`: `DockClient` interface = the method table above; `MockDock` returns canned offers; `TerseDock` comes at 12:30
- `relay/dispatcher.ts`: for every `{ offers }` returned, post one OFFER to `#pier9` (naming the holder of the slot the carrier will want) and `openThread()`; for every Relay message, mirror it with `say()`, then act only if the first token is `SETTLE`, `BID`, `VERIFY`, `accept`, `counter` or `decline`
- `SETTLE` handler: parse the assignments and payments, call the actor in order (`swap` → `pay` → `resolveClaim`), post `REJECTED` with the actor's reason on the first failure, `settleThread()` on success
- Auctions: on `noshow` or a freed slot, `openAuction()` and post AUCTION; collect `BID`s into `bid()`; on the `auction_closed` event pick earliest-ready then priority and `award()`. Vetting: a request from a handle not in the roster → post VERIFY to the broker, act on its answer, never call the actor
- Watch the actor websocket for events with `seq` greater than the last seen: `noshow`, `detention`, `auction_closed`, `thread_expired`, `empty` come from alarms, not from your calls

### 12:30 to 1:00 · eight persona agents

- `relay/agents.ts`: loop over personas, `relay.workspace.register({ name, type: 'agent' })`, one listener per agent for `#pier9` messages that mention it or sit in a thread it's part of
- Every agent gets the same structured output: `{ verb: "accept" | "counter" | "decline" | "SWAP?" | "COUNTER" | "AGREE" | "SETTLE" | "BID" | "VERIFY" | "silent", args, text }`, 8-second timeout, fallback `accept` or `silent`. The prompt carries the persona's value of time, its budget, and the thread so far
- Hard rules in code, not in the prompt: two messages per agent per thread, then forced `silent`; only the agent that made the last concession posts the `SETTLE`; budgets are enforced before the LLM is asked (an offer above budget is auto-declined)
- The unknown carrier is the eighth agent: a persona with no load, who requests a slot once at the scripted moment

### 1:20 to 2:30 · scenario runner, end to end

- `relay/scenario.ts`: seeds Pier 9 with 12 trucks, then waits for keypresses 1 to 10, each injecting one event through the dispatcher. Print what each key will do before you press it, and print "waiting for alarm" with a countdown for the alarm rows
- Swap in `TerseDock`; run the whole cascade against the deployed actor with A's dashboard open. Fix the grammar, fix the parsing, fix the timing
- Write `demo/pitch.md` (below) and the Devpost text while runs are happening

### Personas [prose, can be drafted before 11:00]

| Agent                     | Handle      | Trucks               | Values an hour at                        | Persona rule, one line each                                                                                                                                                                                  |
|---------------------------|-------------|----------------------|------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Carrier A, the pusher     | `carrier-a` | T1, T4               | $120 · pays up to $150 to move earlier | Always wants the earliest slot; opens a SWAP with whoever holds it; never yields to anyone; bids on every auction.                                                                                           |
| Carrier B, cooperative    | `carrier-b` | T2, T6, T9, T12      | $60 · will move later for cash          | Accepts anything within two hours; when offered money to move, counters once for 20% more, then agrees.                                                                                                      |
| Carrier C, reefer         | `carrier-c` | T5, T10              | $200 · budget $250 per deal            | Refuses any dry door outright; opens a SWAP for the earliest reefer slot and pays for it; mentions the cold chain every time.                                                                                |
| Carrier D, owner-operator | `carrier-d` | T8 · hours end 15:30 | $90 · no side payments, cash-poor       | Bids on auctions it can reach; if a slot ends after 15:30, declines and asks the warehouse for tomorrow 08:00.                                                                                               |
| Broker                    | `broker`    | T3, T7               | $100 · trades, never pays               | Yields for a hot load only if the warehouse waives T3's detention and someone hands it a later slot; verifies carriers against its tender list (L12 → carrier-b only); offers a backhaul to any empty truck. |
| Shipper                   | `shipper`   | T11, hot load L17    | $300 to get 11:00                       | Asks the thread who can yield, accepts the broker's package, posts the SETTLE, thanks everyone by name.                                                                                                      |
| Warehouse                 | `pier9-ops` | owns the doors       | arbiter                                  | Approves claims and waivers under $200, disputes above; refuses any carrier the broker won't vouch for; books tomorrow slots on request; announces door changes.                                            |
| Unknown carrier           | `carrier-x` | claims L12           | fraud                                    | Requests door 2 at 11:00 for load L12 once, at the scripted moment; argues once when refused, then goes quiet.                                                                                               |

## The scenario · three acts, keys 1 to 10

Sim clock at 60x: 1 real second = 1 sim minute, so five real minutes is 08:00 to 13:00 on the board. Seed at 08:00 with 12 trucks booked across 6 doors from 08:00 to 13:00. Rows marked [alarm] need no key: the runner prints "waiting for alarm" and you keep your hands off. Every alarm row has a manual fallback on the same key number in case it hasn't fired by the expected second.

### Act 1 · The dock holds the line [08:00 to 08:45 · ~50s]

| Key | Sim   | Injects                                                                         | Agents      | What should happen on screen                                                                                                                                                                                                                               |
|-----|-------|---------------------------------------------------------------------------------|-------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1   | 08:05 | Two `request()`s for door 4 at 14:00 in the same tick (Carrier A and Carrier B) | A ↔ B, swap | One books, the other gets 15:00. `collision` in the feed. Then Carrier A opens a thread with Carrier B directly: "SWAP? I pay $120 for 14:00." B counters $150, A agrees, A posts SETTLE, the actor swaps two Gantt blocks at once, side payments $150. |
| 2   | 08:30 | `arrive(T3)`, the broker's truck                                                | none        | The detention clock for T3 starts quietly. It will fire at 10:30 on its own, in act 3.                                                                                                                                                                     |

### Act 2 · The cascade [09:00 to 10:00 · ~120s]

| Key | Sim   | Injects                                                                               | Agents               | What should happen on screen                                                                                                                                                                                                                                                                     |
|-----|-------|---------------------------------------------------------------------------------------|----------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 3   | 09:00 | `reportEta(T1, +90)` and `reportEta(T4, +90)`: both Carrier A trucks stuck in traffic | B, D, C → auction    | Two slots free at once. The dispatcher posts AUCTION a3 (door 2, 09:00) and a4 (door 1, 10:00). Carrier B bids T6 ready 08:50, Carrier D bids T8 ready 09:10, Carrier C passes (dry doors). The `auction_close` alarm fires at 09:10; the actor awards a3 to T6 and a4 to T8. Two blocks appear. |
| 4   | 09:20 | `setDoor(3, closed)`                                                                  | C ↔ B, two rounds    | Reefer T5 displaced to door 6 at 16:00. The OFFER names the holder of door 5 at 14:00 (Carrier B, T9). Carrier C opens the thread: "SWAP? we cover $150". B: "COUNTER $200". C: "AGREE $200, cold chain." C posts SETTLE; the actor swaps; side payments $350.                               |
| 5   | 09:40 | Carrier X requests door 2 at 11:00 for load L12                                       | X, broker, warehouse | The dispatcher never calls the actor. It posts VERIFY to the broker; broker: "no, L12 is tendered to carrier-b only"; pier9-ops: "refused". X argues once, goes quiet. `refused` in the feed. Agents policing trust.                                                                             |
| 6   | 09:50 | `overrun(T6, +45)`: paperwork at the door                                             | B, A → deadline      | Two trucks behind T6 get offers. Carrier B accepts. Carrier A opens a SWAP with nobody willing; the thread goes quiet; the `thread_deadline` alarm fires at 10:00 and the dispatcher accepts A's standing offer. "If the agents don't agree, the clock decides."                                 |

### Act 3 · The hot load [10:15 to 12:00 · ~100s]

| Key       | Sim   | Injects                                              | Agents                        | What should happen on screen                                                                                                                                                                                                                                                                                                                                                |
|-----------|-------|------------------------------------------------------|-------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 7         | 10:15 | `prioritize(T11)`, the shipper's hot load L17        | shipper, broker, B, warehouse | Broker's T7 is bumped from 11:00. Shipper: "who can yield 11:00?" Broker: "I yield T7 if pier9-ops waives T3's detention and someone gives me 12:00." Carrier B: "take my 12:00 for $80." pier9-ops: "waiver approved." Shipper posts the SETTLE with all three parts; the actor runs `swap`, `pay`, and records the waiver as pending. Four agents, one thread, no human. |
| [alarm] | 10:30 | Nothing. The detention alarm for T3 fires on its own | none                          | `detention` event, claim filed for $150, the pending waiver applies, claim shows `waived`. Say nothing; let the room notice the clock did it.                                                                                                                                                                                                                              |
| [alarm] | 11:00 | Nothing. Arrival check for T12 fires: no-show        | A, D → auction                | `noshow`, slot released, AUCTION a5 posted, Carrier A and Carrier D bid, alarm closes it, award. The second auction of the day, this time with no key pressed anywhere.                                                                                                                                                                                                     |
| 8         | 11:20 | Consequence of act 2: T8's new slot ends after 15:30 | D, warehouse                  | `tomorrow` event; owner-operator asks pier9-ops for 08:00 tomorrow; pier9-ops books it. Realism freight people respect.                                                                                                                                                                                                                                                     |
| 9         | 11:40 | `done(T9)`                                           | broker ↔ B                    | `empty` event; broker offers a backhaul to Carrier B; B accepts; `backhauls++`.                                                                                                                                                                                                                                                                                             |
| 10        | 12:00 | Nothing; freeze the clock                            | none                          | Counters on screen: detention avoided, side payments, moves, phone calls 0. End.                                                                                                                                                                                                                                                                                            |

Counting on stage: eight agents, five negotiations (two swaps, one coalition, one vetting, one deadline), three auctions, four alarms firing on their own, nine exceptions, zero prompts typed. Keys 6, 8 and 9 are the cuts if time runs over.

## Integration · 2:30 to 3:15, both at laptop 1

- [ ] Run 1, no narration, fix whatever breaks. Expect the grammar and the timer offsets to need adjusting
- [ ] Run 2, with narration and a stopwatch. Target 5:00 total; drop keys 6, 8 and 9 if it runs past 5:30, and never let a thread run past two rounds
- [ ] Run 3, clean, and record it: this is the backup video and the Devpost video
- [ ] Decide the Carrier A question: real Claude Code on laptop 1 only if it worked in every run
- [ ] Freeze the code. Anything after 3:15 is README, video, Devpost, and the pitch

## Cut list · in order, if behind at 1:20

1.  Freestyle deploy and the replay slider: run the dashboard locally on the projector
2.  Real Claude Code as Carrier A: all agents SDK
3.  Backhaul (key 9) and owner-operator hours (key 8): chatter plus a counter, and one field
4.  Overrun and the deadline beat (key 6): drop `overrun()`; keep `thread_deadline` in the actor because it's the stall insurance anyway
5.  Vetting (key 5): one persona and one VERIFY handler; cut if the dispatcher is late
6.  The coalition's three-way trade (key 7): keep `prioritize()` and the waiver, drop Carrier B's $80 leg
7.  Auctions: replace with plain offers to the first queued truck. This is the last cut, because the alarm-closes-the-auction beat is the best Durable Actors moment on the list

Never cut: the collision and swap (key 1), the door-down two-round swap (key 4), the detention alarm firing on its own, and the chatter feed. Those four are the judging rubric in visible form: serialized state, agents negotiating, the actor waking itself, and the room seeing all of it.

## Demo and pitch · 5 minutes on stage

[B] drives the runner on laptop 2 and watches the feed. [A] narrates from laptop 1 with the dashboard on the projector. Nobody types a prompt. The narration is short on purpose: the feed is the show, and the best moments are the ones where A says nothing.

1.  **Open <span class="small">· 20s</span>**<span class="say">"A truck needs a time at a warehouse door. Today that's a phone call, and when something goes wrong it's six phone calls. This is Pier 9 Cold Storage: six doors, twelve trucks, and eight companies whose agents are all on Agent Relay. We won't touch the keyboard except to break things."</span> Key 1.
2.  **Act 1 · the collision and the first deal <span class="small">· 40s</span>**<span class="say">"Two carriers just asked for door 4 at two o'clock in the same instant. The dock is a Durable Actor, one request at a time, so this can't double-book. One got it, one got three o'clock. Now watch: the one who lost is going straight to the winner with cash."</span> Wait for the SETTLE. <span class="say">"$150 changed hands, the actor swapped them atomically, and we weren't asked."</span> Key 2 silently.
3.  **Act 2 · the cascade <span class="small">· 120s</span>**Key 3. <span class="say">"Traffic. Two slots just opened at once, so the dock put them up for auction."</span> Say nothing until the alarm closes it. <span class="say">"That close was an alarm inside the actor, not a human."</span> Key 4. <span class="say">"Door 3 is out. The reefer truck can't use a dry door; its agent knows exactly who holds the slot it needs."</span> Two rounds, then SETTLE. Key 5. <span class="say">"An unknown carrier wants a door. The warehouse asks the broker. Refused, and the dock never heard about it."</span> Key 6, then let the deadline fire. <span class="say">"Those two couldn't agree, so the clock decided."</span>
4.  **Act 3 · the hot load <span class="small">· 80s</span>**Key 7. <span class="say">"The shipper needs this load today. Four agents, one thread: the broker will yield, but only for a detention waiver and someone's noon slot. Watch the warehouse sign off."</span> As the detention alarm fires at 10:30: <span class="say">"And that alarm fired on its own for the truck everyone forgot. The claim landed and the waiver from the deal applied itself."</span> Let the no-show auction run without comment.
5.  **Close <span class="small">· 40s</span>**Keys 8 to 10 as time allows. Point at the counters. <span class="say">"Nine exceptions, five negotiations, three auctions, four alarms, zero phone calls. Every scarce thing in freight, a door, a load, a container, is a Durable Actor; every company is an agent on Relay; every clock is an alarm. We built the receiver's dock today. The broker's desk is next."</span>

Questions judges will ask, with the answer ready: **Why an actor and not Postgres?** One request at a time is the double-booking guarantee and the reason two conflicting settlements can't both land; alarms fire while nobody is connected; the websocket is the projector. **Why Relay and not a webhook?** The carriers don't run our software; their agents already have an address, and the negotiations happen between them, not through us. **What stops agents from colluding or stalling?** Budgets enforced in code, two messages per thread, and a deadline timer in the actor. **Who pays?** The warehouse, per door per month; it's the party eating detention claims today.

## Submission checklist · 3:35 to 3:55 [B]

- [ ] Devpost title "Dockside", tagline "Dock appointments that re-plan themselves, agent to agent"
- [ ] Built with: Durable Actors (Terse), Agent Relay SDK, OpenAI gpt-5-mini, Bun, React, Freestyle (if deployed)
- [ ] Repo link, README with the architecture diagram from this page and a 10-line run guide
- [ ] Video: run 3 from integration, trimmed to under 3 minutes, uploaded unlisted
- [ ] Description answers the rubric by name: where the actor serializes, where alarms fire, where agents message each other, which parts use both
- [ ] Submit by 3:55, not 4:00
