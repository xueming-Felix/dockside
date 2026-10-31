import { test, expect } from "bun:test";
import { makeBrain, freshState, type BrainCtx } from "./brain.js";
import { personaByHandle } from "./personas.js";
import type { BusMsg } from "./bus.js";
import { parseLine } from "./grammar.js";

function ctx(handle: string, text: string, opts: Partial<BrainCtx> = {}): BrainCtx {
  const self = personaByHandle(handle)!;
  const msg: BusMsg = opts.msg ?? { id: "m9", from: "dock", text, thread: opts.threadId ?? "t1", mentions: [] };
  return { self, state: opts.state ?? freshState(), msg, parsed: parseLine(text),
    thread: opts.thread ?? [], threadId: opts.threadId ?? "t1", nowMin: 0 };
}

const offerLine = "OFFER o4 truck T4 door 4 at 15:00 — door 4 14:00 was taken. Holder of door 4 14:00: @carrier-b (T2). Thread closes 08:15.";

test("carrier-a opens SWAP? at $120 on a held collision offer", async () => {
  const b = makeBrain();
  const d = await b.decide(ctx("carrier-a", offerLine));
  expect(d.verb).toBe("SWAP?");
  expect(d.text).toContain("@carrier-b");
  expect(d.text).toContain("$120");
});

test("carrier-b counters once: 120 -> 150, 150 -> 200", async () => {
  const b = makeBrain();
  const mk = (text: string) => ctx("carrier-b", text, {
    msg: { id: "m1", from: "carrier-a", text, thread: "t1", mentions: ["carrier-b"] },
    thread: [{ id: "m0", from: "dock", text: offerLine, mentions: [] }],
  });
  const d1 = await b.decide(mk("SWAP? @carrier-b — T4 takes door 4 14:00, T2 takes door 4 15:00, I cover $120."));
  expect(d1.verb).toBe("COUNTER");
  expect(d1.text).toContain("$150");

  const b2 = makeBrain();
  const state = freshState();
  const ctx2 = ctx("carrier-b", "SWAP? @carrier-b — T5 takes door 5 14:00, T9 takes door 6 16:00, we cover $150 of your detention. Cold chain.", {
    state,
    msg: { id: "m2", from: "carrier-c", text: "", thread: "t2", mentions: ["carrier-b"] },
    thread: [{ id: "m0", from: "dock", text: "OFFER o5 truck T5 door 6 at 16:00 — door 3 out. Holder of door 5 14:00: @carrier-b (T9).", mentions: [] }],
  });
  ctx2.msg.text = "SWAP? @carrier-b — T5 takes door 5 14:00, T9 takes door 6 16:00, we cover $150 of your detention. Cold chain.";
  const d2 = await b2.decide(ctx2);
  expect(d2.verb).toBe("COUNTER");
  expect(d2.text).toContain("$200");
});

test("guard: negotiation cap is 2 per agent per thread", async () => {
  const b = makeBrain();
  const state = freshState();
  const c = ctx("carrier-b", "SWAP? @carrier-b — T4 takes door 4 14:00, T2 takes door 4 15:00, I cover $120.", {
    state,
    msg: { id: "m", from: "carrier-a", text: "", thread: "t1", mentions: ["carrier-b"] },
  });
  state.negCount.set("t1", 2); // already used both
  const d = await b.decide(c);
  expect(d.verb).toBe("silent");
});

test("guard: SETTLE only from the conceder", async () => {
  const b = makeBrain();
  const state = freshState();
  const c = ctx("carrier-b", "AGREE $150 — done", {
    state,
    msg: { id: "m", from: "carrier-a", text: "", thread: "t1", mentions: [] },
  });
  // no agreedDeal -> followUp's SETTLE would be blocked; decide returns silent anyway
  const d = await b.decide(c);
  expect(d.verb).toBe("silent");
});

test("guard: carrier-b won't reopen a truck it already dealt", async () => {
  const b = makeBrain();
  const state = freshState();
  state.negotiatedTrucks.add("T2");
  const d = await b.decide(ctx("carrier-b", "SWAP? @carrier-b — T1 takes door 2 11:00, T2 takes door 2 12:00, I cover $120.", {
    state,
    msg: { id: "m", from: "carrier-a", text: "", thread: "t9", mentions: ["carrier-b"] },
  }));
  expect(d.verb).toBe("silent");
});

