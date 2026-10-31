# Dockside

**Dock appointments that re-plan themselves, agent to agent**

Video: <VIDEO_URL>
Repo: https://github.com/xueming-Felix/dockside

## Inspiration

A truck needs a time at a warehouse door. Today that's a phone call. When something goes wrong, a truck stuck in traffic, a door out of service, a hot load, it's six phone calls. Every hour a driver waits past the free time is a detention claim, and the warehouse is the party eating those claims.

The doors are the scarce thing. Every company that wants one already has its own interests and its own idea of what an hour is worth. We wanted the dock to hold the schedule and let the companies' agents work out the trades between themselves.

## What it does

Dockside runs one warehouse-day at Pier 9 Cold Storage: six doors (1 to 4 dry, 5 and 6 reefer), 08:00 to 18:00, twelve trucks, detention at $75 an hour after two free hours. The clock runs at 60x, so one real second is one sim minute.

Eight companies are represented by agents on Agent Relay: four carriers, a broker, a shipper, the warehouse, and one unknown carrier. When something breaks, the dock re-plans and sends offers. The agents then negotiate with each other in threads: they swap slots for cash, bid on freed slots, build a three-way trade around a hot load, check whether a stranger is who it says it is, and, if nobody agrees, let the clock decide.

A dashboard on the projector shows the doors as a Gantt chart, the full agent chatter, the sim clock with the next timers, and counters for detention avoided, side payments, moves, backhauls, and phone calls (always zero).

The demo is three acts driven by ten buttons on the dashboard itself; the presenter clicks to break things and the board reacts. On stage: eight agents, five negotiations, three auctions, six alarms firing on their own, ten exceptions, zero prompts typed.

## How we built it

Three parts, one shared types file between them.

- **The Dock actor** (Durable Actors on Terse). One actor holds the whole warehouse-day: doors, trucks, appointments, offers, auctions, threads, claims, chatter, events. It replans, validates every settlement, and runs every timer. It never talks to Relay.
- **The dispatcher** (Bun, Agent Relay SDK). The bridge. It calls the actor through the generated client, watches the actor's websocket for new events, and does all Relay sends and receives. It posts OFFER, AUCTION, and VERIFY lines to `#pier9`, mirrors every message into the actor with `say()`, and acts on only a handful of line types.
- **Eight persona agents** (Agent Relay SDK, OpenAI gpt-5-mini). Each is registered on Relay and answers through a persona prompt with structured output. Hard rules live in code, not in the prompt: budgets are checked before the model is asked, two messages per agent per thread, and only the agent that made the last concession posts the SETTLE.
- **The dashboard** (Vite + React, a Bun grant server). One page on the projector, rendered straight from the actor's snapshot over a websocket: Gantt, chatter feed, clock with the next alarms, counters, a replay slider, and the ten stage buttons. The grant server also hosts the stage driver that plays the dispatcher's part when the Relay agents are not running.

The replan is kept simple on purpose. Trucks already at the door never move, and a truck keeps any slot that still works, so unaffected trucks never churn. Hot loads and counter-offers preempt; displaced trucks fill gaps by priority, then ETA, on the earliest open hour slot of the right door type. Every changed appointment becomes an offer to its carrier. 24 unit tests cover the three acts; a scenario script replays the whole day against the deployed actor and checks that every alarm fires by itself.

## How it answers the rubric

### Where the actor serializes

There is one Dock actor, `pier9-2026-10-31`, for the whole warehouse-day. It handles one request at a time. That makes double-booking impossible: when two carriers ask for door 4 at 14:00 in the same instant, one books and the other gets an offer for 15:00. It also decides between agents. Every SETTLE is validated by calling the actor in order (`swap`, then `pay`, then `resolveClaim`). If two agents settle conflicting deals in the same second, one is accepted and the other gets `REJECTED` with the actor's reason. `swap()` is atomic: the second of two conflicting swaps fails.

### Where alarms fire

The actor has one alarm and a timer table behind it. Setting the alarm again replaces it, so the actor keeps a list of timers, always sets the alarm to the earliest unfired one, and drains every due timer when it wakes. Four timer kinds:

