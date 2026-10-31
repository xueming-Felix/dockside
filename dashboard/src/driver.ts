import { useCallback, useEffect, useMemo, useRef, useState } from "react"

/** What `GET /api/demo/state` answers; the stage driver (dashboard/demo.ts) owns the shape. */
export type KeyStatus = "ready" | "running" | "done" | "failed"
export type DemoKey = { n: number; title: string; sim: string; status: KeyStatus; note?: string }
// Story mode: the presenter runs two or three scenes and the right column narrates each step as it lands.
export type Tech = "actor" | "agents" | "alarm" | "dispatcher"
export type StepStatus = "pending" | "active" | "done" | "failed"
export type StoryStep = { i: number; title: string; what: string; why: string; tech: Tech; status: StepStatus; at?: string; lines?: string[] }
export type SceneStatus = "ready" | "running" | "done" | "failed"
export type Scene = { id: string; n: number; title: string; subtitle: string; status: SceneStatus; note?: string; outcome?: string }
export type Story = { sceneId: string; title: string; subtitle: string; steps: StoryStep[]; outcome?: string }
export type StageMode = "story" | "keys"
export type DemoState = {
  actorId: string; auto: boolean; running: number | null; keys: DemoKey[]
  mode: StageMode; scenes: Scene[]; story: Story | null // a driver that predates scenes reads as mode "keys" with no scenes
  relay: RelayStats | null // Agent Relay posting, when the driver has a workspace key
  manual: boolean; awaitingNext: boolean; nextTitle: string // step-by-step: a step is waiting for the presenter's Next
  cast: CastMember[] // PLAN.md's personas, for the carrier tabs (empty on a driver that predates them)
  relayFeed: RelayMsg[] // what Agent Relay's event stream delivered to the driver, oldest first; not the dock's mirror
}
export type RelayStats = { enabled: boolean; agents: number; queued: number; posted: number; failed: number; delivered: number; lastError: string }
export type CastMember = { handle: string; role: string; trucks: string[]; hourUsd: number; budgetUsd: number; rule: string }
/** One delivered Relay message: `thread` is the Relay id of the deal's root post (absent on the root itself), `at` epoch ms when the driver received it. */
export type RelayMsg = { id: string; from: string; text: string; thread?: string; mentions: string[]; at: number }
export type Notice = { kind: "error" | "info"; text: string }
export type Driver = {
  state: DemoState | null; online: boolean; pending: string[]; notice: Notice | null
  post: (id: string, path: string, label: string) => Promise<void>
  runningSince: { id: string | null; at: number }
}

const POLL_MS = 1000
const NOTICE_MS = 6000

/** The grant server answers unknown routes with index.html and a 200, so "is it JSON" is the real liveness test, not the status. */
async function json<T>(res: Response): Promise<T | null> {
  if (!/json/i.test(res.headers.get("content-type") ?? "")) return null
  try { return (await res.json()) as T } catch { return null }
}

/** Both driver generations answer here: the ten-key shape (keys) and the scene shape (mode/scenes/story). Missing story fields fall back to keys mode. */
function normalize(s: Partial<DemoState> | null): DemoState | null {
  if (!s || (!Array.isArray(s.keys) && !Array.isArray(s.scenes))) return null
  const story = s.story && typeof s.story === "object" && Array.isArray(s.story.steps) ? s.story : null
  return {
    actorId: typeof s.actorId === "string" ? s.actorId : "", auto: !!s.auto, running: typeof s.running === "number" ? s.running : null,
    keys: Array.isArray(s.keys) ? s.keys : [], mode: s.mode === "story" ? "story" : "keys", scenes: Array.isArray(s.scenes) ? s.scenes : [], story,
    relay: s.relay && typeof s.relay === "object" ? s.relay : null,
    manual: !!s.manual, awaitingNext: !!s.awaitingNext, nextTitle: typeof s.nextTitle === "string" ? s.nextTitle : "",
    cast: Array.isArray(s.cast) ? s.cast.filter(c => c && typeof c.handle === "string").map(c => ({
      handle: c.handle, role: typeof c.role === "string" ? c.role : "", trucks: Array.isArray(c.trucks) ? c.trucks.map(String) : [],
      hourUsd: Number(c.hourUsd) || 0, budgetUsd: Number(c.budgetUsd) || 0, rule: typeof c.rule === "string" ? c.rule : "",
    })) : [],
    relayFeed: Array.isArray(s.relayFeed) ? s.relayFeed.filter(m => m && typeof m.id === "string").map(m => ({
      id: m.id, from: typeof m.from === "string" ? m.from.replace(/^@/, "").toLowerCase() : "?", text: typeof m.text === "string" ? m.text : "", // handles are lowercase; the inbox matches on them
      thread: typeof m.thread === "string" && m.thread ? m.thread : undefined,
      mentions: Array.isArray(m.mentions) ? m.mentions.map(x => String(x).toLowerCase()) : [], at: typeof m.at === "number" ? m.at : 0,
    })) : [],
  }
}

async function fetchState(): Promise<DemoState | null> {
  try {
    const res = await fetch("/api/demo/state", { cache: "no-store", headers: { accept: "application/json" } })
    if (!res.ok) return null
    return normalize(await json<Partial<DemoState>>(res))
  } catch { return null }
}

/** Polls the driver once a second (and right after every click), posts the presenter's clicks, remembers which are in flight. */
export function useDriver(): Driver {
  const [state, setState] = useState<DemoState | null>(null)
  const [online, setOnline] = useState(false)
  const [pending, setPending] = useState<string[]>([])
  const [notice, setNotice] = useState<Notice | null>(null)
  const refresh = useRef<() => Promise<void>>(async () => {})
  const inflight = useRef(new Set<string>())
  const runningSince = useRef<{ id: string | null; at: number }>({ id: null, at: 0 })

  useEffect(() => {
    let stopped = false, gen = 0, timer: number | undefined
    const run = async () => {
      const g = ++gen // a click-triggered refresh supersedes the poll in flight, so exactly one chain keeps polling
      clearTimeout(timer)
      const s = await fetchState()
      if (stopped || g !== gen) return
      if (s) {
        const runKey = s.running !== null ? `key:${s.running}` : s.scenes.find(x => x.status === "running")?.id ?? null
        if (runKey !== runningSince.current.id) runningSince.current = { id: runKey, at: Date.now() }
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

  // One object per poll, so the memoised strip and panel re-render on driver changes, not on every board tick.
  return useMemo<Driver>(() => ({ state, online, pending, notice, post, runningSince: runningSince.current }), [state, online, pending, notice, post])
}
