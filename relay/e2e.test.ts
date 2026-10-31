import { test, expect } from "bun:test";
import { MockDock } from "./mockDock.js";
import { LocalBus } from "./bus.js";
import { runScenario, SEED } from "./scenario.js";
import { startDispatcher } from "./dispatcher.js";
import { makeBrain } from "./brain.js";
import type { Snapshot } from "../shared/types.js";

test("full scenario: keys 1-10 against MockDock + LocalBus + rules", async () => {
  const dock = new MockDock();
  const bus = new LocalBus();
  let snap: Snapshot | null = null;
  dock.onSnapshot((s) => { snap = s; });

  const { transcript } = await runScenario({
    auto: true, speed: 20, replyDelayMs: [5, 30],
    dock, bus, brain: makeBrain(),
    log: () => {},
  });
  const t = transcript.join("\n");
  const S = snap!;

  // key 1: collision -> offer -> swap with $150 side payment
  expect(t).toContain("OFFER");
  expect(t).toContain("SWAP? @carrier-b");
  expect(t).toContain("COUNTER $150");
  expect(t).toContain("AGREE $150");
  expect(t).toContain("SETTLE");
  expect(t).toContain("CONFIRMED");

  // key 3: two auctions posted; awarded T6 and T8
  expect(t).toMatch(/AUCTION a\d+ door 2 at 09:00/);
  expect(t).toMatch(/AUCTION a\d+ door 1 at 10:00/);
  expect(t).toContain("BID");
  expect(t).toMatch(/AWARDED a\d+ T6/);
  expect(t).toMatch(/AWARDED a\d+ T8/);

  // key 4: reefer displaced, C<->B swap at $200
  expect(t).toMatch(/OFFER o\d+ truck T5 door 6 at 16:00/);
  expect(t).toContain("Holder of door 5 14:00: @carrier-b (T9)");
  expect(t).toContain("COUNTER $200");
  expect(t).toContain("AGREE $200");

  // key 5: vetting — VERIFY, REFUSED, carrier-x argues once
  expect(t).toContain("VERIFY @carrier-x load L12?");
  expect(t).toContain("VERIFY no");
  expect(t).toContain("REFUSED @carrier-x");

  // key 6: deadline beat — thread expires, EXPIRED posted
  expect(t).toContain("EXPIRED");

  // key 7: coalition — broker conditions, B's $80 leg, waiver, shipper SETTLE
  expect(t).toContain("waives T3");
  expect(t).toContain("$80");
  expect(t).toContain("waive T3");

  // [alarm] 10:30 detention -> claim waived; [alarm] 11:00 noshow -> third auction
  const t3 = S.claims.find((c) => c.truckId === "T3");
  expect(t3).toBeDefined();
  expect(t3!.status).toBe("waived");
  expect(t3!.amount).toBe(150);
  // a1 door2@09:00 + a2 door1@10:00 + the 11:00 no-show auction (extra
  // re-auctions of displaced award slots are legitimate and may add more)
  expect(S.auctions.length).toBeGreaterThanOrEqual(3);
  const noshowAuction = S.auctions.find((a) => a.door === 4 && a.startMin === 150);
  expect(noshowAuction?.winner).toBeDefined();

  // key 8: tomorrow -> BOOK -> BOOKED
  expect(t).toContain("TOMORROW T8");
  expect(t).toContain("BOOK tomorrow T8 08:00");
  expect(t).toContain("BOOKED tomorrow T8 08:00");
  expect(S.appts.find((a) => a.truckId === "T8")?.status).toBe("tomorrow");

  // key 9: EMPTY -> BACKHAUL -> accept -> counter
  expect(t).toContain("EMPTY T9");
  expect(t).toContain("BACKHAUL T9");
  expect(t).toContain("BACKHAUL accept T9");
  expect(S.counters.backhauls).toBe(1);

  // counters: side payments 150+200+80 = 430; phoneCalls 0; clock frozen
  expect(S.counters.sidePaymentsUsd).toBe(430);
  expect(S.counters.phoneCalls).toBe(0);
  expect(S.speed).toBe(0);
}, 90_000);

test("conflicting double SETTLE: the second one gets REJECTED", async () => {
  const dock = new MockDock();
  const bus = new LocalBus();
  const disp = await startDispatcher(dock, bus);
  const msgs: { id: string; from: string; text: string }[] = [];
  bus.onMessage((m) => msgs.push({ id: m.id, from: m.from, text: m.text }));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  await disp.inject.seed({ ...SEED, speed: 0 });
  await disp.inject.request("carrier-b", "T2", 4, 360);
  await disp.inject.request("carrier-a", "T4", 4, 360);
  await sleep(20);

  const offerMsg = msgs.find((m) => /OFFER o\d+/.test(m.text))!;
  const offerId = /OFFER (o\d+)/.exec(offerMsg.text)![1]!;
  const agent = await bus.register("carrier-a");
  const settle = `SETTLE ${offerId}: T4 door 4 14:00 · T2 door 4 15:00 · pay carrier-a→carrier-b $150`;

  await agent.post(settle, { thread: offerMsg.id });
  await sleep(30);
  await agent.post(settle, { thread: offerMsg.id }); // same deal twice — must fail
  await sleep(50);

  const text = msgs.map((m) => m.text).join("\n");
  expect(text).toContain(`CONFIRMED ${offerId}`);
  expect(text).toContain(`REJECTED ${offerId}`);
  const snap = await dock.snapshot();
  expect(snap.counters.sidePaymentsUsd).toBe(150); // only one settle landed
  await disp.close();
  await bus.close();
}, 30_000);
