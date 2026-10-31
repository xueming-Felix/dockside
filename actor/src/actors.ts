// actor/src/actors.ts — the Dock: one Durable Actor for the whole warehouse-day at Pier 9 Cold Storage.
// Actor id: pier9:2026-10-31. One request at a time, persisted state, one alarm driving a timer table.
// The actor never talks to Relay; it only knows its own state, replan(), and the clock.

import { Actor, Persisted, type ActorSocket } from "terse-sdk/actor"
import type {
  Appt, Auction, AuctionResult, Chat, Claim, ClaimResult, CounterResult, Counters, DockApi, Door, Event,
  Offer, OffersResult, OkResult, RequestResult, SayResult, Scenario, Snapshot, Thread, ThreadResult, Timer, Truck,
} from "../../shared/types.js"
import * as M from "./model.js"

type Meta = { role: string } | null
type Incoming = { type: "ping" }
type Socket = ActorSocket<Meta, Snapshot>

export class Dock extends Actor<Meta, Incoming, Snapshot> implements DockApi {
  @Persisted doors: Door[] = []
  @Persisted trucks: Truck[] = []
  @Persisted appts: Appt[] = []
  @Persisted offers: Offer[] = []
  @Persisted auctions: Auction[] = []
  @Persisted threads: Thread[] = []
  @Persisted claims: Claim[] = []
  @Persisted chatter: Chat[] = []
  @Persisted events: Event[] = []
  @Persisted timers: Timer[] = []
  @Persisted counters: Counters = M.emptyCounters()
  @Persisted clock: M.Clock = M.emptyClock()
  @Persisted seq: M.Seq = M.emptySeq()

  // ---------- lifecycle ----------
  async onConnect(socket: Socket): Promise<void> {
    socket.send(M.snapshot(await this.state(), await this.now()))
  }

  async onMessage(socket: Socket, _message: Incoming): Promise<void> {
    socket.send(M.snapshot(await this.state(), await this.now()))
  }

  /** The single alarm: drain every due timer, re-arm for the next one, broadcast. Fires while dormant too. */
  async onAlarm(): Promise<void> {
    const { state } = M.opTick(await this.state(), await this.now())
    await this.commit(state)
    await this.scheduleNext()
    await this.emit()
  }

  // ---------- the contract (see shared/types.ts DockApi) ----------
  async seed(scenario: Scenario): Promise<Snapshot> {
    const { state, result } = M.clone(M.opSeed(await this.state(), Date.now(), scenario))
    await this.commit(state)
    await this.scheduleNext()
    await this.emit()
    return result
  }

  async request(carrier: string, truckId: string, door: number, startMin: number, truck?: Partial<Truck>): Promise<RequestResult> {
    return this.run(s => M.opRequest(s.state, s.now, carrier, truckId, door, startMin, truck))
  }

  async reportEta(truckId: string, etaMin: number): Promise<OffersResult> {
    return this.run(s => M.opReportEta(s.state, s.now, truckId, etaMin))
  }

  async setDoor(door: number, open: boolean): Promise<OffersResult> {
    return this.run(s => M.opSetDoor(s.state, s.now, door, open))
  }

  async prioritize(truckId: string): Promise<OffersResult> {
    return this.run(s => M.opPrioritize(s.state, s.now, truckId))
  }

  async accept(offerId: string): Promise<OkResult> {
    return this.run(s => M.opAccept(s.state, s.now, offerId))
  }

  async counter(offerId: string, door: number, startMin: number): Promise<CounterResult> {
    return this.run(s => M.opCounter(s.state, s.now, offerId, door, startMin))
  }

  async decline(offerId: string): Promise<OffersResult> {
    return this.run(s => M.opDecline(s.state, s.now, offerId))
  }

  async swap(truckA: string, truckB: string): Promise<OkResult> {
    return this.run(s => M.opSwap(s.state, s.now, truckA, truckB))
  }

  async overrun(truckId: string, extraMin: number): Promise<OffersResult> {
    return this.run(s => M.opOverrun(s.state, s.now, truckId, extraMin))
  }

  async openAuction(door: number, startMin: number, closesMin: number, reason?: string): Promise<AuctionResult> {
    return this.run(s => M.opOpenAuction(s.state, s.now, door, startMin, closesMin, reason))
  }

  async bid(auctionId: string, truckId: string, readyMin: number): Promise<AuctionResult> {
    return this.run(s => M.opBid(s.state, s.now, auctionId, truckId, readyMin))
  }

  async award(auctionId: string, truckId: string): Promise<AuctionResult> {
    return this.run(s => M.opAward(s.state, s.now, auctionId, truckId))
  }

  async openThread(threadId: string, offerId: string, deadlineMin: number): Promise<ThreadResult> {
    return this.run(s => M.opOpenThread(s.state, s.now, threadId, offerId, deadlineMin))
  }

