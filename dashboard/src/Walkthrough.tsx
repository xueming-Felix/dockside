import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { DAY_END_MIN, hhmm } from "../../shared/types"
import { highlight } from "./Carrier"
import { SETTING, WALKTHROUGHS, type Bubble, type Flow, type MiniDoor, type Node, type Tech, type WalkStep, type Walkthrough as Scenario } from "./walkthrough.data"

// The Walkthrough tab: scenarios 1 and 2 as pictures. One fixed system picture (Agent Relay with the agents, the dispatcher,
// the Dock actor with its board, the screens) is drawn on every screen; a step animates its `flows` as labelled arrows on it
// and shows `speech` as bubbles on the agents. Words are labels: the step title, one takeaway line, chips. The old three-pane
// text view (actor log, inboxes, what/why) survives behind the `details` toggle. Nothing here talks to the dock or to Relay.

const TECH: Record<Tech, string> = { actor: "Durable Actor", agents: "Agents on Relay", alarm: "Alarm", dispatcher: "Dispatcher" }
const HOURS = Array.from({ length: 10 }, (_, i) => i * 60)
const pct = (m: number) => `${(Math.max(0, Math.min(DAY_END_MIN, m)) / DAY_END_MIN) * 100}%`
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

type Screen = { kind: "setting" } | { kind: "background"; s: number } | { kind: "step"; s: number; i: number } | { kind: "outcome"; s: number }
/** The deck, flattened: one entry per screen, in presentation order. */
const SCREENS: Screen[] = [
  { kind: "setting" },
  ...WALKTHROUGHS.flatMap((w, s): Screen[] => [{ kind: "background", s }, ...w.steps.map((_, i): Screen => ({ kind: "step", s, i })), { kind: "outcome", s }]),
]
const backgroundOf = (s: number) => Math.max(0, SCREENS.findIndex(sc => sc.kind === "background" && sc.s === s))
let remembered = 0 // the position survives a trip to the Board tab and back (this component unmounts); a reload starts over
let rememberedDetails = false

/* ---------- the few words derived from the data ---------- */

const castOf = (handle: string) => SETTING.cast.find(c => c.handle === handle)
const roleWord = (handle: string) => (castOf(handle)?.role ?? "").replace(/^the /, "")
const rateOf = (handle: string) => { const h = castOf(handle)?.hour; return h && h !== "—" ? `${h}/h` : "" }
/** The first sentence of `why`, cut at a clause boundary when it runs past ~90 characters. */
function takeaway(why: string): string {
  const first = why.split(/(?<=\.)\s+/)[0].trim()
  if (first.length <= 100) return first
  const head = first.slice(0, 100)
  const cut = Math.max(head.lastIndexOf(": "), head.lastIndexOf("; "), head.lastIndexOf(", "))
  if (cut >= 40) return head.slice(0, cut)
  const sp = head.lastIndexOf(" ")
  return head.slice(0, sp > 40 ? sp : 100).replace(/[,;:]$/, "") + "…"
}
/** The outcome sentence, cut at the last clause boundary under 80 characters when it is longer. */
function clause(s: string): string {
  if (s.length <= 80) return s
  const head = s.slice(0, 80)
  const cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "))
  return cut >= 20 ? head.slice(0, cut) : head.slice(0, head.lastIndexOf(" ")) + "…"
}
const firstWords = (s: string, n: number) => { const w = s.split(/\s+/); return w.length <= n ? s : w.slice(0, n).join(" ").replace(/[,;:]$/, "") + "…" }
/** Short forms (≤ 7 words) of background.cast[].wants and of the first story beat, for the background picture; the data file
 *  keeps the full sentences. A scenario not listed here falls back to the first words of the sentence. */
