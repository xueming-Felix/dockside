import { memo, useEffect, useRef, useState } from "react"
import type { Driver, Scene, StoryStep, Tech } from "./driver"

// Story mode: three scene buttons in the strip and a narration panel in the right column. The driver (dashboard/demo.ts)
// owns the words; this file only decides how each step looks as it goes pending → active → done.
const TECH: Record<Tech, string> = { actor: "Durable Actor", agents: "Agents on Relay", alarm: "Alarm", dispatcher: "Dispatcher" }
// Shown while the driver is offline or still speaks keys, so the strip keeps its shape instead of collapsing to Reset.
const PLACEHOLDER: Scene[] = [1, 2, 3].map(n => ({ id: String(n), n, title: `Scene ${n}`, subtitle: "", status: "ready" }))
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

/** A subtitle that starts with "optional" renders the word as a pill; any other subtitle passes through untouched. */
function splitOptional(sub: string): [string | null, string] {
  const m = sub.match(/^\s*(optional)\b[\s:·,.—–-]*/i)
  return m ? [m[1], sub.slice(m[0].length)] : [null, sub]
}
function Subtitle({ text }: { text: string }) {
  const [pill, rest] = splitOptional(text)
  return <>{pill && <em className="pill">{pill}</em>}{rest}</>
}

/** The story strip: scene 1/2/3 and Reset 08:00. Digits 1-3 and R do the same from the keyboard. */
export const SceneControls = memo(function SceneControls({ actorId, driver }: { actorId: string; driver: Driver }) {
  const { state, online, pending, notice, post, runningSince } = driver
  const haveScenes = !!state?.scenes.length
  const scenes = haveScenes ? [...state!.scenes].sort((a, b) => a.n - b.n) : PLACEHOLDER
  const running = scenes.find(s => s.status === "running") ?? null
  // "Next" is the first ready scene after the last one the presenter has been through (done or failed).
  const passed = scenes.reduce((last, s, i) => (s.status === "done" || s.status === "failed" ? i : last), -1)
  const next = online && haveScenes && !running ? scenes.slice(passed + 1).find(s => s.status === "ready")?.id ?? null : null
  const locked = !online || !haveScenes || running !== null || pending.length > 0
  const start = (n: number) => {
    const s = scenes.find(x => x.n === n)
    if (!locked && s) void post(`scene:${s.id}`, `/api/demo/scene/${encodeURIComponent(s.id)}`, `scene ${s.n}`)
  }
  const reset = () => { if (online) void post("reset", "/api/demo/reset", "reset") }
  const awaiting = !!state?.awaitingNext
  const nextStep = () => { if (online && awaiting && !pending.includes("next")) void post("next", "/api/demo/next", "next step") }

  const handlers = useRef({ start, reset, nextStep })
  useEffect(() => { handlers.current = { start, reset, nextStep } })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return // Cmd+R must still reload the page
      const el = e.target instanceof HTMLElement ? e.target : null
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return
      const h = handlers.current
      if (/^[1-3]$/.test(e.key)) h.start(Number(e.key))
      else if (e.key === "r" || e.key === "R") h.reset()
      else if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight" || e.key === "n" || e.key === "N") h.nextStep()
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const elapsed = running ? Math.max(0, Math.round((Date.now() - runningSince.at) / 1000)) : 0
  const done = scenes.filter(s => s.status === "done").length
  const mismatch = state !== null && !!state.actorId && state.actorId !== actorId
  const relay = state?.relay ?? null
  const relayText = !relay ? "" : !relay.enabled ? " · Relay off"
    : relay.agents < 8 ? ` · Relay: ${relay.agents}/8 agents joining #pier9`
    : ` · Relay #pier9: ${relay.posted} posted${relay.queued ? `, ${relay.queued} on the way` : ""}${relay.failed ? `, ${relay.failed} failed` : ""}`
  const status = !online ? { cls: "offline", text: "driver offline · retrying" }
    : notice ? { cls: notice.kind, text: notice.text }
    : mismatch ? { cls: "error", text: `driver on ${state.actorId} · board on ${actorId}` }
    : !haveScenes ? { cls: "offline", text: "driver has no scenes yet" }
    : running ? { cls: "running", text: `running scene ${running.n} · ${running.title}${relayText}` }
    : { cls: "", text: `${done}/${scenes.length} scenes done${relayText}` }

  return (
    <div className={`controls scenes ${online ? "" : "offline"}`} role="toolbar" aria-label="Scene controls">
      {scenes.map(s => {
        const mode = s.status === "running" ? "running" : s.status === "done" ? "done" : s.status === "failed" ? "failed" : next === s.id ? "next" : "ready"
        const note = mode === "running" ? `running · ${elapsed}s` : mode === "failed" ? s.note || "failed" : mode === "next" ? "next" : ""
        const tip = [`Scene ${s.n}`, s.title, s.subtitle, s.status === "failed" && s.note ? `failed · ${s.note}` : s.status].filter(Boolean).join(" · ")
        return (
          <div key={s.id} className={`ctl ${mode} ${pending.includes(`scene:${s.id}`) ? "pending" : ""}`}>
            <button type="button" onClick={() => start(s.n)} disabled={locked} title={tip} aria-label={`Scene ${s.n}, ${s.title}, ${s.status}`}>
              <span className="n">{s.n}</span>
              <span className="txt"><span className="t">{s.title}</span><span className="s"><Subtitle text={s.subtitle} /></span></span>
              {s.status === "done" ? <span className="ok" aria-hidden="true">✓</span> : s.n >= 1 && s.n <= 3 ? <kbd>{s.n}</kbd> : null}
              {mode === "running" && <span className="bar" aria-hidden="true"><i /></span>}
            </button>
            <small className="note" title={s.status === "failed" ? s.note : undefined}>{note}</small>
          </div>
        )
      })}
      <div className={`ctl nextstep ${awaiting ? "waiting" : ""} ${pending.includes("next") ? "pending" : ""}`}>
        <button type="button" onClick={nextStep} disabled={!online || !awaiting || pending.includes("next")} title="Run the next step of the scene (space, enter or →)" aria-label="Next step">
          <span className="n">▶</span>
          <span className="txt"><span className="t">{awaiting ? "Next step" : running ? "Step running…" : "Next step"}</span><span className="s">{awaiting ? state?.nextTitle : running ? "watch the panel" : "press a scene first"}</span></span>
          <kbd>␣</kbd>
        </button>
        <small className="note">{awaiting ? "waiting for you" : ""}</small>
      </div>
      <div className={`ctl reset ${pending.includes("reset") ? "pending" : ""}`}>
        <button type="button" onClick={reset} disabled={!online || pending.includes("reset")} title="Reseed the dock at 08:00 and set every scene back to ready (R)">
          <span className="n">↺</span>
          <span className="txt"><span className="t">Reset</span><span className="s">08:00</span></span>
          <kbd>R</kbd>
        </button>
        <small className="note" />
      </div>
      <div className={`ctl-status ${status.cls}`} title={state ? `driver actor ${state.actorId}` : "GET /api/demo/state is not answering JSON yet"}>{status.text}</div>
    </div>
  )
})

