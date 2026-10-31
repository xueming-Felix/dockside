import { test, expect } from "bun:test";
import { MockDock, ManualClock } from "./mockDock.js";
import type { SeedSpec } from "./dock.js";
import { SEED } from "./scenario.js";

function miniSeed(): SeedSpec {
  return {
    doors: [
      { id: 1, type: "dry", open: true }, { id: 2, type: "dry", open: true },
      { id: 5, type: "reefer", open: true },
    ],
    trucks: [
      { id: "T1", carrier: "carrier-a", load: "L1", type: "dry", priority: 0, etaMin: 0 },
      { id: "T2", carrier: "carrier-b", load: "L2", type: "dry", priority: 0, etaMin: 0 },
      { id: "T5", carrier: "carrier-c", load: "L5", type: "reefer", priority: 0, etaMin: 0 },
      { id: "T9", carrier: "carrier-b", load: "L9", type: "reefer", priority: 0, etaMin: 0 },
    ],
    appts: [
      { truckId: "T1", door: 1, startMin: 60, status: "booked", arrivalCheck: true },
      { truckId: "T2", door: 2, startMin: 60, status: "booked" },
      { truckId: "T5", door: 5, startMin: 300, status: "booked" },
      { truckId: "T9", door: 5, startMin: 360, status: "booked" },
    ],
    speed: 0,
  };
}

const sleep = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test("request collision: first books, second gets offer", async () => {
  const d = new MockDock(new ManualClock());
  await d.seed(miniSeed());
  const r1 = await d.request("carrier-b", "T2", 1, 240);
  expect(r1.appt).toBeDefined();
  const r2 = await d.request("carrier-a", "T1", 1, 240);
  expect(r2.offer).toBeDefined();
  expect(r2.offer!.startMin).toBe(300);
});

test("reportEta re-slots infeasible appt into an offer", async () => {
  const d = new MockDock(new ManualClock());
  await d.seed(miniSeed());
  const { offers } = await d.reportEta("T1", 150);
  expect(offers).toHaveLength(1);
  expect(offers[0]!.truckId).toBe("T1");
  expect(offers[0]!.startMin).toBe(180); // earliest hour >= 150, prefers door 1
  expect(offers[0]!.door).toBe(1);
});

test("door-close displacement tries the same start on a compatible door", async () => {
  const d = new MockDock(new ManualClock());
  const seed = miniSeed();
  seed.trucks.push({ id: "T5b", carrier: "carrier-c", load: "L5b", type: "reefer", priority: 0, etaMin: 0 });
  seed.doors.push({ id: 6, type: "reefer", open: true });
  seed.doors.push({ id: 3, type: "dry", open: true });
  seed.appts.push({ truckId: "T5b", door: 3, startMin: 480, status: "booked" });
  await d.seed(seed);
  const { offers } = await d.setDoor(3, false);
  const o = offers.find((x) => x.truckId === "T5b");
  expect(o).toBeDefined();
  expect(o!.door).toBe(5); // first compatible door free at the same start
  expect(o!.startMin).toBe(480);
});

test("swap exchanges booked and offered slots atomically", async () => {
  const d = new MockDock(new ManualClock());
  await d.seed(miniSeed());
  const r = await d.request("carrier-a", "T1", 2, 60); // collision -> offer door2@120+
  expect(r.offer).toBeDefined();
  const sw = await d.swap("T1", "T2");
  expect(sw.ok).toBe(true);
  const s = await d.snapshot();
  expect(s.appts.find((a) => a.truckId === "T1" && a.door === 2)?.startMin).toBe(60);
  expect(s.appts.find((a) => a.truckId === "T2")?.startMin).toBe(r.offer!.startMin);
});

test("swap rejects type mismatch", async () => {
  const d = new MockDock(new ManualClock());
  await d.seed(miniSeed());
  const sw = await d.swap("T1", "T5"); // dry T1 can't take reefer door 5
  expect(sw.ok).toBe(false);
});

