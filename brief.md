# Dockside — current understanding

## User direction

On 2026-10-31, Xueming asked to initialize a new hackathon project with a new repository, folder and Lark group, naming the repository `git@github.com:xueming-Felix/dockside.git`. [Original request](journal/2026-10/cap_baf32724-7d80-4539-baf0-64d272450b90.md), promoted from Personal Workspace capture `cap_8064a978-5aae-4dc3-a449-d5b3e8e6bc0f`.

## What the repository holds

The owner created the repository and pushed commit `ea25a39` ("Add the Dockside build plan, diagrams and README") before the request. [PLAN.md](PLAN.md) is the two-person team plan for Haunted Hacks (YC San Francisco, 2026-10-31, hacking 11:00 to 16:00); [docs/plan.html](docs/plan.html) renders it with the diagrams in place.

Dockside is "dock appointments that re-plan themselves, agent to agent". Pier 9 Cold Storage, a warehouse with six doors (four dry, two reefer), is one Durable Actor on Terse (`pier9:2026-10-31`): one request at a time, persisted state, a simulated clock at 60x behind a single alarm and a timer table (arrival checks, detention, auction close, thread deadlines). Carriers, a broker, a shipper, the warehouse and one unknown carrier are agents on Agent Relay, eight personas driven by gpt-5-mini, negotiating offers, swaps, auctions, coalitions and vetting in a `#pier9` channel. A dispatcher process bridges the actor and Relay and acts only on `SETTLE`, `BID`, `VERIFY` and accept/counter/decline lines. Person A owns `actor/` and `dashboard/` (Gantt, chatter feed, clock, counters); Person B owns `relay/` (dispatcher, persona agents, scenario runner); `shared/types.ts` is the contract frozen at 11:20. The plan fixes six team decisions, a three-act demo scenario driven by keys 1 to 10, a cut list, the pitch and the Devpost checklist.

At initialization the repository contains the plan, README and diagrams only; the `shared/`, `actor/`, `dashboard/` and `relay/` folders named in the README are planned, not yet present. Nothing here claims running code.

## Workspace status

Project `dockside` is registered at `/Users/xuemingxu/workspace/projects/dockside`, linked to the existing private repository, with Lark topic group **Dockside** (`oc_7ace179430b101be62241f34b1b98de1`). Lark readback confirmed topic mode, the owner as member and the Codex bot (Felix) present; its Workspace binding and Botmux working-directory binding point new topics in that group at this folder. Felix-Claude (the Claude Code bot) is not in the group yet because Lark does not let one app add another bot: the owner adds "Felix-Claude" in the group's Bots settings, then runs `node scripts/add-bot.mjs cli_aa52cde0b578c08b claude-code` from the platform folder to mirror the binding. [Setup receipt](journal/2026-10/cap_9dd3bc10-281b-4e9e-9120-bfba30878d18.md).

## Open items

The request did not say what the workspace agents should do during the hackathon; no task, schedule or spending was created. Credentials named in the plan (Terse API token, Agent Relay workspace key, OpenAI key) belong in ignored `.env` files, never in Git.
