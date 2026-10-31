// DockClient — the frozen contract between Person B (this folder) and Person A's
// Dock actor. Method names/positional params match PLAN's actor method table.
// MockDock (mockDock.ts) is the in-memory implementation; TerseDock wraps the
// durable-actors generated client in ./generated (written by `terse actor generate`).

import type { Appt, Auction, Claim, Door, Offer, Snapshot, Thread, Truck } from "../shared/types.js";

export type SeedSpec = {
  doors: Door[];
  trucks: Truck[];
  /** Seed appointments. arrivalCheck:true schedules a start+30 arrival-check timer. */
  appts: (Appt & { arrivalCheck?: boolean })[];
  speed?: number;
};

export type RequestResult = { appt?: Appt; offer?: Offer };
export type OffersResult = { offers: Offer[] };
export type OkResult = { ok: boolean; reason?: string };
export type CounterResult = { ok: boolean; reason?: string; offers: Offer[] };

export interface DockClient {
  seed(scenario: SeedSpec): Promise<Snapshot>;
  request(carrier: string, truckId: string, door: number, startMin: number): Promise<RequestResult>;
  reportEta(truckId: string, etaMin: number): Promise<OffersResult>;
  setDoor(door: number, open: boolean): Promise<OffersResult>;
  prioritize(truckId: string): Promise<OffersResult>;
  accept(offerId: string): Promise<OkResult>;
  counter(offerId: string, door: number, startMin: number): Promise<CounterResult>;
  decline(offerId: string): Promise<OffersResult>;
  swap(truckA: string, truckB: string): Promise<OkResult>;
  overrun(truckId: string, extraMin: number): Promise<OffersResult>;
  openAuction(door: number, startMin: number, closesMin: number): Promise<{ auction: Auction }>;
  bid(auctionId: string, truckId: string, readyMin: number): Promise<OkResult>;
  award(auctionId: string, truckId: string): Promise<{ auction?: Auction; reason?: string }>;
  openThread(threadId: string, offerId: string, deadlineMin: number): Promise<{ thread: Thread }>;
  settleThread(threadId: string): Promise<{ thread?: Thread; reason?: string }>;
  pay(from: string, to: string, usd: number): Promise<OkResult>;
  arrive(truckId: string): Promise<OkResult>;
  done(truckId: string): Promise<OkResult>;
  fileClaim(truckId: string): Promise<{ claim?: Claim; reason?: string }>;
  resolveClaim(truckId: string, status: "approved" | "waived"): Promise<{ claim?: Claim; reason?: string }>;
  // CONTRACT GAP (needs Person A): plan's say() has no thread param; we pass the
  // relay thread root id so the dashboard can indent replies.
  say(from: string, to: string, text: string, thread?: string): Promise<{ seq: number }>;
  snapshot(): Promise<Snapshot>;
  // CONTRACT GAP (needs Person A): no method records a backhaul; we need one to
  // bump counters.backhauls.
  backhaul?(truckId: string): Promise<OkResult>;
  // CONTRACT GAP (needs Person A): no method freezes the clock; key 10 needs it.
  setSpeed?(speed: number): Promise<OkResult>;

  onSnapshot(cb: (s: Snapshot) => void): () => void;
  close(): Promise<void> | void;
}

export async function createDock(): Promise<DockClient> {
  const which = (process.env.DOCK ?? "mock").toLowerCase();
  if (which === "terse") return TerseDock.create();
  const { MockDock } = await import("./mockDock.js");
  return new MockDock();
}

// ---------------------------------------------------------------------------
// TerseDock — wraps the durable-actors generated client. generated/ is produced
// by `terse actor generate` in relay/ and is gitignored; it may not exist yet,
// so it is lazily imported and typed `any` to keep `tsc --noEmit` green.
// ---------------------------------------------------------------------------

export class TerseDock implements DockClient {
  private actor: any;
  private snapshotSubs = new Set<(s: Snapshot) => void>();
  private ws: WebSocket | null = null;
  private closed = false;
  private gapLogged = new Set<string>();

  static async create(): Promise<TerseDock> {
    const d = new TerseDock();
    // `terse actor generate` writes ./generated — absent until Person A runs it,
    // so the specifier is computed to keep tsc happy.
    const genPath = "./generated/index.js";
    const gen: any = await import(genPath);
    const actorId = process.env.DOCK_ACTOR_ID ?? "pier9:2026-10-31";
    d.actor = gen.actors.Dock.get(actorId);
    await d.connectSnapshots(gen, actorId);
    return d;
  }

