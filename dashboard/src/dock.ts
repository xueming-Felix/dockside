import { useEffect, useState } from "react"
import type { Snapshot } from "../../shared/types"

export type DockFeed = { live?: Snapshot; history: Snapshot[]; status: "connecting" | "open" | "closed" | "error"; error?: string }

/** Opens the actor websocket through the grant route, keeps every snapshot for replay, reconnects on close. */
export function useDock(actorId: string): DockFeed {
  const [feed, setFeed] = useState<DockFeed>({ history: [], status: "connecting" })
  useEffect(() => {
    let stopped = false
    let ws: WebSocket | undefined
    let retry = 0
    const later = (fn: () => void) => { if (!stopped) setTimeout(fn, Math.min(8000, 500 * 2 ** retry++)) }
    const connect = async () => {
      try {
        setFeed(f => ({ ...f, status: "connecting" }))
        const res = await fetch(`/api/socket?actor=${encodeURIComponent(actorId)}`, { method: "POST" })
        if (!res.ok) throw new Error(await res.text())
        const { websocketUrl } = (await res.json()) as { websocketUrl: string }
        // The effect may have been cleaned up while the grant was in flight (StrictMode runs effects twice in dev);
        // opening a socket now would leak it and double every snapshot in history.
        if (stopped) return
        ws = new WebSocket(websocketUrl)
        ws.onopen = () => { retry = 0; setFeed(f => ({ ...f, status: "open", error: undefined })) }
        ws.onmessage = (e) => {
          let snap: Snapshot | undefined
          try { snap = JSON.parse(e.data) } catch { return }
          if (!snap || typeof snap.simMin !== "number" || !Array.isArray(snap.doors)) return
          const s = snap
          setFeed(f => ({ ...f, live: s, history: [...f.history.slice(-900), s] }))
        }
        ws.onclose = () => { if (stopped) return; setFeed(f => ({ ...f, status: "closed" })); later(connect) }
      } catch (error) {
        if (stopped) return
        setFeed(f => ({ ...f, status: "error", error: error instanceof Error ? error.message : String(error) }))
        later(connect)
      }
    }
    connect()
    return () => { stopped = true; ws?.close() }
  }, [actorId])
  return feed
}

/** The board's own clock: interpolates sim minutes between snapshots from realStart and speed. */
export function useSimMin(snap?: Snapshot): number {
  const [sim, setSim] = useState(0)
  useEffect(() => {
    if (!snap) return
    const tick = () => setSim(snap.frozen || !snap.seeded ? snap.simMin : Math.max(snap.simMin, Math.floor(((Date.now() - snap.realStart) * snap.speed) / 60000)))
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [snap])
  return sim
}
