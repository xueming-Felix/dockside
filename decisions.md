# Decisions and rationale

## 2026-10-31 — Initialize Dockside around the owner's existing repository

**User direction:** initialize a new hackathon project with a new repo, folder and group for `git@github.com:xueming-Felix/dockside.git`. [Request](journal/2026-10/cap_baf32724-7d80-4539-baf0-64d272450b90.md).

**Assistant choices:** the repository already existed with the owner's plan commit `ea25a39`, so the workspace's automatic `gh repo create` failed ("Name already exists") and the project was linked to the existing remote instead of a second repository. Local main was rebuilt on `ea25a39` with the workspace scaffolding committed on top, keeping the owner's history intact and linear; the generated "Initialize Dockside" commit was dropped because its files are carried in that commit. The owner's README is kept verbatim with a workspace section appended. Project ID `dockside`, name Dockside, purpose paraphrased from the owner's README and PLAN.md. The dedicated Lark topic group was created through `workspace provision`; the originating Personal Workspace topic keeps its binding. [Setup receipt](journal/2026-10/cap_9dd3bc10-281b-4e9e-9120-bfba30878d18.md).

**Provisioning deviations:** Lark admitted only the creating Codex bot (cross-app bot invites are refused), and Botmux skipped the group's working-directory binding after that partial failure. The Codex bot's binding to this folder was added by hand under Botmux's own bots.json file lock, with a backup outside Git. Adding Felix-Claude is an owner step; `scripts/add-bot.mjs` then mirrors its binding.

**Scope and status:** initialization complete. Plan, personas and scenario are the owner's team decisions as recorded in PLAN.md, not assistant proposals. No application code, task, schedule, paid API use, deployment or Devpost action was started here.

## 2026-10-31 — Finish Felix-Claude's Dockside routing

**User direction:** assign Felix-Claude to this workspace after its message was rejected as an unassigned project group. [Request](journal/2026-10/cap_93307716-7b05-4e24-b628-c96d1702a4a7.md).

**Finding and action:** Lark confirmed Felix-Claude was already a group member. Workspace resolves bindings separately for each bot; only Felix had the Dockside binding. Added the wildcard group binding for Claude app `cli_aa52cde0b578c08b` through Workspace and the matching Dockside directory entry in Botmux under its file lock, with a private backup outside Git. This repairs routing; no separate project-owner role is involved. The broader onboarding script was unnecessary because it changes other groups and settings and restarts services. No Claude session existed in this group, and oncall mappings refresh from disk, so no session migration or restart was needed.

**Verification:** Workspace readback shows both group bindings and an active project; Botmux now reports Claude's directory source as `oncall`. The next human message is the remaining end-to-end inbound check; no blocked prompt was replayed. [Repair receipt](journal/2026-10/cap_e7d00598-a9dc-4073-8e2f-06d29a87e34b.md).

## 2026-10-31 — Person A implementation started by Felix-Claude

**User direction:** "Start implementation for person A. if blocked or you need any resources, let me know. otherwise keep doing. On the side, build a temporary dashboard for me to understand the whole project status (diagram better)." [Request](journal/2026-10/cap_62aea7a3-1d4e-4aeb-9cc8-ef740d62821f.md). Later in the same topic the owner completed the Terse device login and created the Terse API token.