- `arrival_check`: a truck that hasn't arrived 30 minutes after its start is a no-show; the slot is released and auctioned.
- `detention`: two hours after arrival, a detention event and an automatic claim.
- `auction_close`: ends an auction; the dispatcher awards the slot.
- `thread_deadline`: ends a negotiation that went quiet; the dispatcher accepts the standing offer.

These fire while nobody is connected: we seeded a test actor on Terse Cloud, disconnected everything, and came back to find it had woken itself five times on schedule. In the demo, three auction closes, the thread deadline, the detention claim, and the no-show all happen with no button pressed, each within about 100 ms of its due sim minute.

### Where agents message each other

Eight persona agents talk in `#pier9`, one thread per offer or auction:

- **Swap:** two carriers trade slots for cash, up to two rounds.
- **Auction:** a freed slot is posted and every carrier may bid once.
- **Coalition:** shipper, broker, a carrier, and the warehouse build a three-way trade around a hot load.
- **Vetting:** an unknown carrier asks for a door; the broker says the load isn't theirs and the warehouse refuses. The request never reaches the actor.
- **Deadline:** a thread that goes quiet is closed by the clock.

The dispatcher only listens. It mirrors every line and acts on just six: `SETTLE`, `BID`, `VERIFY`, and plain `accept`, `counter`, `decline`.

### Which parts use both

- **Auctions:** agents bid over Relay; an `auction_close` alarm in the actor ends the auction; the dispatcher reads the bids and the actor records the award.
- **Negotiation threads:** agents bargain over Relay; the actor holds a `thread_deadline` timer for each thread, so if the agents don't agree, the clock decides.
- **The coalition and the detention alarm:** the agents agree to a detention waiver in a thread; later the `detention` alarm fires on its own, the claim is filed, and the waiver from the deal applies.
- **The no-show:** an `arrival_check` alarm releases the slot and opens the auction itself, so the agents can bid even if the dispatcher is asleep.
- **Every settlement:** agents agree on Relay; the actor serializes and validates the result.

## Challenges

- **One alarm per actor.** Terse gives each actor one alarm, and setting it again replaces it. We needed four kinds of timers, so the actor keeps a timer table and always arms the alarm for the earliest one.
- **One actor or many.** Door-down and hot-load replans cross doors, and actor-to-actor calls aren't documented. We chose one actor for the whole warehouse-day, which keeps "one scarce shared thing, one request at a time."
- **Persisted state and strict JSON.** In-place array changes don't save, so every collection is reassigned on change; results and broadcasts must be strict JSON, and every method on the actor must be async, private helpers included.
- **Agents that stall.** Language models can talk forever. We capped each agent at two messages per thread, enforced budgets in code, and gave every thread a 10 sim-minute deadline in the actor.
- **Keeping the actor clean.** The actor knows nothing about Relay. The dispatcher is the only bridge, so the actor stays state, replan, and alarms.

## Accomplishments that we're proud of

- The agents negotiate with each other, not through us. The dispatcher only listens and acts on the outcome.
- The actor is the referee. Conflicting settlements can't both land.
- Six alarms fire on their own during the demo, and the room can watch each one count down on the clock panel before it fires.
- The whole run is eight agents, five negotiations, three auctions, six alarms firing on their own, ten exceptions, zero prompts typed.

## What we learned

- A single serialized actor is a simple answer to double-booking. No locks, no transactions to reason about.
- One alarm plus a timer table is enough for a day full of clocks.
- Agent negotiation needs hard limits in code. Prompts set the personality; code sets the budget, the message count, and the deadline.
- Splitting the work at one frozen types file, with a mock actor on one side, let two people build in parallel without blocking each other; the two halves met on the deployed actor in the last hour.

## What's next

We built the receiver's dock. The broker's desk is next. Every scarce thing in freight, a door, a load, a container, can be a Durable Actor; every company can be an agent on Relay; every clock can be an alarm. The warehouse would pay per door per month, since it's the party eating detention claims today.

## Built with

- Durable Actors (Terse)
- Agent Relay SDK
- OpenAI gpt-5-mini
- Bun
- React
- Vite
