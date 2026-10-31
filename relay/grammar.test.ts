import { test, expect } from "bun:test";
import { parseLine, fmt } from "./grammar.js";
import { hhmm, parseHHMM } from "./clock.js";

test("clock round-trips", () => {
  expect(hhmm(0)).toBe("08:00");
  expect(hhmm(360)).toBe("14:00");
  expect(parseHHMM("14:00")).toBe(360);
  expect(parseHHMM("08:00")).toBe(0);
});

test("OFFER with holder + close", () => {
  const line = fmt.offer({ offerId: "o21", truckId: "T5", door: 6, startMin: 480,
    reason: "door 3 out of service",
    holder: { door: 5, startMin: 360, carrier: "carrier-b", truckId: "T9" }, closesMin: 90 });
  expect(line).toBe("OFFER o21 truck T5 door 6 at 16:00 — door 3 out of service. Holder of door 5 14:00: @carrier-b (T9). Thread closes 09:30.");
  const p = parseLine(line);
  expect(p.verb).toBe("OFFER");
  if (p.verb !== "OFFER") return;
  expect(p.offerId).toBe("o21");
  expect(p.truckId).toBe("T5");
  expect(p.door).toBe(6);
  expect(p.startMin).toBe(480);
  expect(p.holder).toEqual({ door: 5, startMin: 360, carrier: "carrier-b", truckId: "T9" });
  expect(p.closesMin).toBe(90);
});

test("OFFER without holder", () => {
  const p = parseLine("OFFER o2 truck T1 door 2 at 11:00 — eta moved");
  if (p.verb !== "OFFER") throw new Error("not OFFER");
  expect(p.holder).toBeUndefined();
});

test("AUCTION", () => {
  const line = fmt.auction({ auctionId: "a3", door: 2, startMin: 60, why: "slot freed by T1 breakdown", closesMin: 70 });
  const p = parseLine(line);
  if (p.verb !== "AUCTION") throw new Error(`got ${p.verb}`);
  expect(p).toMatchObject({ auctionId: "a3", door: 2, startMin: 60, closesMin: 70 });
});

test("AWARDED both forms", () => {
  const a = parseLine(fmt.awarded("a3", "T6", 2, 60));
  if (a.verb !== "AWARDED") throw new Error("not AWARDED");
  expect(a).toMatchObject({ auctionId: "a3", truckId: "T6", door: 2, startMin: 60 });
  const b = parseLine("AWARDED a3 T6 door 2 at 09:00");
  if (b.verb !== "AWARDED") throw new Error("not AWARDED");
  expect(b).toMatchObject({ auctionId: "a3", truckId: "T6", door: 2, startMin: 60 });
});

test("VERIFY ask and answers", () => {
  const ask = parseLine(fmt.verifyAsk("carrier-x", "L12", "unknown carrier requesting door 2 at 11:00"));
  if (ask.verb !== "VERIFY" || !ask.ask) throw new Error("not VERIFY ask");
  expect(ask.ask).toEqual({ target: "carrier-x", load: "L12" });
  const no = parseLine(fmt.verifyAnswer(false, "L12 is tendered to @carrier-b, nobody else."));
  if (no.verb !== "VERIFY") throw new Error("not VERIFY");
  expect(no.answer).toBe("no");
  const yes = parseLine("VERIFY yes - vouched");
  if (yes.verb !== "VERIFY") throw new Error("not VERIFY");
  expect(yes.answer).toBe("yes");
});

test("REJECTED/CONFIRMED/REFUSED/EXPIRED/EMPTY/TOMORROW", () => {
  expect(parseLine(fmt.rejected("o21", "door 5 14:00 was taken")).verb).toBe("REJECTED");
  expect(parseLine(fmt.confirmed("o21", "settled")).verb).toBe("CONFIRMED");
  const r = parseLine(fmt.refused("carrier-x", "no vouch"));
  if (r.verb !== "REFUSED") throw new Error("not REFUSED");
  expect(r.target).toBe("carrier-x");
  const e = parseLine(fmt.expired("o9", "T1", 2, 240));
  if (e.verb !== "EXPIRED") throw new Error("not EXPIRED");
  expect(e).toMatchObject({ offerId: "o9", truckId: "T1", door: 2, startMin: 240 });
  const em = parseLine(fmt.empty("T9", 5));
  if (em.verb !== "EMPTY") throw new Error("not EMPTY");
  expect(em).toMatchObject({ truckId: "T9", door: 5 });
  const t = parseLine(fmt.tomorrow("T8"));
  if (t.verb !== "TOMORROW") throw new Error("not TOMORROW");
  expect(t.truckId).toBe("T8");
});