test("counter pins truck, bumps lower priority; fails on equal priority", async () => {
  const d = new MockDock(new ManualClock());
  const seed = miniSeed();
  seed.trucks[0]!.priority = 1; // T1 outranks T2
  await d.seed(seed);
  const r2 = await d.request("carrier-a", "T1", 2, 60); // taken by T2 -> offer
  expect(r2.offer).toBeDefined();
  const c = await d.counter(r2.offer!.id, 2, 60); // pin T1 at door2@60, bumping T2
  expect(c.ok).toBe(true);
  const s = await d.snapshot();
  expect(s.appts.filter((a) => a.truckId === "T1").map((a) => `${a.door}@${a.startMin}`)).toContain("2@60");
  expect(s.offers.find((o) => o.truckId === "T2" && o.status === "open")).toBeDefined();

  // equal priority cannot bump
  const d2 = new MockDock(new ManualClock());
  await d2.seed(miniSeed());
  const r3 = await d2.request("carrier-a", "T1", 2, 60);
  const c2 = await d2.counter(r3.offer!.id, 2, 60);
  expect(c2.ok).toBe(false);
});

test("timers: arrival check -> noshow", async () => {
  const clock = new ManualClock();
  const d = new MockDock(clock);
  await d.seed({ ...miniSeed(), speed: 1 });
  clock.advance(91 * 1000); // simMin 91 > 60+30
  await sleep();
  const s = await d.snapshot();
  expect(s.appts.find((a) => a.truckId === "T1")?.status).toBe("noshow");
  expect(s.events.some((e) => e.kind === "noshow")).toBe(true);
});

test("timers: detention files a $150 claim", async () => {
  const clock = new ManualClock();
  const d = new MockDock(clock);
  await d.seed({ ...miniSeed(), speed: 1 });
  await d.arrive("T2"); // arrives ~simMin 0, detention at +120
  clock.advance(121 * 1000);
  await sleep();
  const s = await d.snapshot();
  const claim = s.claims.find((c) => c.truckId === "T2");
  expect(claim).toBeDefined();
  expect(claim!.amount).toBe(150);
  expect(s.events.some((e) => e.kind === "detention")).toBe(true);
});

test("timers: thread deadline -> thread_expired", async () => {
  const clock = new ManualClock();
  const d = new MockDock(new ManualClock());
  void d;
  const d2 = new MockDock(clock);
  await d2.seed({ ...miniSeed(), speed: 1 });
  await d2.openThread("t1", "o1", 10);
  clock.advance(11 * 1000);
  await sleep();
  const s = await d2.snapshot();
  expect(s.events.some((e) => e.kind === "thread_expired")).toBe(true);
  expect(s.threads.find((t) => t.id === "t1")?.status).toBe("expired");
});

test("timers: auction close event", async () => {
  const clock = new ManualClock();
  const d = new MockDock(clock);
  await d.seed({ ...miniSeed(), speed: 1 });
  await d.openAuction(1, 120, 20);
  clock.advance(21 * 1000);
  await sleep();
  const s = await d.snapshot();
  expect(s.events.some((e) => e.kind === "auction_closed" && e.auctionId === "a1")).toBe(true);
});

test("overrun slides the queue on that door", async () => {
  const clock = new ManualClock();
  const d = new MockDock(clock);
  const seed = miniSeed();
  seed.appts = [
    { truckId: "T1", door: 2, startMin: 60, status: "booked" },
    { truckId: "T2", door: 2, startMin: 120, status: "booked" },
  ];
  await d.seed({ ...seed, speed: 1 });
  clock.advance(100 * 1000); // simMin 100
  const { offers } = await d.overrun("T1", 45);
  expect(offers.length).toBe(1); // T2@120 displaced -> offer
  expect(offers[0]!.truckId).toBe("T2");
});
