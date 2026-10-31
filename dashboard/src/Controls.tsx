import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react"

/** What `GET /api/demo/state` answers; the stage driver (dashboard/demo.ts) owns the shape. */
export type KeyStatus = "ready" | "running" | "done" | "failed"
export type DemoKey = { n: number; title: string; sim: string; status: KeyStatus; note?: string }
export type DemoState = { actorId: string; auto: boolean; running: number | null; keys: DemoKey[] }

// Short labels sized for the back of the room; the driver's own title goes in the tooltip. The sim times are the
// scheduled minutes from PLAN.md "The scenario · three acts" and only show until the driver reports its own.
const SCRIPT: ReadonlyArray<{ n: number; title: string; sim: string }> = [
  { n: 1, title: "Collision", sim: "08:05" }, { n: 2, title: "Truck arrives", sim: "08:30" }, { n: 3, title: "Traffic", sim: "09:00" },
  { n: 4, title: "Door 5 down", sim: "09:20" }, { n: 5, title: "Unknown carrier", sim: "09:40" }, { n: 6, title: "Overrun", sim: "09:50" },
  { n: 7, title: "Hot load", sim: "10:15" }, { n: 8, title: "Hours of service", sim: "11:20" }, { n: 9, title: "Backhaul", sim: "11:40" },
  { n: 10, title: "Freeze", sim: "12:00" },
]
const POLL_MS = 1000
const NOTICE_MS = 6000
const hintFor = (n: number) => (n >= 1 && n <= 9 ? String(n) : n === 10 ? "0" : "")

/** The grant server answers unknown routes with index.html and a 200, so "is it JSON" is the real liveness test, not the status. */
async function json<T>(res: Response): Promise<T | null> {
  if (!/json/i.test(res.headers.get("content-type") ?? "")) return null
  try { return (await res.json()) as T } catch { return null }
}

async function fetchState(): Promise<DemoState | null> {
  try {
    const res = await fetch("/api/demo/state", { cache: "no-store", headers: { accept: "application/json" } })
    if (!res.ok) return null
    const s = await json<DemoState>(res)
    return s && Array.isArray(s.keys) ? s : null
  } catch { return null }
}

type Notice = { kind: "error" | "info"; text: string }

