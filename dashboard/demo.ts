// dashboard/demo.ts — the stage driver behind the dashboard's control strip.
// Each key runs that beat's actor calls plus the agents' lines (there is no Relay yet; Person B's dispatcher replaces the
// chatter part later). A small loop does the dispatcher's alarm work: award on auction_closed, accept on thread_expired,
// bid on the no-show auction, and the gate (arrive / done trucks on time so the dock does not no-show or detain them).
import { actors } from "../actor/generated/index.js"
import { PIER9 } from "../shared/pier9.js"
import { ACTOR_ID, DETENTION_FREE_MIN, hhmm, type Auction, type Event, type Offer, type Snapshot, type Truck } from "../shared/types.js"
import { RelayBus, type BusAgent } from "../relay/bus.js"
const CAST = ["pier9-ops", "carrier-a", "carrier-b", "carrier-c", "carrier-d", "broker", "shipper", "carrier-x"]
// PLAN.md's persona table, for the carrier tabs.
export const CAST_INFO = [
  { handle: "carrier-a", role: "Carrier A, the pusher", trucks: ["T1", "T4", "T13"], hourUsd: 120, budgetUsd: 150, rule: "Always wants the earliest slot; opens a SWAP with whoever holds it; never yields; bids on every auction." },
  { handle: "carrier-b", role: "Carrier B, cooperative", trucks: ["T2", "T6", "T9", "T12", "T14"], hourUsd: 60, budgetUsd: 0, rule: "Accepts anything within two hours; when offered money to move, counters once for 20% more, then agrees." },
  { handle: "carrier-c", role: "Carrier C, reefer", trucks: ["T5", "T10"], hourUsd: 200, budgetUsd: 250, rule: "Refuses any dry door; opens a SWAP for the earliest reefer slot and pays for it; mentions the cold chain every time." },
  { handle: "carrier-d", role: "Carrier D, owner-operator", trucks: ["T8"], hourUsd: 90, budgetUsd: 0, rule: "Bids on auctions it can reach; if a slot ends after 15:30, declines and asks for tomorrow 08:00." },
  { handle: "broker", role: "Broker", trucks: ["T3", "T7"], hourUsd: 100, budgetUsd: 0, rule: "Yields for a hot load only for a detention waiver and a later slot; vets carriers against its tender list; offers backhauls to empty trucks." },
  { handle: "shipper", role: "Shipper", trucks: ["T11"], hourUsd: 300, budgetUsd: 300, rule: "Asks the thread who can yield, accepts the broker's package, posts the SETTLE, thanks everyone by name." },
  { handle: "pier9-ops", role: "Pier 9 Cold Storage, the warehouse", trucks: [], hourUsd: 0, budgetUsd: 200, rule: "Approves claims and waivers under $200; refuses any carrier the broker won't vouch for; announces door changes and auctions." },
  { handle: "carrier-x", role: "Unknown carrier", trucks: [], hourUsd: 0, budgetUsd: 0, rule: "Asks for door 2 at 11:00 for a load that is not theirs; argues once when refused, then goes quiet." },
]

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
  // Agent Relay: every agent line is posted as that agent in #pier9 (one thread per deal) before the dock mirrors it.
  readonly relayEnabled = !!process.env.RELAY_WORKSPACE_KEY && process.env.RELAY_POST !== "0"
  private relayBus?: RelayBus
  private relayAgents = new Map<string, Promise<BusAgent>>()
  private relayRoots = new Map<string, string>()
  private relayStats = { posted: 0, failed: 0, delivered: 0, lastError: "" }
  readonly storySpeed = Number(process.env.STORY_SPEED ?? 5) // story mode: 1 real second = 5 sim seconds, so scenes can be pressed at any rhythm
  private scenes: Scene[] = SCENES.map(sc => ({ ...sc, status: "ready" }))
  private story: Story | null = null
  // Step-by-step: every step after the first waits for the presenter's Next (space / enter / arrow), unless STORY_MANUAL=0.
  readonly manual = process.env.STORY_MANUAL !== "0"
  readonly pace = Number(process.env.STORY_PACE_MS ?? 3000) // real ms between lines inside a step
  private awaitingNext = false
  private nextTitle = ""
  private nextWaiter: (() => void) | null = null
  private aborted = false
  // What arrived over Agent Relay's event stream (not the dock mirror): the carrier tabs render this.
  private relayFeed: { id: string; from: string; text: string; thread?: string; mentions: string[]; at: number }[] = []
  constructor(readonly actorId = ACTOR_ID, readonly speed = 120) { // key mode clock; 120x puts the 09:10 auction alarm 35 s after Reset
    this.dock = actors.Dock.get(actorId)
    void this.connect()
    if (!this.passive) setInterval(() => void this.tickLoop(), 1000)
    if (this.relayEnabled) {
      try {
        this.relayBus = new RelayBus()
        this.relayBus.onMessage(m => {
          this.relayStats.delivered += 1
          this.relayFeed.push({ id: m.id, from: m.from, text: m.text, thread: m.thread, mentions: m.mentions, at: Date.now() })
          if (this.relayFeed.length > 400) this.relayFeed = this.relayFeed.slice(-400)
        })
        // the workspace rejects bursts ("write capacity is busy"): register the cast one at a time, in the queue
        for (const name of CAST) this.relayQueue(() => this.relayAgent(name).then(() => this.note(`relay: ${name} is in #pier9`)))
      } catch (e) {
        this.relayStats.lastError = e instanceof Error ? e.message : String(e)
      }
    }
  }

  /** Registration with backoff; one attempt chain per handle. */
  private relayAgent(name: string): Promise<BusAgent> {
    let p = this.relayAgents.get(name)
    if (!p) {
      p = (async () => {
        let last: unknown
        for (const wait of [0, 2000, 4000, 8000, 12000]) {
          if (wait) await sleep(wait)
          try { return await this.relayBus!.register(name) } catch (e) { last = e }
        }
        throw last
      })()
      this.relayAgents.set(name, p)
      p.catch(e => { this.relayAgents.delete(name); this.relayStats.lastError = `register ${name}: ${e instanceof Error ? e.message : e}` })
    }
    return p
  }

  /** One FIFO for everything that touches Relay, so replies always follow their thread root and bursts never happen. */
  private relayChain: Promise<void> = Promise.resolve()
  private relayPending = 0
  private relayQueue(job: () => Promise<unknown>): void {
    this.relayPending += 1
    this.relayChain = this.relayChain.then(job).catch(() => {}).then(() => { this.relayPending -= 1 })
  }

  state() {
    return { actorId: this.actorId, speed: this.speed, auto: this.auto, running: this.running, passive: this.passive, mode: this.mode, scenes: this.scenes, story: this.story, manual: this.manual, awaitingNext: this.awaitingNext, nextTitle: this.nextTitle, cast: CAST_INFO, relayFeed: this.relayFeed.slice(-200), relay: { enabled: !!this.relayBus, agents: this.relayAgents.size, queued: this.relayPending, ...this.relayStats }, simMin: this.simNow(), seeded: this.snap?.seeded ?? false, keys: this.keys, log: this.log.slice(-12) }
  }

  /** Post the line in #pier9 on Agent Relay as `from` (reply inside the deal's thread), then mirror it into the dock. */
  private async say(from: string, to: string, text: string, thread?: string) {
    if (this.relayBus) {
      // queued and retried; the scene never waits for Relay
      this.relayQueue(async () => {
        let last: unknown
        for (const wait of [0, 1500, 3000, 6000]) {
          if (wait) await sleep(wait)
          try {
            const agent = await this.relayAgent(from)
            const root = thread ? this.relayRoots.get(thread) : undefined
            const line = to !== "*" && !text.includes(`@${to}`) ? `@${to} ${text}` : text
            const m = await agent.post(line, root ? { thread: root } : undefined)
            if (thread && !root) this.relayRoots.set(thread, m.id)
            this.relayStats.posted += 1
            return
          } catch (e) { last = e }
        }
        this.relayStats.failed += 1
        this.relayStats.lastError = last instanceof Error ? last.message : String(last)
      })
    }
    return this.dock.say(from, to, text, thread)
  }
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
    this.aborted = true
    this.nextWaiter?.()
    this.awaitingNext = false
    this.relayFeed = []
    const s = this.mode === "story"
      ? await this.dock.seed({ ...PIER9, speed: this.storySpeed, arrivalChecks: "flagged" })
      : await this.dock.seed({ ...PIER9, speed: this.speed })
    this.snap = s
    this.lastSeq = s.events.at(-1)?.seq ?? 0
    this.running = null
    this.relayRoots.clear()
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
    this.aborted = false
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
        { tech: "actor", title: "carrier-b asks for door 4 at 14:00", what: "A normal booking: request(carrier-b, T14, door 4, 14:00). The dock answers in one call.", why: "The dock is the single source of truth for every door. No spreadsheet, no phone." },
        { tech: "actor", title: "carrier-a asks for the same slot, in the same instant", what: "request(carrier-a, T13, door 4, 14:00). The dock sees the collision: 14:00 is taken, so T13 is offered 15:00 instead of an error.", why: "The dock is a Durable Actor: one request at a time. Two simultaneous requests can never double-book; the second gets the next slot and an offer." },
        { tech: "dispatcher", title: "The dock announces the offer in #pier9", what: "OFFER → carrier-a: T13 door 4 15:00 — 14:00 is held by carrier-b (T14). A thread opens for the deal.", why: "The offer names who holds the slot the loser wants, which is exactly what a human dispatcher would have to look up and phone around for." },
        { tech: "agents", title: "The loser goes straight to the winner with cash", what: "carrier-a's agent replies in the thread: swap the two slots for $120.", why: "Agents negotiate with each other on Agent Relay. The dock is not in the conversation; it only listens." },
        { tech: "agents", title: "Counter, then agree", what: "carrier-b counters at $150. carrier-a agrees.", why: "Multi-round bargaining with limits in code: budgets are checked before the model answers, two messages per agent per thread, a deadline timer in the actor if they stall." },
        { tech: "dispatcher", title: "SETTLE: the dock swaps the slots atomically", what: "carrier-a posts the settlement. The dispatcher calls swap(T13, T14), then pay(). Both blocks trade places on the board.", why: "The actor validates every settlement in order. If two agents settled conflicting deals in the same second, one would land and the other come back REJECTED." },
      ]
      case "doordown": return [
        { tech: "actor", title: "Door 5 fails; the dock re-plans in one call", what: "setDoor(5, out of service). The reefer truck on it, carrier-c's T5, is the only truck that moves: to door 6 at 11:00.", why: "State and planning live in the actor. Unaffected trucks keep their slots; there is no cascade to clean up." },
        { tech: "dispatcher", title: "The dock offers carrier-c the new slot and names who holds 10:00", what: "OFFER → carrier-c: T5 door 6 11:00. Holder of door 6 10:00: carrier-b (T9).", why: "The offer carries the one fact the carrier needs to act: who to talk to." },
        { tech: "agents", title: "carrier-c wants 10:00 back and offers carrier-b $150", what: "A reefer hour is worth about $200 to carrier-c (cold chain). carrier-b values an hour at $60.", why: "There is a deal to be found between those two numbers, and no human has to find it." },
        { tech: "agents", title: "Round two: $200, agreed", what: "carrier-b counters at $200. carrier-c agrees. Two rounds, then silence.", why: "Hard caps keep language-model agents from talking forever: two messages each, and the actor's deadline timer decides if they stall." },
        { tech: "actor", title: "SETTLE: the dock pins T5 to 10:00 and bumps T9", what: "counter(offer, door 6, 10:00) succeeds because no higher-priority truck would move. T9 gets 11:00 and its own offer. $200 recorded as a side payment.", why: "Both carriers are better off: carrier-c pays $200 for an hour it values at $200 or more, carrier-b earns $200 for an hour it values at $60. The warehouse paid nothing, and T5 waits one hour less." },
      ]
      case "auction": return [
        { tech: "actor", title: "Two of carrier-a's trucks report 90 minutes late", what: "reportEta(T1, 10:30) and reportEta(T4, 11:30). The dock re-plans only those two. Door 2 at 09:00 is suddenly free.", why: "Every ETA change is a re-plan inside the actor; the freed hour becomes something to sell." },
        { tech: "dispatcher", title: "The freed slot goes to auction, closing in one sim minute", what: "AUCTION on door 2 09:00. Any carrier may bid once: BID <truck> ready <time>.", why: "The close is a timer inside the actor, not a cron job somewhere else." },
        { tech: "agents", title: "Three carriers answer: two bid, one passes", what: "carrier-b bids T6 ready 08:50. carrier-d bids T8 ready 09:10. carrier-c passes: reefer loads only.", why: "One bid per carrier, enforced in code. The agents decide whether the slot is worth it to them." },
        { tech: "alarm", title: "The actor wakes itself and closes the auction", what: "Nobody presses anything. The auction_close alarm fires inside the actor and the auction closes.", why: "Durable alarm: it fires even if nobody is connected. A test actor left alone this afternoon woke itself five times on schedule." },
        { tech: "actor", title: "Award: earliest ready wins", what: "award(T6): T6 jumps from noon to 09:00. Detention avoided +$225 for the warehouse.", why: "The actor records the award atomically; the counter shows the detention the warehouse will never have to pay." },
      ]
      default: return []
    }
  }

  /** The presenter's Next: releases the step that is waiting. */
  next(): { ok: boolean; reason?: string } {
    if (!this.awaitingNext || !this.nextWaiter) return { ok: false, reason: "no step is waiting" }
    const release = this.nextWaiter
    this.nextWaiter = null
    this.awaitingNext = false
    release()
    return { ok: true }
  }

  private async step(i: number): Promise<StoryStep> {
    const story = this.story!
    const st = story.steps[i - 1]
    if (this.manual && i > 1) {
      this.nextTitle = st.title
      this.awaitingNext = true
      await new Promise<void>(resolve => { this.nextWaiter = resolve })
      if (this.aborted || this.story !== story) throw new Error("reset")
    }
    st.status = "active"
    st.at = hhmm(this.simNow())
    return st
  }
  private line(st: StoryStep, text: string) { st.lines = [...(st.lines ?? []), text] }
  private finish(st: StoryStep) { st.status = "done"; st.at = hhmm(this.simNow()) }

  private async scene(id: string): Promise<string | void> {
    const dock = this.dock
    const say = this.say.bind(this)
    const chat = async (st: StoryStep, from: string, to: string, text: string, thread?: string) => { await say(from, to, text, thread); this.line(st, `${from} → ${to}: ${text}`) }
    const pace = () => sleep(this.pace)
    if (id === "collision") {
      let st = await this.step(1)
      const r1 = await dock.request("carrier-b", "T14", 4, 360)
      this.line(st, r1.appt ? "dock → carrier-b: T14 booked door 4 14:00" : `dock → carrier-b: ${r1.reason}`)
      this.finish(st)
      st = await this.step(2)
      const r2 = await dock.request("carrier-a", "T13", 4, 360)
      const offer = r2.offer ?? this.must(this.openOffer(await dock.snapshot(), "T13"), "an offer for T13")
      this.line(st, "dock: collision — door 4 14:00 is held by T14 (carrier-b)")
      await pace()
      this.line(st, `dock → carrier-a: OFFER ${offer.id} T13 door 4 15:00 instead`)
      this.finish(st)
      st = await this.step(3)
      await dock.openThread("th1", offer.id, this.simNow() + 30)
      await chat(st, "pier9-ops", "*", `OFFER ${offer.id} → carrier-a: T13 door 4 15:00 — 14:00 is held by carrier-b (T14).`, "th1")
      this.finish(st)
      st = await this.step(4)
      await chat(st, "carrier-a", "carrier-b", "SWAP? @carrier-b — T13 takes door 4 14:00, T14 takes 15:00, we pay $120.", "th1")
      this.finish(st)
      st = await this.step(5)
      await chat(st, "carrier-b", "carrier-a", "COUNTER $150 — 15:00 costs us a driver swap.", "th1")
      await pace()
      await chat(st, "carrier-a", "carrier-b", "AGREE $150.", "th1")
      this.finish(st)
      st = await this.step(6)
      await chat(st, "carrier-a", "pier9-ops", "SETTLE th1: T13 door 4 14:00 · T14 door 4 15:00 · pay carrier-a→carrier-b $150", "th1")
      await pace()
      const sw = await dock.swap("T13", "T14")
      if (!sw.ok) throw new Error(`swap refused: ${sw.reason}`)
      this.line(st, "dock: swap(T13, T14) ok — T13 now 14:00, T14 15:00")
      await dock.pay("carrier-a", "carrier-b", 150)
      await dock.settleThread("th1")
      this.line(st, "dock: pay carrier-a → carrier-b $150; thread settled")
      this.finish(st)
      const s = await dock.snapshot()
      return `T13 at 14:00, T14 at 15:00, $${s.counters.sidePaymentsUsd} changed hands between the carriers, the dock never double-booked, nobody picked up a phone.`
    }
    if (id === "doordown") {
      let st = await this.step(1)
      const sd = await dock.setDoor(5, false)
      const o5 = sd.offers.find(o => o.truckId === "T5") ?? this.openOffer(await dock.snapshot(), "T5")
      if (!o5) throw new Error("door 5 down displaced nobody; is T5 still on door 5?")
      const holder = (await dock.snapshot()).appts.find(a => a.door === 6 && a.startMin === 120 && a.truckId !== "T5")
      this.line(st, "dock: door 5 out of service")
      await pace()
      this.line(st, `dock: re-plan — T5 (reefer, carrier-c) moves to door ${o5.door} ${hhmm(o5.startMin)}; nothing else moves`)
      this.finish(st)
      st = await this.step(2)
      await dock.openThread("th-cold", o5.id, this.simNow() + 30)
      await chat(st, "pier9-ops", "*", `Door 5 is out of service. OFFER ${o5.id} → carrier-c: T5 door 6 ${hhmm(o5.startMin)}. Holder of door 6 10:00: @carrier-b (${holder?.truckId ?? "T9"}).`, "th-cold")
      this.finish(st)
      st = await this.step(3)
      await chat(st, "carrier-c", "carrier-b", "SWAP? @carrier-b — T5 takes door 6 10:00, T9 takes 11:00, we cover $150 of your detention. Cold chain.", "th-cold")
      this.finish(st)
      st = await this.step(4)
      await chat(st, "carrier-b", "carrier-c", "COUNTER $200 — 11:00 pushes our next pickup.", "th-cold")
      await pace()
      await chat(st, "carrier-c", "carrier-b", "AGREE $200 — the cold chain is worth it.", "th-cold")
      this.finish(st)
      st = await this.step(5)
      await chat(st, "carrier-c", "pier9-ops", `SETTLE th-cold: T5 door 6 10:00 · ${holder?.truckId ?? "T9"} door 6 11:00 · pay carrier-c→carrier-b $200`, "th-cold")
      await pace()
      const ct = await dock.counter(o5.id, 6, 120)
      if (!ct.ok) throw new Error(`counter refused: ${ct.reason}`)
      for (const o of ct.offers) await dock.accept(o.id)
      this.line(st, `dock: counter ok — T5 pinned to door 6 10:00, ${holder?.truckId ?? "T9"} moved to 11:00`)
      await dock.pay("carrier-c", "carrier-b", 200)
      await dock.settleThread("th-cold")
      this.line(st, "dock: pay carrier-c → carrier-b $200; thread settled")
      this.finish(st)
      const s = await dock.snapshot()
      return `T5 unloads cold at 10:00 on door 6; carrier-b took $200 to wait an hour it values at $60; the warehouse paid nothing. Side payments between carriers now $${s.counters.sidePaymentsUsd}; detention avoided (warehouse) $${s.counters.detentionAvoidedUsd}.`
    }
    if (id === "auction") {
      let st = await this.step(1)
      const now = this.simNow()
      await say("carrier-a", "pier9-ops", "T1 and T4 are stuck on the bridge; both 90 minutes out.")
      this.line(st, "carrier-a → pier9-ops: T1 and T4 are stuck on the bridge; both 90 minutes out.")
      await pace()
      const e1 = await dock.reportEta("T1", Math.max(150, now + 90))
      const e2 = await dock.reportEta("T4", Math.max(210, now + 90))
      for (const o of [...e1.offers, ...e2.offers]) await dock.accept(o.id)
      for (const o of [...e1.offers, ...e2.offers]) this.line(st, `dock: ${o.truckId} → door ${o.door} ${hhmm(o.startMin)}`)
      this.line(st, "dock: door 2 09:00 is free")
      this.finish(st)
      st = await this.step(2)
      const closes = this.simNow() + 1
      const a1 = this.must((await dock.openAuction(2, 60, closes, "T1 stuck in traffic")).auction, "auction")
      await chat(st, "pier9-ops", "*", `AUCTION ${a1.id} door 2 09:00 — slot freed by T1's delay. Closes ${hhmm(closes)}. BID ${a1.id} <truck> ready <HH:MM>`)
      this.finish(st)
      st = await this.step(3)
      await chat(st, "carrier-b", "pier9-ops", `BID ${a1.id} T6 ready 08:50`)
      await dock.bid(a1.id, "T6", 50)
      await pace()
      await chat(st, "carrier-d", "pier9-ops", `BID ${a1.id} T8 ready 09:10`)
      await dock.bid(a1.id, "T8", 70)
      await pace()
      await chat(st, "carrier-c", "pier9-ops", "PASS — reefer loads only, that is a dry door.")
      this.finish(st)
      st = await this.step(4)
      const started = Date.now()
      let closed = false
      while (Date.now() - started < 90_000) {
        const s = await dock.snapshot()
        const au = s.auctions.find(a => a.id === a1.id)
        if (au && au.status !== "open") { closed = true; break }
        await sleep(500)
      }
      if (!closed) throw new Error("the auction_close alarm did not fire within 90 s")
      this.line(st, `alarm → auction_closed ${a1.id} at ${hhmm(this.simNow())}: 2 bids, nobody connected had to do anything`)
      this.finish(st)
      st = await this.step(5)
      const aw = await dock.award(a1.id, "T6")
      if (!aw.ok) throw new Error(`award refused: ${aw.reason}`)
      await chat(st, "pier9-ops", "*", `${a1.id} closed by the clock. Door 2 09:00 goes to T6 (ready 08:50).`)
      const s = await dock.snapshot()
      this.line(st, `dock: award(${a1.id}, T6) ok — detention avoided (warehouse) now $${s.counters.detentionAvoidedUsd}`)
      this.finish(st)
      return `T6 unloads at 09:00 instead of noon, the clock did the closing, detention avoided (warehouse) $${s.counters.detentionAvoidedUsd}.`
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