  private async connectSnapshots(gen: any, actorId: string): Promise<void> {
    const grant = await gen.actors.Dock.prepareWebsocket({
      actorId,
      metadata: { role: "dispatcher" },
    });
    const ws = new WebSocket(grant.websocketUrl);
    this.ws = ws;
    ws.onmessage = (ev: MessageEvent) => {
      try {
        const snap = JSON.parse(String(ev.data)) as Snapshot;
        for (const cb of this.snapshotSubs) cb(snap);
      } catch {
        /* non-snapshot frame */
      }
    };
    ws.onclose = () => {
      if (!this.closed) void this.connectSnapshots(gen, actorId);
    };
  }

  onSnapshot(cb: (s: Snapshot) => void): () => void {
    this.snapshotSubs.add(cb);
    return () => this.snapshotSubs.delete(cb);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.ws?.close();
  }

  private gap(name: string): OkResult {
    if (!this.gapLogged.has(name)) {
      this.gapLogged.add(name);
      console.warn(`[terse] actor stub lacks .${name}() — contract gap, skipping`);
    }
    return { ok: false, reason: `actor lacks ${name}` };
  }

  // Every contract method is a straight pass-through to the generated stub.
  seed(scenario: SeedSpec) { return this.actor.seed(scenario) as Promise<Snapshot>; }
  request(carrier: string, truckId: string, door: number, startMin: number) {
    return this.actor.request(carrier, truckId, door, startMin) as Promise<RequestResult>;
  }
  reportEta(truckId: string, etaMin: number) { return this.actor.reportEta(truckId, etaMin) as Promise<OffersResult>; }
  setDoor(door: number, open: boolean) { return this.actor.setDoor(door, open) as Promise<OffersResult>; }
  prioritize(truckId: string) { return this.actor.prioritize(truckId) as Promise<OffersResult>; }
  accept(offerId: string) { return this.actor.accept(offerId) as Promise<OkResult>; }
  counter(offerId: string, door: number, startMin: number) {
    return this.actor.counter(offerId, door, startMin) as Promise<CounterResult>;
  }
  decline(offerId: string) { return this.actor.decline(offerId) as Promise<OffersResult>; }
  swap(truckA: string, truckB: string) { return this.actor.swap(truckA, truckB) as Promise<OkResult>; }
  overrun(truckId: string, extraMin: number) { return this.actor.overrun(truckId, extraMin) as Promise<OffersResult>; }
  openAuction(door: number, startMin: number, closesMin: number) {
    return this.actor.openAuction(door, startMin, closesMin) as Promise<{ auction: Auction }>;
  }
  bid(auctionId: string, truckId: string, readyMin: number) {
    return this.actor.bid(auctionId, truckId, readyMin) as Promise<OkResult>;
  }
  award(auctionId: string, truckId: string) {
    return this.actor.award(auctionId, truckId) as Promise<{ auction?: Auction; reason?: string }>;
  }
  openThread(threadId: string, offerId: string, deadlineMin: number) {
    return this.actor.openThread(threadId, offerId, deadlineMin) as Promise<{ thread: Thread }>;
  }
  settleThread(threadId: string) {
    return this.actor.settleThread(threadId) as Promise<{ thread?: Thread; reason?: string }>;
  }
  pay(from: string, to: string, usd: number) { return this.actor.pay(from, to, usd) as Promise<OkResult>; }
  arrive(truckId: string) { return this.actor.arrive(truckId) as Promise<OkResult>; }
  done(truckId: string) { return this.actor.done(truckId) as Promise<OkResult>; }
  fileClaim(truckId: string) { return this.actor.fileClaim(truckId) as Promise<{ claim?: Claim; reason?: string }>; }
  resolveClaim(truckId: string, status: "approved" | "waived") {
    return this.actor.resolveClaim(truckId, status) as Promise<{ claim?: Claim; reason?: string }>;
  }
  say(from: string, to: string, text: string, thread?: string) {
    // CONTRACT GAP (needs Person A): contract signature is say(from,to,text);
    // pass thread only when the deployed stub accepts it (arity check), else drop it.
    const fn = this.actor.say as (...a: unknown[]) => Promise<{ seq: number }>;
    return fn.length >= 4 ? fn.call(this.actor, from, to, text, thread) : fn.call(this.actor, from, to, text);
  }
  snapshot() { return this.actor.snapshot() as Promise<Snapshot>; }

  backhaul(truckId: string) {
    // CONTRACT GAP (needs Person A): contract has no backhaul method.
    const fn = this.actor.backhaul as undefined | ((t: string) => Promise<OkResult>);
    return fn ? fn.call(this.actor, truckId) : Promise.resolve(this.gap("backhaul"));
  }
  setSpeed(speed: number) {
    // CONTRACT GAP (needs Person A): contract has no setSpeed method.
    const fn = this.actor.setSpeed as undefined | ((s: number) => Promise<OkResult>);
    return fn ? fn.call(this.actor, speed) : Promise.resolve(this.gap("setSpeed"));
  }
}
