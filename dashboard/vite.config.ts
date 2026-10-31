import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// The grant server (server.ts, port 7110) hands out websocket URLs; Vite proxies /api to it in dev.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:7110" }, fs: { allow: [".."] } },
})