/** Polls the driver once a second (and right after every click), posts the presenter's clicks, remembers which are in flight. */
function useDriver() {
  const [state, setState] = useState<DemoState | null>(null)
  const [online, setOnline] = useState(false)
  const [pending, setPending] = useState<string[]>([])
  const [notice, setNotice] = useState<Notice | null>(null)
  const refresh = useRef<() => Promise<void>>(async () => {})
  const inflight = useRef(new Set<string>())
  const runningSince = useRef<{ n: number | null; at: number }>({ n: null, at: 0 })

  useEffect(() => {
    let stopped = false, gen = 0, timer: number | undefined
    const run = async () => {
      const g = ++gen // a click-triggered refresh supersedes the poll in flight, so exactly one chain keeps polling
      clearTimeout(timer)
      const s = await fetchState()
      if (stopped || g !== gen) return
      if (s) {
        if (s.running !== runningSince.current.n) runningSince.current = { n: s.running, at: Date.now() }
        setState(s)
      }
      setOnline(s !== null)
      timer = window.setTimeout(run, POLL_MS)
    }
    refresh.current = run
    void run()
    return () => { stopped = true; clearTimeout(timer); refresh.current = async () => {} }
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => clearTimeout(t)
  }, [notice])

  const post = useCallback(async (id: string, path: string, label: string) => {
    if (inflight.current.has(id)) return
    inflight.current.add(id)
    setPending([...inflight.current])
    try {
      const res = await fetch(path, { method: "POST", headers: { accept: "application/json" } })
      const body = await json<{ ok?: boolean; reason?: string }>(res)
      if (!body) setNotice({ kind: "error", text: res.ok ? `${label}: driver offline` : `${label}: HTTP ${res.status}` })
      else if (body.ok === false) setNotice({ kind: "error", text: `${label}: ${body.reason ?? "refused"}` })
    } catch (e) {
      setNotice({ kind: "error", text: `${label}: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      await refresh.current() // the button comes back only once the state shows running/done, so a double click can't double-fire
      inflight.current.delete(id)
      setPending([...inflight.current])
    }
  }, [])

  return { state, online, pending, notice, post, runningSince: runningSince.current }
}

/** The stage strip: ten scenario keys, Reset 08:00 and Auto. Digits 1-9 and 0, R and A do the same from the keyboard. */
export const Controls = memo(function Controls({ actorId }: { actorId: string }) {
  const { state, online, pending, notice, post, runningSince } = useDriver()
  const keys = (state?.keys.length ? state.keys : SCRIPT.map((s): DemoKey => ({ ...s, status: "ready" }))).map(k => {
    const short = SCRIPT.find(s => s.n === k.n)?.title ?? k.title
    return { ...k, short, long: k.title !== short ? k.title : undefined }
  })
  const running = state?.running ?? keys.find(k => k.status === "running")?.n ?? null
  // "Next" is the first ready key after the last one the presenter has been through (done or failed); skipped keys stay plain.
  const passed = keys.reduce((last, k, i) => (k.status === "done" || k.status === "failed" ? i : last), -1)
  const next = online && running === null ? keys.slice(passed + 1).find(k => k.status === "ready")?.n ?? null : null
  const locked = !online || running !== null || pending.length > 0
  const press = (n: number) => { if (!locked && keys.some(k => k.n === n)) void post(`key:${n}`, `/api/demo/key/${n}`, `key ${n}`) }
  const reset = () => { if (online) void post("reset", "/api/demo/reset", "reset") }
  const toggleAuto = () => { if (online) void post("auto", "/api/demo/auto", "auto") }

  const handlers = useRef({ press, reset, toggleAuto })
  useEffect(() => { handlers.current = { press, reset, toggleAuto } })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return // Cmd+R must still reload the page
      const el = e.target instanceof HTMLElement ? e.target : null
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      const h = handlers.current
      if (/^[1-9]$/.test(e.key)) h.press(Number(e.key))
      else if (e.key === "0") h.press(10)
      else if (e.key === "r" || e.key === "R") h.reset()
      else if (e.key === "a" || e.key === "A") h.toggleAuto()
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const elapsed = running !== null ? Math.max(0, Math.round((Date.now() - runningSince.at) / 1000)) : 0
  const done = keys.filter(k => k.status === "done").length
  const mismatch = state !== null && !!state.actorId && state.actorId !== actorId
  const runningKey = running !== null ? keys.find(k => k.n === running) : undefined
  const status = !online ? { cls: "offline", text: "driver offline · retrying" }
    : notice ? { cls: notice.kind, text: notice.text }
    : mismatch ? { cls: "error", text: `driver on ${state.actorId} · board on ${actorId}` }
    : runningKey ? { cls: "running", text: `running key ${runningKey.n} · ${runningKey.short}` }
    : state?.auto ? { cls: "auto", text: `auto · scripted timing · ${done}/${keys.length} done` }
    : { cls: "", text: `manual · ${done}/${keys.length} done` }

  return (
    <div className={`controls ${online ? "" : "offline"}`} style={{ ["--nkeys" as string]: keys.length } as CSSProperties} role="toolbar" aria-label="Stage controls">
      {keys.map(k => {
        const isRunning = running === k.n || k.status === "running"
        const mode = isRunning ? "running" : k.status === "done" ? "done" : k.status === "failed" ? "failed" : next === k.n ? "next" : "ready"
        const note = isRunning ? `running · ${elapsed}s` : k.status === "failed" ? k.note || "failed" : next === k.n ? "next" : ""
        const tip = [`Key ${k.n} · ${k.sim}`, k.long ?? k.short, k.status === "failed" && k.note ? `failed · ${k.note}` : k.status].join(" · ")
        return (
          <div key={k.n} className={`ctl ${mode} ${pending.includes(`key:${k.n}`) ? "pending" : ""}`}>
            <button type="button" onClick={() => press(k.n)} disabled={locked} title={tip} aria-label={`Key ${k.n}, ${k.short}, ${k.sim}, ${k.status}`}>
              <span className="n">{k.n}</span>
              <span className="txt"><span className="t">{k.short}</span><span className="s">{k.sim}</span></span>
              {k.status === "done" ? <span className="ok" aria-hidden="true">✓</span> : hintFor(k.n) ? <kbd>{hintFor(k.n)}</kbd> : null}
              {isRunning && <span className="bar" aria-hidden="true"><i /></span>}
            </button>
            <small className="note" title={k.status === "failed" ? k.note : undefined}>{note}</small>
          </div>
        )
      })}
      <div className={`ctl reset ${pending.includes("reset") ? "pending" : ""}`}>
        <button type="button" onClick={reset} disabled={!online || pending.includes("reset")} title="Reseed the dock at 08:00 and set every key back to ready (R)">
          <span className="n">↺</span>
          <span className="txt"><span className="t">Reset</span><span className="s">08:00</span></span>
          <kbd>R</kbd>
        </button>
        <small className="note" />
      </div>
      <div className={`ctl auto ${state?.auto ? "on" : ""} ${pending.includes("auto") ? "pending" : ""}`}>
        <button type="button" onClick={toggleAuto} disabled={!online || pending.includes("auto")} aria-pressed={!!state?.auto}
          title={state?.auto ? "Auto is on: the driver runs the remaining keys on the scripted timing. A turns it off" : "Run the remaining keys on the scripted timing (A)"}>
          <span className="n">{state?.auto ? "■" : "▶"}</span>
          <span className="txt"><span className="t">Auto</span><span className="s">{state?.auto ? "on" : "off"}</span></span>
          <kbd>A</kbd>
        </button>
        <small className="note" />
      </div>
      <div className={`ctl-status ${status.cls}`} title={state ? `driver actor ${state.actorId}` : "GET /api/demo/state is not answering JSON yet"}>{status.text}</div>
    </div>
  )
})
