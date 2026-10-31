import { useEffect, useMemo, useRef, useState } from "react"
import {
  ACTOR_ID, DAY_END_MIN, DETENTION_FREE_MIN, hhmm,
  type Appt, type Chat, type Event, type Snapshot, type Timer, type Truck,
} from "../../shared/types"
import { useDock, useSimMin } from "./dock"

const pct = (m: number) => `${(Math.max(0, Math.min(DAY_END_MIN, m)) / DAY_END_MIN) * 100}%`
const HOURS = Array.from({ length: 10 }, (_, i) => i * 60)
const ALARM_KINDS = new Set(["noshow", "detention", "auction_closed", "thread_expired", "auction_open", "claim"])
// The word printed inside a block for the states a colour alone doesn't explain on a projector.
const STATUS_WORD: Record<string, string> = { noshow: "no-show", detention: "detention", late: "late", done: "done" }

export function App() {
  const actorId = new URLSearchParams(location.search).get("actor") || ACTOR_ID
  const feed = useDock(actorId)
  const [cursor, setCursor] = useState<number | null>(null) // null = live
  // Replay scrubs through seeded snapshots only: the pre-seed snapshot would blank the board and hide the slider.
  const history = useMemo(() => feed.history.filter(s => s.seeded), [feed.history])
  const snap = cursor === null ? feed.live : history[Math.min(cursor, history.length - 1)]
  const sim = useSimMin(cursor === null ? feed.live : undefined)
  const shownSim = cursor === null ? sim : snap?.simMin ?? 0

  if (!snap || !snap.seeded) return <Empty status={feed.status} error={feed.error} actorId={actorId} />
  return (
    <div className="app">
      <header className="top">
        <div className="brand"><b>Pier 9 Cold Storage</b><span>Dockside · agent-to-agent dock appointments</span></div>
        <Clock snap={snap} sim={shownSim} />
        <Counters snap={snap} />
        <div className={`conn ${feed.status}`} title={feed.error ?? ""}><i />{feed.status === "open" ? "live" : feed.status}</div>
      </header>
      <main className="grid">
        <section className="panel gantt-panel">
          <Gantt snap={snap} sim={shownSim} />
          <Tomorrow snap={snap} />
        </section>
        <section className="panel feed-panel"><h2>#pier9 <small>{snap.chatter.length} lines</small></h2><Feed chatter={snap.chatter} /></section>
        <section className="panel events-panel"><h2>Dock log <small>alarms highlighted</small></h2><Events events={snap.events} /></section>
      </main>
      <Replay history={history} cursor={cursor} setCursor={setCursor} />
    </div>
  )
}

function Empty({ status, error, actorId }: { status: string; error?: string; actorId: string }) {
  return (
    <div className="empty">
      <div className="brand"><b>Pier 9 Cold Storage</b><span>Dockside</span></div>
      <p className="big">{status === "open" ? "Connected. Waiting for seed()…" : status === "connecting" ? "Connecting to the dock…" : "Dock unreachable, retrying…"}</p>
      <p className="muted">actor <code>{actorId}</code>{error ? ` · ${error}` : ""}</p>
    </div>
  )
}

function Clock({ snap, sim }: { snap: Snapshot; sim: number }) {
  const label = (t: Timer) =>
    t.kind === "arrival_check" ? `arrival check ${t.truckId}` : t.kind === "detention" ? `detention ${t.truckId}` :
    t.kind === "auction_close" ? `${t.auctionId} closes` : `${t.threadId} deadline`
  return (
    <div className="clock">
      <div className="time">{hhmm(sim)}<small>{snap.frozen ? "frozen" : `${snap.speed}×`}</small></div>
      <ul className="timers">
        {snap.timers.slice(0, 3).map(t => (
          <li key={t.id} className={t.kind}><span className="at">{hhmm(t.atMin)}</span>{label(t)}<em>{Math.max(0, t.atMin - sim)}m</em></li>
        ))}
        {snap.timers.length === 0 && <li className="none">no timers armed</li>}
      </ul>
    </div>
  )
}

