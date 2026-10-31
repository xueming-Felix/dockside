// actor/src/model.ts — pure state transitions for the Dock actor.
// No Terse imports here, so `bun test` exercises replan() and the timer table directly.
// Every op takes a state and the sim time, returns a NEW state (the actor reassigns its @Persisted fields from it).

import {
  type Appt, type ApptStatus, type Auction, type Chat, type Claim, type Counters, type Door, type Event,
  type EventKind, type Offer, type Scenario, type Snapshot, type Thread, type Timer, type TimerKind, type Truck,
  ARRIVAL_GRACE_MIN, AUCTION_LENGTH_MIN, DAY_END_MIN, DEFAULT_SPEED, DETENTION_FREE_MIN, DETENTION_USD_PER_HOUR,
  SLOT_MIN, hhmm,
} from "./shared/types.js"
import type { AuctionResult, ClaimResult, CounterResult, OffersResult, OkResult, RequestResult, SayResult, ThreadResult } from "./shared/types.js"

export type Clock = { realStart: number; speed: number; frozenAtMin: number | null; seeded: boolean; arrivalChecks?: "all" | "flagged"; flagged?: string[] }
export type Seq = { event: number; chat: number; offer: number; auction: number; timer: number }
export type DockState = {
  doors: Door[]; trucks: Truck[]; appts: Appt[]; offers: Offer[]; auctions: Auction[]; threads: Thread[]
  claims: Claim[]; chatter: Chat[]; events: Event[]; timers: Timer[]; counters: Counters; clock: Clock; seq: Seq
}

export const emptyCounters = (): Counters => ({ detentionAvoidedUsd: 0, sidePaymentsUsd: 0, phoneCalls: 0, moves: 0, backhauls: 0 })
export const emptyClock = (): Clock => ({ realStart: 0, speed: DEFAULT_SPEED, frozenAtMin: null, seeded: false })
export const emptySeq = (): Seq => ({ event: 0, chat: 0, offer: 0, auction: 0, timer: 0 })
export const emptyState = (): DockState => ({
  doors: [], trucks: [], appts: [], offers: [], auctions: [], threads: [], claims: [], chatter: [], events: [], timers: [],
  counters: emptyCounters(), clock: emptyClock(), seq: emptySeq(),
})

const EVENT_CAP = 300
const CHAT_CAP = 400

// ---------- clock ----------
export function simNow(clock: Clock, nowMs: number): number {
  if (!clock.seeded) return 0
  if (clock.frozenAtMin !== null) return clock.frozenAtMin
  return Math.max(0, Math.floor(((nowMs - clock.realStart) * clock.speed) / 60000))
}
export function realAt(clock: Clock, atMin: number): number {
  return clock.realStart + (atMin * 60000) / clock.speed
}
export const floorHour = (m: number) => Math.floor(m / SLOT_MIN) * SLOT_MIN
export const ceilHour = (m: number) => Math.ceil(m / SLOT_MIN) * SLOT_MIN

// ---------- lookups ----------
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const ACTIVE: ApptStatus[] = ["booked", "arrived", "unloading"]
export const isActive = (a: Appt) => ACTIVE.includes(a.status)
export const isFixed = (a: Appt) => a.status === "arrived" || a.status === "unloading" || a.status === "done"
export const apptOf = (s: DockState, truckId: string) => s.appts.find(a => a.truckId === truckId)
export const truckOf = (s: DockState, id: string) => s.trucks.find(t => t.id === id)
export const doorOf = (s: DockState, id: number) => s.doors.find(d => d.id === id)
export const fits = (truck: Truck, door: Door) => truck.type === "dry" || door.type === "reefer"
export function overlaps(a: Appt, door: number, start: number, dur = SLOT_MIN): boolean {
  return a.door === door && isActive(a) && start < a.startMin + a.durationMin && start + dur > a.startMin
}
export const holderAt = (appts: Appt[], door: number, start: number, except?: string) =>
  appts.find(a => a.truckId !== except && overlaps(a, door, start))
const byDoorStart = (x: Appt, y: Appt) => x.door - y.door || x.startMin - y.startMin
const numId = (id: string) => Number(id.replace(/\D/g, "")) || 0
const cmpId = (a: string, b: string) => numId(a) - numId(b) || (a < b ? -1 : a > b ? 1 : 0)

// ---------- bookkeeping ----------
type Refs = { truckId?: string; offerId?: string; auctionId?: string; threadId?: string }
function event(d: DockState, now: number, kind: EventKind, detail: string, refs: Refs = {}) {
  d.seq.event += 1
  d.events.push({ seq: d.seq.event, atMin: now, kind, detail, ...refs })
  if (d.events.length > EVENT_CAP) d.events = d.events.slice(-EVENT_CAP)
}
function expireOffers(d: DockState, truckId: string) {
  for (const o of d.offers) if (o.truckId === truckId && o.status === "open") o.status = "expired"
}
function newOffer(d: DockState, now: number, truck: Truck, appt: Appt, reason: string, from?: Appt): Offer {
  expireOffers(d, truck.id)
  d.seq.offer += 1
  const o: Offer = {
    id: `o${d.seq.offer}`, truckId: truck.id, carrier: truck.carrier, door: appt.door, startMin: appt.startMin,
    reason, status: "open", atMin: now, ...(from ? { fromDoor: from.door, fromStartMin: from.startMin } : {}),
  }
  d.offers.push(o)
  const was = from ? ` (was door ${from.door} ${hhmm(from.startMin)})` : ""
  event(d, now, "offer", `${o.id} to ${truck.carrier}: ${truck.id} door ${o.door} ${hhmm(o.startMin)}${was} — ${reason}`, { truckId: truck.id, offerId: o.id })
  return o
}
function addTimer(d: DockState, kind: TimerKind, atMin: number, refs: Refs = {}): Timer {
  d.seq.timer += 1
  const t: Timer = { id: `t${d.seq.timer}`, kind, atMin, fired: false, ...refs }
  d.timers.push(t)
  return t
}
function dropTimers(d: DockState, pred: (t: Timer) => boolean) {
  d.timers = d.timers.filter(t => t.fired || !pred(t))
}
function pruneTimers(d: DockState, now: number) {
  d.timers = d.timers.filter(t => !t.fired || t.atMin > now - 30)
}
/** One unfired arrival_check per booked appointment, at start + 30 (or a little after now if that is already past). */
function resetArrivalTimer(d: DockState, a: Appt, now: number) {
  dropTimers(d, t => t.kind === "arrival_check" && t.truckId === a.truckId)
  if (a.status !== "booked") return
  if (d.clock.arrivalChecks === "flagged" && !(d.clock.flagged ?? []).includes(a.truckId)) return
  const at = a.startMin + ARRIVAL_GRACE_MIN
  addTimer(d, "arrival_check", at > now ? at : now + 10, { truckId: a.truckId })
}
export function nextTimer(timers: Timer[]): Timer | undefined {
  let best: Timer | undefined
  for (const t of timers) if (!t.fired && (!best || t.atMin < best.atMin)) best = t
  return best
}
const label = (t: Truck) => `${t.id} (${t.carrier})`

