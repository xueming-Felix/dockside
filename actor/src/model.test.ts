import { describe, expect, test } from "bun:test"
import { PIER9 } from "../../shared/pier9.js"
import { hhmm } from "../../shared/types.js"
import * as M from "./model.js"
import { readFileSync } from "node:fs"

const T0 = 1_700_000_000_000
const seeded = () => M.opSeed(M.emptyState(), T0, PIER9).state
/** The world as the actor would see it at sim minute `now`: every due alarm has fired. */
const at = (now: number, s: M.DockState = seeded()) => M.opTick(s, now).state
const slot = (s: M.DockState, id: string) => { const a = M.apptOf(s, id)!; return `${a.door}@${hhmm(a.startMin)}:${a.status}` }

describe("seed", () => {
  test("places the twelve trucks exactly as laid out, with one arrival check each and no offers", () => {
    const s = seeded()
    expect(s.appts.filter(a => a.status === "booked")).toHaveLength(12)
    expect(slot(s, "T3")).toBe("1@08:00:booked")
    expect(slot(s, "T5")).toBe("5@10:00:booked")
    expect(slot(s, "T8")).toBe("3@13:00:booked")
    expect(s.offers).toHaveLength(0)
    expect(s.timers.filter(t => t.kind === "arrival_check" && !t.fired)).toHaveLength(12)
    expect(M.nextTimer(s.timers)!.atMin).toBe(30)
    expect(s.counters.moves).toBe(0)
    expect(M.simNow(s.clock, T0)).toBe(0)
    expect(M.simNow(s.clock, T0 + 65_000)).toBe(65)
    expect(M.realAt(s.clock, 150)).toBe(T0 + 150_000)
  })

  test("a replan with nothing changed moves nothing, even late in the day", () => {
    const s = at(200)
    const moves = s.counters.moves
    const r = M.replan(s, 200, "noop")
    expect(r.ok).toBe(true)
    expect(r.offers).toHaveLength(0)
    expect(s.counters.moves).toBe(moves)
  })
})

describe("act 1: the collision", () => {
  test("two requests for door 4 at 14:00: one books, the other is offered 15:00 on the same door", () => {
    let s = seeded()
    const a = M.opRequest(s, 5, "carrier-a", "T13", 4, 360)
    s = a.state
    expect(a.result.appt?.startMin).toBe(360)
    const b = M.opRequest(s, 5, "carrier-b", "T14", 4, 360)
    s = b.state
    expect(b.result.appt).toBeUndefined()
    expect(b.result.offer?.door).toBe(4)
    expect(b.result.offer?.startMin).toBe(420)
    expect(b.result.offer?.reason).toContain("held by T13")
    expect(s.events.some(e => e.kind === "collision")).toBe(true)
    expect(slot(s, "T14")).toBe("4@15:00:booked")
  })

  test("swap exchanges two booked slots atomically and pay() counts the side payment", () => {
    let s = seeded()
    s = M.opRequest(s, 5, "carrier-a", "T13", 4, 360).state
    s = M.opRequest(s, 5, "carrier-b", "T14", 4, 360).state
    const sw = M.opSwap(s, 6, "T14", "T13")
    expect(sw.result.ok).toBe(true)
    s = sw.state
    expect(slot(s, "T14")).toBe("4@14:00:booked")
    expect(slot(s, "T13")).toBe("4@15:00:booked")
    expect(s.offers.find(o => o.truckId === "T14")!.status).toBe("expired")
    s = M.opPay(s, 6, "carrier-b", "carrier-a", 150).state
    expect(s.counters.sidePaymentsUsd).toBe(150)
    expect(s.counters.moves).toBe(2)
  })

  test("a reefer load cannot be swapped onto a dry door", () => {
    const r = M.opSwap(seeded(), 5, "T5", "T4")
    expect(r.result.ok).toBe(false)
    expect(r.result.reason).toContain("reefer")
  })
})

