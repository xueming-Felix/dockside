// dispatcher.ts — registers as `dock` on the bus. Bridges the actor and Relay:
// every actor interaction runs inside one serial promise queue (bus handler,
// snapshot handler and scenario injects each enqueue one unit of work); every
// offer becomes an OFFER post + openThread; every bus message is mirrored into
// the actor with say(); it acts only on SETTLE, BID, VERIFY,
// accept/counter/decline, REQUEST, BACKHAUL accept and BOOK lines; alarm-born
// snapshot events drive auctions, EXPIRED posts, pending waivers and
// EMPTY/TOMORROW announcements.

import type { Offer, Snapshot } from "../shared/types.js";
import type { DockClient, SeedSpec } from "./dock.js";
import type { Bus, BusAgent, BusMsg } from "./bus.js";
import { parseLine, fmt, type Parsed, type SettleAssign } from "./grammar.js";
import { hhmm, SLOT_MIN } from "./clock.js";
import { DISPATCHER_HANDLE } from "./personas.js";
import { DOOR_TYPES } from "./brain.js";

const THREAD_DEADLINE_MIN = Number(process.env.THREAD_DEADLINE_MIN ?? 10);
const AUCTION_WINDOW_MIN = 180;
const AUCTION_CLOSE_MIN = Number(process.env.AUCTION_CLOSE_MIN ?? 10);

export type DispatcherHandle = {
  agent: BusAgent;
  inject: {
    seed(spec: SeedSpec): Promise<Snapshot>;
    request(carrier: string, truckId: string, door: number, startMin: number): Promise<void>;
    reportEta(truckId: string, etaMin: number): Promise<void>;
    setDoor(door: number, open: boolean): Promise<void>;
    prioritize(truckId: string): Promise<void>;
    arrive(truckId: string): Promise<void>;
    done(truckId: string): Promise<void>;
    overrun(truckId: string, extraMin: number): Promise<void>;
    setSpeed(speed: number): Promise<void>;
  };
  snapshot(): Promise<Snapshot>;
  close(): Promise<void>;
};

type PendingVerify = { handle: string; truckId?: string; door: number; startMin: number; load?: string };