const WANTS: Record<string, Record<string, string>> = {
  collision: { "carrier-a": "earliest slot, pays up to $150", "carrier-b": "paid to move later; counters once", "pier9-ops": "no double bookings, no phone calls" },
  doordown: { "carrier-c": "earliest reefer slot, budget $250, cold chain", "carrier-b": "paid to move T9 an hour later", "pier9-ops": "re-planned, no cascade, no phone" },
}
const BREAKS: Record<string, string> = { collision: "08:05 · both ask for door 4 at 14:00", doordown: "09:20 · door 5's compressor fails" }
const wantsOf = (walk: Scenario, handle: string) => WANTS[walk.id]?.[handle] ?? firstWords(walk.background.cast.find(c => c.handle === handle)?.wants ?? "", 7)
const breaksOf = (walk: Scenario) => BREAKS[walk.id] ?? firstWords(walk.background.story[0].split(/(?<=\.)\s/)[0], 10)
const usd = (n: number) => `$${n.toLocaleString()}`
/** Side payments of a scenario: every pay($n) in its flow labels; detention avoided: the last step's chip, if it names one. */
const countersOf = (walk: Scenario) => ({
  side: walk.steps.flatMap(s => s.flows).reduce((sum, f) => sum + [...f.label.matchAll(/pay\(\$(\d+)\)/g)].reduce((a, m) => a + Number(m[1]), 0), 0),
  detention: Number(walk.steps[walk.steps.length - 1].chips?.join(" ").match(/detention avoided \+\$(\d+)/)?.[1] ?? 0),
})
/** The warehouse itself: six doors, four dry, two refrigerated, for the setting and the background. */
const SIX_DOORS: MiniDoor[] = [1, 2, 3, 4, 5, 6].map(id => ({ id, type: id <= 4 ? "dry" : "reefer", open: true, slots: [] }))

export function Walkthrough() {
  const [pos, setPos] = useState(() => Math.min(remembered, SCREENS.length - 1))
  const [details, setDetails] = useState(rememberedDetails)
  useEffect(() => { remembered = pos }, [pos])
  useEffect(() => { rememberedDetails = details }, [details])
  const screen = SCREENS[pos]
  const go = (p: number) => setPos(Math.max(0, Math.min(SCREENS.length - 1, p)))
  const next = () => setPos(p => (p + 1) % SCREENS.length) // past the last outcome, Next starts the deck over
  const prev = () => setPos(p => Math.max(0, p - 1))

  // → space Enter = next, ← = previous, 1/2 = that scenario's background, Home = the setting, Escape closes the details.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const el = e.target instanceof HTMLElement ? e.target : null
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      if ((e.key === " " || e.key === "Enter") && el?.tagName === "BUTTON") return
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter" || e.key === "PageDown") setPos(p => (p + 1) % SCREENS.length)
      else if (e.key === "ArrowLeft" || e.key === "PageUp") setPos(p => Math.max(0, p - 1))
      else if (e.key === "Home") setPos(0)
      else if (e.key === "Escape") setDetails(false)
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= WALKTHROUGHS.length) setPos(backgroundOf(Number(e.key) - 1))
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const walk = screen.kind === "setting" ? null : WALKTHROUGHS[screen.s]
  const label = screen.kind === "setting" ? "Setting" : screen.kind === "background" ? "Background" : screen.kind === "step" ? `Step ${screen.i + 1} of ${walk!.steps.length}` : "Outcome"
  const title = screen.kind === "setting" ? SETTING.title : screen.kind === "step" ? walk!.steps[screen.i].title : walk!.title
  const after = SCREENS[(pos + 1) % SCREENS.length]
  const nextText = after.kind === "setting" ? "Start over" : after.kind === "background" ? `Scenario ${WALKTHROUGHS[after.s].n}` : after.kind === "outcome" ? "Outcome" : "Next"

  return (
    <main className="walk">
      <div className="walk-bar">
        <div className="walk-scn" role="tablist" aria-label="Scenario">
          {WALKTHROUGHS.map((w, s) => (
            <button key={w.id} type="button" role="tab" aria-selected={walk === w} className={walk === w ? "active" : ""} title={w.subtitle}
              onClick={e => { e.currentTarget.blur(); go(backgroundOf(s)) }}>
              <span className="n">{w.n}</span><span className="t">{w.title}</span><kbd>{w.n}</kbd>
            </button>
          ))}
        </div>
        <div className="walk-step">
          <span className="ind">{label}</span>
          <h1>{title}</h1>
        </div>
        <div className="walk-nav">
          <button type="button" onClick={e => { e.currentTarget.blur(); prev() }} disabled={pos === 0} title="Previous screen (←)"><kbd>←</kbd>Prev</button>
          <button type="button" className="primary" onClick={e => { e.currentTarget.blur(); next() }} title="Next screen (→, space or enter)">{nextText}<kbd>{after.kind === "setting" ? "↺" : "→"}</kbd></button>
        </div>
      </div>
      {screen.kind === "setting" && <SettingScreen />}
      {screen.kind === "background" && <BackgroundScreen walk={walk!} />}
      {screen.kind === "outcome" && <OutcomeScreen walk={walk!} />}
      {screen.kind === "step" && <StepScreen key={walk!.id} walk={walk!} i={screen.i} pos={pos} base={backgroundOf(screen.s)} go={go} details={details} setDetails={setDetails} />}
    </main>
  )
}

/* ---------- the screens ---------- */

