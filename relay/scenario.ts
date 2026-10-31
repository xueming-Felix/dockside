// scenario.ts — seeds Pier 9 and runs keys 1–10 from PLAN's three acts.
//
// DEVIATIONS FROM PLAN.md (it is internally inconsistent in places; these are
// the closest consistent choices):
//  1. Trucks may hold several appointments (T2, T9, T4 each carry more than one).
//     swap() picks the booked slot closest below the counterpart's slot — the
//     slot the other side is buying.
//  2. T5 is seeded on dry door 3 at 16:00 although replan would never put a
//     reefer truck on a dry door. PLAN's key-4 beat needs door 3 closing to
//     displace exactly T5 to door 6 at 16:00.
//  3. replan "prefers its current slot" reads as: a truck displaced by a closed
//     door first tries its SAME start on another compatible door (that is what
//     lands T5 on door 6 at 16:00 without filling the reefer doors with ghosts).
//  4. T12 is seeded at door 4 10:30 — a half-hour start, since arrival_check is
//     start+30 and PLAN wants the no-show alarm at 11:00 sharp.
//  5. Arrival checks are only armed on seeded/requested appts flagged
//     `arrivalCheck` — awarded and re-slotted trucks don't spontaneously
//     no-show (PLAN's cast never calls arrive() for them).
//  6. Detention auto-files a claim for the full 120 minutes ($150) when the
//     arrived+120 alarm fires (PLAN act 3's concrete number; "$75/h after 2 free
//     hours" would be $0 at that instant).
//  7. Key 8 injects reportEta(T8, 15:00) — PLAN lists no inject ("consequence of
//     act 2") but something must push T8's slot past 15:30 to raise `tomorrow`.
//  8. PLAN's "two trucks behind T6 get offers" is read as the whole booked queue
//     behind the overrunning truck on that door sliding out (the next booked
//     appt plus the truck it was pushed into — T2 and T1 here).
//  9. The unknown carrier's REQUEST is posted by the carrier-x agent itself via
//     poke() — the grammar needs a sender to vet.
// 10. Auction ids count from a1 (PLAN's a3/a4/a5 implies a longer day).
// 11. prioritize() breaks eviction ties by highest door id — that is what puts
//     the hot truck on door 4 (T7's slot) rather than door 1.

import { MockDock, RealClock } from "./mockDock.js";
import { createDock, type DockClient, type SeedSpec } from "./dock.js";
import { createBus, type Bus, type BusMsg } from "./bus.js";
import { startDispatcher, type DispatcherHandle } from "./dispatcher.js";
import { startAgents, type AgentsHandle, type AgentsOptions } from "./agents.js";
import { hhmm } from "./clock.js";
import { PIER9 } from "../shared/pier9.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Seed and keys follow shared/pier9.ts (Person A's seed, the one the deployed actor, the dashboard and the
// demo script use). The original MockDock seed is in git history (branch person-b/relay). Only T12 carries
// arrivalCheck: the actor then arms arrival-check alarms for flagged trucks only, since this runner never
// calls arrive() for the rest. Door-down is door 5 (a reefer door, so reefer T5 is the one displaced).
export const SEED: SeedSpec = {
  doors: PIER9.doors,
  trucks: PIER9.trucks,
  appts: PIER9.appts!.map((a) => ({ ...a, status: "booked" as const, durationMin: 60, arrivalCheck: a.truckId === "T12" })),
};

export type KeyDef = { key: string; simMin: number; describe: string; run: (c: Ctx) => Promise<void> };
type Ctx = { disp: DispatcherHandle; agents: AgentsHandle; dock: DockClient };

export const KEYS: KeyDef[] = [
  { key: "1", simMin: 5, describe: "two request()s for door 4 at 14:00 same tick (carrier-b books, carrier-a collides and swaps for cash)",
    run: async (c) => {
      await c.disp.inject.request("carrier-b", "T14", 4, 360);
      await c.disp.inject.request("carrier-a", "T13", 4, 360);
    } },
  { key: "2", simMin: 28, describe: "arrive(T3) — the detention clock starts quietly (fires 10:28)",
    run: (c) => c.disp.inject.arrive("T3") },
  { key: "3", simMin: 60, describe: "reportEta(T1, 10:30) and reportEta(T4, 11:30) — traffic; door 2 09:00 and door 1 10:00 go to auction",
    run: async (c) => {
      await c.disp.inject.reportEta("T1", 150);
      await c.disp.inject.reportEta("T4", 210);
    } },
  { key: "4", simMin: 80, describe: "setDoor(5, closed) — reefer T5 is displaced; it wants door 6 10:00, held by carrier-b's T9",
    run: (c) => c.disp.inject.setDoor(5, false) },
  { key: "5", simMin: 100, describe: "carrier-x requests door 2 at 11:00 for load L12 (vetting)",
    run: async (c) => { c.agents.poke("carrier-x"); } },
  { key: "6", simMin: 110, describe: "overrun(+75) for whoever holds door 2 09:00 — paperwork at the door; the truck behind slides",
    run: async (c) => {
      const s = await c.disp.snapshot();
      const at = s.appts.find((a) => a.door === 2 && a.startMin === 60 && a.status !== "noshow" && a.status !== "done")
        ?? s.appts.find((a) => a.status === "unloading" || a.status === "arrived");
      await c.disp.inject.overrun(at?.truckId ?? "T6", 75);
    } },
  { key: "7", simMin: 135, describe: "prioritize(T11) — the shipper's hot load L17 takes 11:00; the broker's T7 is bumped",
    run: (c) => c.disp.inject.prioritize("T11") },
  // [alarm] 10:28 — T3 detention fires on its own; [alarm] 11:30 — T12's arrival check: no-show, auction.
  { key: "8", simMin: 200, describe: "reportEta(T8, 15:00) — its slot would end past 15:30: tomorrow",
    run: (c) => c.disp.inject.reportEta("T8", 420) },
  { key: "9", simMin: 220, describe: "done(T9) — door 6 frees up; the broker smells a backhaul",
    run: (c) => c.disp.inject.done("T9") },
  { key: "0", simMin: 240, describe: "key 10 — freeze the clock, print counters",
    run: async (c) => {
      await c.disp.inject.setSpeed(0);
      const s = await c.disp.snapshot();
      const k = s.counters;
      console.log(`\n=== counters @ ${hhmm(s.simMin)} ===`);
      console.log(`  detention avoided: $${k.detentionAvoidedUsd}`);
      console.log(`  side payments:     $${k.sidePaymentsUsd}`);
      console.log(`  moves:             ${k.moves}`);
      console.log(`  backhauls:         ${k.backhauls}`);
      console.log(`  phone calls:       ${k.phoneCalls}`);
    } },
];