// ---------- replan ----------
export type Pin = { truckId: string; door: number; startMin: number }
export type ReplanOptions = { pin?: Pin; earliest?: string[]; seed?: boolean }
export type ReplanResult = { ok: boolean; reason?: string; offers: Offer[]; moved: string[] }

/** Door preference for a truck: its own type first (current door ahead), then reefer doors as a fallback for dry loads. */
function doorOrder(doors: Door[], t: Truck, currentDoor?: number): Door[] {
  const open = doors.filter(x => x.open && fits(t, x))
  const same = open.filter(x => x.type === t.type).sort((a, b) => (a.id === currentDoor ? -1 : b.id === currentDoor ? 1 : a.id - b.id))
  const cross = open.filter(x => x.type !== t.type).sort((a, b) => a.id - b.id)
  return [...same, ...cross]
}

/**
 * The deliberately dumb planner from PLAN.md. Mutates `d` (a draft) in place.
 * - appointments in arrived / unloading / done never move; noshow / tomorrow are inert
 * - the rest are ordered by priority desc, eta asc, current start asc
 * - a truck keeps its current slot if it is still feasible, unless it is in `earliest` (hot loads, re-queued trucks)
 * - otherwise: earliest hour slot >= max(eta, now) on an open door of matching type; dry loads fall back to a reefer door only when no dry door is free at that hour; reefer loads never use a dry door
 * - start + duration > hosLimitMin -> status "tomorrow", an event, no offer
 * - every (door, start) that changed becomes an open Offer and a `replanned` event; moves++; detention avoided += $75 per hour a truck moved earlier
 * - with a pin, the pinned truck is placed first at exactly that slot; the plan is rejected if any higher-priority truck would move
 */