function StepScreen({ walk, i, pos, base, go, details, setDetails }: { walk: Scenario; i: number; pos: number; base: number; go: (p: number) => void; details: boolean; setDetails: (d: boolean) => void }) {
  const step = walk.steps[i]
  return (
    <section className="panel walk-stage">
      <div className="walk-fig">
        <Picture agents={step.inboxes} flows={step.flows} speech={step.speech} chips={step.chips} doors={step.doors} flowKey={pos} />
        {details && <div className="walk-details"><StepPanes walk={walk} i={i} base={base} go={go} /></div>}
      </div>
      <div className="walk-foot">
        <span className={`tech ${step.tech}`}>{TECH[step.tech]}</span>
        <span className="take">{takeaway(step.why)}</span>
        <button type="button" className="walk-more" onClick={e => { e.currentTarget.blur(); setDetails(!details) }} aria-expanded={details}>{details ? "hide details" : "details"}</button>
      </div>
    </section>
  )
}

const CAPTIONS: { x: number; y: number; anchor: "start" | "middle" | "end"; text: string }[] = [
  { x: 32, y: 78, anchor: "start", text: "agents talk here, not to us" },
  { x: 650, y: 262, anchor: "middle", text: "mirrors chatter" },
  { x: 650, y: 386, anchor: "middle", text: "acts on SETTLE · BID · accept" },
  { x: 1000, y: 96, anchor: "start", text: "one request at a time" },
  { x: 1574, y: 77, anchor: "end", text: "alarms wake it up" },
  { x: 1308, y: 515, anchor: "start", text: "snapshot after every change" },
]

function SettingScreen() {
  return (
    <section className="panel walk-stage">
      <div className="walk-fig">
        <Picture agents={WALKTHROUGHS[0].steps[0].inboxes} flows={[]} doors={SIX_DOORS} boardY={104} captions={CAPTIONS} clock allOn />
      </div>
      <div className="walk-cast">
        {SETTING.cast.map(c => <div key={c.handle} className="card"><code>{c.handle}</code><span>{roleWord(c.handle)}</span><b>{c.hour}</b></div>)}
      </div>
    </section>
  )
}

function BackgroundScreen({ walk }: { walk: Scenario }) {
  const agents = walk.steps[0].inboxes
  const doors = walk.steps[0].doors.map(d => ({ ...d, open: true, slots: [] }))
  const speech = [...agents, "pier9-ops"].map(h => ({ node: h as Node, text: wantsOf(walk, h), kicker: "wants" }))
  return (
    <section className="panel walk-stage">
      <div className="walk-fig">
        <Picture agents={agents} flows={[]} speech={speech} doors={doors} chips={[breaksOf(walk)]} chipsKicker="what breaks" dimRest />
      </div>
    </section>
  )
}

function OutcomeScreen({ walk }: { walk: Scenario }) {
  const last = walk.steps[walk.steps.length - 1]
  const c = countersOf(walk)
  return (
    <section className="panel walk-stage walk-outcome">
      <div className="big-board"><MiniGantt doors={last.doors} list={false} /></div>
      <div className="walk-counters">
        <div className="tile"><b>{usd(c.side)}</b><span>side payments · carrier to carrier</span></div>
        <div className="tile"><b>{usd(c.detention)}</b><span>detention avoided · warehouse</span></div>
        <div className="tile"><b>0</b><span>phone calls</span></div>
      </div>
      <p className="walk-outline">{clause(walk.outcome)}</p>
    </section>
  )
}

/* ---------- the fixed system picture ---------- */

