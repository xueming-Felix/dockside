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

**User direction:** "what if we make buttons on the dashboard (and click buttons) instead of clicking keyboards for better visualization" (13:10).

**Assistant choices and why:** the keys became a control strip on the projector page backed by a driver inside the grant server (`dashboard/demo.ts`), because the Terse API key must stay server-side and the room should see the click. The driver also does the dispatcher's alarm work (awards, accepts, no-show bids, the arrive/done gate) so the demo does not depend on Person B's Relay dispatcher; when that exists it replaces the chatter lines and the buttons stay. The gate holds back trucks that a still-pending key needs (T1/T4 for key 3, T5/T9 for key 4, T7 for key 7, T9's departure for key 9) so a late press keeps its beat, and key 2 is idempotent. Auto mode presses the remaining keys at their scheduled sim times. Verified at 300x on the cloud actor; `docs/demo-script.md` now leads with the buttons and keeps the terminal script as the fallback.

## 2026-10-31 — Taking over Person B's branch and wiring the halves

**User direction:** "person-b pushed to a branch, but not might be fully finished. you take over. and wire everything together" (13:24), followed by the OpenAI and Agent Relay keys.

**Assistant choices and why:** merged `person-b/relay` into main keeping Person A's `shared/types.ts` (a superset of the plan's contract that the actor, dashboard and buttons depend on; B's copy was the plan's verbatim text). B's seed relied on MockDock quirks the actor rejects (a reefer truck on a dry door, two appointments per truck), so the runner was pointed at the shared Pier 9 day instead of relaxing the actor. The actor learned B's calling conventions rather than the other way round, because B's dispatcher is generic and the actor was already verified: arrival checks only for flagged trucks when the seed carries `arrivalCheck` flags, past unchecked slots treated as history, `backhaul(truckId)`, `setSpeed(0)` as freeze, `+N` in overrun events. Two dispatcher bugs found on the first live run were fixed in `relay/` (stale pre-seed snapshot freeing every slot; re-opening an auction the actor had already opened). With under 40 minutes to the deadline the live Relay bus and the LLM brain were left untested and the button demo was recommended for the stage. The Devpost draft was corrected to the built system; the video link stays the owner's.

## 2026-10-31 — Demo path: our stack

**User direction:** "go with ours, we took full control and took over. don't need to worry about B." (13:37).

**Assistant choices:** stopped the demo-speed rerun of B's stack, kept the merge on main (nothing of it runs on stage), restarted the live grant server in normal button mode on the latest code, and re-verified Reset plus keys 1 and 2 on a throwaway cloud actor before telling the owner the board was ready. The Devpost text had already been handed over with only the video URL left.

## 2026-10-31 — Simplify the demo into narrated scenes

**User direction:** "it's a bit too complicated now, too many scenarios, we can demo 1-2 key scenarios or exceptions, and we show the workflow of durable objects and agents multi-round conversations … make what happens under each event more obvious, like what happen and what's good about us, and what conversations happen. work in subagents if needed" (13:41).

**Assistant choices and why:** three scenes instead of ten keys, chosen to cover the two things the owner named: scene 1 shows the actor serializing two simultaneous requests and a four-message haggle settled by an atomic swap; scene 2 shows replan on a door failure and a two-round deal pinned by `counter()`; scene 3 (optional) shows the actor's own alarm closing an auction. Each step carries a technology badge, a "what happened" line, a "why it matters" line and the chat lines, served by the driver so the panel and the board stay in sync. Story mode runs the clock at 5x with arrival checks off, because scenes are pressed at the presenter's pace and no gate runs; the key board stays available for the full-day run. The UI was built by a subagent in parallel with the driver.

## 2026-10-31 — Demo video: shoot it headless, cut it in HyperFrames

**User direction:** "research on https://github.com/heygen-com/hyperframes. can you shoot and cut demo video for me. i can read all the scripts, you help me cut into the video? or other ways you recommend" (13:14), then "ok stop for now. we are rebuilding the demo, after that, we can record" (14:06). [Request](journal/2026-10/cap_8c377343-86de-4c39-a5f6-cd1a1742d7d5.md).