export function replan(d: DockState, now: number, why: string, opts: ReplanOptions = {}): ReplanResult {
  const hot = new Set(opts.earliest ?? [])
  const before = new Map(d.appts.map(a => [a.truckId, a] as const))
  const placed: Appt[] = d.appts.filter(a => isActive(a) && a.status !== "booked") // fixed appointments occupy their doors
  const untouched: Appt[] = d.appts.filter(a => a.status !== "booked")
  const pinId = opts.pin?.truckId
  const candidates = d.trucks.filter(t => { const a = before.get(t.id); return !a || a.status === "booked" })
  const startOf = (t: Truck) => before.get(t.id)?.startMin ?? Number.POSITIVE_INFINITY
  candidates.sort((x, y) => y.priority - x.priority || x.etaMin - y.etaMin || startOf(x) - startOf(y) || cmpId(x.id, y.id))

  const out: Appt[] = [...untouched]
  const moved: { truck: Truck; from?: Appt; to: Appt }[] = []
  const late: { truck: Truck; from?: Appt; dur: number }[] = []
  const freeAt = (t: Truck, door: Door, start: number, dur: number) =>
    door.open && fits(t, door) && !placed.some(a => overlaps(a, door.id, start, dur))
  const fail = (reason: string): ReplanResult => ({ ok: false, reason, offers: [], moved: [] })
  const place = (t: Truck, cur: Appt | undefined, dur: number, target: { door: number; start: number } | undefined) => {
    if (!target) { late.push({ truck: t, from: cur, dur }); return }
    const a: Appt = { ...(cur ?? {}), truckId: t.id, door: target.door, startMin: target.start, status: "booked", durationMin: dur }
    placed.push(a)
    out.push(a)
    if (!cur || cur.door !== target.door || cur.startMin !== target.start) moved.push({ truck: t, from: cur, to: a })
  }
  /** Earliest hour slot >= max(eta, now) on a door that fits; dry loads fall back to a reefer door only when no dry door is free at that hour. */
  const search = (t: Truck, cur: Appt | undefined, dur: number) => {
    const s0 = Math.max(ceilHour(t.etaMin), ceilHour(now), 0)
    const order = doorOrder(d.doors, t, cur?.door)
    for (let s = s0; s + dur <= DAY_END_MIN; s += SLOT_MIN) {
      if (t.hosLimitMin !== undefined && s + dur > t.hosLimitMin) return undefined
      for (const door of order) if (freeAt(t, door, s, dur)) return { door: door.id, start: s }
    }
    return undefined
  }
  /** A slot still works if it has not ended, the truck can be there within the arrival grace, hours allow it, and nobody fixed sits on it. */
  const keeps = (t: Truck, cur: Appt, dur: number) =>
    cur.startMin + dur > now && t.etaMin <= cur.startMin + ARRIVAL_GRACE_MIN
    && (t.hosLimitMin === undefined || cur.startMin + dur <= t.hosLimitMin)
    && freeAt(t, doorOf(d, cur.door) ?? { id: cur.door, type: "dry", open: false }, cur.startMin, dur)

  // pass 1: the pinned truck goes exactly where it asked, or the whole plan is rejected
  if (opts.pin) {
    const t = truckOf(d, opts.pin.truckId)
    if (!t) return fail(`unknown truck ${opts.pin.truckId}`)
    const cur = before.get(t.id)
    if (cur && cur.status !== "booked") return fail(`${t.id} is ${cur.status} and cannot move`)
    const dur = cur?.durationMin ?? SLOT_MIN
    const door = doorOf(d, opts.pin.door)
    const start = opts.pin.startMin
    if (!door) return fail(`door ${opts.pin.door} does not exist`)
    if (!door.open) return fail(`door ${door.id} is out of service`)
    if (!fits(t, door)) return fail(`${t.id} is a reefer load and door ${door.id} is dry`)
    if (start % SLOT_MIN !== 0 || start < 0 || start + dur > DAY_END_MIN) return fail(`${hhmm(start)} is not a slot in today's day`)
    if (start < floorHour(now)) return fail(`${hhmm(start)} has already passed`)
    if (t.hosLimitMin !== undefined && start + dur > t.hosLimitMin) return fail(`${t.id}'s hours end at ${hhmm(t.hosLimitMin)}`)
    if (!freeAt(t, door, start, dur)) {
      const h = holderAt(placed, door.id, start)
      return fail(`door ${door.id} ${hhmm(start)} is held by ${h?.truckId ?? "a truck"} that cannot move`)
    }
    place(t, cur, dur, { door: door.id, start })
  }
  // pass 2: hot loads take the earliest slot they can reach, ahead of everyone who merely holds one
  for (const t of candidates) {
    if (!hot.has(t.id) || t.id === pinId) continue
    const cur = before.get(t.id)
    const dur = cur?.durationMin ?? SLOT_MIN
    place(t, cur, dur, search(t, cur, dur))
  }
  // pass 3: everyone whose slot still works keeps it, so unaffected trucks never churn
  const queue: Truck[] = []
  for (const t of candidates) {
    if (t.id === pinId || hot.has(t.id)) continue
    const cur = before.get(t.id)
    if (cur && keeps(t, cur, cur.durationMin)) place(t, cur, cur.durationMin, { door: cur.door, start: cur.startMin })
    else queue.push(t)
  }
  // pass 4: the displaced and the queued fill the gaps, best priority first
  for (const t of queue) {
    const cur = before.get(t.id)
    const dur = cur?.durationMin ?? SLOT_MIN
    place(t, cur, dur, search(t, cur, dur))
  }

  if (opts.pin) {
    const pinned = truckOf(d, opts.pin.truckId)!
    const victim = moved.find(m => m.truck.id !== pinned.id && m.truck.priority > pinned.priority)
    if (victim) return fail(`that would move higher-priority ${victim.truck.id}`)
    const lateVictim = late.find(l => l.truck.priority > pinned.priority)
    if (lateVictim) return fail(`that would push higher-priority ${lateVictim.truck.id} to tomorrow`)
  }

  // apply
  for (const l of late) {
    const a: Appt = { truckId: l.truck.id, door: l.from?.door ?? 0, startMin: l.from?.startMin ?? ceilHour(Math.max(now, l.truck.etaMin)), status: "tomorrow", durationMin: l.dur }
    out.push(a)
  }
  d.appts = out.sort(byDoorStart)
  const offers: Offer[] = []
  for (const l of late) {
    expireOffers(d, l.truck.id)
    resetArrivalTimer(d, apptOf(d, l.truck.id)!, now)
    if (!opts.seed) {
      const cutoff = l.truck.hosLimitMin !== undefined ? `hours end ${hhmm(l.truck.hosLimitMin)}` : "no slot left today"
      event(d, now, "tomorrow", `${label(l.truck)} rolls to tomorrow 08:00 — ${cutoff}`, { truckId: l.truck.id })
    }
  }
  for (const m of moved) {
    resetArrivalTimer(d, m.to, now)
    if (opts.seed) continue
    d.counters.moves += 1
    if (m.from && m.to.startMin < m.from.startMin) {
      d.counters.detentionAvoidedUsd += (DETENTION_USD_PER_HOUR * (m.from.startMin - m.to.startMin)) / 60
    }
    const was = m.from ? `door ${m.from.door} ${hhmm(m.from.startMin)}` : "the queue"
    event(d, now, "replanned", `${label(m.truck)} ${was} → door ${m.to.door} ${hhmm(m.to.startMin)} — ${why}`, { truckId: m.truck.id })
    if (m.truck.id === pinId || hot.has(m.truck.id)) continue // they asked for this move; no offer to confirm
    offers.push(newOffer(d, now, m.truck, m.to, why, m.from))
  }
  return { ok: true, offers, moved: moved.map(m => m.truck.id) }
}