type Box = { x: number; y: number; w: number; h: number }
const VB = { w: 1640, h: 700 }
const RELAY: Box = { x: 12, y: 24, w: 508, h: 652 }
const AGENT_TOP: Box = { x: 36, y: 96, w: 240, h: 88 }
const AGENT_BOTTOM: Box = { x: 36, y: 392, w: 240, h: 88 }
const OPS: Box = { x: 36, y: 596, w: 200, h: 56 }
const DISP: Box = { x: 580, y: 280, w: 140, h: 80 }
const DOCK: Box = { x: 980, y: 40, w: 648, h: 420 }
const BOARD: Box = { x: 996, y: 88, w: 616, h: 356 }
const SCREENS_BOX: Box = { x: 1210, y: 560, w: 168, h: 80 }
const CLOCK = { cx: 1596, cy: 72, r: 13 }
const WIRE_Y = 320
const CH = 7.5, LH = 15, PX = 7, PY = 3 // label pills: 12.5px mono
const cx = (b: Box) => b.x + b.w / 2, cy = (b: Box) => b.y + b.h / 2, right = (b: Box) => b.x + b.w, bottom = (b: Box) => b.y + b.h
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const inRelay = (n: Node) => n !== "dock" && n !== "dispatcher" && n !== "screens"
function boxOf(node: Node, agents: readonly [string, string]): Box | null {
  if (node === "dock") return DOCK
  if (node === "dispatcher") return DISP
  if (node === "screens") return SCREENS_BOX
  if (node === "pier9-ops") return OPS
  return node === agents[0] ? AGENT_TOP : node === agents[1] ? AGENT_BOTTOM : null
}
/** y of the S-curve `M x0 y0 C m y0, m y1, x1 y1` (m the middle) at a given x, by bisection on t. */
function yAt(x0: number, y0: number, x1: number, y1: number, x: number): number {
  const u = (x - x0) / (x1 - x0)
  let lo = 0, hi = 1
  for (let k = 0; k < 24; k++) { const t = (lo + hi) / 2; if (1.5 * t - 1.5 * t * t + t * t * t < u) lo = t; else hi = t }
  const t = (lo + hi) / 2
  return y0 + (y1 - y0) * (3 * t * t - 2 * t * t * t)
}
/** Wrap a label at " · " or ", " into lines of at most `max` characters (a part longer than that stays whole). */
function wrap(label: string, max: number, at: RegExp = / · |, /): string[] {
  if (label.length <= max) return [label]
  const parts = label.split(at).filter(Boolean)
  const seps = label.match(new RegExp(at.source, "g")) ?? []
  const lines: string[] = []
  let cur = ""
  parts.forEach((p, k) => {
    const sep = k === 0 ? "" : seps[k - 1]
    if (cur && (cur + sep + p).length > max) { lines.push(cur.trim()); cur = p }
    else cur = cur ? cur + sep + p : p
  })
  if (cur) lines.push(cur.trim())
  return lines
}
type Drawn = { d: string; lines: string[]; lx: number; ly: number; anchor: "start" | "middle" | "end"; place: "above" | "on"; dashed?: boolean; glyph?: boolean }
/** Where a flow's arrow runs on the picture and where its label sits. `k` is the index among this step's agent-to-agent arcs. */
function route(f: Flow, agents: readonly [string, string], k: number): Drawn | null {
  const a = boxOf(f.from, agents), b = boxOf(f.to, agents)
  if (!a || !b) return null
  if (f.from === "dock" && f.to === "dock") return { d: "", lines: [f.label], lx: CLOCK.cx - CLOCK.r - 10, ly: CLOCK.cy, anchor: "end", place: "on", glyph: true }
  if (f.to === "dock" && inRelay(f.from)) {
    const fx = right(a), fy = cy(a), ly = clamp(fy, DOCK.y + 40, bottom(DOCK) - 40), mx = (fx + DOCK.x) / 2
    return { d: `M ${fx} ${fy} C ${mx} ${fy}, ${mx} ${ly}, ${DOCK.x} ${ly}`, lines: wrap(f.label, 34), lx: DOCK.x - 14, ly: ly - 7, anchor: "end", place: "above" }
  }
  if (f.from === "dispatcher" && f.to === "dock")
    return { d: `M ${right(DISP)} ${WIRE_Y} L ${DOCK.x} ${WIRE_Y}`, lines: wrap(f.label, 30, / · /), lx: right(DISP) + 14, ly: WIRE_Y - 7, anchor: "start", place: "above", dashed: f.kind === "mirror" }
  if (f.from === "dock" && f.to === "screens")
    return { d: `M ${cx(DOCK)} ${bottom(DOCK)} L ${cx(DOCK)} ${SCREENS_BOX.y}`, lines: wrap(f.label, 34), lx: cx(DOCK) + 12, ly: (bottom(DOCK) + SCREENS_BOX.y) / 2, anchor: "start", place: "on" }
  if (inRelay(f.from) && f.to === "dispatcher") {
    const fx = right(a), fy = cy(a), ty = fy < WIRE_Y ? WIRE_Y - 20 : WIRE_Y + 20, mx = (fx + DISP.x) / 2
    return { d: `M ${fx} ${fy} C ${mx} ${fy}, ${mx} ${ty}, ${DISP.x} ${ty}`, lines: wrap(f.label, 26), lx: 400, ly: yAt(fx, fy, DISP.x, ty, 400), anchor: "middle", place: "on" }
  }
  if (f.from === "dispatcher" && inRelay(f.to)) {
    const tx = right(b), ty = cy(b), fy = ty < WIRE_Y ? WIRE_Y - 20 : WIRE_Y + 20, mx = (tx + DISP.x) / 2
    return { d: `M ${DISP.x} ${fy} C ${mx} ${fy}, ${mx} ${ty}, ${tx} ${ty}`, lines: wrap(f.label, 26), lx: 400, ly: yAt(tx, ty, DISP.x, fy, 400), anchor: "middle", place: "on" }
  }
  if (inRelay(f.from) && inRelay(f.to)) {
    const fx = right(a), off = k === 0 ? -12 : 12, bulge = k === 0 ? 100 : 64, ay = cy(a) + off, by = cy(b) + off
    return { d: `M ${fx} ${ay} C ${fx + bulge} ${ay}, ${fx + bulge} ${by}, ${fx} ${by}`, lines: wrap(f.label, 14), lx: fx + 100, ly: (cy(a) + cy(b)) / 2 + (k === 0 ? -22 : 22), anchor: "start", place: "on" }
  }
  return { d: `M ${cx(a)} ${cy(a)} L ${cx(b)} ${cy(b)}`, lines: wrap(f.label, 30), lx: (cx(a) + cx(b)) / 2, ly: (cy(a) + cy(b)) / 2, anchor: "middle", place: "on" }
}

