// MockDock — in-memory DockClient faithful to PLAN's contract and to
// "replan(), kept deliberately dumb" (PLAN.md). Sim clock: simMin counts
// minutes since 08:00; speed = sim minutes per real second (1 = "60x");
// setSpeed(0) freezes. One underlying timeout mirrors the single Terse alarm;
// a timer table sits behind it (decision 4).

import type { Appt, Auction, Claim, Door, Event, Offer, Snapshot, Thread, Truck } from "../shared/types.js";
import type { CounterResult, DockClient, OkResult, RequestResult, SeedSpec } from "./dock.js";
import { SLOT_MIN, slotCeil, hhmm } from "./clock.js";

export interface Clock {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export const RealClock: Clock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class ManualClock implements Clock {
  t = 0;
  private pending: { at: number; cb: () => void }[] = [];
  now() { return this.t; }
  setTimeout(cb: () => void, ms: number) { const p = { at: this.t + ms, cb }; this.pending.push(p); return p; }
  clearTimeout(h: unknown) { this.pending = this.pending.filter((p) => p !== h); }
  /** advance real ms; fires pending timeouts in order */
  advance(ms: number) {
    const until = this.t + ms;
    for (;;) {
      const next = this.pending.filter((p) => p.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.t = next.at;
      this.pending = this.pending.filter((p) => p !== next);
      next.cb();
    }
    this.t = until;
  }
}

type Timer = {
  atMin: number;
  kind: "arrival_check" | "detention" | "auction_close" | "thread_deadline";
  truckId?: string; startMin?: number; auctionId?: string; threadId?: string;
  fired: boolean;
};

type ReplanOpts = {
  pins?: Map<string, { door: number; startMin: number }>;
  slideDoor?: number;           // overrun: the whole booked queue behind the truck slides
  evictBelow?: number;          // prioritize/counter: may evict movable appts with priority < this
  force?: Appt[];               // explicitly displaced appts (hot-load victim) to re-slot
};

const OCCUPYING = new Set(["booked", "arrived", "unloading"]);
const FIXED = new Set(["arrived", "unloading", "done"]);
const DETENTION_MIN = 120;      // arrived+120 -> detention event + auto claim
const ARRIVAL_GRACE_MIN = 30;   // start+30 -> noshow
const DAY_END_MIN = 600;        // 18:00

export class MockDock implements DockClient {
  private doors: Door[] = [];
  private trucks: Truck[] = [];
  private appts: Appt[] = [];
  private offers: Offer[] = [];
  private auctions: Auction[] = [];
  private threads: Thread[] = [];
  private claims: Claim[] = [];
  private chatter: Snapshot["chatter"] = [];
  private events: Event[] = [];
  private timers: Timer[] = [];
  private counters = { detentionAvoidedUsd: 0, sidePaymentsUsd: 0, phoneCalls: 0 as 0, moves: 0, backhauls: 0 };
  private stretch = new Map<string, number>();
  private seq = 0; private chatSeq = 0; private offerSeq = 0; private auctionSeq = 0;

  private clock: Clock;
  private baseSimMin = 0;
  private baseRealMs = 0;
  private speed = 1;
  private alarmHandle: unknown = null;
  private subs = new Set<(s: Snapshot) => void>();
  private pendingEmit = false;

  constructor(clock: Clock = RealClock) {
    this.clock = clock;
  }

  // ---- sim clock ----------------------------------------------------------

  simNow(): number {
    return this.baseSimMin + ((this.clock.now() - this.baseRealMs) / 1000) * this.speed;
  }
  private resetClock(simMin: number, speed: number) {
    this.baseSimMin = simMin;
    this.baseRealMs = this.clock.now();
    this.speed = speed;
    this.scheduleAlarm();
  }

  // ---- snapshot / events ----------------------------------------------------

  private ev(kind: Event["kind"], detail: string, extra: Partial<Event> = {}) {
    this.events.push({ seq: ++this.seq, atMin: Math.round(this.simNow() * 100) / 100, kind, detail, ...extra });
  }

  private buildSnapshot(): Snapshot {
    const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
    return {
      simMin: Math.round(this.simNow() * 100) / 100,
      speed: this.speed,
      doors: clone(this.doors), trucks: clone(this.trucks), appts: clone(this.appts),
      offers: clone(this.offers), auctions: clone(this.auctions), threads: clone(this.threads),
      claims: clone(this.claims), chatter: clone(this.chatter), events: clone(this.events),
      counters: { ...this.counters },
    };
  }
  snapshotSync(): Snapshot { return this.buildSnapshot(); }

