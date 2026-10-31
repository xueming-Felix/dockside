// Smoke check: relay/dock.ts TerseDock against a real local durable-actors dev server
// running the throwaway Dock actor in ./src/actors.ts. Run from relay/terse-smoke so
// Bun loads ./.env (DURABLE_ACTORS_CONTROL_PLANE_URL etc.):  bun check.ts
// Expects ../dock.ts, ../generated/ and ../../shared/types.ts at the usual relative paths.
// (The local runtime has no win32 build — run inside WSL 2 / Linux / macOS; see wsl-sync.sh.)
import { readFileSync } from "node:fs"
import { TerseDock, type SeedSpec } from "../dock.ts"
import type { Snapshot } from "../../shared/types.ts"

process.env.DOCK_ACTOR_ID ??= "smoke-1"
const results: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = "") => {
    results.push({ name, ok, detail })
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`)
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const pct = (xs: number[], p: number) => {
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!
}
const fmt = (xs: number[]) =>
    `n=${xs.length} min=${Math.min(...xs).toFixed(1)} p50=${pct(xs, 50).toFixed(1)} p90=${pct(xs, 90).toFixed(1)} max=${Math.max(...xs).toFixed(1)} ms`

const dockSrc = readFileSync(new URL("../dock.ts", import.meta.url), "utf8")
console.log("dock.ts under test: contains `fn.length` =", dockSrc.includes("fn.length"),
    " skips {type} frames =", dockSrc.includes('"type" in msg'),
    " default id =", /DOCK_ACTOR_ID \?\? "([^"]+)"/.exec(dockSrc)?.[1])
console.log("bun", process.versions.bun, " env DURABLE_ACTORS_CONTROL_PLANE_URL =", process.env.DURABLE_ACTORS_CONTROL_PLANE_URL)
console.log("env DOCK_ACTOR_ID =", process.env.DOCK_ACTOR_ID)

// ---- inspect the generated stub directly ----------------------------------------
const gen: any = await import("../generated/index.js")
const actorId = process.env.DOCK_ACTOR_ID
const stub = gen.actors.Dock.get(actorId)
console.log("stub keys =", Object.keys(stub), " say.length =", stub.say.length,
    " typeof backhaul =", typeof stub.backhaul, " typeof setSpeed =", typeof stub.setSpeed)

// ---- raw websocket: grant shape + raw frames ------------------------------------
let t = performance.now()
const grant = await gen.actors.Dock.prepareWebsocket({ actorId, metadata: { role: "probe" } })
const grantMs = performance.now() - t
console.log("grant =", JSON.stringify(grant), ` (${grantMs.toFixed(1)} ms)`)
const rawFrames: { at: number; data: string }[] = []
const raw = new WebSocket(grant.websocketUrl)
raw.onmessage = ev => rawFrames.push({ at: performance.now(), data: String(ev.data) })
t = performance.now()
await new Promise<void>((res, rej) => { raw.onopen = () => res(); raw.onerror = e => rej(e) })
console.log(`raw ws open in ${(performance.now() - t).toFixed(1)} ms`)
await sleep(800)
check("raw ws got onConnect snapshot before any method call", rawFrames.length >= 1, `frames=${rawFrames.length}`)

// ---- TerseDock ------------------------------------------------------------------
t = performance.now()
const dock = await TerseDock.create()
console.log(`TerseDock.create in ${(performance.now() - t).toFixed(1)} ms`)
const snaps: { at: number; s: Snapshot }[] = []
dock.onSnapshot(s => snaps.push({ at: performance.now(), s }))
await sleep(800)
check("TerseDock onSnapshot got onConnect snapshot (before seed)", snaps.length >= 1, `snaps=${snaps.length}`)

const spec: SeedSpec = {
    doors: [{ id: 1, type: "dry", open: true }, { id: 2, type: "reefer", open: true }],
    trucks: [
        { id: "T1", carrier: "carrier-a", load: "paper", type: "dry", priority: 0, etaMin: 480 },
        { id: "T2", carrier: "carrier-b", load: "steel", type: "dry", priority: 1, etaMin: 480 }
    ],
    appts: [],
    speed: 1
}
const seeded = await dock.seed(spec)
check("seed returns Snapshot", Array.isArray(seeded.doors) && seeded.doors.length === 2, `doors=${seeded.doors?.length} trucks=${seeded.trucks?.length}`)

const r1 = await dock.request("carrier-a", "T1", 1, 480)
console.log("request#1 =", JSON.stringify(r1))
check("request#1 books appt", !!r1.appt && !r1.offer)
const r2 = await dock.request("carrier-b", "T2", 1, 480)
console.log("request#2 =", JSON.stringify(r2))
check("request#2 same slot returns offer", !!r2.offer && !r2.appt)

const said = await dock.say("carrier-a", "#pier9", "hello", "root1")
console.log("say =", JSON.stringify(said))
const snap = await dock.snapshot()
console.log("snapshot().chatter =", JSON.stringify(snap.chatter))

const sp = await dock.setSpeed(0)
console.log("setSpeed(0) =", JSON.stringify(sp))
const bh = await dock.backhaul("T1")
console.log("backhaul(T1) =", JSON.stringify(bh))
check("backhaul detected as missing (gap path)", bh.ok === false && /lacks backhaul/.test(bh.reason ?? ""), JSON.stringify(bh))
check("setSpeed detected as present", sp.ok === true, JSON.stringify(sp))

await sleep(500)
const withHello = snaps.find(x => x.s.chatter?.some(c => c.text === "hello"))
check("onSnapshot got a broadcast whose chatter contains 'hello'", !!withHello)
const helloChat = withHello?.s.chatter.find(c => c.text === "hello")
console.log("hello chat in broadcast =", JSON.stringify(helloChat))
check("hello chat thread === 'root1' (via TerseDock.say)", helloChat?.thread === "root1", `thread=${JSON.stringify(helloChat?.thread)}`)

// ---- timings: 20 sequential say() calls -----------------------------------------
const callMs: number[] = []
const bcastFromStart: number[] = []
const bcastVsReply: number[] = []
for (let i = 0; i < 20; i++) {
    const text = `lat-${i}`
    let resolveB!: (at: number) => void
    const gotB = new Promise<number>(r => (resolveB = r))
    const off = dock.onSnapshot(s => { if (s.chatter.some(c => c.text === text)) resolveB(performance.now()) })
    const t0 = performance.now()
    await dock.say("carrier-a", "#pier9", text, "root1")
    const t1 = performance.now()
    const tb = await Promise.race([gotB, sleep(3000).then(() => NaN)])
    off()
    callMs.push(t1 - t0)
    if (!Number.isNaN(tb)) { bcastFromStart.push(tb - t0); bcastVsReply.push(tb - t1) }
}
console.log("say() call latency           :", fmt(callMs))
console.log("broadcast latency (from call):", fmt(bcastFromStart))
console.log("broadcast minus RPC reply    :", fmt(bcastVsReply), "(negative = frame arrived before reply)")
check("all 20 say() broadcasts arrived", bcastFromStart.length === 20, `got ${bcastFromStart.length}`)

await sleep(300)
console.log("raw frames received =", rawFrames.length)
console.log("raw frame[0] (onConnect, full) =", rawFrames[0]?.data)
const helloFrame = rawFrames.find(f => f.data.includes('"hello"'))
console.log("raw frame containing hello (first 700 chars) =", helloFrame?.data.slice(0, 700))
const parsed0 = rawFrames[0] ? JSON.parse(rawFrames[0].data) : undefined
console.log("raw frame[0] top-level keys =", parsed0 && Object.keys(parsed0))
const nonSnap = rawFrames.filter(f => { const o = JSON.parse(f.data); return !("chatter" in o && "doors" in o) || "type" in o })
check("raw ws frames are bare Snapshot JSON", rawFrames.length > 0 && nonSnap.length === 0, `nonSnapshot=${nonSnap.length}${nonSnap[0] ? " e.g. " + nonSnap[0].data.slice(0, 200) : ""}`)

raw.close()
await dock.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