type Speech = { node: Node; text: string; kicker?: string }
type PictureProps = {
  agents: readonly [string, string]; flows: Flow[]; speech?: Speech[]; chips?: string[]; chipsKicker?: string; doors: MiniDoor[]
  boardY?: number; captions?: typeof CAPTIONS; clock?: boolean; allOn?: boolean; dimRest?: boolean; flowKey?: number
}
const KINDS = ["call", "broadcast", "post", "settle", "timer", "mirror"] as const

function Picture({ agents, flows, speech = [], chips = [], chipsKicker, doors, boardY, captions, clock, allOn, dimRest, flowKey }: PictureProps) {
  const drawn = useMemo(() => { let k = 0; return flows.map(f => ({ f, r: route(f, agents, inRelay(f.from) && inRelay(f.to) ? k++ : 0) })).filter(x => x.r) as { f: Flow; r: Drawn }[] }, [flows, agents])
  const active = useMemo(() => new Set(flows.flatMap(f => [f.from, f.to])), [flows])
  const on = (n: Node) => !!(allOn || active.has(n) || (dimRest && inRelay(n)))
  const dim = (n: Node) => !!dimRest && !inRelay(n)
  const hasTimer = clock || flows.some(f => f.kind === "timer")
  const board: Box = boardY ? { ...BOARD, y: boardY, h: BOARD.h - (boardY - BOARD.y) } : BOARD
  return (
    <svg className="walk-pic" viewBox={`0 0 ${VB.w} ${VB.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="The dock, the dispatcher and the agents on Agent Relay">
      <defs>
        {KINDS.map(k => (
          <marker key={k} id={`ah-${k}`} className={`ah ${k}`} markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
            <path d="M 1 1 L 11 6 L 1 11 Z" />
          </marker>
        ))}
      </defs>
      {/* permanent channels: Relay ↔ dispatcher, dispatcher ↔ dock, dock → screens */}
      <g className="chan">
        <line x1={right(RELAY)} y1={WIRE_Y} x2={DISP.x} y2={WIRE_Y} />
        <line x1={right(DISP)} y1={WIRE_Y} x2={DOCK.x} y2={WIRE_Y} />
        <line x1={cx(DOCK)} y1={bottom(DOCK)} x2={cx(DOCK)} y2={SCREENS_BOX.y} />
      </g>
      {/* Agent Relay and its agents */}
      <g className={`relay ${dimRest ? "lit" : ""}`}>
        <rect x={RELAY.x} y={RELAY.y} width={RELAY.w} height={RELAY.h} rx="14" />
        <text className="relay-title" x={RELAY.x + 20} y={RELAY.y + 28}>Agent Relay · #pier9</text>
      </g>
      <AgentNode box={AGENT_TOP} handle={agents[0]} on={on(agents[0] as Node)} />
      <AgentNode box={AGENT_BOTTOM} handle={agents[1]} on={on(agents[1] as Node)} />
      <AgentNode box={OPS} handle="pier9-ops" on={on("pier9-ops")} small />
      {/* the dispatcher */}
      <g className={`node disp ${on("dispatcher") ? "on" : ""} ${dim("dispatcher") ? "dim" : ""}`}>
        <rect x={DISP.x} y={DISP.y} width={DISP.w} height={DISP.h} rx="10" />
        <text className="handle" x={cx(DISP)} y={cy(DISP) + 6} textAnchor="middle">dispatcher</text>
        {!captions && <text className="cap11" x={cx(DISP)} y={bottom(DISP) + 22} textAnchor="middle">mirrors · acts on SETTLE/BID/accept</text>}
      </g>
      {/* the Dock actor: the board and the chips live in HTML inside the box */}
      <g className={`node dock ${on("dock") ? "on" : ""} ${dim("dock") ? "dim" : ""}`}>
        <rect x={DOCK.x} y={DOCK.y} width={DOCK.w} height={DOCK.h} rx="14" />
        <text className="dock-title" x={DOCK.x + 22} y={DOCK.y + 32}>Dock · Durable Actor on Terse</text>
        {hasTimer && (
          <g className="clock">
            <circle cx={CLOCK.cx} cy={CLOCK.cy} r={CLOCK.r} />
            <path d={`M ${CLOCK.cx} ${CLOCK.cy - 8} L ${CLOCK.cx} ${CLOCK.cy} L ${CLOCK.cx + 6} ${CLOCK.cy + 3}`} />
          </g>
        )}
        <foreignObject x={board.x} y={board.y} width={board.w} height={board.h}>
          <div className={`walk-dockin ${doors.length > 2 ? "six" : ""}`}>
            <MiniGantt doors={doors} list={false} />
            {chips.length > 0 && (
              <div className="walk-chips">
                {chipsKicker && <span className="kick">{chipsKicker}</span>}
                {chips.slice(0, 3).map(c => <span key={c} className={`chip ${chipsKicker ? "hot" : ""}`}>{c}</span>)}
              </div>
            )}
          </div>
        </foreignObject>
      </g>
      {/* every screen */}
      <g className={`node screens ${on("screens") ? "on" : ""} ${dim("screens") ? "dim" : ""}`}>
        <rect x={SCREENS_BOX.x} y={SCREENS_BOX.y} width={SCREENS_BOX.w} height={SCREENS_BOX.h} rx="10" />
        <rect className="mon" x={SCREENS_BOX.x + 18} y={SCREENS_BOX.y + 22} width="34" height="24" rx="3" />
        <path className="mon" d={`M ${SCREENS_BOX.x + 29} ${SCREENS_BOX.y + 54} h 12 M ${SCREENS_BOX.x + 35} ${SCREENS_BOX.y + 46} v 8`} />
        <text className="role13" x={SCREENS_BOX.x + 64} y={cy(SCREENS_BOX) + 5}>every screen</text>
      </g>
      {/* the step's arrows, in order */}
      <g className="flows" key={flowKey ?? 0}>
        {drawn.map(({ f, r }, i) => (
          <g key={i} className={`flow ${f.kind}`} style={{ "--i": i } as React.CSSProperties}>
            {r.d && <path className={`wire ${r.dashed ? "dashed" : ""}`} d={r.d} pathLength={r.dashed ? undefined : 1} />}
            {r.d && <path className="head" d={r.d} markerEnd={`url(#ah-${f.kind})`} />}
            <Pill r={r} />
          </g>
        ))}
      </g>
      {/* speech bubbles (HTML, so the text wraps and clamps) and the setting's captions */}
      {speech.map((s, i) => <SpeechBubble key={`${flowKey ?? 0}-${i}`} s={s} agents={agents} i={i} />)}
      {captions?.map(c => <text key={c.text} className="cap" x={c.x} y={c.y} textAnchor={c.anchor}>{c.text}</text>)}
    </svg>
  )
}