// ---------- timers ----------
function claimFor(d: DockState, now: number, truck: Truck, waitedMin: number): Claim {
  const amount = DETENTION_USD_PER_HOUR * Math.max(DETENTION_FREE_MIN / 60, Math.ceil(waitedMin / 60))
  let c = d.claims.find(x => x.truckId === truck.id)
  if (c) { c.minutes = waitedMin; c.amount = amount }
  else { c = { truckId: truck.id, carrier: truck.carrier, minutes: waitedMin, amount, status: "filed" }; d.claims.push(c) }
  return c
}
function openAuction(d: DockState, now: number, door: number, startMin: number, closesMin: number, reason: string): Auction {
  d.seq.auction += 1
  const au: Auction = { id: `a${d.seq.auction}`, door, startMin, closesMin, bids: [], status: "open", reason }
  d.auctions.push(au)
  addTimer(d, "auction_close", closesMin, { auctionId: au.id })
  event(d, now, "auction_open", `${au.id}: door ${door} ${hhmm(startMin)} up for auction, closes ${hhmm(closesMin)} — ${reason}`, { auctionId: au.id })
  return au
}
/** Fires every due timer. Returns how many fired. */
export function drainTimers(d: DockState, now: number): number {
  const due = d.timers.filter(t => !t.fired && t.atMin <= now).sort((a, b) => a.atMin - b.atMin || numId(a.id) - numId(b.id))
  for (const t of due) {
    t.fired = true
    const at = Math.max(t.atMin, 0)
    if (t.kind === "arrival_check" && t.truckId) {
      const a = apptOf(d, t.truckId); const truck = truckOf(d, t.truckId)
      if (!a || !truck || a.status !== "booked") continue
      a.status = "noshow"
      expireOffers(d, truck.id)
      event(d, at, "noshow", `${label(truck)} did not show for door ${a.door} ${hhmm(a.startMin)}; slot released`, { truckId: truck.id })
      if (a.startMin + a.durationMin > now + 5) openAuction(d, at, a.door, a.startMin, at + AUCTION_LENGTH_MIN, `no-show ${truck.id}`)
    } else if (t.kind === "detention" && t.truckId) {
      const a = apptOf(d, t.truckId); const truck = truckOf(d, t.truckId)
      if (!a || !truck || a.arrivedMin === undefined || !(a.status === "arrived" || a.status === "unloading")) continue
      const waited = at - a.arrivedMin
      event(d, at, "detention", `${label(truck)} has waited ${waited} min at door ${a.door}; detention clock running at $${DETENTION_USD_PER_HOUR}/h`, { truckId: truck.id })
      const c = claimFor(d, at, truck, waited)
      event(d, at, "claim", `claim ${c.status} for ${truck.id}: $${c.amount}`, { truckId: truck.id })
    } else if (t.kind === "auction_close" && t.auctionId) {
      const au = d.auctions.find(x => x.id === t.auctionId)
      if (!au || au.status !== "open") continue
      au.status = "closed"
      const bids = au.bids.map(b => `${b.truckId} ready ${hhmm(b.readyMin)}`).join(", ") || "no bids"
      event(d, at, "auction_closed", `${au.id} closed by alarm: ${bids}`, { auctionId: au.id })
    } else if (t.kind === "thread_deadline" && t.threadId) {
      const th = d.threads.find(x => x.id === t.threadId)
      if (!th || th.status !== "open") continue
      th.status = "expired"
      event(d, at, "thread_expired", `${th.id} went quiet; the clock decides — standing offer ${th.offerId} applies`, { threadId: th.id, offerId: th.offerId })
    }
  }
  pruneTimers(d, now)
  return due.length
}

// ---------- snapshot ----------
export function snapshot(s: DockState, now: number): Snapshot {
  return {
    simMin: now, speed: s.clock.speed, doors: s.doors, trucks: s.trucks, appts: s.appts, offers: s.offers,
    auctions: s.auctions, threads: s.threads, claims: s.claims, chatter: s.chatter, events: s.events, counters: s.counters,
    timers: s.timers.filter(t => !t.fired).sort((a, b) => a.atMin - b.atMin), realStart: s.clock.realStart,
    frozen: s.clock.frozenAtMin !== null, seeded: s.clock.seeded,
  }
}

// ---------- operations (each returns a new state) ----------
export type Op<R> = { state: DockState; result: R }

export function opSeed(s: DockState, nowMs: number, scenario: Scenario): Op<Snapshot> {
  const d = emptyState()
  const speed = scenario.speed ?? DEFAULT_SPEED
  const startMin = scenario.startMin ?? 0
  const flagged = (scenario.appts ?? []).filter(a => a.arrivalCheck).map(a => a.truckId)
  const arrivalChecks = scenario.arrivalChecks ?? ((scenario.appts ?? []).some(a => a.arrivalCheck !== undefined) ? "flagged" : "all")
  d.clock = { realStart: nowMs - (startMin * 60000) / speed, speed, frozenAtMin: null, seeded: true, arrivalChecks, flagged }
  d.doors = clone(scenario.doors).sort((a, b) => a.id - b.id)
  d.trucks = clone(scenario.trucks)
  for (const a of scenario.appts ?? []) {
    if (!truckOf(d, a.truckId) || !doorOf(d, a.door)) continue
    d.appts.push({ truckId: a.truckId, door: a.door, startMin: a.startMin, status: "booked", durationMin: SLOT_MIN })
  }
  const now = startMin
  replan(d, now, "seed", { seed: true })
  for (const a of d.appts) resetArrivalTimer(d, a, now)
  const booked = d.appts.filter(a => a.status === "booked").length
  event(d, now, "seed", `Pier 9 seeded: ${d.doors.length} doors, ${d.trucks.length} trucks, ${booked} appointments, clock ${speed}x from ${hhmm(now)}${arrivalChecks === "flagged" ? `; arrival checks only for ${flagged.join(", ") || "nobody"}` : ""}`)
  return { state: d, result: snapshot(d, now) }
}