test("SWAP?/COUNTER/AGREE", () => {
  const s = parseLine("SWAP? @carrier-b — T5 takes door 5 14:00, T9 takes door 6 16:00, we cover $150.");
  if (s.verb !== "SWAP?") throw new Error("not SWAP?");
  expect(s.mention).toBe("carrier-b");
  const s2 = parseLine("SWAP? — anyone at 11:00?");
  if (s2.verb !== "SWAP?") throw new Error("not SWAP?");
  expect(s2.mention).toBeUndefined();
  const c = parseLine("COUNTER $200 — 16:00 pushes my driver");
  if (c.verb !== "COUNTER") throw new Error("not COUNTER");
  expect(c.usd).toBe(200);
  const a = parseLine("AGREE $200 — cold chain is worth it.");
  if (a.verb !== "AGREE") throw new Error("not AGREE");
  expect(a.usd).toBe(200);
});

test("SETTLE with assignments, pay, waive", () => {
  const line = fmt.settle("o21",
    [{ truckId: "T5", door: 5, startMin: 360 }, { truckId: "T9", door: 6, startMin: 480 }],
    [{ from: "carrier-c", to: "carrier-b", usd: 200 }], ["T3"]);
  const p = parseLine(line);
  if (p.verb !== "SETTLE") throw new Error("not SETTLE");
  expect(p.offerId).toBe("o21");
  expect(p.assigns).toEqual([
    { truckId: "T5", door: 5, startMin: 360 },
    { truckId: "T9", door: 6, startMin: 480 },
  ]);
  expect(p.pays).toEqual([{ from: "carrier-c", to: "carrier-b", usd: 200 }]);
  expect(p.waives).toEqual(["T3"]);
  // '->' accepted for '→'
  const p2 = parseLine("SETTLE o21: T5 door 5 14:00 · pay carrier-a->carrier-b $120");
  if (p2.verb !== "SETTLE") throw new Error("not SETTLE");
  expect(p2.pays[0]!.to).toBe("carrier-b");
});

test("BID/accept/counter/decline", () => {
  const b = parseLine("BID a3 T6 ready 08:50");
  if (b.verb !== "BID") throw new Error("not BID");
  expect(b).toMatchObject({ auctionId: "a3", truckId: "T6", readyMin: 50 });
  const a = parseLine("accept o21");
  if (a.verb !== "accept") throw new Error("not accept");
  expect(a.offerId).toBe("o21");
  const c = parseLine("counter o21 door 5 at 14:00");
  if (c.verb !== "counter") throw new Error("not counter");
  expect(c).toMatchObject({ offerId: "o21", door: 5, startMin: 360 });
  expect(parseLine("decline o21").verb).toBe("decline");
});

test("REQUEST / BACKHAUL / BOOK / BOOKED", () => {
  const r = parseLine(fmt.request(2, 180, "L12", "T13", "we're on the gate"));
  if (r.verb !== "REQUEST") throw new Error(`got ${r.verb}`);
  expect(r).toMatchObject({ truckId: "T13", door: 2, startMin: 180, load: "L12" });
  const r2 = parseLine("REQUEST door 2 at 11:00 load L12 — hi");
  if (r2.verb !== "REQUEST") throw new Error("not REQUEST");
  expect(r2.truckId).toBeUndefined();
  const bh = parseLine(fmt.backhaulOffer("T9", "L30", "want a leg?"));
  if (bh.verb !== "BACKHAUL") throw new Error("not BACKHAUL");
  expect(bh.accept).toBe(false);
  const ba = parseLine(fmt.backhaulAccept("T9"));
  if (ba.verb !== "BACKHAUL") throw new Error("not BACKHAUL accept");
  expect(ba.accept).toBe(true);
  const bk = parseLine(fmt.bookTomorrow("T8", 0));
  if (bk.verb !== "BOOK") throw new Error("not BOOK");
  expect(bk.startMin).toBe(0);
  const bkd = parseLine(fmt.bookedTomorrow("T8", 0));
  if (bkd.verb !== "BOOKED") throw new Error("not BOOKED");
  expect(bkd.startMin).toBe(0);
});

test("unparseable lines are free text", () => {
  const p = parseLine("hello there, anyone awake?");
  expect(p.verb).toBe("free");
});
