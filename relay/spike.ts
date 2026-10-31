// spike.ts — PLAN "Relay spike" step 1: register `dock-spike` and
// `carrier-a-spike` (suffixed so they can't collide with the real cast),
// dock DMs carrier-a, a listener prints it. Uses RELAY_WORKSPACE_KEY.

import { AgentRelay } from "@agent-relay/sdk";

const key = process.env.RELAY_WORKSPACE_KEY;
if (!key) {
  console.error("RELAY_WORKSPACE_KEY is not set — put it in relay/.env first.");
  process.exit(1);
}

const relay = new AgentRelay({ workspaceKey: key });

const dock = await relay.workspace.register({ name: "dock-spike", type: "agent" });
const carrierA = await relay.workspace.register({ name: "carrier-a-spike", type: "agent" });
console.log(`registered: ${dock.name}, ${carrierA.name}`);

let got = false;
relay.addListener("message.created", (ev) => {
  const m = ev.message;
  console.log(`[message.created] ${m.from?.name ?? "?"}: ${m.text}`);
  got = true;
});
relay.addListener("dm.received", (ev) => {
  const m = ev.message;
  console.log(`[dm.received] ${m.from?.name ?? "?"}: ${m.text}`);
  got = true;
});

const sent = await dock.sendMessage({ to: "@carrier-a-spike", text: "ping from dock — pier 9 spike" });
console.log(`sent ${sent.id}: "${sent.text}"`);

await new Promise((r) => setTimeout(r, 5000));
await relay.events.disconnect().catch(() => {});
console.log(got ? "spike OK — DM round-tripped" : "spike sent but no listener event arrived in 5s");
process.exit(got ? 0 : 2);
