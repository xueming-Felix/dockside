import { useEffect, useMemo, useRef, useState } from "react"
import {
  ACTOR_ID, DAY_END_MIN, hhmm,
  type Appt, type Chat, type Event, type Snapshot, type Timer, type Truck,
} from "../../shared/types"
import { CarrierView, Tabs, useUnread, useView } from "./Carrier"
import { Controls } from "./Controls"
import { useDock, useSimMin } from "./dock"
import { useDriver, type CastMember, type RelayMsg, type StageMode } from "./driver"
import { blockClass, lineKind, STATUS_WORD } from "./status"
import { SceneControls, StoryPanel } from "./Story"

const pct = (m: number) => `${(Math.max(0, Math.min(DAY_END_MIN, m)) / DAY_END_MIN) * 100}%`
const HOURS = Array.from({ length: 10 }, (_, i) => i * 60)
const ALARM_KINDS = new Set(["noshow", "detention", "auction_closed", "thread_expired", "auction_open", "claim"])
const NO_FEED: RelayMsg[] = [], NO_CAST: CastMember[] = [] // stable empties while the driver is offline, so the memoised tabs don't re-render per tick
// ?keys=1 forces the ten-key strip, ?story=1 forces story mode; otherwise the driver's `mode` decides (missing = keys).
const FORCED_MODE: StageMode | null = (() => { const q = new URLSearchParams(location.search); return q.get("keys") === "1" ? "keys" : q.get("story") === "1" ? "story" : null })()

export function App() {
  const actorId = new URLSearchParams(location.search).get("actor") || ACTOR_ID
  const feed = useDock(actorId)
  const driver = useDriver()
  const mode: StageMode = FORCED_MODE ?? (driver.state?.mode === "story" ? "story" : "keys")
  // Carrier tabs: #board or an agent's handle in the hash; the badges count Relay messages that landed while a tab was away.
  const [view, setView] = useView()
  const unread = useUnread(driver.state?.relayFeed ?? NO_FEED, view)
  const [cursor, setCursor] = useState<number | null>(null) // null = live
  // Replay scrubs through seeded snapshots only: the pre-seed snapshot would blank the board and hide the slider.
  const history = useMemo(() => feed.history.filter(s => s.seeded), [feed.history])
  const snap = cursor === null ? feed.live : history[Math.min(cursor, history.length - 1)]
  const sim = useSimMin(cursor === null ? feed.live : undefined)
  const shownSim = cursor === null ? sim : snap?.simMin ?? 0

  // The strip stays up before the first seed too: "Reset 08:00" is how the presenter seeds the dock from the projector.
  const strip = mode === "story" ? <SceneControls actorId={actorId} driver={driver} /> : <Controls actorId={actorId} driver={driver} />
  if (!snap || !snap.seeded) return (
    <div className="app app-empty">
      <Empty status={feed.status} error={feed.error} actorId={actorId} />
      {strip}
    </div>
  )
  return (
    <div className="app">
      <header className="top">
        <div className="brand"><b>Pier 9 Cold Storage</b><span>Dockside · agent-to-agent dock appointments</span></div>
        <Tabs view={view} unread={unread} cast={driver.state?.cast ?? NO_CAST} onPick={setView} />
        <Clock snap={snap} sim={shownSim} />
        <Counters snap={snap} />
        <div className={`conn ${feed.status}`} title={feed.error ?? ""}><i />{feed.status === "open" ? "live" : feed.status}</div>
      </header>
      {/* A carrier tab swaps the board for that agent's view; header, replay and the scene strip stay, so steps run from any tab. */}
      {view !== "board" ? <CarrierView handle={view} snap={snap} sim={shownSim} state={driver.state} /> : (
        <main className={`grid ${mode}`}>
          <section className="panel gantt-panel">
            <Gantt snap={snap} sim={shownSim} />
            <Tomorrow snap={snap} />
          </section>
          {/* Story mode: the narration takes the top of the right column and the dock log steps aside; keys mode is unchanged. */}
          {mode === "story" && <StoryPanel driver={driver} />}
          <section className="panel feed-panel"><h2>#pier9 <small>{snap.chatter.length} lines</small></h2><Feed chatter={snap.chatter} /></section>
          {mode === "keys" && <section className="panel events-panel"><h2>Dock log <small>alarms highlighted</small></h2><Events events={snap.events} /></section>}
        </main>
      )}
      <Replay history={history} cursor={cursor} setCursor={setCursor} />
      {strip}
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
    ["detention avoided · warehouse", usd(c.detentionAvoidedUsd)], ["side payments · carrier to carrier", usd(c.sidePaymentsUsd)],
    ["phone calls", String(c.phoneCalls)], ["moves", String(c.moves)], ["backhauls", String(c.backhauls)],
  ]
  return <div className="counters">{tiles.map(([k, v]) => <div key={k} className="tile"><b>{v}</b><span>{k}</span></div>)}</div>
}

function Gantt({ snap, sim }: { snap: Snapshot; sim: number }) {
  const trucks = useMemo(() => new Map(snap.trucks.map(t => [t.id, t] as const)), [snap.trucks])
  const pending = useMemo(() => new Set(snap.offers.filter(o => o.status === "open").map(o => o.truckId)), [snap.offers])
  const expected = useMemo(() => new Set(snap.timers.filter(t => t.kind === "arrival_check" && t.truckId).map(t => t.truckId as string)), [snap.timers])
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
              {appts.map(a => <Block key={a.truckId} a={a} t={trucks.get(a.truckId)} cls={blockClass(a, sim, expected)} pending={pending.has(a.truckId)} stacked={shared(a.startMin)} />)}
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