/** The right-column narration: scene title, one row per step, the outcome once the scene is done. */
export const StoryPanel = memo(function StoryPanel({ driver }: { driver: Driver }) {
  const { state } = driver
  const story = state?.story ?? null
  const scene = story ? state?.scenes.find(s => s.id === story.sceneId) : undefined
  const total = state?.scenes.length ?? 0
  const outcome = story?.outcome ?? scene?.outcome
  const listRef = useRef<HTMLOListElement>(null)
  // Five steps with chat lines on each do not fit a projector column, so only the active step and the step that just
  // finished stay open (its lines land at finish and must outlive the next step going active); older done steps fold to
  // their title and tick. The presenter can click a folded step to open it again; the overrides clear with the scene.
  const [overrides, setOverrides] = useState<Map<number, boolean>>(new Map())
  useEffect(() => { setOverrides(new Map()) }, [story?.sceneId])
  const lastDone = story ? story.steps.reduce((m, s) => (s.status === "done" || s.status === "failed" ? Math.max(m, s.i) : m), 0) : 0
  const openByDefault = (st: StoryStep) => st.status === "active" || st.status === "failed" || st.i === lastDone
  const isOpen = (st: StoryStep) => overrides.get(st.i) ?? openByDefault(st)
  const toggle = (st: StoryStep) => setOverrides(prev => new Map(prev).set(st.i, !isOpen(st)))
  // Keep the step that just changed in view: the panel scrolls at 1440×900 once a scene has chat lines on several steps.
  const arc = story?.steps.map(s => s.status).join("") ?? ""
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const steps = Array.from(list.querySelectorAll<HTMLElement>(".step"))
    const target = steps.find(s => s.classList.contains("active")) ?? [...steps].reverse().find(s => !s.classList.contains("pending"))
    target?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" })
  }, [story?.sceneId, arc])

  if (!story) return (
    <section className="panel story-panel">
      <div className="story-empty"><p className="big">Pick a scene below.</p><p>Each step appears here as it happens.</p></div>
    </section>
  )
  return (
    <section className={`panel story-panel ${scene?.status ?? ""}`}>
      <header className="story-head">
        <span className="sn">{scene ? `Scene ${scene.n}${total > 1 ? ` of ${total}` : ""}` : "Scene"}{scene && <i className={`state ${scene.status}`}>{scene.status}</i>}</span>
        <b>{story.title}</b>
        <span className="sub"><Subtitle text={story.subtitle} /></span>
      </header>
      <ol className="steps" ref={listRef}>
        {story.steps.map(st => <Step key={st.i} step={st} open={isOpen(st)} onToggle={st.status === "done" ? () => toggle(st) : undefined} />)}
      </ol>
      {outcome && <div className="outcome"><span>Outcome</span><p>{outcome}</p></div>}
      {scene?.status === "failed" && scene.note && <div className="outcome failed"><span>Failed</span><p>{scene.note}</p></div>}
    </section>
  )
})

/** Pending shows the title only, so the room sees the arc before it happens; the what/why/chat lines appear when the step goes active. */
function Step({ step, open, onToggle }: { step: StoryStep; open: boolean; onToggle?: () => void }) {
  const show = step.status !== "pending" && open
  return (
    <li className={`step ${step.status} ${show ? "open" : "folded"}`} onClick={onToggle} role={onToggle ? "button" : undefined} aria-expanded={onToggle ? show : undefined}
      title={onToggle ? (show ? "Click to fold this step" : "Click to show what happened") : undefined}>
      <span className="num" aria-hidden="true">{step.i}</span>
      <div className="body">
        <div className="head">
          <span className={`tech ${step.tech}`}>{TECH[step.tech] ?? step.tech}</span>
          <b className="title">{step.title}</b>
          <span className="right">
            {step.status === "done" && <i className="ok" aria-label="done">✓</i>}
            {step.status === "failed" && <i className="bad" aria-label="failed">✕</i>}
            {step.at && <time className="at">{step.at}</time>}
          </span>
        </div>
        {show && step.what && <p className="what">{step.what}</p>}
        {show && step.why && <p className="why">{step.why}</p>}
        {show && step.lines && step.lines.length > 0 && <div className="lines">{step.lines.map((l, k) => <span key={k}>{l}</span>)}</div>}
      </div>
    </li>
  )
}