function AgentNode({ box, handle, on, small }: { box: Box; handle: string; on: boolean; small?: boolean }) {
  const rate = rateOf(handle)
  return (
    <g className={`node agent ${on ? "on" : ""}`}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="10" />
      <text className={small ? "handle15" : "handle"} x={box.x + 16} y={box.y + (small ? 25 : 38)}>{handle}</text>
      <text className={small ? "role11" : "role"} x={box.x + 16} y={box.y + (small ? 45 : 64)}>{roleWord(handle)}</text>
      {rate && <text className="rate" x={right(box) - 14} y={box.y + (small ? 25 : 38)} textAnchor="end">{rate}</text>}
    </g>
  )
}

/** A label on its wire: a dark pill with 12.5px mono text, one or more lines. */
function Pill({ r }: { r: Drawn }) {
  const w = Math.max(...r.lines.map(l => l.length)) * CH + 2 * PX, h = r.lines.length * LH + 2 * PY
  const px = r.anchor === "end" ? r.lx - w : r.anchor === "start" ? r.lx : r.lx - w / 2
  const py = r.place === "above" ? r.ly - h : r.ly - h / 2
  const tx = r.anchor === "end" ? r.lx - PX : r.anchor === "start" ? r.lx + PX : r.lx
  return (
    <g className="lbl">
      <rect x={px} y={py} width={w} height={h} rx="4" />
      <text x={tx} y={py + PY + 11} textAnchor={r.anchor}>{r.lines.map((l, k) => <tspan key={k} x={tx} dy={k === 0 ? 0 : LH}>{l}</tspan>)}</text>
    </g>
  )
}

