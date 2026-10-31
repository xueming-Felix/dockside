// agents.ts — registers the 8 personas on the bus; each listens to #pier9
// messages that mention it, concern its trucks, or sit in a thread it has
// posted in. Agents ignore their own messages, reply in-thread after a short
// random delay, and know only what Relay text tells them — no DockClient.

import type { Bus, BusAgent, BusMsg } from "./bus.js";
import { createBus } from "./bus.js";
import { parseLine, mentionsOf, type Parsed } from "./grammar.js";
import { PERSONAS, type Persona } from "./personas.js";
import { makeBrain, freshState, notePost, carrierXRequest,
         type AgentState, type Brain, type BrainCtx, type BrainDecision, SILENT } from "./brain.js";

export type AgentsOptions = {
  replyDelayMs?: [number, number];   // default 800–2000 real ms
  nowMin?: () => number;             // approx sim minutes, for flavor
  brain?: Brain;
  onPost?: (from: string, msg: BusMsg) => void;
};

export type AgentsHandle = {
  close(): Promise<void>;
  poke(handle: string): void;        // scripted trigger (carrier-x's request)
  stats(): import("./brain.js").BrainStats;
};

type AgentRuntime = {
  persona: Persona;
  client: BusAgent;
  state: AgentState;
  brain: Brain;
  queue: Promise<void>;              // serialize decisions per agent
};

const ALL_TRUCKS = /\bT\d+\b/g;

function concernsMe(p: Persona, state: AgentState, msg: BusMsg, parsed: Parsed): boolean {
  if (msg.mentions.includes(p.handle)) return true;
  if (msg.thread && state.threadsPosted.has(msg.thread)) return true;
  // does the line name one of my trucks?
  const names = new Set<string>();
  const collect = (s: string | undefined) => {
    if (!s) return;
    for (const m of s.matchAll(ALL_TRUCKS)) names.add(m[0]);
  };
  collect(msg.text);
  if ("truckId" in parsed && typeof parsed.truckId === "string") names.add(parsed.truckId);
  if (parsed.verb === "SETTLE") for (const a of parsed.assigns) names.add(a.truckId);
  if (parsed.verb === "SWAP?") for (const m of parsed.text.matchAll(ALL_TRUCKS)) names.add(m[0]);
  if ([...names].some((t) => p.trucks.includes(t))) return true;
  // broadcasts every carrier should see
  if (parsed.verb === "AUCTION" && p.trucks.length > 0) return true;
  if (parsed.verb === "EMPTY" && p.handle === "broker") return true;
  if (parsed.verb === "OFFER" && /hot/i.test(msg.text) && p.handle === "shipper") return true;
  if (parsed.verb === "BOOK" && p.handle === "pier9-ops") return true; // booking tomorrow is ops's job
  return false;
}

export async function startAgents(bus: Bus, opts: AgentsOptions = {}): Promise<AgentsHandle> {
  const [dMin, dMax] = opts.replyDelayMs ?? [800, 2000];
  const nowMin = opts.nowMin ?? (() => 0);
  const brain = opts.brain ?? makeBrain();
  const runtimes = new Map<string, AgentRuntime>();
  const threads = new Map<string, BusMsg[]>();   // rootId -> messages in thread

  for (const persona of PERSONAS) {
    const client = await bus.register(persona.handle);
    runtimes.set(persona.handle, { persona, client, state: freshState(), brain, queue: Promise.resolve() });
  }

  const delay = () => dMin + Math.random() * (dMax - dMin);

  function track(msg: BusMsg) {
    const root = msg.thread ?? msg.id;
    const list = threads.get(root) ?? [];
    if (!threads.has(root)) threads.set(root, list);
    list.push(msg);
    return root;
  }

  async function act(rt: AgentRuntime, msg: BusMsg, threadId: string) {
    const ctx: BrainCtx = {
      self: rt.persona, state: rt.state, msg, parsed: parseLine(msg.text),
      thread: (threads.get(threadId) ?? []).filter((m) => m.id !== msg.id),
      // reply inside the triggering thread; a top-level message IS the root
      threadId: msg.thread ?? msg.id,
      nowMin: nowMin(),
    };
    // record offers/auctions for later context
    if (ctx.parsed.verb === "OFFER") {
      rt.state.offers.set(ctx.parsed.offerId, ctx.parsed);
      rt.state.offerThreads.set(ctx.parsed.offerId, threadId);
      if (rt.persona.trucks.includes(ctx.parsed.truckId)) rt.state.myOffers.set(ctx.parsed.truckId, ctx.parsed.offerId);
    }
    if (ctx.parsed.verb === "AUCTION") rt.state.auctions.set(ctx.parsed.auctionId, ctx.parsed);

    await sleep(delay());
    const decision = await rt.brain.decide(ctx);
    await post(rt, ctx, decision);
  }

  async function post(rt: AgentRuntime, ctx: BrainCtx, decision: BrainDecision) {
    if (decision.verb === "silent" || !decision.text) return;
    const { id } = await rt.client.post(decision.text, { thread: ctx.threadId });
    notePost(ctx, decision);
    if (ctx.threadId) rt.state.threadsPosted.add(ctx.threadId);
    else rt.state.threadsPosted.add(id);
    opts.onPost?.(rt.persona.handle, {
      id, from: rt.persona.handle, text: decision.text, thread: ctx.threadId,
      mentions: mentionsOf(decision.text),
    });
    // chain: AGREE -> SETTLE
    const up = rt.brain.followUp(ctx, decision);
    if (up.verb !== "silent") {
      await sleep(delay() / 2);
      const { id: id2 } = await rt.client.post(up.text, { thread: ctx.threadId });
      notePost(ctx, up);
      if (ctx.threadId) rt.state.threadsPosted.add(ctx.threadId);
      else rt.state.threadsPosted.add(id2);
    }
  }

  const un = bus.onMessage((msg) => {
    const root = track(msg);
    for (const rt of runtimes.values()) {
      if (msg.from === rt.persona.handle) continue;
      const parsed = parseLine(msg.text);
      if (!concernsMe(rt.persona, rt.state, msg, parsed)) continue;
      rt.queue = rt.queue.then(() => act(rt, msg, root)).catch((e) => {
        console.warn(`[${rt.persona.handle}] decide failed: ${e}`);
      });
    }
  });

  return {
    async close() {
      un();
      await Promise.all([...runtimes.values()].map((r) => r.queue.catch(() => {})));
    },
    poke(handle: string) {
      const rt = runtimes.get(handle);
      if (!rt) return;
      rt.queue = rt.queue.then(async () => {
        const d = handle === "carrier-x" ? carrierXRequest() : SILENT;
        const ctx: BrainCtx = { self: rt.persona, state: rt.state,
          msg: { id: "", from: "script", text: "", mentions: [] },
          parsed: { verb: "free", text: "" }, thread: [], threadId: undefined, nowMin: nowMin() };
        await post(rt, ctx, d);
      });
    },
    stats: () => brain.stats(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// CLI: run the cast as a separate process (`bun agents.ts`)
if (import.meta.main) {
  const bus = createBus();
  const handle = await startAgents(bus);
  console.log(`[agents] ${PERSONAS.length} personas up on bus=${process.env.BUS ?? "local"}`);
  const shutdown = async () => { await handle.close(); await bus.close(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
