# Dockside

Dock appointments that re-plan themselves, agent to agent.

A warehouse's dock is a [Durable Actor](https://github.com/TerseAI/durable-actors) (one request at a time, its own SQLite, alarms); every carrier, broker and shipper is an agent on [Agent Relay](https://agentrelay.com); every clock with money on it (detention, no-shows, auctions, negotiation deadlines) is an alarm. Built at Haunted Hacks, YC San Francisco, Oct 31 2026.

- **[docs/CONTEXT.md](docs/CONTEXT.md)**: start here if you're new. The freight words, the tech words, and how the pieces fit, in plain language.
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

## Workspace records

This repository is also the project record for `dockside` in Xueming's personal agent workspace.

- [Current understanding](brief.md), [decisions](decisions.md) and [agent instructions](AGENTS.md).
- `journal/` holds immutable source records; the [original request](journal/2026-10/cap_baf32724-7d80-4539-baf0-64d272450b90.md) is the linked copy of the Personal Workspace capture.
- Lark project group: **Dockside** (`oc_7ace179430b101be62241f34b1b98de1`), topic mode. Start a topic there to work on Dockside with the workspace agents; the originating Personal Workspace topic keeps its own binding.
- Local checkout on the Mac mini: `/Users/xuemingxu/workspace/projects/dockside`.

Keep the Terse token, the Agent Relay workspace key and the OpenAI key in ignored `.env` files, never in Git.