export function opRequest(s: DockState, now: number, carrier: string, truckId: string, door: number, startMin: number, info?: Partial<Truck>): Op<RequestResult> {
  const d = clone(s)
  const dd = doorOf(d, door)
  if (!dd) return { state: d, result: { reason: `door ${door} does not exist` } }
  let t = truckOf(d, truckId)
  if (!t) {
    t = { id: truckId, carrier, load: info?.load ?? `L${numId(truckId) || truckId}`, type: info?.type ?? dd.type, priority: info?.priority ?? 0, etaMin: info?.etaMin ?? startMin, ...(info?.hosLimitMin !== undefined ? { hosLimitMin: info.hosLimitMin } : {}) }
    d.trucks.push(t)
  }
  const cur = apptOf(d, truckId)
  if (cur && isFixed(cur)) return { state: d, result: { reason: `${truckId} is already at door ${cur.door}` } }
  const dur = cur?.durationMin ?? SLOT_MIN
  const inDay = startMin % SLOT_MIN === 0 && startMin >= floorHour(now) && startMin + dur <= DAY_END_MIN
  const hosOk = t.hosLimitMin === undefined || startMin + dur <= t.hosLimitMin
  const holder = holderAt(d.appts, dd.id, startMin, truckId)
  if (dd.open && fits(t, dd) && inDay && hosOk && !holder) {
    d.appts = d.appts.filter(a => a.truckId !== truckId)
    const a: Appt = { truckId, door: dd.id, startMin, status: "booked", durationMin: dur }
    d.appts.push(a); d.appts.sort(byDoorStart)
    expireOffers(d, truckId)
    resetArrivalTimer(d, a, now)
    if (cur) d.counters.moves += 1
    event(d, now, "booked", `${label(t)} booked door ${dd.id} ${hhmm(startMin)}`, { truckId })
    return { state: d, result: { appt: a } }
  }
  const why = holder ? `door ${dd.id} ${hhmm(startMin)} is held by ${holder.truckId} (${truckOf(d, holder.truckId)?.carrier ?? "?"})`
    : !dd.open ? `door ${dd.id} is out of service`
    : !fits(t, dd) ? `door ${dd.id} is dry and ${truckId} is a reefer load`
    : !hosOk ? `${truckId}'s hours end at ${hhmm(t.hosLimitMin!)}`
    : `${hhmm(startMin)} is not a slot in today's day`
  event(d, now, "collision", `${label(t)} asked for door ${dd.id} ${hhmm(startMin)}: ${why}`, { truckId })
  let target: { door: number; start: number } | undefined
  const free = (door: Door, st: number) => door.open && fits(t, door) && !holderAt(d.appts, door.id, st, truckId) && (t.hosLimitMin === undefined || st + dur <= t.hosLimitMin)
  const s0 = Math.max(ceilHour(startMin), ceilHour(now), 0)
  for (let st = s0; st + dur <= DAY_END_MIN && !target; st += SLOT_MIN) if (free(dd, st)) target = { door: dd.id, start: st }
  for (let st = s0; st + dur <= DAY_END_MIN && !target; st += SLOT_MIN) for (const door of doorOrder(d.doors, t)) if (free(door, st)) { target = { door: door.id, start: st }; break }
  if (!target) {
    if (cur && cur.status === "booked") return { state: d, result: { reason: `${why}; ${truckId} keeps door ${cur.door} ${hhmm(cur.startMin)}` } }
    d.appts = d.appts.filter(a => a.truckId !== truckId)
    d.appts.push({ truckId, door: dd.id, startMin, status: "tomorrow", durationMin: dur }); d.appts.sort(byDoorStart)
    event(d, now, "tomorrow", `${label(t)}: nothing left today, pencilled for tomorrow 08:00`, { truckId })
    return { state: d, result: { reason: `no slot left today for ${truckId}` } }
  }
  d.appts = d.appts.filter(a => a.truckId !== truckId)
  const a: Appt = { truckId, door: target.door, startMin: target.start, status: "booked", durationMin: dur }
  d.appts.push(a); d.appts.sort(byDoorStart)
  resetArrivalTimer(d, a, now)
  const o = newOffer(d, now, t, a, why, cur)
  return { state: d, result: { offer: o } }
}

export function opReportEta(s: DockState, now: number, truckId: string, etaMin: number): Op<OffersResult> {
  const d = clone(s)
  const t = truckOf(d, truckId)
  if (!t) return { state: d, result: { offers: [] } }
  const old = t.etaMin
  t.etaMin = etaMin
  event(d, now, "eta", `${label(t)} eta ${hhmm(old)} → ${hhmm(etaMin)}`, { truckId })
  const r = replan(d, now, `${t.id} eta now ${hhmm(etaMin)}`)
  return { state: d, result: { offers: r.offers } }
}

export function opSetDoor(s: DockState, now: number, door: number, open: boolean): Op<OffersResult> {
  const d = clone(s)
  const dd = doorOf(d, door)
  if (!dd) return { state: d, result: { offers: [] } }
  dd.open = open
  event(d, now, "door", `door ${door} ${open ? "back in service" : "out of service"}`)
  const r = replan(d, now, open ? `door ${door} back in service` : `door ${door} out of service`)
  return { state: d, result: { offers: r.offers } }
}

export function opPrioritize(s: DockState, now: number, truckId: string): Op<OffersResult> {
  const d = clone(s)
  const t = truckOf(d, truckId)
  if (!t) return { state: d, result: { offers: [] } }
  t.priority = 2
  event(d, now, "hot", `${label(t)} load ${t.load} is hot: priority 2`, { truckId })
  const r = replan(d, now, "yield for hot load", { earliest: [truckId] })
  return { state: d, result: { offers: r.offers } }
}

export function opAccept(s: DockState, now: number, offerId: string): Op<OkResult> {
  const d = clone(s)
  const o = d.offers.find(x => x.id === offerId)
  if (!o) return { state: d, result: { ok: false, reason: `${offerId} does not exist` } }
  if (o.status !== "open") return { state: d, result: { ok: false, reason: `${offerId} is ${o.status}` } }
  o.status = "accepted"
  event(d, now, "accepted", `${o.carrier} accepted ${o.id}: ${o.truckId} door ${o.door} ${hhmm(o.startMin)}`, { truckId: o.truckId, offerId: o.id })
  return { state: d, result: { ok: true } }
}

