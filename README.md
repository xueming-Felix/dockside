# Dockside

Dock appointments that re-plan themselves, agent to agent.

A warehouse's dock is a [Durable Actor](https://github.com/TerseAI/durable-actors) (one request at a time, its own SQLite, alarms); every carrier, broker and shipper is an agent on [Agent Relay](https://agentrelay.com); every clock with money on it (detention, no-shows, auctions, negotiation deadlines) is an alarm. Built at Haunted Hacks, YC San Francisco, Oct 31 2026.

- **[PLAN.md](PLAN.md)**: the execution plan, interface contract, personas, scenario and pitch.
- **[docs/plan.html](docs/plan.html)**: the same plan as a page with the diagrams in place (open locally).

## Layout

| Folder | Owner | What lives here |
|---|---|---|
| `shared/` | both, frozen at 11:20 | `types.ts`: Snapshot, Event, Offer, the actor's method list |
| `actor/` | Person A | the `Dock` actor (Terse), `replan()`, timers, `scripts/drive.ts` |
| `dashboard/` | Person A | Vite + React page on the actor's websocket: Gantt, chatter feed, clock, counters |
| `relay/` | Person B | dispatcher, persona agents on the Relay SDK, scenario runner, `MockDock` / `TerseDock` |
| `docs/` | both | this plan, diagrams, pitch |