  async settleThread(threadId: string): Promise<ThreadResult> {
    return this.run(s => M.opSettleThread(s.state, s.now, threadId))
  }

  async pay(from: string, to: string, usd: number): Promise<OkResult> {
    return this.run(s => M.opPay(s.state, s.now, from, to, usd))
  }

  async arrive(truckId: string): Promise<OkResult> {
    return this.run(s => M.opArrive(s.state, s.now, truckId))
  }

  async done(truckId: string): Promise<OkResult> {
    return this.run(s => M.opDone(s.state, s.now, truckId))
  }

  async fileClaim(truckId: string): Promise<ClaimResult> {
    return this.run(s => M.opFileClaim(s.state, s.now, truckId))
  }

  async resolveClaim(truckId: string, status: "approved" | "waived"): Promise<ClaimResult> {
    return this.run(s => M.opResolveClaim(s.state, s.now, truckId, status))
  }

  async say(from: string, to: string, text: string, thread?: string): Promise<SayResult> {
    return this.run(s => M.opSay(s.state, s.now, from, to, text, thread))
  }

  async snapshot(): Promise<Snapshot> {
    return await this.settle()
  }

  // ---------- stage controls [added] ----------
  async freeze(): Promise<Snapshot> {
    return this.run(s => M.opFreeze(s.state, s.now))
  }

  async resume(): Promise<Snapshot> {
    const { state, result } = M.clone(M.opResume(await this.state(), Date.now()))
    await this.commit(state)
    await this.scheduleNext()
    await this.emit()
    return result
  }

  async setSpeed(speed: number): Promise<Snapshot> {
    const { state, result } = M.clone(M.opSetSpeed(await this.state(), Date.now(), Math.max(1, Math.min(600, speed))))
    await this.commit(state)
    await this.scheduleNext()
    await this.emit()
    return result
  }

  async tick(): Promise<Snapshot> {
    return await this.settle()
  }

  async backhaul(truckId: string, by: string): Promise<OkResult> {
    return this.run(s => M.opBackhaul(s.state, s.now, truckId, by))
  }

  // ---------- helpers (private: not part of the RPC surface) ----------
  private async state(): Promise<M.DockState> {
    return {
      doors: this.doors, trucks: this.trucks, appts: this.appts, offers: this.offers, auctions: this.auctions,
      threads: this.threads, claims: this.claims, chatter: this.chatter, events: this.events, timers: this.timers,
      counters: this.counters, clock: this.clock, seq: this.seq,
    }
  }

  private async now(): Promise<number> {
    return M.simNow(this.clock, Date.now())
  }

  /** Reassign every collection so @Persisted saves it (in-place mutation would not). */
  private async commit(next: M.DockState): Promise<void> {
    this.doors = next.doors; this.trucks = next.trucks; this.appts = next.appts; this.offers = next.offers
    this.auctions = next.auctions; this.threads = next.threads; this.claims = next.claims; this.chatter = next.chatter
    this.events = next.events; this.timers = next.timers; this.counters = next.counters; this.clock = next.clock
    this.seq = next.seq
  }

  /** Catch up on due timers, apply one operation, re-arm the alarm, broadcast. */
  private async run<R>(op: (ctx: { state: M.DockState; now: number }) => M.Op<R>): Promise<R> {
    let state = await this.state()
    const now = await this.now()
    const pending = M.nextTimer(state.timers)
    if (pending && pending.atMin <= now && state.clock.frozenAtMin === null) state = M.opTick(state, now).state
    const { state: next, result } = M.clone(op({ state, now })) // JSON round trip: the runtime rejects undefined in results and broadcasts
    await this.commit(next)
    await this.scheduleNext()
    await this.emit()
    return result
  }

  private async settle(): Promise<Snapshot> {
    const now = await this.now()
    const pending = M.nextTimer(this.timers)
    if (pending && pending.atMin <= now && this.clock.frozenAtMin === null) {
      await this.commit(M.opTick(await this.state(), now).state)
      await this.scheduleNext()
      await this.emit()
    }
    return M.snapshot(await this.state(), now)
  }

  /** Always point the one alarm at the earliest unfired timer; none, or a frozen clock, clears it. */
  private async scheduleNext(): Promise<void> {
    const next = M.nextTimer(this.timers)
    if (!next || this.clock.frozenAtMin !== null || !this.clock.seeded) {
      if (this.alarm.get() !== null) this.alarm.delete()
      return
    }
    this.alarm.set(Math.max(Date.now(), M.realAt(this.clock, next.atMin)))
  }

  private async emit(): Promise<void> {
    this.broadcast(M.snapshot(await this.state(), await this.now()))
  }
}