**Assistant choices and why:**
- Recommended split: the agent shoots and cuts, the owner records the narration. The board is recorded by headless Chrome through a CDP screencast (lossless PNG frames, assembled to a CFR MP4 with ffmpeg) rather than QuickTime, so the take is deterministic, has no cursor and can be re-shot in minutes; it runs against a second grant server on its own cloud actor (`pier9-video`, port 7120) so the stage actor is never reseeded by a shoot. The driver's state is polled during the shoot, so every beat has an exact timestamp and the cut needs no eyeballing.
- HyperFrames was kept after a smoke test by a subagent proved init, lint, check, transcribe and render on this machine (pinned `hyperframes@0.8.224`, `CI=1`); plain ffmpeg stays the fallback. The composition is generated by `demo/video/build.mjs` from `edl.json`, because the cut has to be rebuilt when the owner's voice replaces the stand-in and when the demo changes.
- Stand-in narration is macOS `say` (Kokoro TTS fails on an espeak data-path bug), so the structure could be shown before the real voice lands. No music: no licensed source was at hand and nobody can hear a bed before the deadline.
- Captions sit on one line over the board's replay-slider row, so the Gantt and the control strip stay uncovered.
- Stopped on the owner's word with the full-day draft rendering; the ten-key cut is kept only as reference because the owner had moved the demo to story mode in parallel. The next cut follows the rebuilt demo and its script.

**Status:** paused at 14:08 pending the demo rebuild; nothing is scheduled.

## 2026-10-31 — Put the agents' lines on Agent Relay for real

**User direction:** "are agents really work at the background? did they communicate via agent relay?" (14:04).

**Assistant choices and why:** told the owner plainly that the demo's agent lines were scripted and never touched Relay, then made the claim true at the transport level: the stage driver posts each line as its agent in `#pier9` on Agent Relay (via `relay/bus.ts`), threaded per deal, before mirroring it into the dock. The deals remain code-decided so the demo stays deterministic; the owner can say "the messages are posted and threaded by the agents on Agent Relay; the deals are bounded by code; the dock validates every settlement". Because the workspace rejects bursts and answers slowly (register ~10 s each, post ~4 s), the driver registers the cast sequentially at startup and queues posts with retries; nothing on stage waits for Relay. Live LLM wording of the lines was offered as a further step and not started.

## 2026-10-31 — Slower, presenter-paced scenes; honest counters; carrier tabs

**User direction:** "make each scenario slower for demo … it needs to happen step by step with UI showing that" and "what does the detention avoided mean, why for scenario 2 we avoid $75 detention but have 150 more side payments, then it's a loss for carrier?" (14:14); then "how do we better show that agent relay … communication happens … one chat tab each carrier" (14:17).

**Assistant choices and why:** steps now wait for the presenter instead of a fixed pace, because narration speed differs by speaker and the room needs to see each beat land; lines are appended as they are said so the panel and the feed move together. The collision became its own beat so the room sees a booking, then the second request colliding, before any agent speaks. On the counters the honest reading is that "detention avoided" is the warehouse's avoided liability ($75 per hour a truck's wait shortened) and "side payments" is value transferred between carriers; the tiles were relabelled and scene 2's text states the economics rather than hiding them. For the carrier tabs the inbox is rendered from what arrived over Agent Relay's event stream (with message ids), not from the dock mirror, so the tab is evidence rather than decoration.

## 2026-10-31 — Two views: the live v1 board and a static walkthrough

**User direction:** "we should have two views for demo. one is the real dashboard we built before … and the second view is step by step real illustration of what happens in these scenarios … only for illustration so we don't need to make real triggers" (14:41).

**Assistant choices and why:** the live board returns to the ten-key v1 mode (real actor, real Relay posting) because that is the system; the walkthrough is pure client-side data so it can never stall during the explanation. Its content is the same beats the live run performs (same calls, same lines), frozen, so the two views tell one story. Story mode (presenter-paced live scenes) stays available behind an environment flag rather than being deleted.

## 2026-10-31 — Walkthrough as diagrams, minimal text

**User direction:** "for the dashboard, i think it have too many texts, let's illustrate by diagrams" and "with minimal text" (15:03).

