// dashboard/demo.ts — the stage driver behind the dashboard's control strip.
// Each key runs that beat's actor calls plus the agents' lines (there is no Relay yet; Person B's dispatcher replaces the
// chatter part later). A small loop does the dispatcher's alarm work: award on auction_closed, accept on thread_expired,
// bid on the no-show auction, and the gate (arrive / done trucks on time so the dock does not no-show or detain them).
import { actors } from "../actor/generated/index.js"
import { PIER9 } from "../shared/pier9.js"
import { ACTOR_ID, DETENTION_FREE_MIN, hhmm, type Auction, type Event, type Offer, type Snapshot, type Truck } from "../shared/types.js"

export type KeyStatus = "ready" | "running" | "done" | "failed"
export type KeyState = { n: number; title: string; sim: string; simMin: number; status: KeyStatus; note?: string }
const KEYS: Omit<KeyState, "status">[] = [
  { n: 1, title: "Collision", sim: "08:05", simMin: 5 },
  { n: 2, title: "Truck arrives", sim: "08:28", simMin: 28 },
  { n: 3, title: "Traffic", sim: "09:00", simMin: 60 },
  { n: 4, title: "Door 5 down", sim: "09:20", simMin: 80 },
  { n: 5, title: "Unknown carrier", sim: "09:40", simMin: 100 },
  { n: 6, title: "Overrun", sim: "09:50", simMin: 110 },
  { n: 7, title: "Hot load", sim: "10:15", simMin: 135 },
  { n: 8, title: "Hours of service", sim: "11:20", simMin: 200 },
  { n: 9, title: "Backhaul", sim: "11:40", simMin: 220 },
  { n: 10, title: "Freeze", sim: "12:00", simMin: 240 },
]
export type Tech = "actor" | "agents" | "alarm" | "dispatcher"
export type StoryStep = { i: number; title: string; what: string; why: string; tech: Tech; status: "pending" | "active" | "done" | "failed"; at?: string; lines?: string[] }
export type Scene = { id: string; n: number; title: string; subtitle: string; status: KeyStatus; note?: string; outcome?: string }
export type Story = { sceneId: string; title: string; subtitle: string; steps: StoryStep[]; outcome?: string }
const SCENES: Omit<Scene, "status">[] = [
  { id: "collision", n: 1, title: "Two trucks, one door", subtitle: "Two carriers ask for door 4 at 14:00 in the same instant. The loser buys the slot." },
  { id: "doordown", n: 2, title: "Door 5 goes down", subtitle: "A reefer door fails. The cold load's agent buys its way back in two rounds." },
  { id: "auction", n: 3, title: "Traffic, and the clock decides", subtitle: "optional · two trucks run late, the freed hour goes to auction, the actor's own alarm closes it." },
]
type StepSpec = Omit<StoryStep, "status" | "i">
const NOSHOW = "T12" // the scripted no-show: the gate never lets it in
const STUCK = "T3" // sits at door 1 all morning so the 10:28 detention alarm has something to find
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export class DemoDriver {
  private keys: KeyState[] = KEYS.map(k => ({ ...k, status: "ready" }))
  private running: number | null = null
  auto = false
  private dock: ReturnType<typeof actors.Dock.get>
  private snap?: Snapshot
  private lastSeq = 0
  private ws?: WebSocket
  private stopped = false
  private log: string[] = []

  readonly passive = !!process.env.DEMO_PASSIVE // Person B's dispatcher is driving: no chatter, no awards, no gate
  readonly mode: "story" | "keys" = process.env.DEMO_MODE === "keys" ? "keys" : "story"
  readonly storySpeed = Number(process.env.STORY_SPEED ?? 5) // story mode: 1 real second = 5 sim seconds, so scenes can be pressed at any rhythm
  private scenes: Scene[] = SCENES.map(sc => ({ ...sc, status: "ready" }))
  private story: Story | null = null
  constructor(readonly actorId = ACTOR_ID, readonly speed = 60) {
    this.dock = actors.Dock.get(actorId)
    void this.connect()
    if (!this.passive) setInterval(() => void this.tickLoop(), 1000)
  }

  state() {
    return { actorId: this.actorId, speed: this.speed, auto: this.auto, running: this.running, passive: this.passive, mode: this.mode, scenes: this.scenes, story: this.story, simMin: this.simNow(), seeded: this.snap?.seeded ?? false, keys: this.keys, log: this.log.slice(-12) }
  }

  private say(from: string, to: string, text: string, thread?: string) { return this.dock.say(from, to, text, thread) }
  private note(text: string) { this.log.push(`${hhmm(this.simNow())} ${text}`); if (this.log.length > 60) this.log = this.log.slice(-60); console.log(`[demo] ${text}`) }
  private simNow(): number {
    const s = this.snap
    if (!s || !s.seeded) return 0
    if (s.frozen) return s.simMin
    return Math.max(s.simMin, Math.floor(((Date.now() - s.realStart) * s.speed) / 60000))
  }

  // ---------- websocket feed: the dispatcher's eyes ----------
  private async connect(): Promise<void> {
    if (this.stopped) return
    try {
      const { websocketUrl } = await actors.Dock.prepareWebsocket({ actorId: this.actorId, metadata: { role: "demo-driver" } })
      const ws = new WebSocket(websocketUrl)
      this.ws = ws
      ws.addEventListener("message", e => {
        let s: Snapshot | undefined
        try { s = JSON.parse(String(e.data)) } catch { return }
        if (!s || typeof s.simMin !== "number" || !Array.isArray(s.events)) return
        void this.onSnapshot(s)
      })
      ws.addEventListener("close", () => { if (!this.stopped) setTimeout(() => void this.connect(), 1500) })
      ws.addEventListener("error", () => { /* close follows */ })
    } catch (error) {
      console.error("[demo] websocket grant failed:", error instanceof Error ? error.message : error)
      setTimeout(() => void this.connect(), 3000)
    }
  }

  private handling = Promise.resolve()
  private onSnapshot(s: Snapshot): void {
    const first = !this.snap
    this.snap = s
    const fresh = s.events.filter(e => e.seq > this.lastSeq)
    if (fresh.some(e => e.kind === "seed")) { this.lastSeq = 0 } // a reseed restarts the sequence
    const events = first ? [] : s.events.filter(e => e.seq > this.lastSeq)
    this.lastSeq = s.events.at(-1)?.seq ?? this.lastSeq
    for (const ev of events) this.handling = this.handling.then(() => this.onEvent(ev, s)).catch(e => console.error("[demo] event handler:", e))
  }

  /** The dispatcher's alarm work. */
  private async onEvent(ev: Event, s: Snapshot): Promise<void> {
    if (this.passive || this.mode === "story") return
    if (ev.kind === "auction_closed" && ev.auctionId) {
      const au = s.auctions.find(a => a.id === ev.auctionId)
      if (!au || au.status !== "closed" || au.bids.length === 0) return
      const prio = (id: string) => s.trucks.find(t => t.id === id)?.priority ?? 0
      const best = [...au.bids].sort((a, b) => a.readyMin - b.readyMin || prio(b.truckId) - prio(a.truckId))[0]
      const r = await this.dock.award(au.id, best.truckId)
      this.note(`${au.id} closed by alarm → award ${best.truckId}: ${r.ok ? "ok" : r.reason}`)
      if (r.ok) await this.say("pier9-ops", "*", `${au.id} closed by the clock. Door ${au.door} ${hhmm(au.startMin)} goes to ${best.truckId} (ready ${hhmm(best.readyMin)}).`)
    } else if (ev.kind === "thread_expired" && ev.threadId) {
      const th = s.threads.find(t => t.id === ev.threadId)
      const offer = th && s.offers.find(o => o.id === th.offerId)
      if (!offer || offer.status !== "open") return
      const r = await this.dock.accept(offer.id)
      this.note(`${th!.id} went quiet → accept ${offer.id}: ${r.ok ? "ok" : r.reason}`)
      await this.say("pier9-ops", offer.carrier, `${th!.id} went quiet; the clock decides. ${offer.truckId} keeps door ${offer.door} ${hhmm(offer.startMin)}.`, th!.id)
    } else if (ev.kind === "auction_open" && ev.auctionId && /no-show/.test(ev.detail)) {
      // a slot the clock just freed: the dry truck with the most to gain bids, ready now
      const au = s.auctions.find(a => a.id === ev.auctionId)
      if (!au) return
      const door = s.doors.find(d => d.id === au.door)
      const candidates = s.appts
        .filter(a => a.status === "booked" && a.startMin > au.startMin)
        .map(a => ({ a, t: s.trucks.find(t => t.id === a.truckId)! }))
        .filter(x => x.t && (x.t.type === "dry" || door?.type === "reefer") && x.t.id !== NOSHOW)
        .sort((x, y) => y.a.startMin - x.a.startMin)
      const pick = candidates[0]
      if (!pick) return
      const now = this.simNow()
      await this.say(pick.t.carrier, "pier9-ops", `BID ${au.id} ${pick.t.id} ready ${hhmm(now)}`)
      const r = await this.dock.bid(au.id, pick.t.id, now)
      this.note(`no-show auction ${au.id}: ${pick.t.id} bids ready ${hhmm(now)}: ${r.ok ? "ok" : r.reason}`)
    } else if (ev.kind === "awarded" && ev.truckId) {
      // a winner whose slot already started must be at the gate now, or its own arrival check bites
      const a = s.appts.find(x => x.truckId === ev.truckId)
      if (a && a.status === "booked" && a.startMin <= this.simNow()) {
        const r = await this.dock.arrive(ev.truckId)
        this.note(`arrive ${ev.truckId} after award: ${r.ok ? "ok" : r.reason}`)
      }
    }
  }

  /** Every second: the gate, and auto mode's next key. */
  private gating = false
  private async tickLoop(): Promise<void> {
    if (this.gating || !this.snap?.seeded || this.snap.frozen || this.mode === "story") return
    this.gating = true
    try {
      await this.gate()
      if (this.auto && this.running === null) {
        const next = this.keys.find(k => k.status === "ready")
        if (next && next.simMin <= this.simNow()) void this.press(next.n)
      }
    } finally { this.gating = false }
  }

  private async gate(hold: string[] = []): Promise<Snapshot> {
    const s = await this.dock.snapshot()
    this.snap = s
    const now = s.simMin
    // Trucks a pending key still needs to find in place are held back, so a late press does not lose its beat.
    const pending = (n: number) => this.keys.find(k => k.n === n)?.status !== "done"
    const keepOut = new Set([NOSHOW, ...hold])
    if (now < 28) keepOut.add(STUCK) // key 2's moment; from 08:28 the gate lets T3 in itself so the detention beat survives a missed press
    if (pending(3)) { keepOut.add("T1"); keepOut.add("T4") } // key 3 delays them
    if (pending(4)) { keepOut.add("T5"); keepOut.add("T9") } // key 4 displaces T5 and bumps T9
    if (pending(7)) { keepOut.add("T7") } // key 7 bumps T7
    const keepIn = new Set([STUCK])
    if (pending(9)) keepIn.add("T9") // key 9 sends T9 away itself
    for (const a of s.appts) {
      if (a.status === "booked" && a.startMin <= now && !keepOut.has(a.truckId)) {
        const r = await this.dock.arrive(a.truckId)
        if (r.ok) this.note(`gate: ${a.truckId} arrives at door ${a.door}`)
      } else if ((a.status === "arrived" || a.status === "unloading") && !keepIn.has(a.truckId) && a.startMin + a.durationMin <= now) {
        const r = await this.dock.done(a.truckId)
        if (r.ok) this.note(`gate: ${a.truckId} leaves door ${a.door}`)
      }
    }
    return s
  }

  // ---------- controls ----------
  async reset(): Promise<{ ok: boolean }> {
    this.auto = false
    this.keys = KEYS.map(k => ({ ...k, status: "ready" }))
    this.scenes = SCENES.map(sc => ({ ...sc, status: "ready" }))
    this.story = null
    const s = this.mode === "story"
      ? await this.dock.seed({ ...PIER9, speed: this.storySpeed, arrivalChecks: "flagged" })
      : await this.dock.seed({ ...PIER9, speed: this.speed })
    this.snap = s
    this.lastSeq = s.events.at(-1)?.seq ?? 0
    this.running = null
    this.log = []
    this.note(`reset: Pier 9 at 08:00, ${this.mode === "story" ? this.storySpeed : this.speed}x${this.mode === "story" ? " (story mode)" : ""}`)
    return { ok: true }
  }

  toggleAuto(): { auto: boolean } {
    this.auto = !this.auto
    this.note(this.auto ? "auto: remaining keys fire at their scheduled times" : "auto off")
    return { auto: this.auto }
  }

  press(n: number): { ok: boolean; reason?: string } {
    const key = this.keys.find(k => k.n === n)
    if (!key) return { ok: false, reason: `no key ${n}` }
    if (this.running !== null) return { ok: false, reason: `key ${this.running} is still running` }
    if (!this.snap?.seeded) return { ok: false, reason: "press Reset first: the dock is not seeded" }
    if (this.passive) return { ok: false, reason: "passive mode: Person B's dispatcher and agents are driving this run" }
    this.running = n
    key.status = "running"
    key.note = undefined
    void this.handling.then(() => this.beat(n)).then(
      (note) => { key.status = "done"; if (note) key.note = note; this.running = null; this.note(`key ${n} ${key.title}: done${note ? ` (${note})` : ""}`) },
      (e: unknown) => { key.status = "failed"; key.note = e instanceof Error ? e.message : String(e); this.running = null; this.note(`key ${n} failed: ${key.note}`) },
    )
    return { ok: true }
  }

  private openOffer(s: Snapshot, truckId: string): Offer | undefined {
    return [...s.offers].reverse().find(o => o.truckId === truckId && o.status === "open")
  }
  private must<T>(v: T | undefined, what: string): T { if (v === undefined) throw new Error(`expected ${what}`); return v }

  // ---------- story mode: three scenes, each narrated step by step ----------
  startScene(id: string): { ok: boolean; reason?: string } {
    const scene = this.scenes.find(sc => sc.id === id)
    if (!scene) return { ok: false, reason: `no scene ${id}` }
    if (this.running !== null) return { ok: false, reason: "a scene is still running" }
    if (!this.snap?.seeded) return { ok: false, reason: "press Reset first: the dock is not seeded" }
    if (this.passive) return { ok: false, reason: "passive mode" }
    this.running = scene.n
    scene.status = "running"
    scene.note = undefined
    scene.outcome = undefined
    const specs = this.sceneSteps(id)
    this.story = { sceneId: id, title: scene.title, subtitle: scene.subtitle, steps: specs.map((st, i) => ({ ...st, i: i + 1, status: "pending" })) }
    void this.handling.then(() => this.scene(id)).then(
      (outcome) => { scene.status = "done"; scene.outcome = outcome ?? undefined; if (this.story) this.story.outcome = outcome ?? undefined; this.running = null; this.note(`scene ${scene.n} ${scene.title}: done`) },
      (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        scene.status = "failed"; scene.note = msg; this.running = null
        const active = this.story?.steps.find(st => st.status === "active"); if (active) { active.status = "failed"; active.what = `${active.what} (${msg})` }
        this.note(`scene ${scene.n} failed: ${msg}`)
      },
    )
    return { ok: true }
  }

  private sceneSteps(id: string): StepSpec[] {
    switch (id) {
      case "collision": return [
        { tech: "actor", title: "Two requests for door 4 at 14:00, in the same instant", what: "carrier-b asks for T14, carrier-a asks for T13: both want door 4 at two o'clock.", why: "The dock is a Durable Actor: one request at a time. T14 books, T13 gets an offer for 15:00. No lock, no race, no double booking." },
        { tech: "agents", title: "The loser goes straight to the winner with cash", what: "carrier-a's agent opens a thread with carrier-b: swap the two slots for $120.", why: "Agents negotiate with each other on Agent Relay. The dock is not in the conversation; it only listens." },
        { tech: "agents", title: "Two rounds: counter, then agree", what: "carrier-b counters at $150. carrier-a agrees.", why: "Multi-round bargaining with limits in code: budgets are checked before the model answers, two messages per agent per thread, and a deadline timer in the actor if they stall." },
        { tech: "dispatcher", title: "SETTLE: the dock swaps the slots atomically", what: "carrier-a posts the settlement. The dispatcher calls swap(T13, T14), then pay(). Both blocks trade places on the board.", why: "The actor validates every settlement in order. If two agents settle conflicting deals in the same second, one lands and the other comes back REJECTED." },
      ]
      case "doordown": return [
        { tech: "actor", title: "Door 5 fails; the dock re-plans in one call", what: "setDoor(5, out of service). The reefer truck on it, carrier-c's T5, is the only truck that moves: to door 6 at 11:00.", why: "State and planning live in the actor. Unaffected trucks keep their slots. One offer goes out, to carrier-c, naming who holds the slot it would rather have." },
        { tech: "agents", title: "carrier-c wants 10:00 back: the cold chain is worth money", what: "Its agent offers carrier-b $150 to take 11:00 instead.", why: "The offer told the agent exactly who to talk to. No broker, no dispatcher, no phone call." },
        { tech: "agents", title: "Round two: $200, agreed", what: "carrier-b counters at $200. carrier-c agrees. Two rounds, then silence.", why: "Hard caps keep language-model agents from talking forever: two messages each, and the actor's deadline timer decides if they stall." },
        { tech: "actor", title: "SETTLE: the dock pins T5 to 10:00 and bumps T9", what: "counter(offer, door 6, 10:00) succeeds because no higher-priority truck would move. T9 gets 11:00 and its own offer. $200 recorded.", why: "The actor checks door type and priority before accepting. A deal that breaks the rules comes back REJECTED with the reason." },
      ]
      case "auction": return [
        { tech: "actor", title: "Two of carrier-a's trucks report 90 minutes late", what: "reportEta(T1, 10:30) and reportEta(T4, 11:30). The dock re-plans only those two. Door 2 at 09:00 is suddenly free.", why: "Every ETA change is a re-plan inside the actor; the freed hour becomes something to sell." },
        { tech: "dispatcher", title: "The freed slot goes to auction, closing in one sim minute", what: "AUCTION on door 2 09:00. Any carrier may bid once: BID <truck> ready <time>.", why: "The close is a timer inside the actor, not a cron job somewhere else." },
        { tech: "agents", title: "Three carriers answer: two bid, one passes", what: "carrier-b bids T6 ready 08:50. carrier-d bids T8 ready 09:10. carrier-c passes: reefer loads only.", why: "One bid per carrier, enforced in code. The agents decide whether the slot is worth it to them." },
        { tech: "alarm", title: "The actor wakes itself and closes the auction", what: "Nobody presses anything. The auction_close alarm fires inside the actor and the auction closes.", why: "Durable alarm: it fires even if nobody is connected. A test actor left alone this afternoon woke itself five times on schedule." },
        { tech: "actor", title: "Award: earliest ready wins", what: "award(T6): T6 jumps from noon to 09:00. Detention avoided +$225.", why: "The actor records the award atomically; the counter shows the money the carrier will never pay." },
      ]
      default: return []
    }
  }

  private step(i: number): StoryStep { const st = this.story!.steps[i - 1]; st.status = "active"; st.at = hhmm(this.simNow()); return st }
  private finish(st: StoryStep, lines: string[]) { st.lines = lines; st.status = "done"; st.at = hhmm(this.simNow()) }

  private async scene(id: string): Promise<string | void> {
    const dock = this.dock
    const say = this.say.bind(this)
    const chat = async (from: string, to: string, text: string, thread?: string) => { await say(from, to, text, thread); return `${from} → ${to}: ${text}` }
    const pace = () => sleep(1500)
    if (id === "collision") {
      let st = this.step(1)
      const r1 = await dock.request("carrier-b", "T14", 4, 360)
      const r2 = await dock.request("carrier-a", "T13", 4, 360)
      const offer = r2.offer ?? this.must(this.openOffer(await dock.snapshot(), "T13"), "an offer for T13")
      await dock.openThread("th1", offer.id, this.simNow() + 30)
      this.finish(st, [`dock → carrier-b: T14 booked door 4 14:00`, `dock → carrier-a: OFFER ${offer.id} T13 door 4 15:00 — 14:00 is held by T14 (carrier-b)`])
      await say("pier9-ops", "*", `OFFER ${offer.id} → carrier-a: T13 door 4 15:00 — 14:00 is held by carrier-b (T14).`, "th1")
      await pace()
      st = this.step(2)
      const l2 = await chat("carrier-a", "carrier-b", "SWAP? @carrier-b — T13 takes door 4 14:00, T14 takes 15:00, we pay $120.", "th1")
      this.finish(st, [l2])
      await pace()
      st = this.step(3)
      const l3a = await chat("carrier-b", "carrier-a", "COUNTER $150 — 15:00 costs us a driver swap.", "th1")
      await pace()
      const l3b = await chat("carrier-a", "carrier-b", "AGREE $150.", "th1")
      this.finish(st, [l3a, l3b])
      await pace()
      st = this.step(4)
      const l4 = await chat("carrier-a", "pier9-ops", "SETTLE th1: T13 door 4 14:00 · T14 door 4 15:00 · pay carrier-a→carrier-b $150", "th1")
      const sw = await dock.swap("T13", "T14")
      if (!sw.ok) throw new Error(`swap refused: ${sw.reason}`)
      await dock.pay("carrier-a", "carrier-b", 150)
      await dock.settleThread("th1")
      this.finish(st, [l4, "dock: swap(T13, T14) ok — T13 now 14:00, T14 15:00", "dock: pay carrier-a → carrier-b $150"])
      const s = await dock.snapshot()
      return `T13 at 14:00, T14 at 15:00, $${s.counters.sidePaymentsUsd} changed hands, the dock never double-booked, nobody picked up a phone.`
    }
    if (id === "doordown") {
      let st = this.step(1)
      const sd = await dock.setDoor(5, false)
      const o5 = sd.offers.find(o => o.truckId === "T5") ?? this.openOffer(await dock.snapshot(), "T5")
      if (!o5) throw new Error("door 5 down displaced nobody; is T5 still on door 5?")
      const holder = (await dock.snapshot()).appts.find(a => a.door === 6 && a.startMin === 120 && a.truckId !== "T5")
      await dock.openThread("th-cold", o5.id, this.simNow() + 30)
      this.finish(st, ["dock: door 5 out of service", `dock → carrier-c: OFFER ${o5.id} T5 door ${o5.door} ${hhmm(o5.startMin)} (was door 5 10:00). Holder of door 6 10:00: carrier-b (${holder?.truckId ?? "T9"})`])
      await say("pier9-ops", "*", `Door 5 is out of service. OFFER ${o5.id} → carrier-c: T5 door 6 ${hhmm(o5.startMin)}. Holder of door 6 10:00: @carrier-b (${holder?.truckId ?? "T9"}).`, "th-cold")
      await pace()
      st = this.step(2)
      const l2 = await chat("carrier-c", "carrier-b", "SWAP? @carrier-b — T5 takes door 6 10:00, T9 takes 11:00, we cover $150 of your detention. Cold chain.", "th-cold")
      this.finish(st, [l2])
      await pace()
      st = this.step(3)
      const l3a = await chat("carrier-b", "carrier-c", "COUNTER $200 — 11:00 pushes our next pickup.", "th-cold")
      await pace()
      const l3b = await chat("carrier-c", "carrier-b", "AGREE $200 — the cold chain is worth it.", "th-cold")
      this.finish(st, [l3a, l3b])
      await pace()
      st = this.step(4)
      const l4 = await chat("carrier-c", "pier9-ops", `SETTLE th-cold: T5 door 6 10:00 · ${holder?.truckId ?? "T9"} door 6 11:00 · pay carrier-c→carrier-b $200`, "th-cold")
      const ct = await dock.counter(o5.id, 6, 120)
      if (!ct.ok) throw new Error(`counter refused: ${ct.reason}`)
      for (const o of ct.offers) await dock.accept(o.id)
      await dock.pay("carrier-c", "carrier-b", 200)
      await dock.settleThread("th-cold")
      this.finish(st, [l4, "dock: counter ok — T5 pinned to door 6 10:00, T9 moved to 11:00", "dock: pay carrier-c → carrier-b $200"])
      const s = await dock.snapshot()
      return `T5 unloads cold at 10:00 on door 6, T9 moved an hour for $200, side payments now $${s.counters.sidePaymentsUsd}.`
    }
    if (id === "auction") {
      let st = this.step(1)
      const now = this.simNow()
      const e1 = await dock.reportEta("T1", Math.max(150, now + 90))
      const e2 = await dock.reportEta("T4", Math.max(210, now + 90))
      for (const o of [...e1.offers, ...e2.offers]) await dock.accept(o.id)
      const moved = [...e1.offers, ...e2.offers].map(o => `${o.truckId} → door ${o.door} ${hhmm(o.startMin)}`)
      this.finish(st, [`carrier-a → dock: T1 and T4 are 90 minutes out`, ...moved.map(m => `dock: ${m}`), "dock: door 2 09:00 is free"])
      await say("carrier-a", "pier9-ops", "T1 and T4 are stuck on the bridge; both 90 minutes out.")
      await pace()
      st = this.step(2)
      const closes = this.simNow() + 1
      const a1 = this.must((await dock.openAuction(2, 60, closes, "T1 stuck in traffic")).auction, "auction")
      const l2 = await chat("pier9-ops", "*", `AUCTION ${a1.id} door 2 09:00 — slot freed by T1's delay. Closes ${hhmm(closes)}. BID ${a1.id} <truck> ready <HH:MM>`)
      this.finish(st, [l2])
      await pace()
      st = this.step(3)
      const l3a = await chat("carrier-b", "pier9-ops", `BID ${a1.id} T6 ready 08:50`)
      await dock.bid(a1.id, "T6", 50)
      await pace()
      const l3b = await chat("carrier-d", "pier9-ops", `BID ${a1.id} T8 ready 09:10`)
      await dock.bid(a1.id, "T8", 70)
      await pace()
      const l3c = await chat("carrier-c", "pier9-ops", "PASS — reefer loads only, that is a dry door.")
      this.finish(st, [l3a, l3b, l3c])
      st = this.step(4)
      const started = Date.now()
      let closed = false
      while (Date.now() - started < 60_000) {
        const s = await dock.snapshot()
        const au = s.auctions.find(a => a.id === a1.id)
        if (au && au.status !== "open") { closed = true; break }
        await sleep(500)
      }
      if (!closed) throw new Error("the auction_close alarm did not fire within 60 s")
      this.finish(st, [`alarm → auction_closed ${a1.id} at ${hhmm(this.simNow())}: 2 bids, nobody connected had to do anything`])
      await pace()
      st = this.step(5)
      const aw = await dock.award(a1.id, "T6")
      if (!aw.ok) throw new Error(`award refused: ${aw.reason}`)
      const l5 = await chat("pier9-ops", "*", `${a1.id} closed by the clock. Door 2 09:00 goes to T6 (ready 08:50).`)
      const s = await dock.snapshot()
      this.finish(st, [l5, `dock: award(${a1.id}, T6) ok — detention avoided now $${s.counters.detentionAvoidedUsd}`])
      return `T6 unloads at 09:00 instead of noon, the clock did the closing, detention avoided $${s.counters.detentionAvoidedUsd}.`
    }
    throw new Error(`no scene ${id}`)
  }

  private async beat(n: number): Promise<string | void> {
    const dock = this.dock
    const say = this.say.bind(this)
    const pace = () => sleep(Math.max(300, 60_000 / this.speed)) // one sim minute between lines, at least 300 ms
    switch (n) {
      case 1: {
        await this.gate(["T13", "T14"])
        const r1 = await dock.request("carrier-a", "T13", 4, 360)
        const r2 = await dock.request("carrier-b", "T14", 4, 360)
        this.note(`collision: ${r1.appt ? "T13 booked 14:00" : r1.reason}; ${r2.offer ? `T14 offered ${hhmm(r2.offer.startMin)}` : r2.reason}`)
        const offer = r2.offer ?? this.must(this.openOffer(await dock.snapshot(), "T14"), "an offer for T14")
        await dock.openThread("th1", offer.id, this.simNow() + 10)
        await say("pier9-ops", "*", `OFFER ${offer.id} → carrier-b: T14 door 4 15:00 — 14:00 is held by carrier-a (T13). Thread th1 closes ${hhmm(this.simNow() + 10)}.`, "th1")
        await pace(); await say("carrier-b", "carrier-a", "SWAP? @carrier-a — T14 takes door 4 14:00, T13 takes 15:00, we pay $120.", "th1")
        await pace(); await say("carrier-a", "carrier-b", "COUNTER $150 — 15:00 costs us a driver swap.", "th1")
        await pace(); await say("carrier-b", "carrier-a", "AGREE $150.", "th1")
        await pace(); await say("carrier-b", "pier9-ops", "SETTLE th1: T14 door 4 14:00 · T13 door 4 15:00 · pay carrier-b→carrier-a $150", "th1")
        const sw = await dock.swap("T14", "T13")
        if (!sw.ok) throw new Error(`swap refused: ${sw.reason}`)
        await dock.pay("carrier-b", "carrier-a", 150)
        await dock.settleThread("th1")
        break
      }
      case 2: {
        const a = (await dock.snapshot()).appts.find(x => x.truckId === STUCK)
        let note: string | undefined
        if (a?.status === "booked" || a?.status === "noshow") {
          const r = await dock.arrive(STUCK)
          if (!r.ok) note = `T3 missed its window (${r.reason}); the detention beat will not happen`
        } else if (a) note = `T3 had already arrived at ${hhmm(a.arrivedMin ?? a.startMin)}`
        await say("broker", "pier9-ops", "T3 is at door 1, paperwork in hand.")
        return note
      }
      case 3: {
        await this.gate(["T1", "T4"])
        const now = this.simNow()
        await say("carrier-a", "pier9-ops", "T1 and T4 are stuck on the bridge; both 90 minutes out.")
        const e1 = await dock.reportEta("T1", Math.max(150, now + 90))
        const e2 = await dock.reportEta("T4", Math.max(210, now + 90))
        this.note(`eta: T1 → ${e1.offers.map(o => `door ${o.door} ${hhmm(o.startMin)}`).join() || "no move"}; T4 → ${e2.offers.map(o => `door ${o.door} ${hhmm(o.startMin)}`).join() || "no move"}`)
        for (const o of [...e1.offers, ...e2.offers]) await dock.accept(o.id)
        const a1 = this.must((await dock.openAuction(2, 60, Math.max(70, now + 10), "T1 stuck in traffic")).auction, "auction a1")
        const a2 = this.must((await dock.openAuction(1, 120, Math.max(130, now + 10), "T4 stuck in traffic")).auction, "auction a2")
        await say("pier9-ops", "*", `AUCTION ${a1.id} door 2 09:00 — closes ${hhmm(a1.closesMin)} · AUCTION ${a2.id} door 1 10:00 — closes ${hhmm(a2.closesMin)}. BID <auction> <truck> ready <HH:MM>`)
        await pace(); await say("carrier-b", "pier9-ops", `BID ${a1.id} T6 ready 08:50`)
        await dock.bid(a1.id, "T6", 50)
        await pace(); await say("carrier-d", "pier9-ops", `BID ${a2.id} T8 ready 09:10`)
        await dock.bid(a2.id, "T8", 70)
        await pace(); await say("carrier-c", "pier9-ops", "PASS — reefer loads only, those are dry doors.")
        break
      }
      case 4: {
        await this.gate()
        const sd = await dock.setDoor(5, false)
        await say("pier9-ops", "*", "Door 5 is out of service: compressor fault.")
        const o5 = sd.offers.find(o => o.truckId === "T5") ?? this.openOffer(await dock.snapshot(), "T5")
        if (!o5) throw new Error("door 5 down displaced nobody; is T5 still on door 5?")
        const holder = (await dock.snapshot()).appts.find(a => a.door === 6 && a.startMin === 120 && a.status !== "noshow")
        await pace(); await say("pier9-ops", "carrier-c", `OFFER ${o5.id}: T5 door ${o5.door} ${hhmm(o5.startMin)} — door 5 out of service. Holder of door 6 10:00: @carrier-b (${holder?.truckId ?? "T9"}).`, "th-cold")
        await pace(); await say("carrier-c", "carrier-b", "SWAP? @carrier-b — T5 takes door 6 10:00, T9 takes 11:00, we cover $150 of your detention. Cold chain.", "th-cold")
        await pace(); await say("carrier-b", "carrier-c", "COUNTER $200 — 11:00 pushes our next pickup.", "th-cold")
        await pace(); await say("carrier-c", "carrier-b", "AGREE $200 — the cold chain is worth it.", "th-cold")
        await pace(); await say("carrier-c", "pier9-ops", `SETTLE ${o5.id}: T5 door 6 10:00 · ${holder?.truckId ?? "T9"} door 6 11:00 · pay carrier-c→carrier-b $200`, "th-cold")
        const ct = await dock.counter(o5.id, 6, 120)
        if (!ct.ok) {
          await say("pier9-ops", "carrier-c", `REJECTED ${o5.id} — ${ct.reason}`, "th-cold")
          await dock.accept(o5.id)
        } else {
          for (const o of ct.offers) await dock.accept(o.id)
          await dock.pay("carrier-c", "carrier-b", 200)
        }
        break
      }
      case 5: {
        await say("carrier-x", "pier9-ops", "REQUEST door 2 at 11:00 for load L12.")
        await pace(); await say("pier9-ops", "broker", "VERIFY @carrier-x load L12? — unknown carrier requesting door 2 at 11:00")
        await pace(); await say("broker", "pier9-ops", "VERIFY no — L12 is tendered to @carrier-b, nobody else.")
        await pace(); await say("pier9-ops", "carrier-x", "REFUSED — the broker does not vouch for you. No door.")
        await pace(); await say("carrier-x", "pier9-ops", "We hauled L12 last week.")
        await pace(); await say("pier9-ops", "carrier-x", "refused")
        break
      }
      case 6: {
        await this.gate()
        const s = await dock.snapshot()
        const now = s.simMin
        const at = s.appts.find(a => a.door === 2 && (a.status === "unloading" || a.status === "arrived"))
          ?? s.appts.find(a => a.status === "unloading" || a.status === "arrived")
        if (!at) throw new Error("no truck is at a door to overrun")
        const ov = await dock.overrun(at.truckId, 75)
        await say("pier9-ops", "*", `${at.truckId} is running 75 minutes over at door ${at.door}: paperwork.`)
        const o = ov.offers[0]
        if (!o) { this.note("overrun displaced nobody"); break }
        await dock.openThread("th2", o.id, now + 10)
        await pace(); await say("pier9-ops", o.carrier, `OFFER ${o.id} → ${o.carrier}: ${o.truckId} door ${o.door} ${hhmm(o.startMin)} — ${o.reason}. Thread th2 closes ${hhmm(now + 10)}.`, "th2")
        await pace(); await say(o.carrier, "*", `SWAP? anyone give ${o.truckId} back its 11:00? We have door ${o.door} ${hhmm(o.startMin)} to trade.`, "th2")
        for (const other of ov.offers.slice(1)) await dock.accept(other.id)
        break
      }
      case 7: {
        await this.gate()
        const pr = await dock.prioritize("T11")
        await say("shipper", "*", "L17 is hot: who can yield 11:00?", "th-hot")
        const o7 = pr.offers.find(o => o.truckId === "T7") ?? pr.offers[0]
        await pace(); await say("broker", "shipper", `I yield T7 if pier9-ops waives T3's detention and someone gives me ${o7 ? hhmm(o7.startMin) : "noon"}.`, "th-hot")
        await pace(); await say("carrier-b", "broker", "Take my 12:00 for $80.", "th-hot")
        await pace(); await say("pier9-ops", "broker", "Waiver approved: T3's detention is on the house.", "th-hot")
        await pace(); await say("shipper", "pier9-ops", `SETTLE th-hot: T7 yields 11:00 · T3 detention waived · pay carrier-b→broker $80`, "th-hot")
        await dock.resolveClaim(STUCK, "waived")
        await dock.pay("carrier-b", "broker", 80)
        for (const o of pr.offers) await dock.accept(o.id)
        break
      }
      case 8: {
        const r = await dock.request("carrier-d", "T15", 4, 480, { hosLimitMin: 500, load: "L15" })
        await say("carrier-d", "pier9-ops", "T15 can take door 4 at 16:00? My hours end 16:20.")
        await pace(); await say("pier9-ops", "carrier-d", r.reason ? `No: ${r.reason}. Booked for tomorrow 08:00.` : "Booked.")
        break
      }
      case 9: {
        const s = await dock.snapshot()
        const t9 = s.appts.find(a => a.truckId === "T9")
        if (t9?.status === "booked") await dock.arrive("T9")
        const dn = await dock.done("T9")
        if (!dn.ok) throw new Error(dn.reason)
        await say("broker", "carrier-b", "T9 is empty at door 6 — I have a backhaul to Fresno, loads in 20 minutes.")
        await pace(); await say("carrier-b", "broker", "accept — T9 leaves full.")
        await dock.backhaul("T9", "broker")
        break
      }
      case 10: {
        await dock.freeze()
        break
      }
      default: throw new Error(`no beat for key ${n}`)
    }
  }
}
