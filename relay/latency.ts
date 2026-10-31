import { RelayBus } from "./bus.js";

console.log("[lat] creating bus");
const bus = new RelayBus();
console.log("[lat] registering");
const a = await bus.register("ping-a-spike");
console.log("[lat] a registered");
const b = await bus.register("ping-b-spike");
console.log("[lat] b registered");
const postMs: number[] = [];
const delivMs: number[] = [];
const sentAt = new Map<string, number>();
bus.onMessage((m) => {
  const t = sentAt.get(m.id);
  if (t != null) delivMs.push(Date.now() - t);
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log("[lat] posting root");
const root = await a.post("ping root");
sentAt.set(root.id, Date.now() - 0); postMs.push(0);
for (let i = 0; i < 9; i++) {
  const t0 = Date.now();
  const m = await a.post(`ping ${i}`);
  sentAt.set(m.id, t0); postMs.push(Date.now() - t0);
}
for (let i = 0; i < 10; i++) {
  const t0 = Date.now();
  const m = await b.post(`pong ${i}`, { thread: root.id });
  sentAt.set(m.id, t0); postMs.push(Date.now() - t0);
}
console.log("[lat] all posts done, waiting 6s for delivery");
await sleep(6000);
const pct = (xs: number[], p: number) => xs.length ? xs.sort((x, y) => x - y)[Math.min(xs.length - 1, Math.floor(xs.length * p / 100))] : -1;
console.log(`post() duration: n=${postMs.length} p50=${pct(postMs, 50)}ms p95=${pct(postMs, 95)}ms`);
console.log(`delivery latency: n=${delivMs.length} p50=${pct(delivMs, 50)}ms p95=${pct(delivMs, 95)}ms`);
await bus.close();
process.exit(0);