/** A bubble hangs under the top agent and sits above the bottom agent and the warehouse; the tail points at the node. */
function SpeechBubble({ s, agents, i }: { s: Speech; agents: readonly [string, string]; i: number }) {
  const box = boxOf(s.node, agents)
  if (!box) return null
  const below = box === AGENT_TOP
  const w = 240, h = 64
  const x = box.x, y = below ? bottom(box) + 12 : box.y - 12 - h
  const tailX = box.x + 40
  const tail = below ? `M ${tailX - 9} ${y + 1} L ${tailX + 9} ${y + 1} L ${tailX} ${y - 10} Z` : `M ${tailX - 9} ${y + h - 1} L ${tailX + 9} ${y + h - 1} L ${tailX} ${y + h + 10} Z`
  return (
    <g className="speech" style={{ "--i": i } as React.CSSProperties}>
      <path className="tail" d={tail} />
      <foreignObject x={x} y={y} width={w} height={h}>
        <div className="wbw"><div className="wb" title={s.text}>{s.kicker && <small>{s.kicker} · </small>}{s.text.length > 72 ? s.text.slice(0, 70).replace(/[\s,.;:—-]+$/, "") + "…" : s.text}</div></div>
      </foreignObject>
    </g>
  )
}

/* ---------- the details overlay: the three text panes of a step (actor log, inboxes, what / why) ---------- */

type LogLine = { text: string; k: number; key: string; kind: "call" | "out" | "internal" | "plain" }
type Landed = Bubble & { k: number; key: string }
const logKind = (t: string): LogLine["kind"] => t.startsWith("←") ? "call" : t.startsWith("→") ? "out" : /^(event:|offer\b|replan:|timer armed:)/.test(t) ? "internal" : "plain"
/** What reaches `agent`'s inbox: its own lines, lines to it, lines that @mention it, and every #pier9 broadcast. */
const concerns = (b: Bubble, agent: string) => b.from === agent || b.to === agent || b.to === "#pier9" || new RegExp(`@${escapeRe(agent)}(?![a-z0-9-])`, "i").test(b.text)

function StepPanes({ walk, i, base, go }: { walk: Scenario; i: number; base: number; go: (p: number) => void }) {
  const step: WalkStep = walk.steps[i]
  // Cumulative: everything the actor did and every line that landed, from step 1 up to this one; `k` is the step it came from.
  const log = useMemo<LogLine[]>(() => walk.steps.slice(0, i + 1).flatMap((st, k) => st.actor.map((text, j) => ({ text, k, key: `${k}-${j}`, kind: logKind(text) }))), [walk, i])
  const landed = useMemo<Landed[]>(() => walk.steps.slice(0, i + 1).flatMap((st, k) => st.bubbles.map((b, j) => ({ ...b, k, key: `${k}-${j}` }))), [walk, i])
  return (
    <div className="walk-panes">
      <section className="panel walk-dock">
        <h2>The dock<small>· Durable Actor</small></h2>
        <MiniGantt doors={step.doors} />
        <h3 className="walk-h3">Actor log<small>← calls in · → broadcasts out</small></h3>
        <ActorLog lines={log} cur={i} />
      </section>
      <section className="panel walk-relay">
        <h2>Agent Relay<small>· #pier9, as each agent received it</small></h2>
        <div className="walk-inboxes">
          {step.inboxes.map(agent => <InboxColumn key={agent} agent={agent} landed={landed} cur={i} />)}
        </div>
      </section>
      <section className="panel walk-why">
        <h2>What happened<small>· why it matters</small></h2>
        <div className="body">
          <span className={`tech ${step.tech}`}>{TECH[step.tech]}</span>
          <p className="what">{step.what}</p>
          <p className="why">{step.why}</p>
          {step.callout && <div className="callout">{step.callout}</div>}
        </div>
        <StepList walk={walk} i={i} base={base} go={go} />
      </section>
    </div>
  )
}

/** The scenario's doors only, ten hour columns like the main board. Blocks are keyed by truck so a slot change slides.
 *  A block carries the truck id only; the optional list under it names carrier, slot and state (the details view). */