export type RunOpts = {
  auto?: boolean;
  speed?: number;                 // sim minutes per real second (default 1 = "60x")
  replyDelayMs?: [number, number];
  dock?: DockClient;
  bus?: Bus;
  transcript?: string[];          // collects transcript lines
  log?: (line: string) => void;
  brain?: AgentsOptions["brain"];
};

export async function runScenario(opts: RunOpts = {}): Promise<{ transcript: string[]; stats: { llm: number; rulesFallback: number; guardFallback: number } }> {
  const transcript = opts.transcript ?? [];
  const log = (line: string) => { transcript.push(line); (opts.log ?? console.log)(line); };

  const dock = opts.dock ?? (await createDock());
  const bus = opts.bus ?? createBus();
  const disp = await startDispatcher(dock, bus);
  const speed = opts.speed ?? 1;
  const agents = await startAgents(bus, {
    replyDelayMs: opts.replyDelayMs,
    brain: opts.brain,
    nowMin: () => simNow(),
  });

  const simNow = () => {
    const m = (dock as MockDock).simNow;
    return typeof m === "function" ? m.call(dock) : (lastSnapMin ?? 0);
  };
  let lastSnapMin = 0;
  dock.onSnapshot((s) => { lastSnapMin = s.simMin; });

  bus.onMessage((m: BusMsg) => {
    log(`  ${hhmm(simNow())}  ${m.from}${m.thread ? " ↳" : ""}: ${m.text}`);
  });

  const ctx: Ctx = { disp, agents, dock };
  // the actor's speed unit is sim minutes per real MINUTE; this runner's is per real second
  await disp.inject.seed({ ...SEED, speed: speed * 60 });
  log(`seeded Pier 9 — 6 doors, 12 trucks, clock at ${speed} sim-min/real-s`);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const waitUntil = async (simMin: number) => {
    for (;;) {
      const left = simMin - simNow();
      if (left <= 0 || speed <= 0) return;
      await sleep(Math.min((left / speed) * 1000, 250));
    }
  };

  const alarmAt = new Set([148, 210]);
  const press = async (k: KeyDef) => {
    log(`\n--- [key ${k.key}] ${hhmm(k.simMin)} — ${k.describe}`);
    if (alarmAt.has(k.simMin)) log(`    (waiting for alarm at ${hhmm(k.simMin)})`);
    await k.run(ctx);
  };

  if (opts.auto) {
    for (const k of KEYS) {
      await waitUntil(k.simMin);
      if (k.simMin === 150 || k.simMin === 180) continue;
      await press(k);
    }
  } else {
    // raw-mode keypresses 1-9, 0 (=10), q quits
    log("\npress keys 1-9, 0 (=key 10) at the marked sim times; q quits\n");
    let i = 0;
    const next = KEYS[i];
    if (next) log(`next: [${next.key}] @ ${hhmm(next.simMin)} — ${next.describe}`);
    const stdin = process.stdin;
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    await new Promise<void>((resolve) => {
      stdin.on("data", async (d) => {
        const ch = d.toString();
        if (ch === "q" || ch === "") { resolve(); return; }
        const k = KEYS[i];
        if (k && ch === k.key) {
          await press(k);
          i++;
          const n = KEYS[i];
          if (n) log(`next: [${n.key}] @ ${hhmm(n.simMin)} — ${n.describe}`);
          else resolve();
        }
      });
    });
  }

  // let the last beats play out, then wrap
  await sleep(Math.min(3000 / Math.max(speed, 0.001), 5000));
  const stats = agents.stats();
  const b = stats.buckets;
  log(`\nbrain stats: llm=${stats.llm} rulesFallback=${stats.rulesFallback} ` +
    `(verbMismatch=${b.verbMismatch} headMismatch=${b.headMismatch} timeoutOrError=${b.timeoutOrError} invalid=${b.invalid}) ` +
    `guardFallback=${stats.guardFallback}`);
  await agents.close();
  await disp.close();
  await bus.close();
  await dock.close();
  return { transcript, stats };
}

// ---- main -------------------------------------------------------------------

if (import.meta.main) {
  const auto = process.argv.includes("--auto");
  const speedArg = process.argv.find((a) => a.startsWith("--speed="));
  const speed = speedArg ? Number(speedArg.split("=")[1]) : 1;
  const dir = join(dirname(fileURLToPath(import.meta.url)), "runs");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `${stamp}.log`);
  const { transcript, stats } = await runScenario({ auto, speed });
  writeFileSync(path, transcript.join("\n") + "\n");
  console.log(`\ntranscript: ${path}`);
  process.exit(0);
}