export function opCounter(s: DockState, now: number, offerId: string, door: number, startMin: number): Op<CounterResult> {
  const d = clone(s)
  const o = d.offers.find(x => x.id === offerId)
  if (!o) return { state: d, result: { ok: false, reason: `${offerId} does not exist`, offers: [] } }
  if (o.status !== "open") return { state: d, result: { ok: false, reason: `${offerId} is ${o.status}`, offers: [] } }
  const t = truckOf(d, o.truckId)!
  const r = replan(d, now, `bumped by ${t.id}'s counter for door ${door} ${hhmm(startMin)}`, { pin: { truckId: o.truckId, door, startMin } })
  if (!r.ok) {
    event(d, now, "refused", `counter ${offerId} (${t.id} → door ${door} ${hhmm(startMin)}) refused: ${r.reason}`, { truckId: t.id, offerId })
    return { state: d, result: { ok: false, reason: r.reason, offers: [] } }
  }
  o.status = "countered"
  event(d, now, "countered", `${o.carrier} countered ${o.id}: ${t.id} pinned to door ${door} ${hhmm(startMin)}`, { truckId: t.id, offerId })
  return { state: d, result: { ok: true, offers: r.offers } }
}

export function opDecline(s: DockState, now: number, offerId: string): Op<OffersResult> {
  const d = clone(s)
  const o = d.offers.find(x => x.id === offerId)
  if (!o || o.status !== "open") return { state: d, result: { offers: [] } }
  o.status = "declined"
  const t = truckOf(d, o.truckId)!
  const cur = apptOf(d, o.truckId)
  if (cur && cur.status === "booked") d.appts = d.appts.filter(a => a.truckId !== o.truckId)
  event(d, now, "declined", `${o.carrier} declined ${o.id}; ${t.id} goes back to the queue`, { truckId: t.id, offerId })
  const r = replan(d, now, `next slot after ${t.id} declined ${o.id}`)
  return { state: d, result: { offers: r.offers } }
}

export function opSwap(s: DockState, now: number, truckA: string, truckB: string): Op<OkResult> {
  const d = clone(s)
  const ta = truckOf(d, truckA), tb = truckOf(d, truckB)
  const aa = apptOf(d, truckA), ab = apptOf(d, truckB)
  if (!ta || !tb) return { state: d, result: { ok: false, reason: `unknown truck ${!ta ? truckA : truckB}` } }
  if (!aa || !ab) return { state: d, result: { ok: false, reason: `${!aa ? truckA : truckB} has no appointment` } }
  if (aa.status !== "booked") return { state: d, result: { ok: false, reason: `${truckA} is ${aa.status} and cannot move` } }
  if (ab.status !== "booked") return { state: d, result: { ok: false, reason: `${truckB} is ${ab.status} and cannot move` } }
  const da = doorOf(d, aa.door)!, db = doorOf(d, ab.door)!
  if (!fits(ta, db)) return { state: d, result: { ok: false, reason: `${truckA} is a reefer load and door ${db.id} is dry` } }
  if (!fits(tb, da)) return { state: d, result: { ok: false, reason: `${truckB} is a reefer load and door ${da.id} is dry` } }
  if (ta.hosLimitMin !== undefined && ab.startMin + aa.durationMin > ta.hosLimitMin) return { state: d, result: { ok: false, reason: `${truckA}'s hours end at ${hhmm(ta.hosLimitMin)}` } }
  if (tb.hosLimitMin !== undefined && aa.startMin + ab.durationMin > tb.hosLimitMin) return { state: d, result: { ok: false, reason: `${truckB}'s hours end at ${hhmm(tb.hosLimitMin)}` } }
  if (Math.min(aa.startMin, ab.startMin) < floorHour(now)) return { state: d, result: { ok: false, reason: `one of those slots has already passed` } }
  const fromA = { door: aa.door, startMin: aa.startMin }, fromB = { door: ab.door, startMin: ab.startMin }
  aa.door = fromB.door; aa.startMin = fromB.startMin
  ab.door = fromA.door; ab.startMin = fromA.startMin
  d.appts.sort(byDoorStart)
  expireOffers(d, truckA); expireOffers(d, truckB)
  resetArrivalTimer(d, aa, now); resetArrivalTimer(d, ab, now)
  d.counters.moves += 2
  event(d, now, "swap", `${label(ta)} ↔ ${label(tb)}: ${truckA} now door ${aa.door} ${hhmm(aa.startMin)}, ${truckB} now door ${ab.door} ${hhmm(ab.startMin)}`, { truckId: truckA })
  return { state: d, result: { ok: true } }
}

export function opOverrun(s: DockState, now: number, truckId: string, extraMin: number): Op<OffersResult> {
  const d = clone(s)
  const a = apptOf(d, truckId); const t = truckOf(d, truckId)
  if (!a || !t || !isActive(a)) return { state: d, result: { offers: [] } }
  a.durationMin += extraMin
  event(d, now, "overrun", `${label(t)} overrun +${extraMin} min at door ${a.door}; slot now ends ${hhmm(a.startMin + a.durationMin)}`, { truckId })
  const r = replan(d, now, `${t.id} overran at door ${a.door}`)
  return { state: d, result: { offers: r.offers } }
}

export function opOpenAuction(s: DockState, now: number, door: number, startMin: number, closesMin: number, reason?: string): Op<AuctionResult> {
  const d = clone(s)
  if (!doorOf(d, door)) return { state: d, result: { ok: false, reason: `door ${door} does not exist` } }
  const au = openAuction(d, now, door, startMin, closesMin, reason ?? "slot freed")
  return { state: d, result: { ok: true, auction: au } }
}

