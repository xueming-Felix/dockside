// shared/types.ts — the Dockside contract between the Dock actor (Person A) and the relay side (Person B).
//
// Sim minutes count from 08:00 (0 = 08:00, 360 = 14:00, 600 = 18:00). Slots start on the hour and last
// 60 minutes unless an overrun stretched them. Relay handles are the carriers' agent names.
//
// Frozen at 11:20 per PLAN.md. Fields marked [added] came in with the actor implementation; they only
// extend the plan's shapes, nothing in the plan was renamed or removed.

export type DoorType = "dry" | "reefer"
export type Door = { id: number; type: DoorType; open: boolean }

export type Truck = {
  id: string
  carrier: string
  load: string
  type: DoorType
  priority: 0 | 1 | 2
  etaMin: number
  hosLimitMin?: number
}

export type ApptStatus = "booked" | "arrived" | "unloading" | "done" | "noshow" | "tomorrow"
export type Appt = {
  truckId: string
  door: number
  startMin: number
  status: ApptStatus
  durationMin: number // [added] 60 unless overrun() stretched it
  arrivedMin?: number // [added] set by arrive(); the detention clock counts from here
  doneMin?: number // [added] set by done()
}

export type OfferStatus = "open" | "accepted" | "countered" | "declined" | "expired"
export type Offer = {
  id: string
  truckId: string
  carrier: string
  door: number
  startMin: number
  reason: string
  status: OfferStatus
  atMin: number // [added] sim time the offer was made
  fromDoor?: number // [added] where the truck sat before the move, if it had a slot
  fromStartMin?: number // [added]
}

export type ClaimStatus = "filed" | "approved" | "waived"
export type Claim = { truckId: string; carrier: string; minutes: number; amount: number; status: ClaimStatus }

export type Bid = { truckId: string; readyMin: number }
export type Auction = {
  id: string
  door: number
  startMin: number
  closesMin: number
  bids: Bid[]
  winner?: string
  status: "open" | "closed" | "awarded" // [added]
  reason?: string // [added] why the slot freed up, for the AUCTION line
}

export type Thread = { id: string; offerId: string; deadlineMin: number; status: "open" | "settled" | "expired" }

export type Chat = { seq: number; atMin: number; from: string; to: string; thread?: string; text: string }

export type EventKind =
  | "collision" | "replanned" | "offer" | "noshow" | "detention" | "tomorrow" | "empty" | "hot"
  | "swap" | "overrun" | "auction_open" | "auction_closed" | "thread_expired" | "refused"
  // [added] bookkeeping kinds so the feed can narrate every mutation
  | "seed" | "booked" | "accepted" | "countered" | "declined" | "awarded" | "bid" | "settled"
  | "paid" | "claim" | "arrived" | "done" | "door" | "clock" | "eta" | "backhaul" | "thread_open"

export type Event = {
  seq: number
  atMin: number
  kind: EventKind
  truckId?: string
  offerId?: string
  auctionId?: string
  threadId?: string
  detail: string
}

// [added] The timer table behind the actor's single alarm. The dashboard lists the next few under the clock.
export type TimerKind = "arrival_check" | "detention" | "auction_close" | "thread_deadline"
export type Timer = {
  id: string
  atMin: number
  kind: TimerKind
  truckId?: string
  auctionId?: string
  threadId?: string
  fired: boolean
}

export type Counters = {
  detentionAvoidedUsd: number
  sidePaymentsUsd: number
  phoneCalls: 0
  moves: number
  backhauls: number
}

export type Snapshot = {
  simMin: number
  speed: number
  doors: Door[]
  trucks: Truck[]
  appts: Appt[]
  offers: Offer[]
  auctions: Auction[]
  threads: Thread[]
  claims: Claim[]
  chatter: Chat[]
  events: Event[]
  counters: Counters
  timers: Timer[] // [added] unfired timers, soonest first
  realStart: number // [added] epoch ms that corresponds to sim 08:00; lets the dashboard tick between snapshots
  frozen: boolean // [added] true after freeze(); simMin stops advancing
  seeded: boolean // [added] false until seed() ran
}