export async function startDispatcher(dock: DockClient, bus: Bus): Promise<DispatcherHandle> {
  const agent = await bus.register(DISPATCHER_HANDLE);

  // One serial queue for ALL actor interactions. Top-level entry points enqueue
  // a whole unit of work; inside that unit dock calls run directly (never via
  // call(), or the task would deadlock waiting on itself).
  let queue: Promise<unknown> = Promise.resolve();
  const call = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
  };
  const later = (fn: () => Promise<void>) => {
    queue = queue.then(fn).catch((e) => console.warn(`[dispatcher] ${e}`));
  };

  // Ordered post queue — bus posts never block the actor queue.
  let postQ: Promise<unknown> = Promise.resolve();
  const postLater = (text: string, thread?: string): Promise<string> => {
    const p = postQ.then(() => agent.post(text, { thread }).then((r) => r.id));
    postQ = p.catch(() => {});
    return p;
  };

  let lastSnap: Snapshot | null = null;
  let lastSeq = 0;
  const offerThreads = new Map<string, string>();        // offerId -> relay thread root
  const rootToOffer = new Map<string, string>();         // relay thread root -> offerId
  const pendingVerifies = new Map<string, PendingVerify>();
  const auctionedSlots = new Set<string>();
  const pendingWaivers = new Set<string>();
  const carrierBids = new Map<string, Set<string>>();
  let prevCoverage = new Map<string, boolean>();
  const stretch = new Map<string, number>();
  const lostSlots = new Map<string, { door: number; startMin: number }>();
  const knownAppts = new Map<string, { door: number; startMin: number }>();
  const noAuctionSlots = new Set<string>();           // freed by done() — EMPTY beat is a backhaul, not an auction

  const simNow = () => lastSnap?.simMin ?? 0;

  /** relay thread id -> actor thread id (`th-${offerId}`) so the dashboard
   *  indents chatter under the right thread */
  function actorThreadOf(msg: BusMsg): string | undefined {
    const offerId = rootToOffer.get(msg.thread ?? msg.id);
    return offerId ? `th-${offerId}` : msg.thread;
  }

  function trackAppts(snap: Snapshot) {
    const now = new Map<string, { door: number; startMin: number }>();
    for (const a of snap.appts) {
      if (a.status === "booked") now.set(a.truckId, { door: a.door, startMin: a.startMin });
    }
    for (const [truckId, slot] of knownAppts) {
      const cur = now.get(truckId);
      if (!cur || cur.door !== slot.door || cur.startMin !== slot.startMin) lostSlots.set(truckId, slot);
    }
    for (const [k, v] of now) knownAppts.set(k, v);
  }

  /** holder of the slot the carrier will want (movable, different carrier,
   *  compatible door, start >= max(eta, now) and earlier than the offer) */
  function findHolder(offer: Offer, snap: Snapshot, wanted?: { door: number; startMin: number }) {
    const truck = snap.trucks.find((t) => t.id === offer.truckId);
    if (!truck) return undefined;
    const now = snap.simMin;
    const prev = lostSlots.get(offer.truckId);
    type Cand = { door: number; startMin: number; carrier: string; truckId: string; isPrev: boolean };
    const cands: Cand[] = [];
    const push = (door: number, startMin: number, carrier: string, truckId: string) => {
      if (carrier === offer.carrier || truckId === offer.truckId) return;
      if (!wanted && !(startMin >= Math.max(truck.etaMin, now) && startMin < offer.startMin)) return;
      if (startMin % SLOT_MIN !== 0) return; // holders sit on hour slots
      if (DOOR_TYPES[door] !== truck.type) return;
      cands.push({ door, startMin, carrier, truckId, isPrev: !!prev && prev.door === door && prev.startMin === startMin });
    };
    if (wanted) {
      const a = snap.appts.find((x) => x.door === wanted.door && x.startMin === wanted.startMin && x.status === "booked");
      const t = a && snap.trucks.find((z) => z.id === a.truckId);
      if (a && t) push(a.door, a.startMin, t.carrier, a.truckId);
    } else {
      for (const a of snap.appts) {
        if (a.status !== "booked") continue;
        const t = snap.trucks.find((z) => z.id === a.truckId);
        if (t) push(a.door, a.startMin, t.carrier, a.truckId);
      }
      for (const o of snap.offers) {
        if (o.status === "open") push(o.door, o.startMin, o.carrier, o.truckId);
      }
    }
    cands.sort((x, y) => Number(y.isPrev) - Number(x.isPrev) || x.startMin - y.startMin || x.door - y.door);
    const c = cands[0];
    return c ? { carrier: c.carrier, truckId: c.truckId, door: c.door, startMin: c.startMin } : undefined;
  }

  // NOTE: everything below runs inside the queue — dock calls are direct.

  async function postOffer(offer: Offer, wanted?: { door: number; startMin: number }) {
    const snap = lastSnap ?? (await dock.snapshot());
    const closes = Math.round(snap.simMin + THREAD_DEADLINE_MIN);
    // actor thread first (inside the actor queue), then the Relay post on the
    // post queue — the post round-trip never blocks actor calls.
    await dock.openThread(`th-${offer.id}`, offer.id, closes);
    const holder = findHolder(offer, snap, wanted);
    const text = fmt.offer({ offerId: offer.id, truckId: offer.truckId, door: offer.door,
      startMin: offer.startMin, reason: offer.reason, holder, closesMin: closes });
    void postLater(text).then((root) => {
      offerThreads.set(offer.id, root);
      rootToOffer.set(root, offer.id);
    });
  }
  async function postOffers(offers: Offer[] | undefined) {
    for (const o of offers ?? []) await postOffer(o);
  }

  function coverageOf(snap: Snapshot): Map<string, boolean> {
    const cov = new Map<string, boolean>();
    for (const a of snap.appts) {
      if (a.status !== "booked" && a.status !== "arrived" && a.status !== "unloading") continue;
      const end = a.startMin + SLOT_MIN + (stretch.get(a.truckId) ?? 0);
      for (let h = a.startMin; h < end; h += SLOT_MIN) cov.set(`${a.door}@${h}`, true);
    }
    for (const o of snap.offers) {
      if (o.status === "open") cov.set(`${o.door}@${o.startMin}`, true);
    }
    return cov;
  }

  async function detectFreed(snap: Snapshot) {
    const cov = coverageOf(snap);
    const now = snap.simMin;
    const freed: { door: number; startMin: number }[] = [];
    for (const key of prevCoverage.keys()) {
      if (cov.has(key)) continue;
      const [door, start] = key.split("@").map(Number);
      if (start! + SLOT_MIN >= now && start! <= now + AUCTION_WINDOW_MIN &&
          !auctionedSlots.has(key) && !noAuctionSlots.has(key)) {
        freed.push({ door: door!, startMin: start! });
      }
    }
    for (const key of [...auctionedSlots]) if (cov.has(key)) auctionedSlots.delete(key);
    prevCoverage = cov;
    for (const f of freed) await openAuctionFor(f.door, f.startMin, `slot freed at door ${f.door} ${hhmm(f.startMin)}`);
  }

  async function openAuctionFor(door: number, startMin: number, why: string) {
    const key = `${door}@${startMin}`;
    if (auctionedSlots.has(key)) return;
    auctionedSlots.add(key);
    // The Dock actor opens an auction itself when its arrival-check alarm turns a truck into a no-show;
    // reuse that one instead of opening a second auction on the same slot.
    const existing = lastSnap?.auctions.find((a) => a.door === door && a.startMin === startMin && a.status === "open");
    if (existing) {
      postLater(fmt.auction({ auctionId: existing.id, door, startMin, why, closesMin: existing.closesMin }));
      return;
    }
    const closes = Math.round(simNow() + AUCTION_CLOSE_MIN);
    const { auction } = await dock.openAuction(door, startMin, closes);
    postLater(fmt.auction({ auctionId: auction.id, door, startMin, why, closesMin: closes }));
  }

  // ---- SETTLE ------------------------------------------------------------------

  function slotsOf(snap: Snapshot, truckId: string): { door: number; startMin: number }[] {
    const s: { door: number; startMin: number }[] = [];
    for (const a of snap.appts) if (a.truckId === truckId && a.status === "booked") s.push({ door: a.door, startMin: a.startMin });
    for (const o of snap.offers) if (o.truckId === truckId && o.status === "open") s.push({ door: o.door, startMin: o.startMin });
    return s;
  }

  async function handleSettle(m: BusMsg, p: Extract<Parsed, { verb: "SETTLE" }>) {
    const snap = lastSnap ?? (await dock.snapshot());
    // already settled once — a replayed/conflicting SETTLE loses; a SETTLE on
    // an expired thread loses to the clock
    const prior = snap.threads.find((t) => t.offerId === p.offerId);
    if (prior && prior.status === "settled") {
      postLater(fmt.rejected(p.offerId, "thread already settled"), m.thread);
      return;
    }
    if (prior && prior.status === "expired") {
      postLater(fmt.rejected(p.offerId, "thread closed, the clock decided"), m.thread);
      return;
    }
    const pairs: [string, string][] = [];
    const remaining = [...p.assigns];
    const holds = (t: SettleAssign) =>
      slotsOf(snap, t.truckId).some((s) => s.door === t.door && s.startMin === t.startMin);
    while (remaining.length) {
      const a = remaining.shift()!;
      if (holds(a)) continue; // already in place
      const partnerIdx = remaining.findIndex((b) =>
        slotsOf(snap, b.truckId).some((s) => s.door === a.door && s.startMin === a.startMin) &&
        slotsOf(snap, a.truckId).some((s) => s.door === b.door && s.startMin === b.startMin));
      if (partnerIdx < 0) {
        postLater(fmt.rejected(p.offerId,
          `${a.truckId} door ${a.door} ${hhmm(a.startMin)} is not a swap of current slots`), m.thread);
        return;
      }
      const b = remaining.splice(partnerIdx, 1)[0]!;
      pairs.push([a.truckId, b.truckId]);
    }
    for (const [ta, tb] of pairs) {
      const r = await dock.swap(ta, tb);
      if (!r.ok) { postLater(fmt.rejected(p.offerId, r.reason ?? "swap failed"), m.thread); return; }
    }
    for (const pay of p.pays) {
      const r = await dock.pay(pay.from, pay.to, pay.usd);
      if (!r.ok) { postLater(fmt.rejected(p.offerId, r.reason ?? "pay failed"), m.thread); return; }
    }
    for (const w of p.waives) {
      const r = await dock.resolveClaim(w, "waived");
      if (!r.claim) pendingWaivers.add(w);
    }
    await dock.settleThread(`th-${p.offerId}`);
    postLater(fmt.confirmed(p.offerId, "settled by the actor"), m.thread);
  }

  // ---- actions -----------------------------------------------------------------

  function roster(snap: Snapshot): Set<string> {
    return new Set(snap.trucks.map((t) => t.carrier));
  }

  async function handleRequest(msg: BusMsg, p: Extract<Parsed, { verb: "REQUEST" }>) {
    const snap = lastSnap ?? (await dock.snapshot());
    if (!roster(snap).has(msg.from)) {
      pendingVerifies.set(msg.thread ?? msg.id, {
        handle: msg.from, truckId: p.truckId, door: p.door, startMin: p.startMin, load: p.load,
      });
      postLater(fmt.verifyAsk(msg.from, p.load ?? "?",
        `unknown carrier requesting door ${p.door} at ${hhmm(p.startMin)} — @broker, yours?`), msg.thread ?? msg.id);
      return;
    }
    const truckId = p.truckId ?? snap.trucks.find((t) => t.carrier === msg.from)?.id ?? "T0";
    const r = await dock.request(msg.from, truckId, p.door, p.startMin);
    if (r.offer) await postOffer(r.offer, { door: p.door, startMin: p.startMin });
    else if (r.appt) postLater(`booked ${truckId} door ${p.door} ${hhmm(p.startMin)}`, msg.thread);
  }

  async function actOn(msg: BusMsg, p: Parsed) {
    switch (p.verb) {
      case "SETTLE": await handleSettle(msg, p); return;
      case "BID": {
        const set = carrierBids.get(p.auctionId) ?? new Set<string>();
        if (set.has(msg.from)) return;
        set.add(msg.from);
        carrierBids.set(p.auctionId, set);
        const r = await dock.bid(p.auctionId, p.truckId, p.readyMin);
        if (!r.ok) postLater(fmt.rejected(p.auctionId, r.reason ?? "bid failed"), msg.thread);
        return;
      }
      case "accept": {
        const r = await dock.accept(p.offerId);
        if (!r.ok) postLater(fmt.rejected(p.offerId, r.reason ?? "accept failed"), msg.thread);
        else await dock.settleThread(`th-${p.offerId}`);
        return;
      }
      case "counter": {
        const r = await dock.counter(p.offerId, p.door, p.startMin);
        if (!r.ok) postLater(fmt.rejected(p.offerId, r.reason ?? "counter failed"), msg.thread);
        else await postOffers(r.offers);
        return;
      }
      case "decline": {
        const r = await dock.decline(p.offerId);
        await postOffers(r.offers);
        return;
      }
      case "REQUEST": await handleRequest(msg, p); return;
      case "VERIFY": {
        if (p.answer && msg.thread && pendingVerifies.has(msg.thread)) {
          const v = pendingVerifies.get(msg.thread)!;
          pendingVerifies.delete(msg.thread);
          if (p.answer === "yes") {
            const r = await dock.request(v.handle, v.truckId ?? "T0", v.door, v.startMin);
            if (r.offer) await postOffer(r.offer);
            else if (r.appt) postLater(`booked ${v.truckId ?? "?"} door ${v.door} ${hhmm(v.startMin)}`, msg.thread);
          } else {
            postLater(fmt.refused(v.handle, "the broker won't vouch for the load"), msg.thread);
          }
        }
        return;
      }
      case "BACKHAUL": {
        if (p.accept && dock.backhaul) await dock.backhaul(p.truckId);
        return;
      }
      case "BOOK":
        // CONTRACT GAP (needs Person A): no actor method for tomorrow bookings;
        // pier9-ops answers with BOOKED, we only mirror.
        return;
      default: return;
    }
  }

  // ---- snapshot events ----------------------------------------------------------

  async function onEvents(snap: Snapshot) {
    // The actor's onConnect frame may be the pre-seed state, and frames can arrive out of order:
    // never let an older snapshot roll coverage back (that would "free" every booked slot).
    if ((snap as { seeded?: boolean }).seeded === false) return;
    const lastEvt = snap.events.at(-1)?.seq ?? 0;
    if (lastEvt < lastSeq && !snap.events.some((e) => e.kind === "seed" && e.seq === 1)) return;
    const fresh = snap.events.filter((e) => e.seq > lastSeq);
    lastSeq = Math.max(lastSeq, ...snap.events.map((e) => e.seq), 0);
    trackAppts(snap);
    for (const e of fresh) {
      switch (e.kind) {
        case "noshow": {
          const appt = snap.appts.find((a) => a.truckId === e.truckId && a.status === "noshow");
          if (appt) await openAuctionFor(appt.door, appt.startMin, `no-show at door ${appt.door} ${hhmm(appt.startMin)}`);
          break;
        }
        case "detention": {
          if (e.truckId && pendingWaivers.has(e.truckId)) {
            pendingWaivers.delete(e.truckId);
            await dock.resolveClaim(e.truckId, "waived");
          }
          break;
        }
        case "auction_closed": {
          const a = snap.auctions.find((x) => x.id === e.auctionId);
          if (a && !a.winner && a.bids.length) {
            const winner = [...a.bids].sort((x, y) => x.readyMin - y.readyMin ||
              (snap.trucks.find((t) => t.id === y.truckId)?.priority ?? 0) -
              (snap.trucks.find((t) => t.id === x.truckId)?.priority ?? 0))[0]!;
            const r = await dock.award(a.id, winner.truckId);
            if (r.auction) postLater(fmt.awarded(a.id, winner.truckId, a.door, a.startMin));
          }
          break;
        }
        case "thread_expired": {
          const offer = snap.offers.find((o) => o.id === e.offerId);
          if (offer && offer.status === "open") {
            await dock.accept(offer.id);
            postLater(fmt.expired(offer.id, offer.truckId, offer.door, offer.startMin), offerThreads.get(offer.id));
          }
          break;
        }
        case "overrun": {
          const extra = /\+(\d+)/.exec(e.detail)?.[1];
          if (e.truckId) stretch.set(e.truckId, (stretch.get(e.truckId) ?? 0) + (extra ? +extra : 0));
          break;
        }
        case "empty": {
          const appt = snap.appts.find((a) => a.truckId === e.truckId && a.status === "done");
          if (appt) noAuctionSlots.add(`${appt.door}@${appt.startMin}`);
          postLater(fmt.empty(e.truckId ?? "?", appt?.door ?? 0));
          break;
        }
        case "tomorrow": {
          if (e.truckId) postLater(fmt.tomorrow(e.truckId));
          break;
        }
        default: break;
      }
    }
    await detectFreed(snap);
  }

  dock.onSnapshot((snap) => {
    lastSnap = snap;
    later(() => onEvents(snap));
  });

  bus.onMessage((msg) => {
    const to = msg.mentions[0] ?? "#pier9";
    later(async () => {
      await dock.say(msg.from, to, msg.text, actorThreadOf(msg));
      if (msg.from !== DISPATCHER_HANDLE) await actOn(msg, parseLine(msg.text));
    });
  });

  return {
    agent,
    inject: {
      seed: (spec) => call(async () => {
        const s = await dock.seed(spec);
        lastSnap = s;
        lastSeq = Math.max(...s.events.map((e) => e.seq), 0);
        trackAppts(s);
        prevCoverage = coverageOf(s);
        return s;
      }),
      request: (carrier, truckId, door, startMin) => call(async () => {
        const r = await dock.request(carrier, truckId, door, startMin);
        if (r.offer) await postOffer(r.offer, { door, startMin });
      }),
      reportEta: (truckId, etaMin) => call(async () => {
        const r = await dock.reportEta(truckId, etaMin);
        await postOffers(r.offers);
      }),
      setDoor: (door, open) => call(async () => {
        const r = await dock.setDoor(door, open);
        await postOffers(r.offers);
      }),
      prioritize: (truckId) => call(async () => {
        const r = await dock.prioritize(truckId);
        await postOffers(r.offers);
      }),
      arrive: (truckId) => call(() => dock.arrive(truckId).then(() => {})),
      done: (truckId) => call(() => dock.done(truckId).then(() => {})),
      overrun: (truckId, extraMin) => call(async () => {
        const r = await dock.overrun(truckId, extraMin);
        await postOffers(r.offers);
      }),
      setSpeed: (speed) => call(async () => {
        if (dock.setSpeed) await dock.setSpeed(speed);
      }),
    },
    snapshot: () => call(() => dock.snapshot()),
    async close() {
      await queue.catch(() => {});
      await postQ.catch(() => {});
    },
  };
}
