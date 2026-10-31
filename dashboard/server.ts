// dashboard/server.ts — the 20-line backend: issues websocket grants for the Dock actor and serves the built page.
// Dev: `bun run server` here + `bun run dev` for Vite. Demo: `bun run build && bun run start`.
// Connection settings come from TERSE_ACTOR_URL and TERSE_API_KEY (actor/.env is read if present); local dev needs neither.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { actors } from "../actor/generated/index.js"
import { ACTOR_ID } from "../shared/types.js"
import { DemoDriver } from "./demo.js"

for (const file of [join(import.meta.dir, ".env"), join(import.meta.dir, "../actor/.env")]) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const port = Number(process.env.PORT ?? 7110)
const demoActor = process.env.DEMO_ACTOR || ACTOR_ID
const demo = new DemoDriver(demoActor, Number(process.env.DEMO_SPEED ?? 60))
const dist = join(import.meta.dir, "dist")

Bun.serve({
  port,
  hostname: process.env.HOST ?? "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/api/socket" && req.method === "POST") {
      const actorId = url.searchParams.get("actor") || demoActor
      try {
        const grant = await actors.Dock.prepareWebsocket({ actorId, metadata: { role: "dashboard" } })
        return Response.json(grant, { headers: { "Cache-Control": "no-store" } })
      } catch (error) {
        return new Response(error instanceof Error ? error.message : String(error), { status: 502 })
      }
    }
    if (url.pathname === "/api/demo/state") return Response.json(demo.state(), { headers: { "Cache-Control": "no-store" } })
    if (req.method === "POST" && url.pathname === "/api/demo/reset") return Response.json(await demo.reset())
    if (req.method === "POST" && url.pathname === "/api/demo/auto") return Response.json(demo.toggleAuto())
    const scene = url.pathname.match(/^\/api\/demo\/scene\/([a-z]+)$/)
    if (req.method === "POST" && scene) return Response.json(demo.startScene(scene[1]))
    const key = url.pathname.match(/^\/api\/demo\/key\/(\d+)$/)
    if (req.method === "POST" && key) return Response.json(demo.press(Number(key[1])))
    if (url.pathname === "/api/health") return Response.json({ ok: true, actorId: demoActor, actorUrl: process.env.TERSE_ACTOR_URL ?? "local" })
    if (existsSync(dist)) {
      const file = Bun.file(join(dist, url.pathname === "/" ? "index.html" : url.pathname))
      if (await file.exists()) return new Response(file)
      return new Response(Bun.file(join(dist, "index.html")))
    }
    return new Response("Dockside grant server. Run `bun run dev` for the page, or `bun run build` to serve it from here.", { status: 404 })
  },
})
console.log(`Dockside grant server on http://${process.env.HOST ?? "127.0.0.1"}:${port}  actor=${demoActor}  target=${process.env.TERSE_ACTOR_URL ?? "local runtime :7100"}`)