  private emit() {
    if (this.pendingEmit) return;
    this.pendingEmit = true;
    queueMicrotask(() => {
      this.pendingEmit = false;
      const snap = this.buildSnapshot();
      for (const cb of this.subs) cb(snap);
    });
  }

  onSnapshot(cb: (s: Snapshot) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  async close() {
    if (this.alarmHandle != null) this.clock.clearTimeout(this.alarmHandle);
    this.subs.clear();
  }

  // ---- timers ----------------------------------------------------------------

  private addTimer(t: Omit<Timer, "fired">) {
    this.timers.push({ ...t, fired: false });
    this.scheduleAlarm();
  }

  private scheduleAlarm() {
    if (this.alarmHandle != null) { this.clock.clearTimeout(this.alarmHandle); this.alarmHandle = null; }
    if (this.speed <= 0) return;
    const next = this.timers.filter((t) => !t.fired).sort((a, b) => a.atMin - b.atMin)[0];
    if (!next) return;
    const ms = ((next.atMin - this.simNow()) / this.speed) * 1000;
    this.alarmHandle = this.clock.setTimeout(() => this.onAlarm(), Math.max(0, ms));
  }

  private onAlarm() {
    this.alarmHandle = null;
    const due = this.timers.filter((t) => !t.fired && t.atMin <= this.simNow() + 1e-6)
      .sort((a, b) => a.atMin - b.atMin);
    for (const t of due) {
      t.fired = true;
      this.fireTimer(t);
    }
    this.scheduleAlarm();
    this.emit();
  }

  private fireTimer(t: Timer) {
    switch (t.kind) {
      case "arrival_check": {
        const appt = this.appts.find((a) => a.truckId === t.truckId && a.startMin === t.startMin);
        if (appt && appt.status === "booked") {
          appt.status = "noshow";
          this.ev("noshow", `${t.truckId} no-show; door ${appt.door} ${hhmm(appt.startMin)} released`, { truckId: t.truckId });
        }
        break;
      }
      case "detention": {
        const appt = this.appts.find((a) => a.truckId === t.truckId && (a.status === "arrived" || a.status === "unloading"));
        if (appt) {
          this.ev("detention", `${t.truckId} in detention at door ${appt.door}`, { truckId: t.truckId });
          this.fileClaimSync(t.truckId!);
        }
        break;
      }
      case "auction_close": {
        const a = this.auctions.find((x) => x.id === t.auctionId);
        if (a && !a.winner) this.ev("auction_closed", `auction ${a.id} door ${a.door} closed`, { auctionId: a.id });
        break;
      }
      case "thread_deadline": {
        const th = this.threads.find((x) => x.id === t.threadId);
        if (th && th.status === "open") {
          th.status = "expired";
          this.ev("thread_expired", `thread ${th.id} expired with no settlement`, { threadId: th.id, offerId: th.offerId });
        }
        break;
      }
    }
  }

  // ---- occupancy --------------------------------------------------------------

  private endOf(a: Appt): number {
    return a.startMin + SLOT_MIN + (this.stretch.get(a.truckId) ?? 0);
  }

  private door(id: number): Door {
    const d = this.doors.find((x) => x.id === id);
    if (!d) throw new Error(`no door ${id}`);
    return d;
  }
  private truck(id: string): Truck {
    const t = this.trucks.find((x) => x.id === id);
    if (!t) throw new Error(`no truck ${id}`);
    return t;
  }

  /** Is interval [s,e) on `door` covered by another truck's occupying appt? */
  private covered(door: number, s: number, e: number, exclude?: Appt): boolean {
    return this.appts.some((a) =>
      a !== exclude && a.door === door && OCCUPYING.has(a.status) &&
      a.startMin < e && this.endOf(a) > s);
  }

  /** movable booked appt occupying [s,s+60) start on door */
  private apptAt(door: number, startMin: number): Appt | undefined {
    return this.appts.find((a) => a.door === door && a.startMin === startMin && OCCUPYING.has(a.status));
  }

  /** booked appt, open offer, or stretched occupancy holds this hour slot */
  private slotTaken(door: number, h: number): boolean {
    return !!this.apptAt(door, h) || this.covered(door, h, h + SLOT_MIN) ||
      this.offers.some((o) => o.status === "open" && o.door === door && o.startMin === h);
  }

  private doorFits(truck: Truck, door: Door, atMin: number): boolean {
    if (!door.open) return false;
    if (door.type === truck.type) return true;
    if (truck.type === "dry") {
      // dry may use a reefer door only when no open dry door is free at that hour
      return !this.doors.some((d) => d.open && d.type === "dry" && !this.covered(d.id, atMin, atMin + SLOT_MIN));
    }
    return false; // reefer never uses dry
  }

  /** a booked appt is infeasible when its door closed, eta passed its start, or it missed its window */
  private infeasible(a: Appt): boolean {
    if (a.status !== "booked") return false;
    const t = this.truck(a.truckId);
    if (!this.door(a.door).open) return true;
    if (a.startMin < t.etaMin) return true;
    if (this.simNow() > a.startMin + ARRIVAL_GRACE_MIN) return true;
    return false;
  }

  // ---- replan() — kept deliberately dumb --------------------------------------

  /**
   * Re-slots infeasible `booked` appts into open Offers. Fixed statuses never move.
   * Order: priority desc, eta asc, current start asc. Earliest hour slot >=
   * max(eta, now) on an open compatible door; prefers the current door.
   * Door-closed displacements first try their same start on another door
   * (minimizes moves). opts.slideDoor: the door whose queue slides (overrun) —
   * every booked appt behind the stretched truck is re-slotted and may evict
   * into that door's next slots.
   */
  private replan(opts: ReplanOpts = {}, reason = "replanned"): { offers: Offer[]; evictedHighPriority: boolean } {
    const before = new Map(this.appts.map((a) => [a, { door: a.door, startMin: a.startMin }] as const));
    const newOffers: Offer[] = [];
    let evictedHighPriority = false;

    // 1. pins first: place each pinned truck, evicting movable occupants
    const queue: { appt: Appt; viaSlide: boolean; viaClosed: boolean }[] = [];
    if (opts.pins) {
      for (const [truckId, slot] of opts.pins) {
        const truck = this.truck(truckId);
        const occupant = this.apptAt(slot.door, slot.startMin);
        if (occupant && occupant.truckId !== truckId) {
          if (occupant.status === "booked" && this.truck(occupant.truckId).priority < (opts.evictBelow ?? 99)) {
            queue.push({ appt: occupant, viaSlide: false, viaClosed: false });
            this.appts = this.appts.filter((x) => x !== occupant);
          } else {
            evictedHighPriority = true;
            continue;
          }
        }
        this.placeBooked(truckId, slot.door, slot.startMin);
      }
    }

    // 2. collect infeasible booked appts (and explicitly displaced ones)
    for (const a of opts.force ?? []) {
      if (!queue.some((q) => q.appt === a)) queue.push({ appt: a, viaSlide: false, viaClosed: false });
    }
    for (const a of this.appts) {
      if (a.status === "booked" && this.infeasible(a) && !queue.some((q) => q.appt === a)) {
        queue.push({ appt: a, viaSlide: false, viaClosed: !this.door(a.door).open });
      }
    }
    // 3. overrun slide: every booked appt on the door behind the stretched truck
    if (opts.slideDoor != null) {
      const stretched = this.appts.find((a) => a.door === opts.slideDoor && this.stretch.get(a.truckId));
      if (stretched) {
        for (const a of this.appts) {
          if (a.door === opts.slideDoor && a.status === "booked" && a.startMin > stretched.startMin &&
              !queue.some((q) => q.appt === a)) {
            queue.push({ appt: a, viaSlide: true, viaClosed: false });
          }
        }
      }
    }

    // 4. order: priority desc, eta asc, current start asc
    queue.sort((x, y) => {
      const ta = this.truck(x.appt.truckId); const tb = this.truck(y.appt.truckId);
      return tb.priority - ta.priority || ta.etaMin - tb.etaMin || x.appt.startMin - y.appt.startMin;
    });

    // 5. drop the queued appts and re-slot each into an offer
    const toReslot = queue.map((q) => q);
    const processed = new Set<Appt>();
    for (const q of toReslot) {
      const a = q.appt;
      if (processed.has(a)) continue;
      processed.add(a);
      const old = before.get(a) ?? { door: a.door, startMin: a.startMin };
      this.appts = this.appts.filter((x) => x !== a);
      const t = this.truck(a.truckId);
      const now = this.simNow();
      let placed: { door: number; startMin: number } | null = null;

      // door-closed trucks first try their same start on another compatible door
      if (q.viaClosed) {
        for (const d of [...this.doors].sort((p, r) => p.id - r.id)) {
          if (this.doorFits(t, d, a.startMin) && !this.covered(d.id, a.startMin, a.startMin + SLOT_MIN)) {
            placed = { door: d.id, startMin: a.startMin };
            break;
          }
        }
      }

      if (!placed) {
        const earliest = slotCeil(Math.max(t.etaMin, now));
        const prefer = [...this.doors].sort((p, r) =>
          (p.id === a.door ? -1 : 0) - (r.id === a.door ? -1 : 0) || p.id - r.id);
        const scan = (doors: Door[], evict: boolean) => {
          for (const d of doors) {
            if (placed) return;
            for (let h = earliest; h <= DAY_END_MIN && !placed; h += SLOT_MIN) {
              if (t.hosLimitMin != null && h + SLOT_MIN > t.hosLimitMin) {
                a.status = "tomorrow";
                this.appts.push(a);
                this.ev("tomorrow", `${t.id} slot would end past ${hhmm(t.hosLimitMin)} — rolled to tomorrow`, { truckId: t.id });
                placed = { door: -1, startMin: -1 };
                return;
              }
              if (!this.doorFits(t, d, h)) continue;
              if (!this.slotTaken(d.id, h)) { placed = { door: d.id, startMin: h }; return; }
              const occupant = this.apptAt(d.id, h);
              if (occupant && occupant.status === "booked" && evict &&
                  this.truck(occupant.truckId).priority < (opts.evictBelow ?? t.priority + 1)) {
                this.appts = this.appts.filter((x) => x !== occupant);
                if (!toReslot.some((r) => r.appt === occupant)) {
                  toReslot.push({ appt: occupant, viaSlide: false, viaClosed: false });
                }
                placed = { door: d.id, startMin: h };
                return;
              }
            }
          }
        };
        // a slid truck stays in the same queue first (the slide door, evicting
        // movable occupants); everyone else prefers their current door.
        if (q.viaSlide && opts.slideDoor != null) scan([this.door(opts.slideDoor)], true);
        if (!placed) scan(prefer, opts.evictBelow != null);
      }

      if (!placed) {
        // no slot today — truck goes to the queue (no appointment)
        this.ev("replanned", `${t.id} has no feasible slot — queued`, { truckId: t.id });
        continue;
      }
      if (placed.door === -1) continue; // rolled to tomorrow

      const offer: Offer = {
        id: `o${++this.offerSeq}`, truckId: t.id, carrier: t.carrier,
        door: placed.door, startMin: placed.startMin,
        reason, status: "open",
      };
      this.offers.push(offer);
      newOffers.push(offer);
      this.ev("replanned", `${t.id} door ${old.door} ${hhmm(old.startMin)} -> door ${placed.door} ${hhmm(placed.startMin)}`, { truckId: t.id, offerId: offer.id });
      this.counters.moves++;
      if (placed.startMin < old.startMin) {
        this.counters.detentionAvoidedUsd += Math.round(75 * (old.startMin - placed.startMin) / 60);
      }
    }

    return { offers: newOffers, evictedHighPriority };
  }

  /** create or move a truck's booked appt to (door,startMin); consumes its open offer there if any */
  private placeBooked(truckId: string, door: number, startMin: number) {
    const open = this.offers.find((o) => o.truckId === truckId && o.status === "open");
    if (open) open.status = "accepted";
    const existing = this.appts.find((a) => a.truckId === truckId && a.door === door && a.startMin === startMin);
    if (existing) { existing.status = "booked"; return; }
    this.appts.push({ truckId, door, startMin, status: "booked" });
  }

  private makeOffer(truckId: string, door: number, startMin: number, reason: string): Offer {
    const o: Offer = { id: `o${++this.offerSeq}`, truckId, carrier: this.truck(truckId).carrier,
      door, startMin, reason, status: "open" };
    this.offers.push(o);
    this.ev("offer", `offer ${o.id}: ${truckId} door ${door} ${hhmm(startMin)} — ${reason}`, { truckId, offerId: o.id });
    return o;
  }

  // ---- contract methods ------------------------------------------------------

  async seed(scenario: SeedSpec): Promise<Snapshot> {
    this.doors = scenario.doors.map((d) => ({ ...d }));
    this.trucks = scenario.trucks.map((t) => ({ ...t }));
    this.appts = [];
    this.offers = []; this.auctions = []; this.threads = []; this.claims = [];
    this.chatter = []; this.events = []; this.timers = []; this.stretch.clear();
    this.counters = { detentionAvoidedUsd: 0, sidePaymentsUsd: 0, phoneCalls: 0, moves: 0, backhauls: 0 };
    this.seq = 0; this.chatSeq = 0; this.offerSeq = 0; this.auctionSeq = 0;
    for (const a of scenario.appts) {
      this.appts.push({ truckId: a.truckId, door: a.door, startMin: a.startMin, status: a.status });
      if (a.arrivalCheck) {
        this.timers.push({ atMin: a.startMin + ARRIVAL_GRACE_MIN, kind: "arrival_check",
          truckId: a.truckId, startMin: a.startMin, fired: false });
      }
    }
    this.resetClock(0, scenario.speed ?? 1);
    this.ev("replanned", "seeded pier 9");
    const s = this.buildSnapshot();
    queueMicrotask(() => { for (const cb of this.subs) cb(s); });
    return s;
  }

  async request(carrier: string, truckId: string, door: number, startMin: number): Promise<RequestResult> {
    const truck = this.truck(truckId);
    const d = this.door(door);
    if (d.open && this.doorFits(truck, d, startMin) && !this.covered(door, startMin, startMin + SLOT_MIN)) {
      const appt: Appt = { truckId, door, startMin, status: "booked" };
      this.appts.push(appt);
      this.addTimer({ atMin: startMin + ARRIVAL_GRACE_MIN, kind: "arrival_check", truckId, startMin });
      this.emit();
      return { appt };
    }
    // collision: offer the next free hour on the same door
    this.ev("collision", `${truckId} wanted door ${door} ${hhmm(startMin)} — taken`, { truckId });
    const now = this.simNow();
    for (let h = slotCeil(Math.max(startMin + SLOT_MIN, truck.etaMin, now)); h <= DAY_END_MIN; h += SLOT_MIN) {
      if (!this.covered(door, h, h + SLOT_MIN) && this.doorFits(truck, d, h)) {
        const offer = this.makeOffer(truckId, door, h, `door ${door} ${hhmm(startMin)} was taken`);
        this.emit();
        return { offer };
      }
    }
    const offer = this.makeOffer(truckId, door, slotCeil(Math.max(truck.etaMin, now)), `door ${door} ${hhmm(startMin)} was taken`);
    this.emit();
    return { offer };
  }

  async reportEta(truckId: string, etaMin: number) {
    this.truck(truckId).etaMin = etaMin;
    const { offers } = this.replan({}, `eta moved to ${hhmm(etaMin)}`);
    this.emit();
    return { offers };
  }

  async setDoor(door: number, open: boolean) {
    this.door(door).open = open;
    const { offers } = this.replan({}, `door ${door} ${open ? "reopened" : "out of service"}`);
    this.emit();
    return { offers };
  }

  async prioritize(truckId: string) {
    const truck = this.truck(truckId);
    truck.priority = 2;
    this.ev("hot", `${truckId} is a hot load`, { truckId });
    const now = this.simNow();
    const earliest = slotCeil(Math.max(truck.etaMin, now));
    const current = this.appts.find((a) => a.truckId === truckId && a.status === "booked");
    const offers: Offer[] = [];
    if (!current || current.startMin > earliest) {
      // find the earliest hour it can take — free, or evict a lower-priority movable appt.
      // Eviction tie-break: highest door id first (documented; the dock hands the hot
      // load to the truck whose move costs the least negotiation).
      let placed = false;
      for (let h = earliest; h <= DAY_END_MIN && !placed; h += SLOT_MIN) {
        // prefer bumping a lower-priority movable appt on a same-type door over
        // taking a cross-type fallback slot
        const sameType = this.doors.filter((d) => d.type === truck.type).sort((a, b) => b.id - a.id);
        const victim = sameType
          .map((d) => this.apptAt(d.id, h))
          .find((a): a is Appt => !!a && a.status === "booked" && this.truck(a.truckId).priority < truck.priority);
        if (victim) {
          if (current) this.appts = this.appts.filter((a) => a !== current);
          this.appts = this.appts.filter((a) => a !== victim);
          this.appts.push({ truckId, door: victim.door, startMin: h, status: "booked" });
          const { offers: o } = this.replan({ force: [victim] }, "yield for hot load");
          offers.push(...o);
          placed = true;
          break;
        }
        const doorsDesc = [...this.doors].sort((x, y) => Number(y.type === truck.type) - Number(x.type === truck.type) || y.id - x.id);
        const free = doorsDesc.find((d) => this.doorFits(truck, d, h) && !this.apptAt(d.id, h) && !this.covered(d.id, h, h + SLOT_MIN));
        if (free) {
          if (current) this.appts = this.appts.filter((a) => a !== current);
          this.appts.push({ truckId, door: free.id, startMin: h, status: "booked" });
          placed = true;
          break;
        }
      }
    }
    this.emit();
    return { offers };
  }

  async accept(offerId: string): Promise<OkResult> {
    const o = this.offers.find((x) => x.id === offerId);
    if (!o || o.status !== "open") return { ok: false, reason: `offer ${offerId} not open` };
    const truck = this.truck(o.truckId);
    const d = this.door(o.door);
    if (!d.open) return { ok: false, reason: `door ${o.door} is closed` };
    if (this.covered(o.door, o.startMin, o.startMin + SLOT_MIN)) {
      return { ok: false, reason: `door ${o.door} ${hhmm(o.startMin)} was taken` };
    }
    o.status = "accepted";
    this.placeBooked(o.truckId, o.door, o.startMin);
    this.emit();
    return { ok: true };
  }

  async counter(offerId: string, door: number, startMin: number): Promise<CounterResult> {
    const o = this.offers.find((x) => x.id === offerId);
    if (!o || o.status !== "open") return { ok: false, reason: `offer ${offerId} not open`, offers: [] };
    const truck = this.truck(o.truckId);
    const d = this.door(door);
    if (!this.doorFits(truck, d, startMin)) {
      return { ok: false, reason: `${o.truckId} cannot use door ${door}`, offers: [] };
    }
    const occupant = this.apptAt(door, startMin);
    if (occupant && occupant.truckId !== o.truckId) {
      const other = this.truck(occupant.truckId);
      if (occupant.status !== "booked" || other.priority >= truck.priority) {
        return { ok: false, reason: `door ${door} ${hhmm(startMin)} held by ${occupant.truckId}`, offers: [] };
      }
    }
    const { offers } = this.replan(
      { pins: new Map([[o.truckId, { door, startMin }]]), evictBelow: truck.priority },
      `countered by ${o.truckId}`,
    );
    o.status = "accepted";
    this.emit();
    return { ok: true, offers };
  }

  async decline(offerId: string) {
    const o = this.offers.find((x) => x.id === offerId);
    if (o && o.status === "open") o.status = "declined";
    const { offers } = this.replan({}, `${o?.truckId ?? "?"} declined`);
    this.emit();
    return { offers };
  }

  /**
   * The slot a truck brings to a swap: its open offer if it has one (the live
   * negotiation), else the booked appt closest below the counterpart's slot —
   * that earlier slot is the thing the other side wants. Falls back to the
   * earliest booked appt.
   */
  private slotForSwap(truckId: string, otherStart: number): { door: number; startMin: number; offerId?: string } | null {
    const open = this.offers.find((o) => o.truckId === truckId && o.status === "open");
    if (open) return { door: open.door, startMin: open.startMin, offerId: open.id };
    const booked = this.appts.filter((a) => a.truckId === truckId && a.status === "booked");
    if (!booked.length) return null;
    const earlier = booked.filter((b) => b.startMin < otherStart).sort((a, b) => b.startMin - a.startMin)[0];
    const pick = earlier ?? [...booked].sort((a, b) => a.startMin - b.startMin)[0];
    return pick ? { door: pick.door, startMin: pick.startMin } : null;
  }

  private bookedAt(truckId: string, door: number, startMin: number): Appt | undefined {
    return this.appts.find((a) => a.truckId === truckId && a.status === "booked" &&
      a.door === door && a.startMin === startMin);
  }

  async swap(truckA: string, truckB: string): Promise<OkResult> {
    if (truckA === truckB) return { ok: false, reason: "same truck" };
    // first pass with a neutral estimate, then re-resolve against each other
    const ea = this.offers.find((o) => o.truckId === truckA && o.status === "open");
    const eb = this.offers.find((o) => o.truckId === truckB && o.status === "open");
    const guessA = ea?.startMin ?? this.appts.filter((a) => a.truckId === truckA && a.status === "booked").sort((x, y) => x.startMin - y.startMin)[0]?.startMin ?? 0;
    const guessB = eb?.startMin ?? this.appts.filter((a) => a.truckId === truckB && a.status === "booked").sort((x, y) => x.startMin - y.startMin)[0]?.startMin ?? 0;
    const sa = this.slotForSwap(truckA, guessB);
    const sb = this.slotForSwap(truckB, sa?.startMin ?? guessA);
    if (!sa) return { ok: false, reason: `${truckA} has no movable slot` };
    if (!sb) return { ok: false, reason: `${truckB} has no movable slot` };
    const ta = this.truck(truckA); const tb = this.truck(truckB);
    // door types must fit the slot each is moving into
    const da = this.door(sb.door); const db = this.door(sa.door);
    if (da.type !== ta.type || db.type !== tb.type) {
      return { ok: false, reason: `door type mismatch for ${truckA}/${truckB}` };
    }
    if (!da.open || !db.open) return { ok: false, reason: "door closed" };
    // apply atomically: each truck's chosen slot becomes the other's
    const apptA = this.bookedAt(truckA, sa.door, sa.startMin);
    const apptB = this.bookedAt(truckB, sb.door, sb.startMin);
    if (apptA) { apptA.door = sb.door; apptA.startMin = sb.startMin; }
    else this.appts.push({ truckId: truckA, door: sb.door, startMin: sb.startMin, status: "booked" });
    if (apptB) { apptB.door = sa.door; apptB.startMin = sa.startMin; }
    else this.appts.push({ truckId: truckB, door: sa.door, startMin: sa.startMin, status: "booked" });
    for (const oid of [sa.offerId, sb.offerId]) {
      const o = oid ? this.offers.find((x) => x.id === oid) : undefined;
      if (o) o.status = "accepted";
    }
    this.ev("swap", `${truckA} and ${truckB} swapped doors`, { truckId: truckA });
    this.emit();
    return { ok: true };
  }

  async overrun(truckId: string, extraMin: number) {
    const appt = this.appts.find((a) => a.truckId === truckId && OCCUPYING.has(a.status));
    if (!appt) return { offers: [] };
    if (appt.status === "booked") appt.status = "arrived"; // paperwork at the door — it is there
    this.stretch.set(truckId, (this.stretch.get(truckId) ?? 0) + extraMin);
    this.ev("overrun", `${truckId} overruns +${extraMin} at door ${appt.door}`, { truckId });
    const { offers } = this.replan({ slideDoor: appt.door }, "overrun slide");
    this.emit();
    return { offers };
  }

  async openAuction(door: number, startMin: number, closesMin: number) {
    const a: Auction = { id: `a${++this.auctionSeq}`, door, startMin, closesMin, bids: [] };
    this.auctions.push(a);
    this.addTimer({ atMin: closesMin, kind: "auction_close", auctionId: a.id });
    this.ev("auction_open", `auction ${a.id}: door ${door} ${hhmm(startMin)}`, { auctionId: a.id });
    this.emit();
    return { auction: a };
  }

  async bid(auctionId: string, truckId: string, readyMin: number): Promise<OkResult> {
    const a = this.auctions.find((x) => x.id === auctionId);
    if (!a || a.winner) return { ok: false, reason: `auction ${auctionId} closed` };
    if (a.bids.some((b) => b.truckId === truckId)) return { ok: false, reason: `${truckId} already bid` };
    const d = this.door(a.door); const t = this.truck(truckId);
    if (d.type !== t.type && !(t.type === "dry" && d.type === "reefer" && !this.doors.some((x) => x.open && x.type === "dry" && !this.covered(x.id, a.startMin, a.startMin + SLOT_MIN)))) {
      return { ok: false, reason: `${truckId} cannot use door ${a.door}` };
    }
    a.bids.push({ truckId, readyMin });
    this.emit();
    return { ok: true };
  }

  async award(auctionId: string, truckId: string) {
    const a = this.auctions.find((x) => x.id === auctionId);
    if (!a) return { reason: `no auction ${auctionId}` };
    if (a.winner) return { reason: `auction ${auctionId} already awarded` };
    a.winner = truckId;
    this.appts.push({ truckId, door: a.door, startMin: a.startMin, status: "booked" });
    this.emit();
    return { auction: a };
  }

  async openThread(threadId: string, offerId: string, deadlineMin: number) {
    const thread: Thread = { id: threadId, offerId, deadlineMin, status: "open" };
    this.threads.push(thread);
    this.addTimer({ atMin: deadlineMin, kind: "thread_deadline", threadId });
    this.emit();
    return { thread };
  }

  async settleThread(threadId: string) {
    const thread = this.threads.find((x) => x.id === threadId);
    if (!thread) return { reason: `no thread ${threadId}` };
    thread.status = "settled";
    this.emit();
    return { thread };
  }

  async pay(from: string, to: string, usd: number): Promise<OkResult> {
    this.counters.sidePaymentsUsd += usd;
    this.emit();
    return { ok: true };
  }

  async arrive(truckId: string): Promise<OkResult> {
    const appt = this.appts
      .filter((a) => a.truckId === truckId && a.status === "booked")
      .sort((a, b) => a.startMin - b.startMin)[0];
    if (!appt) return { ok: false, reason: `${truckId} has no booked slot` };
    appt.status = "arrived";
    this.addTimer({ atMin: this.simNow() + DETENTION_MIN, kind: "detention", truckId });
    this.emit();
    return { ok: true };
  }

  async done(truckId: string): Promise<OkResult> {
    const appt = this.appts
      .filter((a) => a.truckId === truckId && (a.status === "arrived" || a.status === "unloading" || a.status === "booked"))
      .sort((a, b) => a.startMin - b.startMin)[0];
    if (!appt) return { ok: false, reason: `${truckId} not at a door` };
    appt.status = "done";
    this.stretch.delete(truckId);
    this.ev("empty", `${truckId} done; door ${appt.door} free`, { truckId });
    this.emit();
    return { ok: true };
  }

  private fileClaimSync(truckId: string): Claim {
    // PLAN act 3: detention alarm auto-files at $75/h after the 2 free hours;
    // the claim at the 10:30 alarm is 120 min = $150.
    const overFree = Math.max(0, this.simNow() - DETENTION_MIN - this.arrivedAt(truckId));
    const minutes = DETENTION_MIN + Math.round(overFree);
    const claim: Claim = { truckId, carrier: this.truck(truckId).carrier, minutes,
      amount: Math.round(minutes * 75 / 60), status: "filed" };
    this.claims.push(claim);
    return claim;
  }
  private arrivedAt(truckId: string): number {
    // the detention timer is set at arrive-time, so arrive = timerAtMin - 120
    const t = this.timers.filter((x) => x.kind === "detention" && x.truckId === truckId)
      .sort((a, b) => a.atMin - b.atMin)[0];
    return t ? t.atMin - DETENTION_MIN : 0;
  }

  async fileClaim(truckId: string) {
    const claim = this.fileClaimSync(truckId);
    this.emit();
    return { claim };
  }

  async resolveClaim(truckId: string, status: "approved" | "waived") {
    const claim = [...this.claims].reverse().find((c) => c.truckId === truckId && c.status === "filed");
    if (!claim) return { reason: `no filed claim for ${truckId}` };
    claim.status = status;
    this.emit();
    return { claim };
  }

  say(from: string, to: string, text: string, thread?: string): Promise<{ seq: number }> {
    this.chatter.push({ seq: ++this.chatSeq, atMin: Math.round(this.simNow() * 100) / 100, from, to, thread, text });
    this.emit();
    return Promise.resolve({ seq: this.chatSeq });
  }

  async snapshot(): Promise<Snapshot> { return this.buildSnapshot(); }

  async backhaul(truckId: string): Promise<OkResult> {
    this.counters.backhauls++;
    this.ev("replanned", `${truckId} took a backhaul`, { truckId });
    this.emit();
    return { ok: true };
  }

  async setSpeed(speed: number): Promise<OkResult> {
    this.resetClock(this.simNow(), speed);
    this.emit();
    return { ok: true };
  }
}