function Counters({ snap }: { snap: Snapshot }) {
  const c = snap.counters
  const usd = (n: number) => `$${Math.round(n).toLocaleString()}`
  const tiles: [string, string][] = [
    ["detention avoided", usd(c.detentionAvoidedUsd)], ["side payments", usd(c.sidePaymentsUsd)],
    ["phone calls", String(c.phoneCalls)], ["moves", String(c.moves)], ["backhauls", String(c.backhauls)],
  ]
  return <div className="counters">{tiles.map(([k, v]) => <div key={k} className="tile"><b>{v}</b><span>{k}</span></div>)}</div>
}

function blockClass(a: Appt, sim: number): string {
  if (a.status === "done") return "done"
  if (a.status === "noshow") return "noshow"
  if (a.status === "arrived" || a.status === "unloading") return a.arrivedMin !== undefined && sim >= a.arrivedMin + DETENTION_FREE_MIN ? "detention" : "arrived"
  return sim > a.startMin + 5 ? "late" : "booked"
}

function Gantt({ snap, sim }: { snap: Snapshot; sim: number }) {
  const trucks = useMemo(() => new Map(snap.trucks.map(t => [t.id, t] as const)), [snap.trucks])
  const pending = useMemo(() => new Set(snap.offers.filter(o => o.status === "open").map(o => o.truckId)), [snap.offers])
  return (
    <div className="gantt">
      <div className="row head"><div className="door" />
        <div className="track">{HOURS.map(h => <span key={h} className="hour" style={{ left: pct(h) }}>{hhmm(h)}</span>)}</div>
      </div>
      {snap.doors.map(d => {
        const appts = snap.appts.filter(a => a.door === d.id && a.status !== "tomorrow")
        const auctions = snap.auctions.filter(a => a.door === d.id && a.status !== "awarded")
        // A no-show keeps its block and spawns an auction for the same slot: stack them (block as a strip on top) instead of overprinting.
        const shared = (startMin: number) => appts.some(a => a.startMin === startMin) && auctions.some(a => a.startMin === startMin)
        return (
          <div key={d.id} className={`row ${d.open ? "" : "closed"}`}>
            <div className="door"><b>Door {d.id}</b><span>{d.type}{d.open ? "" : " · out of service"}</span></div>
            <div className="track">
              {HOURS.map(h => <i key={h} className="gridline" style={{ left: pct(h) }} />)}
              {auctions.map(a => (
                <div key={a.id} className={`auction ${a.status} ${shared(a.startMin) ? "stacked" : ""}`} style={{ left: pct(a.startMin), width: pct(60) }}
                  title={`${a.id} · door ${a.door} ${hhmm(a.startMin)} · ${a.status} · ${a.bids.length} bids${a.reason ? ` · ${a.reason}` : ""}`}>
                  <b>{a.status === "open" ? "AUCTION" : "CLOSED"}</b>
                  <span>{a.id} · {a.bids.length} bid{a.bids.length === 1 ? "" : "s"}</span>
                  <span>{a.status === "open" ? `closes ${hhmm(a.closesMin)}` : "awaits award"}</span>
                </div>
              ))}
              {appts.map(a => <Block key={a.truckId} a={a} t={trucks.get(a.truckId)} cls={blockClass(a, sim)} pending={pending.has(a.truckId)} stacked={shared(a.startMin)} />)}
              <i className="now" style={{ left: pct(sim) }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Block({ a, t, cls, pending, stacked }: { a: Appt; t?: Truck; cls: string; pending: boolean; stacked: boolean }) {
  const hot = t?.priority === 2
  const title = `${a.truckId} · ${t?.carrier ?? "?"} · ${t?.load ?? ""} · ${hhmm(a.startMin)}–${hhmm(a.startMin + a.durationMin)} · ${a.status}${hot ? " · hot" : ""}${pending ? " · offer pending" : ""}`
  return (
    <div className={`blk ${cls} ${pending ? "pending" : ""} ${hot ? "hot" : ""} ${stacked ? "stacked" : ""}`} style={{ left: pct(a.startMin), width: pct(a.durationMin) }} title={title}>
      <b>{a.truckId}{hot && <i>HOT</i>}</b>
      <span>{t?.carrier}{a.durationMin > 60 ? ` · +${a.durationMin - 60}m` : ""}</span>
      {STATUS_WORD[cls] && <em>{STATUS_WORD[cls]}</em>}
    </div>
  )
}

function Tomorrow({ snap }: { snap: Snapshot }) {
  const t = snap.appts.filter(a => a.status === "tomorrow")
  const claims = snap.claims
  if (!t.length && !claims.length) return null
  return (
    <div className="strip">
      {t.length > 0 && <span><b>Tomorrow 08:00:</b> {t.map(a => a.truckId).join(", ")}</span>}
      {claims.map(c => <span key={c.truckId} className={`claim ${c.status}`}><b>{c.truckId}</b> detention ${c.amount} · {c.status}</span>)}
    </div>
  )
}

function lineKind(text: string): string {
  if (/^SETTLE\b/.test(text)) return "settle"
  if (/^REJECTED\b/.test(text)) return "rejected"
  if (/^(OFFER|AUCTION|VERIFY)\b/.test(text)) return "post"
  if (/^(SWAP\?|COUNTER|AGREE|BID)\b/.test(text)) return "deal"
  if (/^(accept|counter|decline)\b/i.test(text)) return "answer"
  return ""
}

function Feed({ chatter }: { chatter: Chat[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight }, [chatter.length])
  const seen = new Set<string>()
  return (
    <div className="feed" ref={ref}>
      {chatter.length === 0 && <p className="muted">Nothing said yet. Every OFFER, SWAP?, COUNTER, SETTLE and REJECTED line the dispatcher mirrors lands here.</p>}
      {chatter.map(c => {
        const indent = !!c.thread && seen.has(c.thread)
        if (c.thread) seen.add(c.thread)
        return (
          <div key={c.seq} className={`line ${lineKind(c.text)} ${indent ? "indent" : ""}`}>
            <span className="at">{hhmm(c.atMin)}</span>
            <span className="who">{c.from} <i>→</i> {c.to}{c.thread ? <em> {c.thread}</em> : null}</span>
            <span className="txt">{c.text}</span>
          </div>
        )
      })}
    </div>
  )
}

function Events({ events }: { events: Event[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight }, [events.length])
  return (
    <div className="events" ref={ref}>
      {events.slice(-60).map(e => (
        <div key={e.seq} className={`ev ${e.kind} ${ALARM_KINDS.has(e.kind) ? "alarm" : ""}`}>
          <span className="at">{hhmm(e.atMin)}</span><span className="kind">{e.kind.replace("_", " ")}</span><span className="txt">{e.detail}</span>
        </div>
      ))}
    </div>
  )
}

function Replay({ history, cursor, setCursor }: { history: Snapshot[]; cursor: number | null; setCursor: (c: number | null) => void }) {
  const n = history.length
  if (n < 2) return null
  const idx = cursor === null ? n - 1 : Math.min(cursor, n - 1)
  const at = history[idx]
  return (
    <footer className={`replay ${cursor === null ? "live" : "paused"}`}>
      <button onClick={() => setCursor(null)} disabled={cursor === null}>{cursor === null ? "LIVE" : "back to live"}</button>
      <input type="range" min={0} max={n - 1} value={idx} onChange={e => { const v = Number(e.target.value); setCursor(v >= n - 1 ? null : v) }} aria-label="replay snapshots" />
      <span className="pos">{cursor === null ? `${n} snapshots` : `replay · ${hhmm(at.simMin)} · ${idx + 1}/${n}`}</span>
    </footer>
  )
}