function MiniGantt({ doors, list = true }: { doors: MiniDoor[]; list?: boolean }) {
  const state = (sl: MiniDoor["slots"][number]) => sl.status === "pending" ? `offer pending${sl.note ? ` · ${sl.note}` : ""}` : sl.note ? `${sl.status} · ${sl.note}` : sl.status
  return (
    <div className="mg">
      <div className="mgantt">
        <div className="row head"><div className="door" /><div className="track">{HOURS.map(h => <span key={h} className="hour" style={{ left: pct(h) }}>{hhmm(h)}</span>)}</div></div>
        {doors.map(d => (
          <div key={d.id} className={`row ${d.open ? "" : "closed"}`}>
            <div className="door"><b>Door {d.id}</b><span>{d.type}</span></div>
            <div className="track">
              {HOURS.map(h => <i key={h} className="gridline" style={{ left: pct(h) }} />)}
              {!d.open && <span className="oos">out of service</span>}
              {d.slots.map(sl => (
                <div key={sl.truck} className={`blk ${sl.status} ${sl.highlight ? "hl" : ""}`} style={{ left: pct(sl.startMin), width: pct(60) }}
                  title={`${sl.truck} · ${sl.carrier} · ${hhmm(sl.startMin)}–${hhmm(sl.startMin + 60)} · ${state(sl)}`}>
                  <b>{sl.truck}</b>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {list && (
        <ul className="slots">
          {doors.flatMap(d => d.slots.map(sl => (
            <li key={`${d.id}-${sl.truck}`} className={`${sl.status} ${sl.highlight ? "hl" : ""}`}>
              <i className="sw" aria-hidden="true" /><b>{sl.truck}</b><span className="who">{sl.carrier}</span><span className="at">door {d.id} · {hhmm(sl.startMin)}</span><em>{state(sl)}</em>
              {sl.highlight && <span className="chg">changed</span>}
            </li>
          )))}
        </ul>
      )}
    </div>
  )
}

/** Every actor line so far, grouped by step; the current step's lines are bright, earlier ones dimmed. */
function ActorLog({ lines, cur }: { lines: LogLine[]; cur: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = ref.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" }) }, [lines])
  let last = -1
  return (
    <div className="walk-log" ref={ref}>
      {lines.map(l => {
        const first = l.k !== last
        last = l.k
        return (
          <Fragment key={l.key}>
            {first && <span className={`stepmark ${l.k === cur ? "cur" : ""}`}>step {l.k + 1}</span>}
            <div className={`ln ${l.kind} ${l.k === cur ? "cur" : "old"}`}>{l.text}</div>
          </Fragment>
        )
      })}
    </div>
  )
}

/** One agent's inbox as a chat: its own lines on the right in the accent, everyone else on the left. */
function InboxColumn({ agent, landed, cur }: { agent: string; landed: Landed[]; cur: number }) {
  const mine = useMemo(() => landed.filter(b => concerns(b, agent)), [landed, agent])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = ref.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" }) }, [mine.length, agent])
  return (
    <div className="walk-inbox">
      <h3><code>{agent}</code>'s inbox{mine.length > 0 && <small>{mine.length} message{mine.length === 1 ? "" : "s"}</small>}</h3>
      <div className="chat" ref={ref}>
        {mine.length === 0 ? <p className="empty-inbox">Nothing yet.</p> : mine.map(b => (
          <div key={b.key} className={`msg ${b.from === agent ? "me" : "them"} ${b.kind ?? "system"} ${b.k === cur ? "new" : ""}`}>
            <span className="who">{b.from}<i> → {b.to}</i></span>
            <p className="txt">{highlight(b.text, agent)}</p>
            <span className="meta">via Agent Relay · thread {b.thread}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The tiny step list under the narration: background, the steps, the outcome; click to jump. */
function StepList({ walk, i, base, go }: { walk: Scenario; i: number; base: number; go: (p: number) => void }) {
  const items = [
    { num: "B", t: "Background", p: base },
    ...walk.steps.map((st, k) => ({ num: String(k + 1), t: st.title, p: base + 1 + k })),
    { num: "✓", t: "Outcome", p: base + 1 + walk.steps.length },
  ]
  return (
    <ol className="walk-steps" aria-label="Screens of this scenario">
      {items.map((it, k) => {
        const cls = k === i + 1 ? "cur" : k < i + 1 ? "past" : "todo"
        return (
          <li key={it.p} className={cls}>
            <button type="button" onClick={e => { e.currentTarget.blur(); go(it.p) }} aria-current={cls === "cur" ? "step" : undefined} title={it.t}>
              <span className="num">{it.num}</span><span className="t">{it.t}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