export function opBid(s: DockState, now: number, auctionId: string, truckId: string, readyMin: number): Op<AuctionResult> {
  const d = clone(s)
  const au = d.auctions.find(x => x.id === auctionId); const t = truckOf(d, truckId)
  if (!au) return { state: d, result: { ok: false, reason: `${auctionId} does not exist` } }
  if (!t) return { state: d, result: { ok: false, reason: `unknown truck ${truckId}` } }
  if (au.status !== "open") return { state: d, result: { ok: false, reason: `${auctionId} is ${au.status}`, auction: au } }
  if (!fits(t, doorOf(d, au.door)!)) return { state: d, result: { ok: false, reason: `${truckId} is a reefer load and door ${au.door} is dry`, auction: au } }
  au.bids = [...au.bids.filter(b => b.truckId !== truckId), { truckId, readyMin }]
  event(d, now, "bid", `${label(t)} bids on ${au.id}: ready ${hhmm(readyMin)}`, { truckId, auctionId })
  return { state: d, result: { ok: true, auction: au } }
}

export function opAward(s: DockState, now: number, auctionId: string, truckId: string): Op<AuctionResult> {
  const d = clone(s)
  const au = d.auctions.find(x => x.id === auctionId); const t = truckOf(d, truckId)
  if (!au) return { state: d, result: { ok: false, reason: `${auctionId} does not exist` } }
  if (!t) return { state: d, result: { ok: false, reason: `unknown truck ${truckId}` } }
  if (au.status === "awarded") return { state: d, result: { ok: false, reason: `${auctionId} already went to ${au.winner}`, auction: au } }
  const door = doorOf(d, au.door)!
  if (!door.open || !fits(t, door)) return { state: d, result: { ok: false, reason: `door ${door.id} cannot take ${truckId}`, auction: au } }
  const cur = apptOf(d, truckId)
  if (cur && isFixed(cur)) return { state: d, result: { ok: false, reason: `${truckId} is already at door ${cur.door}`, auction: au } }
  const holder = holderAt(d.appts, au.door, au.startMin, truckId)
  if (holder) return { state: d, result: { ok: false, reason: `door ${au.door} ${hhmm(au.startMin)} is held by ${holder.truckId}`, auction: au } }
  const bid = au.bids.find(b => b.truckId === truckId)
  if (bid && bid.readyMin < t.etaMin) t.etaMin = bid.readyMin
  d.appts = d.appts.filter(a => a.truckId !== truckId)
  const a: Appt = { truckId, door: au.door, startMin: au.startMin, status: "booked", durationMin: SLOT_MIN }
  d.appts.push(a); d.appts.sort(byDoorStart)
  expireOffers(d, truckId)
  resetArrivalTimer(d, a, now)
  au.winner = truckId; au.status = "awarded"
  dropTimers(d, x => x.kind === "auction_close" && x.auctionId === au.id)
  d.counters.moves += 1
  if (cur && a.startMin < cur.startMin) d.counters.detentionAvoidedUsd += (DETENTION_USD_PER_HOUR * (cur.startMin - a.startMin)) / 60
  const was = cur ? ` (was door ${cur.door} ${hhmm(cur.startMin)})` : ""
  event(d, now, "awarded", `${au.id} → ${label(t)}: door ${au.door} ${hhmm(au.startMin)}${was}`, { truckId, auctionId })
  return { state: d, result: { ok: true, auction: au } }
}

export function opOpenThread(s: DockState, now: number, threadId: string, offerId: string, deadlineMin: number): Op<ThreadResult> {
  const d = clone(s)
  if (d.threads.some(t => t.id === threadId)) return { state: d, result: { ok: false, reason: `${threadId} already exists` } }
  if (!d.offers.some(o => o.id === offerId) && !d.auctions.some(a => a.id === offerId)) return { state: d, result: { ok: false, reason: `${offerId} is not an offer or auction` } }
  const th: Thread = { id: threadId, offerId, deadlineMin, status: "open" }
  d.threads.push(th)
  addTimer(d, "thread_deadline", deadlineMin, { threadId })
  event(d, now, "thread_open", `${threadId} opened for ${offerId}; the clock decides at ${hhmm(deadlineMin)}`, { threadId, offerId })
  return { state: d, result: { ok: true, thread: th } }
}

export function opSettleThread(s: DockState, now: number, threadId: string): Op<ThreadResult> {
  const d = clone(s)
  const th = d.threads.find(t => t.id === threadId)
  if (!th) return { state: d, result: { ok: false, reason: `${threadId} does not exist` } }
  if (th.status !== "open") return { state: d, result: { ok: false, reason: `${threadId} is ${th.status}`, thread: th } }
  th.status = "settled"
  dropTimers(d, x => x.kind === "thread_deadline" && x.threadId === threadId)
  const o = d.offers.find(x => x.id === th.offerId)
  if (o && o.status === "open") o.status = "accepted"
  event(d, now, "settled", `${threadId} settled (${th.offerId})`, { threadId, offerId: th.offerId })
  return { state: d, result: { ok: true, thread: th } }
}

export function opPay(s: DockState, now: number, from: string, to: string, usd: number): Op<OkResult> {
  const d = clone(s)
  if (!(usd > 0)) return { state: d, result: { ok: false, reason: "amount must be positive" } }
  d.counters.sidePaymentsUsd += usd
  event(d, now, "paid", `${from} → ${to} $${usd}`)
  return { state: d, result: { ok: true } }
}