**Assistant choices and why:**
- Toolchain: Bun 1.4.4 (npm) and Terse CLI 0.14.9 (`bunx terse-cli install --yes`); both symlinked into `/opt/homebrew/bin` because the owner's shell could not find `terse`. Login ran in device-code mode (`terse auth login --no-browser`) so the owner could sign in from any browser; the first code expired while the organization was being created and a second one completed.
- Contract: `shared/types.ts` follows PLAN.md's shapes; additions are marked `[added]` (Snapshot `timers`, `realStart`, `frozen`, `seeded`; Appt `durationMin`, `arrivedMin`, `doneMin`; Offer `atMin`, `fromDoor`, `fromStartMin`; Auction `status`, `reason`; a `Scenario` type; a `DockApi` interface with result types; extra Event kinds; methods `freeze`, `resume`, `setSpeed`, `tick`, `backhaul`; an optional fifth argument on `request()` for unknown trucks). Nothing from the plan was renamed or removed. `shared/pier9.ts` holds the default seed.
- Actor id is `pier9-2026-10-31`, not the plan's `pier9:2026-10-31`: Terse actor ids allow only letters, digits, `.`, `-` and `_`.
- Door-down beat uses door 5: PLAN's key 4 closes door 3 (a dry door) but expects reefer T5 to be displaced. The seed puts T5 on door 5 (reefer); the scenario runner should call `setDoor(5, false)`.
- `replan()` semantics: incumbents keep any slot that is still feasible, so unaffected trucks never churn; a pinned truck (counter) and hot loads (prioritize) preempt; displaced and re-queued trucks fill gaps by priority, then eta. Offers are applied immediately (the board shows the move at once); `accept` confirms, `counter` re-pins, `decline` re-queues; a truck's older open offers expire when it moves again. The detention claim is $150 at the alarm (two hours at $75) and grows by the hour, matching PLAN's act 3 number.
- Runtime constraints found while bringing the actor up: every method on the actor prototype must be async, private helpers included; relative imports need explicit `.js` extensions because the Terse compiler uses Node16 resolution; results and broadcasts must be strict JSON, so op outputs are JSON round-tripped to drop `undefined`.
- The requested status page is a Claude artifact (private link, https://claude.ai/artifact/GLxbt3J88EXQu4e2FXrnCg) rather than a file in the repository, because the owner called it temporary.
- No Workspace task was created: the owner asked for the work in this topic and is steering it live; a `--run` task would dispatch a second agent on the same code.

- Deploy: `terse attach` does not exist in CLI 0.14.9, so the hosted project was created with `terse init dockside --non-interactive` in a scratch folder and its `terse.config.json` (project id only, not secret) copied into `actor/` and committed. The cloud build uploads only `actor/`, so `shared/types.ts` is vendored into `actor/src/shared/` (sync script plus an identity test) and the deploy tsconfig no longer references `bun-types`; a `tsconfig.local.json` keeps the local typecheck of scripts and tests.

**Verification:** 20 `bun test` cases pass and `tsc --noEmit` is clean for the actor; `terse actor dev` compiles and serves the actor; `actor/scripts/drive.ts` exercised seed, the collision, swap and pay, arrive, reportEta, setDoor and counter against the local runtime with the expected results. The deployment passed the same drive script, and a smoke actor left alone on the cloud fired its no-show, auction-close and detention alarms on schedule with nothing connected. The dashboard browser check and the full-scenario run on the local runtime were delegated to two subagents (owner's direction at 12:36: "post more subagents when necessary to speed up the dev") and were still running when this entry was written.

## 2026-10-31 — After the first full run: hardenings and demo access

**User direction:** "help me run the dashboard" (13:14) and "can you make it available through tailscale?" (13:22), both in the Dockside topic.

**Assistant choices and why:**
- The dashboard is served from the Mac mini in cloud mode (`bun run start:cloud`) bound to all interfaces, so it is reachable over the tailnet at http://100.117.209.6:7110; `tailscale serve` hung and was abandoned, the plain port is enough. The generated Terse client (`actor/generated/`) is now committed so a fresh clone runs the dashboard with Bun alone.
- Three hardenings from the subagent's 52/52 scenario run: `arrive()` within the same sim minute as the arrival check reverts the no-show and withdraws the auto-opened auction (PLAN presses key 2 at exactly 08:30, which raced the 08:30 check); detention claims and no-show auction closes use the timer's due minute rather than the drain time, so a late drain cannot inflate a claim; `openThread()` rejects ids that are neither an offer nor an auction and emits a `thread_open` event. One additive event kind in the contract.
- Runner guidance recorded in `docs/demo-runbook.md` and `shared/README.md`: the gate routine (arrive/done every truck or the dock no-shows and detains for real), the act-2 auctions closing an hour apart, where trucks land with this seed, and the key 8 trigger.

## 2026-10-31 — Buttons on the dashboard instead of a terminal runner

**User direction:** "what if we make buttons on the dashboard (and click buttons) instead of clicking keyboards for better visualization" (14:03).

**Assistant choices and why:** the keys became a control strip on the projector page backed by a driver inside the grant server (`dashboard/demo.ts`), because the Terse API key must stay server-side and the room should see the click. The driver also does the dispatcher's alarm work (awards, accepts, no-show bids, the arrive/done gate) so the demo does not depend on Person B's Relay dispatcher; when that exists it replaces the chatter lines and the buttons stay. The gate holds back trucks that a still-pending key needs (T1/T4 for key 3, T5/T9 for key 4, T7 for key 7, T9's departure for key 9) so a late press keeps its beat, and key 2 is idempotent. Auto mode presses the remaining keys at their scheduled sim times. Verified at 300x on the cloud actor; `docs/demo-script.md` now leads with the buttons and keeps the terminal script as the fallback.