describe("act 2: the cascade", () => {
  test("reportEta pushes T1 and T4 later, frees their old slots, and touches nobody else", () => {
    let s = at(60)
    const r1 = M.opReportEta(s, 60, "T1", 150)
    s = r1.state
    expect(r1.result.offers.map(o => o.truckId)).toEqual(["T1"])
    expect(slot(s, "T1")).toBe("4@11:00:booked")
    expect(M.holderAt(s.appts, 2, 60)).toBeUndefined()
    const r2 = M.opReportEta(s, 60, "T4", 210)
    s = r2.state
    expect(r2.result.offers.map(o => o.truckId)).toEqual(["T4"])
    expect(slot(s, "T4")).toBe("3@12:00:booked")
    expect(s.counters.moves).toBe(2)
  })

  test("a small delay inside the arrival grace keeps the slot", () => {
    const r = M.opReportEta(at(60), 60, "T4", 140) // 10:20 for a 10:00 slot
    expect(r.result.offers).toHaveLength(0)
    expect(slot(r.state, "T4")).toBe("1@10:00:booked")
  })

  test("an auction on a freed slot closes by timer and awards the winner, pulling it earlier", () => {
    let s = M.opReportEta(at(60), 60, "T1", 150).state
    const op = M.opOpenAuction(s, 60, 2, 60, 70, "T1 stuck in traffic")
    s = op.state
    const id = op.result.auction!.id
    s = M.opBid(s, 62, id, "T6", 50).state
    s = M.opBid(s, 63, id, "T8", 70).state
    expect(M.opBid(s, 63, id, "T5", 50).result.ok).toBe(false) // reefer load, dry door
    expect(M.nextTimer(s.timers)).toMatchObject({ kind: "auction_close", atMin: 70 })
    s = at(70, s)
    expect(s.auctions[0].status).toBe("closed")
    expect(s.events.some(e => e.kind === "auction_closed")).toBe(true)
    const aw = M.opAward(s, 70, id, "T6")
    expect(aw.result.ok).toBe(true)
    s = aw.state
    expect(slot(s, "T6")).toBe("2@09:00:booked")
    expect(s.counters.detentionAvoidedUsd).toBe(225) // 3 hours earlier at $75
    expect(M.opAward(s, 71, id, "T8").result.ok).toBe(false)
  })

  test("door 5 down: T5 is displaced onto the other reefer door, then counters for the slot T9 holds", () => {
    let s = at(80)
    const r = M.opSetDoor(s, 80, 5, false)
    s = r.state
    expect(r.result.offers.map(o => o.truckId)).toEqual(["T5"])
    const o = r.result.offers[0]
    expect(slot(s, "T5")).toBe("6@11:00:booked")
    expect(o.reason).toBe("door 5 out of service")
    const c = M.opCounter(s, 81, o.id, 6, 120)
    expect(c.result.ok).toBe(true)
    s = c.state
    expect(slot(s, "T5")).toBe("6@10:00:booked")
    expect(c.result.offers.map(x => x.truckId)).toEqual(["T9"])
    expect(slot(s, "T9")).toBe("6@11:00:booked")
    expect(s.offers.find(x => x.id === o.id)!.status).toBe("countered")
  })

  test("a counter that would move a higher-priority truck is refused and the offer stays open", () => {
    let s = M.opPrioritize(at(80), 80, "T2").state // T2 is now a hot load holding door 2 11:00
    const r = M.opSetDoor(s, 81, 1, false)
    s = r.state
    const o7 = r.result.offers.find(o => o.truckId === "T7")!
    const c = M.opCounter(s, 82, o7.id, 2, 180)
    expect(c.result.ok).toBe(false)
    expect(c.result.reason).toContain("T2")
    expect(c.state.offers.find(x => x.id === o7.id)!.status).toBe("open")
    expect(c.state.events.at(-1)!.kind).toBe("refused")
  })

  test("overrun stretches the slot and displaces only the truck behind it", () => {
    let s = M.opArrive(at(60), 60, "T1").state
    s = at(110, s)
    const r = M.opOverrun(s, 110, "T1", 75) // 09:00 slot now ends 11:15
    s = r.state
    expect(r.result.offers.map(o => o.truckId)).toEqual(["T2"])
    expect(slot(s, "T2")).toBe("4@11:00:booked")
    expect(slot(s, "T1")).toBe("2@09:00:unloading")
  })

  test("a thread that goes quiet expires by timer", () => {
    let s = M.opOpenThread(at(110), 110, "th1", "o1", 120).state
    expect(M.opOpenThread(s, 110, "th1", "o1", 120).result.ok).toBe(false)
    s = at(120, s)
    expect(s.threads[0].status).toBe("expired")
    expect(s.events.at(-1)!.kind).toBe("thread_expired")
  })

  test("declining an offer re-queues the truck and offers it the next slot", () => {
    let s = at(80)
    const r = M.opSetDoor(s, 80, 5, false)
    s = r.state
    const d = M.opDecline(s, 81, r.result.offers[0].id)
    expect(d.result.offers.map(o => o.truckId)).toEqual(["T5"])
    expect(d.state.offers.filter(o => o.truckId === "T5" && o.status === "open")).toHaveLength(1)
  })
})

