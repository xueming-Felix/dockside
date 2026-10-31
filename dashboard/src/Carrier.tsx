import { memo, useEffect, useMemo, useRef, useState } from "react"
import { hhmm, type Snapshot } from "../../shared/types"
import type { CastMember, DemoState, RelayMsg, RelayStats } from "./driver"
import { blockClass, lineKind, STATUS_WORD } from "./status"

// Carrier tabs: the presenter flips from the board to one agent's own view. Its persona and trucks come from the driver's
// cast and the dock snapshot; its inbox is what Agent Relay's event stream delivered (Relay message ids and all), never the
// dock's mirror, so the room sees that a real agent sits behind each carrier and that the agents talk over Relay.

/** The tabs after Board, in stage order; carrier-x (the unknown carrier) has no tab. */
export const TAB_ORDER = ["carrier-a", "carrier-b", "carrier-c", "carrier-d", "broker", "shipper", "pier9-ops"] as const
export type Handle = (typeof TAB_ORDER)[number]
export type View = "board" | Handle
const isHandle = (h: string): h is Handle => (TAB_ORDER as readonly string[]).includes(h)
const readHash = (): View => { const h = location.hash.replace(/^#/, "").toLowerCase(); return isHandle(h) ? h : "board" }
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
const pad = (n: number) => String(n).padStart(2, "0")
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** The view lives in location.hash (#board, #carrier-b, …) so a reload or a typed URL lands on the same tab. */
export function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(readHash)
  useEffect(() => {
    const onHash = () => setView(readHash())
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])
  return [view, v => { setView(v); if (readHash() !== v) location.hash = v }]
}

/** What reaches `handle`: its own lines, lines that mention it, and every line of a thread it posted in (root included). */
export function inboxFor(feed: RelayMsg[], handle: string): RelayMsg[] {
  const re = new RegExp(`@${escapeRe(handle)}(?![a-z0-9-])`, "i")
  const posted = new Set<string>()
  for (const m of feed) if (m.from === handle) posted.add(m.thread ?? m.id)
  return feed.filter(m => m.from === handle || m.mentions.includes(handle) || re.test(m.text) || posted.has(m.thread ?? m.id))
}

/** Unread per tab: inbox messages that arrived after the tab was last open. Opening a tab clears it and keeps it at 0. */
export function useUnread(feed: RelayMsg[], view: View): Record<string, number> {
  const inboxes = useMemo(() => Object.fromEntries(TAB_ORDER.map(h => [h, inboxFor(feed, h)])) as Record<Handle, RelayMsg[]>, [feed])
  // `at` is the driver's arrival clock, so "seen up to" compares message times with message times, never with this machine's clock.
  const [seenUntil, setSeenUntil] = useState<Partial<Record<Handle, number>>>({})
  useEffect(() => {
    if (view === "board") return
    const last = inboxes[view].reduce((m, x) => Math.max(m, x.at), 0)
    setSeenUntil(prev => (prev[view] ?? -1) >= last ? prev : { ...prev, [view]: last })
  }, [view, inboxes])
  return useMemo(() => Object.fromEntries(TAB_ORDER.map(h => [h, inboxes[h].filter(m => m.at > (seenUntil[h] ?? -1)).length])), [inboxes, seenUntil])
}

/** The view switcher in the header: Board, then one tab per agent with its unread badge. */
export const Tabs = memo(function Tabs({ view, unread, cast, onPick }: { view: View; unread: Record<string, number>; cast: CastMember[]; onPick: (v: View) => void }) {
  return (
    <nav className="tabs" role="tablist" aria-label="Views">
      <button type="button" role="tab" aria-selected={view === "board"} className={`tab ${view === "board" ? "active" : ""}`} onClick={() => onPick("board")} title="The dock's board">Board</button>
      {TAB_ORDER.map(h => {
        const n = unread[h] ?? 0
        const who = cast.find(c => c.handle === h)
        return (
          <button key={h} type="button" role="tab" aria-selected={view === h} className={`tab ${view === h ? "active" : ""}`} onClick={() => onPick(h)}
            title={`${who?.role ?? h} · ${n} unread on Agent Relay`} aria-label={`${h}, ${n} unread`}>
            <code>{h}</code>{n > 0 && <i className="badge" aria-hidden="true">{n > 99 ? "99+" : n}</i>}
          </button>
        )
      })}
    </nav>
  )
})

/** One agent's page: persona and trucks (doors for the warehouse) on the left, its Agent Relay inbox on the right. */
export function CarrierView({ handle, snap, sim, state }: { handle: Handle; snap: Snapshot; sim: number; state: DemoState | null }) {
  const who = state?.cast.find(c => c.handle === handle)
  const relay = state?.relay ?? null
  const feed = state?.relayFeed
  const inbox = useMemo(() => inboxFor(feed ?? [], handle), [feed, handle])
  return (
    <main className="carrier">
      <section className="panel persona-panel">
        <Persona handle={handle} who={who} relay={relay} />
        {handle === "pier9-ops" ? <Doors snap={snap} sim={sim} /> : <MyTrucks handle={handle} snap={snap} sim={sim} />}
      </section>
      <section className="panel inbox-panel">
        <Inbox handle={handle} inbox={inbox} relay={relay} />
      </section>
    </main>
  )
}

function Persona({ handle, who, relay }: { handle: string; who?: CastMember; relay: RelayStats | null }) {
  const registered = !!relay?.enabled && relay.agents >= 8
  const tip = !relay ? "the driver reports no Relay state" : !relay.enabled ? "the driver has no Relay workspace key" : registered ? `${relay.agents} agents registered` : `${relay.agents}/8 agents registered so far`
  return (
    <header className="persona">
      <h1><code>{handle}</code></h1>
      <p className="role">{who?.role ?? "persona not reported by the driver"}</p>
      <span className={`agent ${registered ? "on" : "off"}`} title={tip}><i />{registered ? "agent registered in #pier9 on Agent Relay" : "agent offline"}</span>
      <div className="facts">
        <div className="fact"><b>{who && who.hourUsd > 0 ? `${usd(who.hourUsd)}/h` : "—"}</b><span>value of an hour</span></div>
        <div className="fact"><b>{who ? usd(who.budgetUsd) : "—"}</b><span>budget</span></div>
        <div className="fact trucks"><b>{who?.trucks.length ? who.trucks.join(" · ") : handle === "pier9-ops" ? "owns the doors" : "—"}</b><span>trucks</span></div>
      </div>
      {who?.rule && <p className="rule">{who.rule}</p>}
    </header>
  )
}

/** One row per truck of this carrier on the board, coloured like its block, with its open offer when it has one. */
function MyTrucks({ handle, snap, sim }: { handle: string; snap: Snapshot; sim: number }) {
  const expected = useMemo(() => new Set(snap.timers.filter(t => t.kind === "arrival_check" && t.truckId).map(t => t.truckId as string)), [snap.timers])
  const rows = snap.trucks.filter(t => t.carrier === handle).map(t => {
    const appt = snap.appts.find(a => a.truckId === t.id)
    const offer = snap.offers.find(o => o.truckId === t.id && o.status === "open")
    const cls = !appt ? "none" : appt.status === "tomorrow" ? "tomorrow" : blockClass(appt, sim, expected)
    const word = !appt ? "no slot" : appt.status === "tomorrow" ? "tomorrow" : STATUS_WORD[cls] ?? cls
    return { t, appt, offer, cls, word }
  }).sort((a, b) => (a.appt?.startMin ?? 1e9) - (b.appt?.startMin ?? 1e9) || a.t.id.localeCompare(b.t.id, undefined, { numeric: true }))
  return (
    <div className="mine">
      <h3>My trucks today <small>{rows.length} on the board</small></h3>
      {rows.length === 0 && <p className="muted">No trucks of {handle} on the board yet.</p>}
      <ul>
        {rows.map(({ t, appt, offer, cls, word }) => (
          <li key={t.id} className={`truck ${cls}`}>
            <div className="line">
              <b>{t.id}</b><span className="sep">·</span>
              <span className="slot">{appt ? appt.status === "tomorrow" ? "tomorrow 08:00" : `door ${appt.door} ${hhmm(appt.startMin)}` : "no slot today"}</span><span className="sep">·</span>
              <em className="st">{word}</em>
              {t.priority === 2 && <i className="hot">HOT</i>}
              <span className="load">{t.load} · {t.type}{appt && appt.durationMin > 60 ? ` · +${appt.durationMin - 60}m` : ""}</span>
            </div>
            {offer && <div className="offer">offer pending: door {offer.door} {hhmm(offer.startMin)} — {offer.reason}</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The warehouse owns no trucks: its left column lists the six doors, open or out of service, and what is at each one now. */
function Doors({ snap, sim }: { snap: Snapshot; sim: number }) {
  return (
    <div className="mine">
      <h3>My doors <small>{snap.doors.filter(d => d.open).length} of {snap.doors.length} open</small></h3>
      <ul>
        {snap.doors.map(d => {
          const today = snap.appts.filter(a => a.door === d.id && a.status !== "tomorrow")
          const now = today.find(a => a.startMin <= sim && sim < a.startMin + a.durationMin)
          return (
            <li key={d.id} className={`door-row ${d.open ? "open" : "closed"}`}>
              <b>Door {d.id}</b><span className="type">{d.type}</span>
              <span className="occupant">{now ? `${now.truckId} · ${now.status}` : `${today.length} appointment${today.length === 1 ? "" : "s"} today`}</span>
              <em>{d.open ? "open" : "out of service"}</em>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** #pier9 as this agent received it over Agent Relay: own lines on the right, everyone else on the left, replies under their root. */
function Inbox({ handle, inbox, relay }: { handle: string; inbox: RelayMsg[]; relay: RelayStats | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const stuck = useRef(true) // false once the presenter scrolls up to read; a new message still brings the view back down
  const lastId = inbox.length ? inbox[inbox.length - 1].id : ""
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const toBottom = (smooth: boolean) => el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reducedMotion() ? "smooth" : "auto" })
    stuck.current = true
    toBottom(true)
    // The replay footer appearing or the web fonts landing reflows the chat after the scroll: stay pinned to the newest line.
    const ro = new ResizeObserver(() => { if (stuck.current) toBottom(false) })
    ro.observe(el)
    for (const c of Array.from(el.children)) ro.observe(c)
    const onScroll = () => { stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }
    el.addEventListener("scroll", onScroll)
    return () => { ro.disconnect(); el.removeEventListener("scroll", onScroll) }
  }, [handle, lastId, inbox.length])
  const off = !relay || !relay.enabled
  return (
    <>
      <h2 className="inbox-head">
        <i className={`live ${off ? "off" : ""}`} aria-hidden="true" />
        <span>#pier9 <span className="sep">·</span> as seen by <code>{handle}</code> <span className="sep">·</span> via Agent Relay</span>
        {relay && <small>{relay.delivered} delivered{relay.queued ? ` · ${relay.queued} on the way` : ""}</small>}
      </h2>
      <div className="chat" ref={ref}>
        {off ? <p className="empty-inbox">Agent Relay is off for this run (lines are mirrored by the dock only).</p>
          : inbox.length === 0 ? <p className="empty-inbox">Nothing has reached <code>{handle}</code> over Agent Relay yet. Run a scene.</p>
          : inbox.map(m => <Bubble key={m.id} m={m} me={m.from === handle} handle={handle} />)}
      </div>
      <p className="inbox-foot">Messages arrive here from Agent Relay's event stream about 6 s after they are posted; the board shows the dock's mirror immediately.</p>
    </>
  )
}

function Bubble({ m, me, handle }: { m: RelayMsg; me: boolean; handle: string }) {
  const kind = lineKind(m.text.replace(/^(?:@[a-z0-9-]+\s+)+/i, "")) // the driver prefixes "@to " when the line is addressed
  const d = new Date(m.at)
  const clock = m.at > 0 ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : "--:--:--"
  return (
    <div className={`msg ${me ? "me" : "them"} ${m.thread ? "reply" : "root"} ${kind}`} title={`Relay message ${m.id}${m.thread ? ` · reply in thread ${m.thread}` : " · thread root"}`}>
      <span className="who">{m.from}</span>
      <p className="txt">{highlight(m.text, handle)}</p>
      <span className="meta">Relay msg {m.id.slice(-6)} · {clock}</span>
    </div>
  )
}

/** Marks the viewing agent's own @mention inside a line, so the room sees why the message reached this inbox. */
function highlight(text: string, handle: string) {
  const parts = text.split(new RegExp(`(@${escapeRe(handle)})(?![a-z0-9-])`, "i"))
  return parts.length === 1 ? text : parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : p))
}