// [added] What seed() takes. appts are optional: without them every truck is placed at its earliest feasible slot.
export type Scenario = {
  doors: Door[]
  trucks: Truck[]
  // arrivalCheck: when any seed appointment carries this flag, only flagged trucks get arrival-check timers
  // (Person B's runner never calls arrive() for the rest); without flags every booked truck is checked.
  appts?: { truckId: string; door: number; startMin: number; arrivalCheck?: boolean; status?: string; durationMin?: number }[]
  arrivalChecks?: "all" | "flagged"
  startMin?: number // sim minute the clock starts at, default 0 (08:00)
  speed?: number // sim minutes per real minute, default 60 (1 real second = 1 sim minute)
}

// Return shapes of the actor methods, so relay/dock.ts can type DockClient against them.
export type RequestResult = { appt?: Appt; offer?: Offer; reason?: string }
export type OffersResult = { offers: Offer[] }
export type OkResult = { ok: boolean; reason?: string }
export type CounterResult = { ok: boolean; reason?: string; offers: Offer[] }
export type AuctionResult = { auction?: Auction; ok: boolean; reason?: string }
export type ThreadResult = { thread?: Thread; ok: boolean; reason?: string }
export type ClaimResult = { claim?: Claim; ok: boolean; reason?: string }
export type SayResult = { seq: number }

// The method table from PLAN.md. [A implements] [B calls]. Every method broadcasts a fresh Snapshot afterwards.
export interface DockApi {
  seed(scenario: Scenario): Promise<Snapshot>
  request(carrier: string, truckId: string, door: number, startMin: number, truck?: Partial<Truck>): Promise<RequestResult>
  reportEta(truckId: string, etaMin: number): Promise<OffersResult>
  setDoor(door: number, open: boolean): Promise<OffersResult>
  prioritize(truckId: string): Promise<OffersResult>
  accept(offerId: string): Promise<OkResult>
  counter(offerId: string, door: number, startMin: number): Promise<CounterResult>
  decline(offerId: string): Promise<OffersResult>
  swap(truckA: string, truckB: string): Promise<OkResult>
  overrun(truckId: string, extraMin: number): Promise<OffersResult>
  openAuction(door: number, startMin: number, closesMin: number, reason?: string): Promise<AuctionResult>
  bid(auctionId: string, truckId: string, readyMin: number): Promise<AuctionResult>
  award(auctionId: string, truckId: string): Promise<AuctionResult>
  openThread(threadId: string, offerId: string, deadlineMin: number): Promise<ThreadResult>
  settleThread(threadId: string): Promise<ThreadResult>
  pay(from: string, to: string, usd: number): Promise<OkResult>
  arrive(truckId: string): Promise<OkResult>
  done(truckId: string): Promise<OkResult>
  fileClaim(truckId: string): Promise<ClaimResult>
  resolveClaim(truckId: string, status: "approved" | "waived"): Promise<ClaimResult>
  say(from: string, to: string, text: string, thread?: string): Promise<SayResult>
  snapshot(): Promise<Snapshot>
  // [added] stage controls
  freeze(): Promise<Snapshot> // key 10: stop the clock (setSpeed(0) does the same)
  resume(): Promise<Snapshot>
  tick(): Promise<Snapshot> // drain due timers now; manual fallback if an alarm is late
  backhaul(truckId: string, by?: string): Promise<OkResult> // key 9: backhauls++ and an event
}

// Numbers everyone agreed on before 11:00.
export const WAREHOUSE = "Pier 9 Cold Storage"
export const ACTOR_ID = "pier9-2026-10-31" // Terse actor ids allow only letters, digits, ".", "-", "_"; PLAN wrote it with a colon
export const DAY_START_MIN = 0 // 08:00
export const DAY_END_MIN = 600 // 18:00
export const SLOT_MIN = 60
export const DEFAULT_SPEED = 60 // 60x: one real second is one sim minute
export const ARRIVAL_GRACE_MIN = 30 // arrival_check fires at start + 30
export const DETENTION_FREE_MIN = 120 // two free hours
export const DETENTION_USD_PER_HOUR = 75
export const THREAD_DEADLINE_MIN = 10
export const AUCTION_LENGTH_MIN = 10

export function hhmm(simMin: number): string {
  const total = 8 * 60 + Math.max(0, Math.round(simMin))
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

export function parseHHMM(text: string): number {
  const [h, m] = text.split(":").map(Number)
  return (h - 8) * 60 + (m || 0)
}
