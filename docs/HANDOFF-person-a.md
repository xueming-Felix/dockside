# Handoff: Person A finishes the Dock actor and dashboard

Person B's half (`relay/`, `shared/types.ts`, `demo/`) is in PR #1: https://github.com/xueming-Felix/dockside/pull/1 (branch `person-b/relay`). Person A's half (`actor/`, `dashboard/`) has not been started. The spec is [PLAN.md](../PLAN.md), sections "[Person A] Actor & board" and "replan(), kept deliberately dumb". This file only records what the plan doesn't say and what relay/ now depends on.

## Read first

- [PLAN.md](../PLAN.md): contract, actor method table, timers, dashboard panels, scenario keys 1-10.
- [shared/types.ts](../shared/types.ts): the frozen contract, copied verbatim from PLAN.
- [relay/dock.ts](../relay/dock.ts): `DockClient` is the exact interface the dispatcher calls. Your actor's public methods must match these names and positional parameters.
- [relay/mockDock.ts](../relay/mockDock.ts): a working in-memory reference implementation of every actor method: replan, collision, swap, counter, overrun, auctions, threads, timers, and the single alarm plus timer table. It passes the full scenario. Port its semantics; you don't need to reinvent them.
- [relay/scenario.ts](../relay/scenario.ts): the seed (12 trucks, 6 doors) and keys 1-10. The comment block at the top lists 11 deviations from PLAN's numbers that the seed relies on (for example T5 seeded on dry door 3 at 16:00, T12 at 10:30 so its arrival check fires at 11:00, and detention filing the full $150).

## Changes the actor must follow (found during B's work)

1. **Actor ID: use `pier9-2026-10-31`, not `pier9:2026-10-31`.** durable-actors rejects `:` in IDs: only letters, digits, `.`, `-` and `_` are allowed, and the client throws `ActorValidationError` before any network call. `relay/.env.example` and `TerseDock` already use the dash form.
2. **Contract gaps.** relay/ calls these; each is marked `CONTRACT GAP` in `relay/dock.ts`:
   - `say(from, to, text, thread?)`: store `thread` on the `Chat` row (it's already an optional field in `Chat`). The dispatcher passes the Relay thread root id so the feed can indent replies.
   - `backhaul(truckId)`: increments `counters.backhauls` (key 9). Optional: TerseDock logs and skips it if the method is missing.
   - `setSpeed(speed)`: `0` freezes the sim clock (key 10). Optional in the same way.
   - There is no actor method for tomorrow bookings; pier9-ops only answers in chatter. Leave it that way unless you want a record.
3. **`seed(scenario)` input shape** is `SeedSpec` in `relay/dock.ts`: `{ doors, trucks, appts: (Appt & { arrivalCheck?: boolean })[], speed? }`. Schedule an `arrival_check` timer (start + 30) only for appointments with `arrivalCheck: true`.
4. **Thread ids.** The dispatcher calls `openThread("th-" + offerId, offerId, deadlineMin)` and `settleThread("th-" + offerId)`. The `thread_expired` event must carry `offerId` and `threadId`.
5. **What the dispatcher reads from snapshot events.** It processes events with `seq` greater than the last one it saw, and relies on these fields:
   - `noshow`: `truckId`, and that appointment's `status` is `"noshow"`. The dispatcher opens the auction itself.
   - `detention`: `truckId`. Auto-`fileClaim` in the actor, then the dispatcher may `resolveClaim(truck, "waived")` for a pending waiver.
   - `auction_closed`: `auctionId`, with the auction's `bids` filled in. The dispatcher picks the winner and calls `award()`.
   - `thread_expired`: `offerId`. The dispatcher `accept()`s the standing offer if it's still `open`.
   - `empty`: `truckId`, and the appointment's `status` is `"done"`.
   - `tomorrow`: `truckId`, and the appointment's `status` is `"tomorrow"`.
   - `overrun`: the `detail` string must contain `+<minutes>`, for example `T6 overrun +45`. The dispatcher parses it to compute stretched coverage.
6. **Broadcast raw `Snapshot` JSON** on `onConnect` and after every mutation and every alarm. TerseDock drops frames that have a `type` field or lack `simMin` or `events`, so don't mark fields `@Emittable` (the runtime then adds `{type:"state"}` frames), or accept that they'll be ignored.
7. **`swap()` with several appointments per truck.** Trucks can hold more than one booked appointment (T2 and T9 in the seed). MockDock picks the booked slot closest below the other truck's slot. Match that or adjust the seed.

## Runtime and tooling facts

- **The durable-actors runtime doesn't run on native Windows** (`No prebuilt runtime for win32/x64`). Use WSL 2 Ubuntu (installed on Person B's laptop, but stopped) or Terse Cloud. It needs Bun 1.4.2 or newer; Windows Bun is 1.3.12, which is fine for relay/.
- **Generate the client into relay/:** `bun node_modules/durable-actors/bin/durable-actors.js generate src/actors.ts --out-dir <repo>/relay/generated`. On Windows, call the CLI through `bun …js` because the bin uses a `#!/usr/bin/env bun` shebang. `relay/generated/` is gitignored, and TerseDock imports it lazily.
- **Environment variables the generated client reads:**
  - `DURABLE_ACTORS_CONTROL_PLANE_URL`: local dev is `http://127.0.0.1:7111`; the client defaults to 7100 if unset.
  - `DURABLE_ACTORS_PROJECT_ID`: required for any non-local URL.
  - `DURABLE_ACTORS_SECRET`: the Bearer token for Terse Cloud.