**Assistant choices and why:** one fixed system picture on every walkthrough screen (agents inside Agent Relay, the dispatcher, the Dock actor with its mini board and timers, the screens) so the room learns the topology once; each step animates only its own calls and messages as labelled arrows and speech bubbles on that picture. Words shrink to the step title, a technology badge and one takeaway sentence; the previous logs and paragraphs stay reachable behind a details toggle rather than being deleted. Content for the arrows lives in the data file (`flows`, `speech`, `chips`) so the picture and the live run keep telling the same story.

## 2026-10-31 — Stage script under two minutes: live board first, alarm as the closer

**User direction:** "check the latest design and outputs and prepare me the scripts, we will have >1 min on the live demo, and ~<1 mins on the step by step walkthrough on the one or two scenarios (it's rebuilding)" (15:06 PDT), then "total under 2 mins" (15:14). [Request](journal/2026-10/cap_50635177-5361-477a-a2f2-a9820d90110a.md).

**Assistant choices and why:** `demo/stage-script.md` is the two-minute script (278 spoken words): live 1:15 with the opening folded in, walkthrough 0:36, close 0:08. The live block runs keys 3 and 4 on the ten-key board and leaves the collision to the walkthrough, so nothing is told twice and each view carries one idea: the live board shows a replan, a two-round deal and the actor's own alarm; the walkthrough teaches serialization, the offer, the haggle and the atomic settle. Key 3 is pressed before the first word because its auction closes at 09:10 on the board clock, 70 s after Reset (`max(09:10, now+10)` in `dashboard/demo.ts`), so the alarm fires at the end of the live block without a wait; pressing 3 first also keeps T1 from no-showing at 09:30 while the gate holds it. The walkthrough lines are one short sentence per screen, matching the step titles and takeaways in `walkthrough.data.ts`, which the diagram redraw keeps. Judge Q&A stays in `demo/talking-points.md`.

**Found while checking, left to the owner:** live key 1 and walkthrough scenario 1 are mirror images (live: carrier-a books first and carrier-b pays $150 against a $0 budget; walkthrough: carrier-b books first and carrier-a pays, which fits the personas). The script names no carrier in a live collision line; aligning the driver is a six-line change in `demo.ts` key 1 that the other session owns. The diagram version of the walkthrough was not yet on :7110 at 13:22.

## 2026-10-31 — Clock correction and parallel work by the Codex bot

**Finding:** Felix-Claude's wall-clock estimates in the topic and in these records drifted about three hours fast during the afternoon (it reported "18:45" at 15:03 PDT). The times in brief.md and decisions.md were corrected from git commit timestamps (PDT); times quoted in the Lark topic after about 12:30 are wrong by up to three hours and the git log is the reference. Separately, the Codex bot (Felix) pushed to main from another topic during the day: `docs/CONTEXT.md` (11:50), presentation talking points (13:52) and a demo video pipeline (13:59); Felix-Claude did not review those.

## 2026-10-31 — Live board at 120x so the live block fits in a minute

**User direction:** "make the live board running even faster, finish in 1 min. for demo purpose" (15:24 PDT), then "no need to test, just make it fast and launch" (15:35). [Request](journal/2026-10/cap_9ce62a3d-5a02-480f-af9f-50df49bee1d0.md), [follow-up](journal/2026-10/cap_72c72067-3a10-4f50-8bff-edede113d380.md).

**Assistant choices and why:** the clock speed is the one lever that shortens everything at once (the auction alarm, the line pacing, the gate) without touching the verified beats, so the key board's default went from 60x to 120x in `dashboard/server.ts` and `demo.ts` rather than rewriting key 3's close time or the pacing floor; `DEMO_SPEED` still overrides, and the actor's own `DEFAULT_SPEED` and the seed scripts stay at 60. 120x was chosen over 90x or 100x because the arithmetic is clean for the presenter (two sim minutes per second: 08:30 at 15 s, 09:10 at 35 s), the alarm then lands around the last door-5 sentence, and the driver was already proven at 300x. The owner waived testing; one timed run on a scratch actor (Relay posting off, so #pier9 saw nothing) had already finished and matched the arithmetic (alarm 35.2 s after Reset), so the live server was relaunched at once with the same environment. That interrupted a run in progress on the board and dropped its queued Relay posts, which the owner was told. The stage script's live block was cut from 174 to 138 words so the speech, not only the mechanics, fits the minute; the walkthrough and close are unchanged. The Devpost text keeps "60x" because it was already submitted; the video README notes the new default and how to reproduce the 60x take.