describe("act 3: the hot load and the alarms", () => {
  test("prioritize pulls the hot load to 11:00 and bumps only the broker, with the right reason", () => {
    let s = at(135)
    const r = M.opPrioritize(s, 135, "T11")
    s = r.state
    expect(slot(s, "T11")).toBe("1@11:00:booked")
    expect(r.result.offers.map(o => o.truckId)).toEqual(["T7"])
    expect(r.result.offers[0].reason).toBe("yield for hot load")
    expect(s.events.some(e => e.kind === "hot")).toBe(true)
  })

  test("the detention alarm files a claim on its own, and a waiver granted in advance applies to it", () => {
    let s = M.opArrive(seeded(), 30, "T3").state
    expect(M.nextTimer(s.timers.filter(t => t.kind === "detention"))!.atMin).toBe(150)
    s = M.opResolveClaim(at(135, s), 135, "T3", "waived").state
    expect(s.claims[0]).toMatchObject({ truckId: "T3", amount: 0, status: "waived" })
    s = at(150, s)
    expect(s.claims[0]).toMatchObject({ truckId: "T3", amount: 150, status: "waived" })
    expect(s.events.some(e => e.kind === "detention")).toBe(true)
  })

  test("the arrival check turns a missing truck into a no-show and opens an auction on its slot", () => {
    const s = at(210) // 11:30: T12 (door 3, 11:00) never arrived
    expect(slot(s, "T12")).toBe("3@11:00:noshow")
    const au = s.auctions.find(a => a.door === 3 && a.startMin === 180)!
    expect(au.status).toBe("open")
    expect(au.closesMin).toBe(220)
    expect(M.holderAt(s.appts, 3, 180)).toBeUndefined()
  })

  test("hours of service: a request that ends after the limit is refused and the truck keeps its slot", () => {
    const r = M.opRequest(seeded(), 5, "carrier-d", "T8", 4, 420) // 15:00 to 16:00, hours end 15:30
    expect(r.result.appt).toBeUndefined()
    expect(r.result.offer).toBeUndefined()
    expect(r.result.reason).toContain("hours end")
    expect(slot(r.state, "T8")).toBe("3@13:00:booked")
  })

  test("hours of service: a displaced truck that cannot fit before its limit rolls to tomorrow", () => {
    let s = seeded()
    s.trucks.find(t => t.id === "T8")!.hosLimitMin = 360 // 14:00: its 13:00 slot still fits
    const r = M.opSetDoor(s, 5, 3, false) // door 3 down: T12 and T8 displaced
    const a = M.apptOf(r.state, "T8")!
    expect(a.status).toBe("booked") // 13:00 was free elsewhere
    s.trucks.find(t => t.id === "T8")!.hosLimitMin = 300
    const r2 = M.opSetDoor(seeded(), 5, 3, false)
    expect(M.apptOf(r2.state, "T8")!.status).toBe("booked")
  })

  test("done frees the door, backhaul counts, freeze stops the clock and resume continues from there", () => {
    let s = M.opArrive(at(120), 120, "T9").state
    s = M.opDone(at(220, s), 220, "T9").state
    expect(s.events.at(-1)!.kind).toBe("empty")
    s = M.opBackhaul(s, 221, "T9", "broker").state
    expect(s.counters.backhauls).toBe(1)
    s = M.opFreeze(s, 240).state
    expect(M.simNow(s.clock, T0 + 999_000)).toBe(240)
    s = M.opResume(s, T0 + 999_000).state
    expect(M.simNow(s.clock, T0 + 999_000)).toBe(240)
    expect(M.simNow(s.clock, T0 + 1_059_000)).toBe(300)
  })
})

describe("vendored contract", () => {
  test("actor/src/shared/types.ts is a byte-for-byte copy of shared/types.ts (run `bun run sync` after editing the contract)", () => {
    const vendored = readFileSync(new URL("./shared/types.ts", import.meta.url), "utf8")
    const source = readFileSync(new URL("../../shared/types.ts", import.meta.url), "utf8")
    expect(vendored).toBe(source)
  })
})
