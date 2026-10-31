# Dockside · talking points

One line: **Dock appointments that re-plan themselves, agent to agent.** The dock is a Durable Actor on Terse; every company is an agent on Agent Relay; every clock with money on it is an alarm.

## Opening (20 s)

"A truck needs a time at a warehouse door. Today that's a phone call, and when something goes wrong it's six phone calls. This is Pier 9 Cold Storage: six doors, twelve trucks, eight companies. The dock itself is a Durable Actor on Terse. Every company is an agent on Agent Relay. We won't touch the keyboard except to break things."

## The problem (30 s)

- Dock slots are booked by phone and email between companies that don't share software. So slots get double-booked, one late truck cascades through the whole day, and drivers sit waiting while the meter runs.
- The meter is detention: two free hours, then $75 an hour. The warehouse is the party eating those claims.
- Nobody has the whole picture, and the only coordination tool is a human on the phone re-planning the day by hand. Every company has its own idea of what an hour is worth, and nothing lets them trade on it.

## How we use Terse (40 s)

- The whole warehouse-day is **one actor**, `pier9-2026-10-31`, deployed on Terse Cloud. It owns the truth: doors, trucks, appointments, offers, auctions, threads, claims, chatter, events.
- **One request at a time.** Two carriers ask for door 4 at 14:00 in the same instant: one books, the other gets an offer for 15:00. No locks, no transactions; double-booking is impossible by construction. Same for conflicting settlements: one lands, the other comes back REJECTED with the reason.
- **Alarms.** Every clock with money on it is a timer inside the actor: the arrival check (no-show 30 minutes in), detention (two hours after arrival), the auction close, the negotiation deadline. Terse gives one alarm per actor, so we keep a timer table and always arm the alarm for the earliest one. They fire while nobody is connected: we left a test actor alone this afternoon and it woke itself five times on schedule.
- **replan() lives inside the actor.** A door fails, an ETA slips, a hot load lands: the actor re-plans in one call, and unaffected trucks never move.
- **The websocket is the projector.** The dashboard is just the actor's latest snapshot; every change slides a block on the Gantt.

## How we use Agent Relay (40 s)

- Every company is a **persona agent registered on Relay** with the Agent Relay SDK: four carriers, a broker, a shipper, the warehouse, and one unknown carrier. They all talk in one channel, `#pier9`, one thread per offer or auction.
- **The dock is not in the conversation.** A thin dispatcher bridges the two: it posts the actor's offers and auctions into the channel, listens, and acts on only six line types: SETTLE, BID, VERIFY, accept, counter, decline.
- **The agents negotiate with each other, not through us.** The carrier that lost a slot goes straight to the winner with cash: SWAP? $120, COUNTER $150, AGREE. Then one SETTLE line, and the dispatcher asks the actor to make it real.
- **Hard limits live in code, not in prompts:** budgets are checked before the model answers, two messages per agent per thread, only the agent that made the last concession may SETTLE, and every thread has a deadline timer in the actor. If they don't agree, the clock decides.

## Why these two, and not a database plus webhooks (30 s)

### What's good about Terse

- Serialization is the product. "One request at a time" is both the double-booking guarantee and the referee between agents. Nothing to lock, nothing to retry.
- Alarms that survive sleep. A cron job somewhere else drifts or dies; the actor's alarm fires with nothing connected, and the timer is stored next to the state it acts on.
- State, planning and clock in one place. The actor is state plus replan plus alarms; nothing else has to be kept consistent with it. The bridge holds no state, so restarting it loses nothing.
- Live broadcast for free: every change reaches the screen over the actor's own websocket.

### What's good about Agent Relay

- The carriers don't run our software and never will. On Relay their agents already have an address, so there is nobody to integrate.
- Negotiation is peer to peer, in a channel we can watch. The feed on the screen is the audit log; when it's scrolling and nobody on stage is talking, that's the point.
- One channel carries every pattern: a two-party swap, a many-party auction, a four-party coalition around a hot load, vetting an unknown carrier. One small message grammar handles all of them.
- The bridge stays thin. The dispatcher posts, listens and relays settlements; it never negotiates and never decides.

## Close (20 s)

"Every scarce thing in freight, a door, a load, a container, can be a Durable Actor; every company can be an agent on Relay; every clock can be an alarm. Today the dock held the schedule, the agents made the deals, and nobody picked up a phone. We built the receiver's dock. The broker's desk is next."

## If a judge asks

- **Why an actor and not Postgres?** One request at a time means no double booking and no conflicting settlements; alarms fire while nobody is connected; the websocket is the projector.
- **Why Relay and not a webhook?** The carriers don't run our software. Their agents already have an address, and the deals happen between them, not through us.
- **What stops the agents stalling or colluding?** Budgets enforced in code, two messages per agent per thread, and the deadline alarm: if they don't agree, the clock decides.
- **Who pays?** The warehouse, per door per month. It's the party eating detention today.
- **Is the chatter live LLM negotiation?** Be precise here. The actor, the re-plans, the settlements and the alarm in scene 3 run live against Terse Cloud. In story mode the agents' lines are played by our stage driver so the demo is deterministic. The Relay stack (SDK agents, dispatcher, gpt-5-mini personas, with its own tests) is built and merged, but we did not run the live Relay bus before submission. Say "the negotiation protocol" or "the agents' lines", not "live Relay traffic".