export function opArrive(s: DockState, now: number, truckId: string): Op<OkResult> {
  const d = clone(s)
  const a = apptOf(d, truckId); const t = truckOf(d, truckId)
  if (!a || !t) return { state: d, result: { ok: false, reason: `${truckId} has no appointment` } }
  // Arriving in the same minute the arrival check fired still counts: the no-show is reverted and the auto-opened
  // auction withdrawn, unless the slot already drew a bid or went to someone else.
  const buzzer = a.status === "noshow" && now <= a.startMin + ARRIVAL_GRACE_MIN + 1
  if (a.status !== "booked" && !buzzer) return { state: d, result: { ok: false, reason: `${truckId} is ${a.status}` } }
  if (buzzer) {
    if (holderAt(d.appts, a.door, a.startMin, truckId)) return { state: d, result: { ok: false, reason: `door ${a.door} ${hhmm(a.startMin)} went to another truck` } }
    const au = d.auctions.find(x => x.door === a.door && x.startMin === a.startMin && x.status === "open")
    if (au && au.bids.length > 0) return { state: d, result: { ok: false, reason: `${truckId} was marked no-show and ${au.id} already has ${au.bids.length} bid(s)` } }
    if (au) {
      au.status = "closed"
      au.reason = `${truckId} arrived inside the grace window`
      dropTimers(d, x => x.kind === "auction_close" && x.auctionId === au.id)
      event(d, now, "auction_closed", `${au.id} withdrawn: ${truckId} arrived after all`, { auctionId: au.id, truckId })
    }
  }
  a.status = now >= a.startMin ? "unloading" : "arrived"
  a.arrivedMin = now
  dropTimers(d, x => x.kind === "arrival_check" && x.truckId === truckId)
  addTimer(d, "detention", now + DETENTION_FREE_MIN, { truckId })
  expireOffers(d, truckId)
  event(d, now, "arrived", `${label(t)} at door ${a.door} (${a.status})${buzzer ? ", just inside the grace window" : ""}; detention clock starts ${hhmm(now + DETENTION_FREE_MIN)}`, { truckId })
  return { state: d, result: { ok: true } }
}

export function opDone(s: DockState, now: number, truckId: string): Op<OkResult> {
  const d = clone(s)
  const a = apptOf(d, truckId); const t = truckOf(d, truckId)
  if (!a || !t) return { state: d, result: { ok: false, reason: `${truckId} has no appointment` } }
  if (a.status === "done") return { state: d, result: { ok: false, reason: `${truckId} is already done` } }
  a.status = "done"; a.doneMin = now
  dropTimers(d, x => (x.kind === "detention" || x.kind === "arrival_check") && x.truckId === truckId)
  expireOffers(d, truckId)
  event(d, now, "done", `${label(t)} finished at door ${a.door}`, { truckId })
  event(d, now, "empty", `door ${a.door} is empty`, { truckId })
  return { state: d, result: { ok: true } }
}

export function opFileClaim(s: DockState, now: number, truckId: string): Op<ClaimResult> {
  const d = clone(s)
  const a = apptOf(d, truckId); const t = truckOf(d, truckId)
  if (!a || !t || a.arrivedMin === undefined) return { state: d, result: { ok: false, reason: `${truckId} has not arrived` } }
  const c = claimFor(d, now, t, now - a.arrivedMin)
  event(d, now, "claim", `${t.carrier} filed detention for ${t.id}: $${c.amount} (${c.status})`, { truckId })
  return { state: d, result: { ok: true, claim: c } }
}

export function opResolveClaim(s: DockState, now: number, truckId: string, status: "approved" | "waived"): Op<ClaimResult> {
  const d = clone(s)
  const t = truckOf(d, truckId)
  if (!t) return { state: d, result: { ok: false, reason: `unknown truck ${truckId}` } }
  let c = d.claims.find(x => x.truckId === truckId)
  if (c) { c.status = status; event(d, now, "claim", `${t.id} detention claim $${c.amount} ${status}`, { truckId }) }
  else {
    c = { truckId, carrier: t.carrier, minutes: 0, amount: 0, status }
    d.claims.push(c)
    event(d, now, "claim", `${t.id} detention ${status} in advance; applies when the clock files it`, { truckId })
  }
  return { state: d, result: { ok: true, claim: c } }
}

export function opSay(s: DockState, now: number, from: string, to: string, text: string, thread?: string): Op<SayResult> {
  const d = clone(s)
  d.seq.chat += 1
  d.chatter.push({ seq: d.seq.chat, atMin: now, from, to, text, ...(thread ? { thread } : {}) })
  if (d.chatter.length > CHAT_CAP) d.chatter = d.chatter.slice(-CHAT_CAP)
  return { state: d, result: { seq: d.seq.chat } }
}

export function opBackhaul(s: DockState, now: number, truckId: string, by = "broker"): Op<OkResult> {
  const d = clone(s)
  const t = truckOf(d, truckId)
  if (!t) return { state: d, result: { ok: false, reason: `unknown truck ${truckId}` } }
  d.counters.backhauls += 1
  event(d, now, "backhaul", `${by} loads ${label(t)} with a backhaul; it leaves full`, { truckId })
  return { state: d, result: { ok: true } }
}

export function opFreeze(s: DockState, now: number): Op<Snapshot> {
  const d = clone(s)
  if (d.clock.frozenAtMin === null) { d.clock.frozenAtMin = now; event(d, now, "clock", `clock frozen at ${hhmm(now)}`) }
  return { state: d, result: snapshot(d, now) }
}

export function opResume(s: DockState, nowMs: number): Op<Snapshot> {
  const d = clone(s)
  if (d.clock.frozenAtMin !== null) {
    const at = d.clock.frozenAtMin
    d.clock.realStart = nowMs - (at * 60000) / d.clock.speed
    d.clock.frozenAtMin = null
    event(d, at, "clock", `clock running again from ${hhmm(at)}`)
  }
  return { state: d, result: snapshot(d, simNow(d.clock, nowMs)) }
}

export function opSetSpeed(s: DockState, nowMs: number, speed: number): Op<Snapshot> {
  const d = clone(s)
  const now = simNow(d.clock, nowMs)
  d.clock.realStart = nowMs - (now * 60000) / speed
  d.clock.speed = speed
  event(d, now, "clock", `clock now ${speed}x`)
  return { state: d, result: snapshot(d, now) }
}

/** Drain due timers into a fresh state. */
export function opTick(s: DockState, now: number): Op<number> {
  const d = clone(s)
  const fired = drainTimers(d, now)
  return { state: d, result: fired }
}