test("carrier-c refuses a dry door offer", async () => {
  const b = makeBrain();
  const d = await b.decide(ctx("carrier-c", "OFFER o9 truck T5 door 2 at 12:00 — replanned"));
  expect(d.verb).toBe("decline");
});

test("broker answers VERIFY no from its tender list", async () => {
  const b = makeBrain();
  const d = await b.decide(ctx("broker", "VERIFY @carrier-x load L12? — unknown carrier requesting door 2 at 11:00"));
  expect(d.verb).toBe("VERIFY");
  expect(d.text).toContain("no");
  expect(d.text).toContain("carrier-b");
});

test("carrier-d books tomorrow on TOMORROW", async () => {
  const b = makeBrain();
  const d = await b.decide(ctx("carrier-d", "TOMORROW T8 — slot ends after hours"));
  expect(d.verb).toBe("BOOK");
  expect(d.text).toContain("T8 08:00");
});

import { acceptLlmDecision, type BrainDecision } from "./brain.js";

const rules: BrainDecision = {
  verb: "SWAP?", args: { usd: 120, payer: "carrier-a" },
  text: "SWAP? @carrier-b — T4 takes door 4 14:00, T2 takes door 4 15:00, I cover $120.",
};

test("llm acceptance: matching head + verb is accepted with LLM text and rules args", () => {
  const llm: BrainDecision = { verb: "SWAP?", args: {},
    text: "SWAP? @carrier-b — listen, my driver is burning hours out there, I'll cover $120 to trade." };
  const out = acceptLlmDecision(rules, llm);
  expect(typeof out).not.toBe("string");
  if (typeof out === "string") return;
  expect(out.text).toBe(llm.text);        // LLM supplies the tail
  expect(out.args).toEqual(rules.args);   // guards keep the rules args
  expect(out.verb).toBe("SWAP?");
});

test("llm acceptance: wrong verb rejected", () => {
  const llm: BrainDecision = { verb: "COUNTER", args: {},
    text: "SWAP? @carrier-b — T4 takes door 4 14:00, T2 takes door 4 15:00, I cover $120." };
  expect(acceptLlmDecision(rules, llm)).toBe("verbMismatch");
});

test("llm acceptance: parsed verb mismatch rejected", () => {
  const llm: BrainDecision = { verb: "SWAP?", args: {},
    text: "accept o1 — fine, I'll just take it." };
  expect(acceptLlmDecision(rules, llm)).toBe("verbMismatch");
});

test("llm acceptance: changed dollar amount in the tail rejected", () => {
  const llm: BrainDecision = { verb: "SWAP?", args: {},
    text: "SWAP? @carrier-b — T4 takes door 4 14:00, T2 takes door 4 15:00, I cover $200." };
  // the room reads the tail — a reworded amount that disagrees with args must not ship
  expect(acceptLlmDecision(rules, llm)).toBe("headMismatch");
});

test("llm acceptance: reworded tail with the same amount is accepted", () => {
  const llm: BrainDecision = { verb: "SWAP?", args: {},
    text: "SWAP? @carrier-b — T4 takes door 4 14:00, T2 takes door 4 15:00, I'll spot you $120 for the trade." };
  const out = acceptLlmDecision(rules, llm);
  expect(typeof out).not.toBe("string");
  if (typeof out === "string") return;
  expect(out.args).toEqual(rules.args);
});

test("llm acceptance: changed slot in head rejected", () => {
  const rules2: BrainDecision = { verb: "SETTLE", args: {},
    text: "SETTLE o1: T4 door 4 14:00 · T2 door 4 15:00 · pay carrier-a→carrier-b $150" };
  const llm: BrainDecision = { verb: "SETTLE", args: {},
    text: "SETTLE o1: T4 door 4 14:00 · T2 door 4 16:00 · pay carrier-a→carrier-b $150 — done deal." };
  expect(acceptLlmDecision(rules2, llm)).toBe("headMismatch");
});

test("llm acceptance: empty/unparsable text rejected", () => {
  expect(acceptLlmDecision(rules, { verb: "SWAP?", args: {}, text: "" })).toBe("invalid");
});
