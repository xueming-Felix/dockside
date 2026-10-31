import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { DAY_END_MIN, hhmm } from "../../shared/types"
import { highlight } from "./Carrier"
import { SETTING, WALKTHROUGHS, type Bubble, type MiniDoor, type Tech, type Walkthrough as Scenario } from "./walkthrough.data"

// The Walkthrough tab: scenarios 1 and 2 as a static, step-by-step illustration of what the live board does. The words,
// boards and chat lines come from walkthrough.data.ts, frozen; nothing here talks to the dock or to Agent Relay, so this
// view cannot fail or wait on stage. The deck runs Setting → (Background → steps → Outcome) per scenario. A step gets the
// three panes: the dock (mini board + actor log), the two agents' Relay inboxes, and what happened / why it matters. The
// setting, background and outcome screens are one wide card each.

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

export function Walkthrough() {
  const [pos, setPos] = useState(() => Math.min(remembered, SCREENS.length - 1))
  useEffect(() => { remembered = pos }, [pos])
  const screen = SCREENS[pos]
  const go = (p: number) => setPos(Math.max(0, Math.min(SCREENS.length - 1, p)))
  const next = () => setPos(p => (p + 1) % SCREENS.length) // past the last outcome, Next starts the deck over
  const prev = () => setPos(p => Math.max(0, p - 1))

  // → space Enter = next, ← = previous, 1/2 = that scenario's background, Home = the setting. Typing fields and focused
  // buttons keep Enter/space for themselves (a focused button's click already runs); modifiers leave browser shortcuts alone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const el = e.target instanceof HTMLElement ? e.target : null
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      if ((e.key === " " || e.key === "Enter") && el?.tagName === "BUTTON") return
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter" || e.key === "PageDown") setPos(p => (p + 1) % SCREENS.length)
      else if (e.key === "ArrowLeft" || e.key === "PageUp") setPos(p => Math.max(0, p - 1))
      else if (e.key === "Home") setPos(0)
      else if (/^[1-9]$/.test(e.key) && Number(e.key) <= WALKTHROUGHS.length) setPos(backgroundOf(Number(e.key) - 1))
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const walk = screen.kind === "setting" ? null : WALKTHROUGHS[screen.s]
  const label = screen.kind === "setting" ? "Setting"
    : screen.kind === "background" ? `Scenario ${walk!.n} · Background`
    : screen.kind === "step" ? `Scenario ${walk!.n} · Step ${screen.i + 1} of ${walk!.steps.length}`
    : `Scenario ${walk!.n} · Outcome`
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
      {screen.kind === "setting" && <SettingCard />}
      {screen.kind === "background" && <BackgroundCard walk={walk!} />}
      {screen.kind === "outcome" && <OutcomeCard walk={walk!} />}
      {screen.kind === "step" && <StepPanes walk={walk!} i={screen.i} base={backgroundOf(screen.s)} go={go} />}
    </main>
  )
}

/* ---------- the opening card ---------- */

function SettingCard() {
  return (
    <section className="panel walk-card setting">
      <div className="card-main">
        <p className="lede">{SETTING.lede}</p>
        {SETTING.paragraphs.map((p, k) => <p key={k} className="para">{p}</p>)}
      </div>
      <div className="card-side">
        <h3>The cast<small>agents in #pier9 on Agent Relay</small></h3>
        <table className="cast">
          <thead><tr><th>agent</th><th>role</th><th className="num">$ / hour</th><th>rule</th></tr></thead>
          <tbody>
            {SETTING.cast.map(c => (
              <tr key={c.handle}><td><code>{c.handle}</code></td><td>{c.role}</td><td className="num">{c.hour}</td><td className="line">{c.line}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ---------- a scenario's background card ---------- */

function BackgroundCard({ walk }: { walk: Scenario }) {
  const { stakes, cast, story } = walk.background
  const watch = story.length > 1 ? story[story.length - 1] : null // the last paragraph is the "watch for" beat
  return (
    <section className="panel walk-card background">
      <div className="card-main">
        <p className="lede">{walk.subtitle}</p>
        <h3>The stakes</h3>
        <p className="para">{stakes}</p>
        <h3>What is about to happen</h3>
        {(watch ? story.slice(0, -1) : story).map((p, k) => <p key={k} className="para">{p}</p>)}
        {watch && <p className="watch">{watch}</p>}
      </div>
      <div className="card-side">
        <h3>Who is in it</h3>
        <ul className="wants">
          {cast.map(c => <li key={c.handle}><code>{c.handle}</code><span>wants {c.wants}</span></li>)}
        </ul>
      </div>
    </section>
  )
}

/* ---------- a scenario's outcome card ---------- */

function OutcomeCard({ walk }: { walk: Scenario }) {
  const last = walk.steps[walk.steps.length - 1]
  return (
    <section className="panel walk-card outcome-card">
      <div className="card-main">
        <span className="kicker">Outcome · scenario {walk.n}</span>
        <p className="big">{walk.outcome}</p>
        <h3>The arc</h3>
        <ol className="arc">
          {walk.steps.map((st, k) => <li key={k}><span className="num">{k + 1}</span><span className={`tech ${st.tech}`}>{TECH[st.tech]}</span><span className="t">{st.title}</span></li>)}
        </ol>
      </div>
      <div className="card-side">
        <h3>The board at the end</h3>
        <MiniGantt doors={last.doors} />
        {last.callout && <div className="callout">{last.callout}</div>}
      </div>
    </section>
  )
}

/* ---------- a step: the three panes ---------- */

type LogLine = { text: string; k: number; key: string; kind: "call" | "out" | "internal" | "plain" }
type Landed = Bubble & { k: number; key: string }
const logKind = (t: string): LogLine["kind"] => t.startsWith("←") ? "call" : t.startsWith("→") ? "out" : /^(event:|offer\b|replan:|timer armed:)/.test(t) ? "internal" : "plain"
/** What reaches `agent`'s inbox: its own lines, lines to it, lines that @mention it, and every #pier9 broadcast. */
const concerns = (b: Bubble, agent: string) => b.from === agent || b.to === agent || b.to === "#pier9" || new RegExp(`@${escapeRe(agent)}(?![a-z0-9-])`, "i").test(b.text)

function StepPanes({ walk, i, base, go }: { walk: Scenario; i: number; base: number; go: (p: number) => void }) {
  const step = walk.steps[i]
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
 *  An hour column is under 50px here, so a block carries the truck id only; the list under it names carrier, slot and state. */
function MiniGantt({ doors }: { doors: MiniDoor[] }) {
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
      <ul className="slots">
        {doors.flatMap(d => d.slots.map(sl => (
          <li key={`${d.id}-${sl.truck}`} className={`${sl.status} ${sl.highlight ? "hl" : ""}`}>
            <i className="sw" aria-hidden="true" /><b>{sl.truck}</b><span className="who">{sl.carrier}</span><span className="at">door {d.id} · {hhmm(sl.startMin)}</span><em>{state(sl)}</em>
            {sl.highlight && <span className="chg">changed</span>}
          </li>
        )))}
      </ul>
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