- **The generated stub** has methods shaped `async (...args) =>`, so `.length` is 0. Missing methods are `undefined`, so optional-method checks work.
- **Smoke harness:** [relay/terse-smoke/](../relay/terse-smoke/) has a minimal `Dock` actor (`src/actors.ts`, pinned `durable-actors@0.11.0`) and `check.ts`, which drives `TerseDock` against it. `wsl-sync.sh` mirrors it into WSL. **It has never run live**; the generated client was only inspected offline. Running it in WSL is the fastest way to prove the websocket and `say` thread path before wiring the real actor.

## Integrating with relay/

1. Deploy the actor, or run it locally in WSL, then generate the client into `relay/generated/`.
2. In `relay/.env` (gitignored; it already holds the OpenAI key and an `rk_live_` Relay workspace key from a fresh SDK workspace), set `DOCK=terse`, `DOCK_ACTOR_ID=pier9-2026-10-31` and the `DURABLE_ACTORS_*` variables above.
3. `cd relay && bun scenario.ts` (keypress mode) or `bun scenario.ts --auto`. Add `BUS=relay BRAIN=llm` for the real demo path.
4. Regression baseline: `BUS=local DOCK=mock BRAIN=rules bun scenario.ts --auto` hits every beat (side payments $430, backhauls 1, phone calls 0). Run the same with `DOCK=terse` and diff the transcripts in `relay/runs/` (gitignored).

## Open items on B's side (not blocking A)

- **The fix for losing beats over Relay is committed but has never been run live.** On real Relay, each agent-to-agent hop took 5 to 15 seconds, against 10-sim-minute (10 real second) thread deadlines, so the hot-load deal, tomorrow and backhaul were lost (side payments $350, backhauls 0). The fix moves Relay posts off the dispatcher's actor queue, adds retry and backoff on "write capacity busy", rejects a SETTLE on an expired thread, and makes the tuning adjustable through `.env` settings (`THREAD_DEADLINE_MIN`, `AUCTION_CLOSE_MIN`, `AGENT_DELAY_MS`, `RELAY_DEBUG=1`). It is committed and unit-tested (41 pass) but was **never re-run over real Relay**. Do that next: `relay/latency.ts` measures hop latency, then run `BUS=relay BRAIN=rules` and `BRAIN=llm`, and raise `THREAD_DEADLINE_MIN` only if beats still drop.
- The gpt-5-mini brain may only reword the free text after the dash. If the verb, ids, slots or dollar amounts differ from the rules decision, it falls back to the rules reply. See `acceptLlmDecision` in `relay/brain.ts`.
- A leftover `bun.exe` from an interrupted run may still be alive on Person B's laptop. Check `tasklist | findstr bun`.
- The demo copy needs a human check before Devpost: the "What we learned" section of `demo/devpost.md` is model-written, and `<VIDEO_URL>` and `<REPO_URL>` are still placeholders.

## Suggested skills

- `context7-mcp`: durable-actors / Terse API (`Actor`, `@Persisted`, alarms, `prepareWebsocket`) and React/Vite docs. Prefer it over guessing.
- `tdd`: port `replan()` from `relay/mockDock.ts` into `actor/src/replan.ts` test-first, as PLAN asks; `relay/mockDock.test.ts` is a ready source of cases.
- `frontend-design` and `ui-styling`: the projector dashboard (dark background; Gantt, chatter feed, clock, counters).
- `diagnose`: when the TerseDock-backed scenario diverges from the MockDock transcript.
- `git-commit`: commit inside `actor/` and `dashboard/` only. Talk to B before touching `shared/types.ts`.
