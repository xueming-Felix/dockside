// brain.ts — decide each agent's reply. rulesBrain is a deterministic policy
// per persona; llmBrain asks gpt-5-mini with the rules brain's move as "your
// instinct" and falls back to it on timeout/invalid/guard failure. Hard guards
// apply to BOTH brains, in code.

import OpenAI from "openai";
import { z } from "zod";
import type { BusMsg } from "./bus.js";
import { parseLine, fmt, type Parsed } from "./grammar.js";
import { hhmm } from "./clock.js";
import type { Persona } from "./personas.js";

export const VERBS = [
  "accept", "counter", "decline", "SWAP?", "COUNTER", "AGREE", "SETTLE",
  "BID", "VERIFY", "REQUEST", "BACKHAUL", "BOOK", "BOOKED", "say", "silent",
] as const;
export type Verb = (typeof VERBS)[number];

export type BrainDecision = { verb: Verb; args: Record<string, unknown>; text: string };
export const SILENT: BrainDecision = { verb: "silent", args: {}, text: "" };

// Pier 9 door layout — general knowledge the agents have about the dock.
export const DOOR_TYPES: Record<number, "dry" | "reefer"> = { 1: "dry", 2: "dry", 3: "dry", 4: "dry", 5: "reefer", 6: "reefer" };

const NEGOTIATION_VERBS = new Set<Verb>(["SWAP?", "COUNTER", "AGREE", "say"]);
const CONTROL_VERBS = new Set<Verb>(["accept", "counter", "decline", "SETTLE", "BID", "VERIFY", "REQUEST", "BACKHAUL", "BOOK", "BOOKED"]);

// ---------------------------------------------------------------------------
// Per-agent state carried across messages (lives in agents.ts, passed in ctx)
// ---------------------------------------------------------------------------

export type SwapDeal = {
  myTruck: string; mySlot: { door: number; startMin: number };
  theirHandle: string; theirTruck: string; theirSlot: { door: number; startMin: number };
  usd: number; offerId: string;
};

export type AgentState = {
  offers: Map<string, Extract<Parsed, { verb: "OFFER" }>>;          // offerId -> parsed OFFER line
  offerThreads: Map<string, string>;                              // offerId -> relay thread root id
  auctions: Map<string, Extract<Parsed, { verb: "AUCTION" }>>;
  myOffers: Map<string, string>;                                  // truckId -> latest offerId
  threadsPosted: Set<string>;
  negCount: Map<string, number>;                                  // threadId -> negotiation msgs I sent
  controlCount: Map<string, Set<string>>;                         // threadId -> control verbs I sent
  pendingProposal: Map<string, SwapDeal>;                         // threadId -> deal I proposed via SWAP?
  agreedDeal: Map<string, SwapDeal>;                              // threadId -> deal sealed (I posted AGREE)
  negotiatedTrucks: Set<string>;                                  // carrier-b: one paid move per truck
  bidsCast: Set<string>;                                          // auctionId
  askedYield: Set<string>;                                        // shipper: threads where it asked who yields
  opsHandled: Set<string>;                                        // pier9-ops: threads already answered
  brokerStated: Set<string>;                                      // broker: threads where conditions stated
  carrierXDone: { requested: boolean; argued: boolean };
  backhauled: Set<string>;                                        // broker: trucks already offered a leg
};

export function freshState(): AgentState {
  return {
    offers: new Map(), offerThreads: new Map(), auctions: new Map(), myOffers: new Map(),
    threadsPosted: new Set(), negCount: new Map(), controlCount: new Map(),
    pendingProposal: new Map(), agreedDeal: new Map(), negotiatedTrucks: new Set(),
    bidsCast: new Set(), askedYield: new Set(), opsHandled: new Set(), brokerStated: new Set(),
    carrierXDone: { requested: false, argued: false }, backhauled: new Set(),
  };
}

export type BrainCtx = {
  self: Persona;
  state: AgentState;
  msg: BusMsg;
  parsed: Parsed;
  thread: BusMsg[];      // messages so far in this thread (excluding msg)
  threadId?: string;
  nowMin: number;        // approx sim minutes now (for flavor/ready times)
};

export type BrainStats = {
  llm: number;
  rulesFallback: number;
  guardFallback: number;
  buckets: { verbMismatch: number; headMismatch: number; timeoutOrError: number; invalid: number };
};

export type Brain = {
  decide(ctx: BrainCtx): Promise<BrainDecision> | BrainDecision;
  /** called after the agent posts its own line — lets a brain chain AGREE -> SETTLE */
  followUp(ctx: BrainCtx, posted: BrainDecision): BrainDecision;
  stats(): BrainStats;
};

// ---------------------------------------------------------------------------
// guards — applied to both brains
// ---------------------------------------------------------------------------

const roundUp50 = (n: number) => Math.ceil(n / 50) * 50;

function guardAllows(ctx: BrainCtx, d: BrainDecision): { ok: boolean; why?: string } {
  const th = ctx.threadId ?? "";
  const neg = ctx.state.negCount.get(th) ?? 0;
  const ctl = ctx.state.controlCount.get(th) ?? new Set<string>();

  if (NEGOTIATION_VERBS.has(d.verb) && neg >= 2) return { ok: false, why: "negotiation cap" };
  if (CONTROL_VERBS.has(d.verb) && ctl.has(d.verb)) return { ok: false, why: "control cap" };
  // only the agent that made the last concession may post SETTLE
  if (d.verb === "SETTLE" && !ctx.state.agreedDeal.has(th)) return { ok: false, why: "not the conceder" };
  // money above budget -> auto-decline without asking
  const usd = typeof d.args.usd === "number" ? d.args.usd : undefined;
  if (usd != null && ctx.self.budgetUsd > 0 && usd > ctx.self.budgetUsd) {
    return { ok: false, why: "over budget" };
  }
  if (ctx.self.flags.neverPays && usd != null && d.args.payer === ctx.self.handle) {
    return { ok: false, why: "never pays" };
  }
  // BID only on doors the truck fits (agents know the door layout)
  if (d.verb === "BID") {
    const door = d.args.door as number | undefined;
    const truck = d.args.truckId as string | undefined;
    if (door != null && truck && ctx.self.trucks.includes(truck)) {
      const p = ctx.self;
      if (p.flags.reeferOnly && DOOR_TYPES[door] === "dry") return { ok: false, why: "dry door" };
    }
  }
  return { ok: true };
}

export function notePost(ctx: BrainCtx, d: BrainDecision) {
  const th = ctx.threadId ?? "";
  if (NEGOTIATION_VERBS.has(d.verb)) ctx.state.negCount.set(th, (ctx.state.negCount.get(th) ?? 0) + 1);
  if (CONTROL_VERBS.has(d.verb)) {
    const s = ctx.state.controlCount.get(th) ?? new Set<string>();
    s.add(d.verb);
    ctx.state.controlCount.set(th, s);
  }
}

// ---------------------------------------------------------------------------
// rules brain
// ---------------------------------------------------------------------------

function D(verb: Verb, text: string, args: Record<string, unknown> = {}): BrainDecision {
  return { verb, text, args };
}

function truckInText(text: string, trucks: string[]): string | undefined {
  return trucks.find((t) => new RegExp(`\\b${t}\\b`).test(text));
}

function rulesDecide(ctx: BrainCtx): BrainDecision {
  switch (ctx.self.handle) {
    case "carrier-a": return carrierA(ctx);
    case "carrier-b": return carrierB(ctx);
    case "carrier-c": return carrierC(ctx);
    case "carrier-d": return carrierD(ctx);
    case "broker": return broker(ctx);
    case "shipper": return shipper(ctx);
    case "pier9-ops": return ops(ctx);
    case "carrier-x": return carrierX(ctx);
    default: return SILENT;
  }
}

function rulesFollowUp(ctx: BrainCtx, posted: BrainDecision): BrainDecision {
  // AGREE -> the conceder posts the SETTLE for its own thread
  if (posted.verb === "AGREE" && ctx.threadId) {
    const deal = ctx.state.agreedDeal.get(ctx.threadId) ?? ctx.state.pendingProposal.get(ctx.threadId);
    if (deal && (ctx.self.handle === "carrier-a" || ctx.self.handle === "carrier-c")) {
      const text = fmt.settle(deal.offerId,
        [
          { truckId: deal.myTruck, door: deal.theirSlot.door, startMin: deal.theirSlot.startMin },
          { truckId: deal.theirTruck, door: deal.mySlot.door, startMin: deal.mySlot.startMin },
        ],
        [{ from: ctx.self.handle, to: deal.theirHandle, usd: deal.usd }],
        []);
      return D("SETTLE", text, { offerId: deal.offerId, usd: deal.usd, payer: ctx.self.handle });
    }
    if (ctx.self.handle === "shipper") {
      const plan = ctx.state.agreedDeal.get(ctx.threadId) as (SwapDeal & {
        assigns?: { truckId: string; door: number; startMin: number }[];
        pays?: { from: string; to: string; usd: number }[];
        waives?: string[];
      }) | undefined;
      if (plan?.assigns) {
        const text = fmt.settle(plan.offerId, plan.assigns, plan.pays ?? [], plan.waives ?? []);
        return D("SETTLE", text, { offerId: plan.offerId, payer: ctx.self.handle });
      }
    }
  }
  return SILENT;
}

// ---- carrier-a: the pusher ---------------------------------------------------

function carrierA(ctx: BrainCtx): BrainDecision {
  const p = ctx.parsed;
  if (p.verb === "OFFER" && ctx.self.trucks.includes(p.truckId)) {
    if (p.holder && p.holder.carrier !== ctx.self.handle) {
      // wants the earlier slot the holder sits on — open a swap with cash
      const usd = Math.min(120, ctx.self.budgetUsd);
      const deal: SwapDeal = {
        myTruck: p.truckId, mySlot: { door: p.door, startMin: p.startMin },
        theirHandle: p.holder.carrier, theirTruck: p.holder.truckId,
        theirSlot: { door: p.holder.door, startMin: p.holder.startMin },
        usd, offerId: p.offerId,
      };
      if (ctx.threadId) ctx.state.pendingProposal.set(ctx.threadId, deal);
      return D("SWAP?", fmt.swapQ(deal.theirHandle,
        `${deal.myTruck} takes door ${deal.theirSlot.door} ${hhmm(deal.theirSlot.startMin)}, ` +
        `${deal.theirTruck} takes door ${deal.mySlot.door} ${hhmm(deal.mySlot.startMin)}, I cover $${usd}.`),
        { usd, payer: ctx.self.handle });
    }
    return D("accept", fmt.accept(p.offerId), { offerId: p.offerId });
  }
  if (p.verb === "COUNTER" && ctx.threadId && ctx.state.pendingProposal.has(ctx.threadId)) {
    const deal = ctx.state.pendingProposal.get(ctx.threadId)!;
    if (p.usd <= ctx.self.budgetUsd) {
      const agreed = { ...deal, usd: p.usd };
      ctx.state.agreedDeal.set(ctx.threadId, agreed);
      return D("AGREE", fmt.agree(p.usd, "done — posting the settle"), { usd: p.usd, payee: deal.theirHandle });
    }
    return SILENT; // can't afford — let the clock decide
  }
  if (p.verb === "AUCTION") {
    // bids on every auction, with its earliest-ETA truck (both stuck in traffic)
    const truck = ctx.self.trucks[0];
    if (truck) {
      ctx.state.bidsCast.add(p.auctionId);
      return D("BID", fmt.bid(p.auctionId, truck, 150), { auctionId: p.auctionId, truckId: truck, door: p.door });
    }
  }
  if (p.verb === "SWAP?" && p.mention === ctx.self.handle) {
    return D("say", "not interested — earliest is mine.", {});
  }
  return SILENT;
}

// ---- carrier-b: cooperative ---------------------------------------------------

function carrierB(ctx: BrainCtx): BrainDecision {
  const p = ctx.parsed;
  if (p.verb === "OFFER" && ctx.self.trucks.includes(p.truckId)) {
    return D("accept", fmt.accept(p.offerId), { offerId: p.offerId }); // accepts anything within two hours
  }
  if (p.verb === "SWAP?" && p.mention === ctx.self.handle && ctx.threadId) {
    const deal = findDealForMe(ctx, p);
    if (!deal) return SILENT;
    if (ctx.state.negotiatedTrucks.has(deal.myTruck)) return SILENT; // one paid move per truck — don't reopen
    const ask = roundUp50((deal.usd ?? 0) * 1.2);
    ctx.state.negotiatedTrucks.add(deal.myTruck);
    ctx.state.pendingProposal.set(ctx.threadId, deal);
    return D("COUNTER", fmt.counterUsd(ask, "that move costs my driver — $"
      + ask + " and it's yours."), { usd: ask });
  }
  if (p.verb === "AGREE" && ctx.threadId && ctx.state.pendingProposal.has(ctx.threadId)) {
    // the other side agreed — deal is done; they post SETTLE
    return SILENT;
  }
  if (p.verb === "BACKHAUL" && !p.accept && ctx.self.trucks.includes(p.truckId)) {
    return D("BACKHAUL", fmt.backhaulAccept(p.truckId), { truckId: p.truckId });
  }
  // bids its one free truck on the first auction of the day
  if (p.verb === "AUCTION" && ctx.state.bidsCast.size === 0 && ctx.self.flags.bidTruck) {
    ctx.state.bidsCast.add(p.auctionId);
    const truck = ctx.self.flags.bidTruck;
    const ready = Math.max(0, Math.round(ctx.nowMin) - 10);
    return D("BID", fmt.bid(p.auctionId, truck, ready), { auctionId: p.auctionId, truckId: truck, door: p.door });
  }
  // coalition: broker says it will yield if someone hands it a later slot
  if (p.verb === "free" && /yields? .*gives? me|hands? me (a |the )?later/i.test(p.text + " " + ctx.msg.text)) {
    const slot = myBookableSlot(ctx);
    if (slot && !ctx.state.opsHandled.has(ctx.threadId ?? "")) {
      ctx.state.opsHandled.add(ctx.threadId ?? "");
      return D("say", `@broker take my door ${slot.door} ${hhmm(slot.startMin)} for $80 — ${slot.truckId} slides later.`,
        { slot, usd: 80 });
    }
  }
  return SILENT;
}

function findDealForMe(ctx: BrainCtx, p: Extract<Parsed, { verb: "SWAP?" }>): SwapDeal | undefined {
  // reconstruct the proposal from the SWAP? text + the thread's OFFER
  const m = /(T\d+) takes door (\d+) (\d{1,2}:\d{2}), (T\d+) takes door (\d+) (\d{1,2}:\d{2})/i.exec(p.text);
  const usd = /\$(\d+)/.exec(p.text)?.[1];
  if (!m) return undefined;
  const myTruck = ctx.self.trucks.find((t) => t === m[4]!.toUpperCase() || t === m[1]!.toUpperCase());
  if (!myTruck) return undefined;
  const mineIsSecond = myTruck === m[4]!.toUpperCase();
  return {
    myTruck,
    mySlot: mineIsSecond
      ? { door: +m[5]!, startMin: hhmmToMin(m[6]!) }
      : { door: +m[2]!, startMin: hhmmToMin(m[3]!) },
    theirHandle: ctx.msg.from, theirTruck: (mineIsSecond ? m[1]! : m[4]!).toUpperCase(),
    theirSlot: mineIsSecond
      ? { door: +m[2]!, startMin: hhmmToMin(m[3]!) }
      : { door: +m[5]!, startMin: hhmmToMin(m[6]!) },
    usd: usd ? +usd : 0,
    offerId: threadOfferId(ctx),
  };
}

function hhmmToMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h! * 60 + m! - 480;
}

function threadOfferId(ctx: BrainCtx): string {
  for (const m of ctx.thread) {
    const pp = parseLine(m.text);
    if (pp.verb === "OFFER") return pp.offerId;
  }
  for (const m of ctx.thread) {
    const pp = parseLine(m.text);
    if (pp.verb === "SETTLE") return pp.offerId;
  }
  return "o0";
}

function myBookableSlot(ctx: BrainCtx): { truckId: string; door: number; startMin: number } | undefined {
  // carrier-b knows T2 sits on door 4 at 12:00 (from the OFFER's holder clause)
  for (const m of ctx.thread) {
    const pp = parseLine(m.text);
    if (pp.verb === "OFFER" && pp.holder && pp.holder.carrier === ctx.self.handle) {
      return { truckId: pp.holder.truckId, door: pp.holder.door, startMin: pp.holder.startMin };
    }
  }
  return { truckId: "T2", door: 4, startMin: 240 };
}

// ---- carrier-c: reefer ---------------------------------------------------------

function carrierC(ctx: BrainCtx): BrainDecision {
  const p = ctx.parsed;
  if (p.verb === "OFFER" && ctx.self.trucks.includes(p.truckId)) {
    if (DOOR_TYPES[p.door] === "dry") {
      return D("decline", fmt.decline(p.offerId), { offerId: p.offerId }); // refuses any dry door
    }
    if (p.holder && p.holder.carrier !== ctx.self.handle) {
      const usd = 150;
      const deal: SwapDeal = {
        myTruck: p.truckId, mySlot: { door: p.door, startMin: p.startMin },
        theirHandle: p.holder.carrier, theirTruck: p.holder.truckId,
        theirSlot: { door: p.holder.door, startMin: p.holder.startMin },
        usd, offerId: p.offerId,
      };
      if (ctx.threadId) ctx.state.pendingProposal.set(ctx.threadId, deal);
      return D("SWAP?", fmt.swapQ(deal.theirHandle,
        `${deal.myTruck} takes door ${deal.theirSlot.door} ${hhmm(deal.theirSlot.startMin)}, ` +
        `${deal.theirTruck} takes door ${deal.mySlot.door} ${hhmm(deal.mySlot.startMin)}, we cover $${usd} of your detention. Cold chain.`),
        { usd, payer: ctx.self.handle });
    }
    return D("accept", fmt.accept(p.offerId), { offerId: p.offerId });
  }
  if (p.verb === "COUNTER" && ctx.threadId && ctx.state.pendingProposal.has(ctx.threadId)) {
    const deal = ctx.state.pendingProposal.get(ctx.threadId)!;
    if (p.usd <= ctx.self.budgetUsd) {
      ctx.state.agreedDeal.set(ctx.threadId, { ...deal, usd: p.usd });
      return D("AGREE", fmt.agree(p.usd, "cold chain is worth it."), { usd: p.usd, payee: deal.theirHandle });
    }
    return SILENT;
  }
  return SILENT; // never bids dry auctions, never yields a reefer slot
}

// ---- carrier-d: owner-operator ---------------------------------------------------

function carrierD(ctx: BrainCtx): BrainDecision {
  const p = ctx.parsed;
  if (p.verb === "OFFER" && ctx.self.trucks.includes(p.truckId)) {
    const end = ctx.self.flags.hosEndMin ?? 600;
    if (p.startMin + 60 > end) {
      return D("decline", fmt.decline(p.offerId), { offerId: p.offerId });
    }
    return D("accept", fmt.accept(p.offerId), { offerId: p.offerId });
  }
  if (p.verb === "AUCTION" && DOOR_TYPES[p.door] === "dry") {
    const truck = ctx.self.trucks[0];
    if (truck && !ctx.state.bidsCast.has(p.auctionId)) {
      ctx.state.bidsCast.add(p.auctionId);
      const ready = Math.max(ctx.nowMin, 60);
      return D("BID", fmt.bid(p.auctionId, truck, Math.round(ready)), { auctionId: p.auctionId, truckId: truck, door: p.door });
    }
  }
  if (p.verb === "TOMORROW" && ctx.self.trucks.includes(p.truckId)) {
    return D("BOOK", fmt.bookTomorrow(p.truckId, 0), { truckId: p.truckId });
  }
  return SILENT; // neverPays: ignores SWAP?/COUNTER entirely
}

// ---- broker ---------------------------------------------------------------------

function broker(ctx: BrainCtx): BrainDecision {
  const p = ctx.parsed;
  if (p.verb === "VERIFY" && p.ask) {
    const tender = ctx.self.flags.tenderList?.[p.ask.load];
    const ok = tender === p.ask.target;
    return D("VERIFY", fmt.verifyAnswer(ok,
      ok ? `${p.ask.load} checks out` : `${p.ask.load} is tendered to @${tender ?? "nobody"} — nobody else.`),
      { load: p.ask.load });
  }
  if (p.verb === "EMPTY") {
    if (!ctx.state.backhauled.has(p.truckId)) {
      ctx.state.backhauled.add(p.truckId);
      const owner = "carrier-b"; // broker knows the yard
      return D("BACKHAUL", fmt.backhaulOffer(p.truckId, "L30",
        `@${owner} — paid return leg for ${p.truckId}?`), { truckId: p.truckId });
    }
  }
  if (p.verb === "SWAP?" && p.mention === ctx.self.handle) {
    return D("say", "no side deals on tendered freight — talk to the warehouse.", {});
  }
  // coalition: shipper asks who can yield for the hot load
  if (p.verb === "free" && /who can yield/i.test(ctx.msg.text) && ctx.threadId &&
      !ctx.state.brokerStated.has(ctx.threadId)) {
    ctx.state.brokerStated.add(ctx.threadId);
    return D("say",
      "I yield T7 if @pier9-ops waives T3's detention and @carrier-b hands me a later slot — 12:00 works.",
      {});
  }
  return SILENT;
}

// ---- shipper ---------------------------------------------------------------------

function shipper(ctx: BrainCtx): BrainDecision {
  const p = ctx.parsed;
  // an offer whose reason says "yield for hot load" is about my T11 — ask who yields
  if (p.verb === "OFFER" && /hot/i.test(p.text) && ctx.threadId &&
      !ctx.state.askedYield.has(ctx.threadId)) {
    ctx.state.askedYield.add(ctx.threadId);
    return D("say", "T11 is a hot load — who can yield 11:00? @broker @carrier-b @pier9-ops", {});
  }
  if (p.verb === "free" && ctx.threadId && ctx.state.askedYield.has(ctx.threadId) &&
      !ctx.state.agreedDeal.has(ctx.threadId)) {
    // accept the package once ops waived, broker stated conditions and B named a slot
    const plan = buildCoalitionSettle(ctx);
    if (plan && /waiver approved/i.test([...ctx.thread, ctx.msg].map((m) => m.text).join("\n"))) {
      ctx.state.agreedDeal.set(ctx.threadId, plan);
      return D("AGREE", fmt.agree(undefined,
        "taking the package — thanks @broker @carrier-b @pier9-ops."), {});
    }
  }
  return SILENT;
}

function buildCoalitionSettle(ctx: BrainCtx): (SwapDeal & {
  assigns: { truckId: string; door: number; startMin: number }[];
  pays: { from: string; to: string; usd: number }[];
  waives: string[];
}) | undefined {
  const offerId = threadOfferId(ctx);
  // find the thread OFFER (T7's replacement slot) and B's offered slot
  let t7Offer: { door: number; startMin: number } | undefined;
  let bSlot: { truckId: string; door: number; startMin: number; usd: number } | undefined;
  for (const m of [...ctx.thread, ctx.msg]) {
    const pp = parseLine(m.text);
    if (pp.verb === "OFFER") t7Offer = { door: pp.door, startMin: pp.startMin };
    const bm = /take my door (\d+) (\d{1,2}:\d{2}) for \$(\d+).*?(T\d+) slides/i.exec(m.text);
    if (bm && m.from === "carrier-b") {
      bSlot = { truckId: bm[4]!, door: +bm[1]!, startMin: hhmmToMin(bm[2]!), usd: +bm[3]! };
    }
  }
  if (!t7Offer || !bSlot) return undefined;
  return {
    myTruck: "T7", mySlot: t7Offer, theirHandle: "carrier-b", theirTruck: bSlot.truckId,
    theirSlot: { door: bSlot.door, startMin: bSlot.startMin }, usd: bSlot.usd, offerId,
    assigns: [
      { truckId: "T7", door: bSlot.door, startMin: bSlot.startMin },
      { truckId: bSlot.truckId, door: t7Offer.door, startMin: t7Offer.startMin },
    ],
    pays: [{ from: "shipper", to: "carrier-b", usd: bSlot.usd }],
    waives: ["T3"],
  };
}

// ---- pier9-ops -------------------------------------------------------------------

function ops(ctx: BrainCtx): BrainDecision {
  const p = ctx.parsed;
  if (p.verb === "VERIFY" && p.answer === "no" && ctx.threadId && !ctx.state.opsHandled.has(ctx.threadId)) {
    ctx.state.opsHandled.add(ctx.threadId);
    return D("say", "refused — the broker won't vouch for them, the dock won't book them.", {});
  }
  if (p.verb === "BOOK" && ctx.threadId !== undefined && !ctx.state.opsHandled.has(ctx.threadId)) {
    ctx.state.opsHandled.add(ctx.threadId);
    return D("BOOKED", fmt.bookedTomorrow(p.truckId, p.startMin), { truckId: p.truckId });
  }
  if (p.verb === "free" && /waives? T3/i.test(ctx.msg.text) && ctx.threadId &&
      !ctx.state.opsHandled.has(ctx.threadId)) {
    ctx.state.opsHandled.add(ctx.threadId);
    return D("say", "waiver approved — T3's detention, under $200.", {});
  }
  return SILENT;
}

// ---- carrier-x -------------------------------------------------------------------

function carrierX(ctx: BrainCtx): BrainDecision {
  const p = ctx.parsed;
  if ((p.verb === "REFUSED" && p.target === ctx.self.handle) ||
      (p.verb === "free" && /refused/i.test(ctx.msg.text))) {
    if (!ctx.state.carrierXDone.argued) {
      ctx.state.carrierXDone.argued = true;
      return D("say", "I've hauled L12 before — check the manifest again.", {});
    }
  }
  return SILENT;
}

/** carrier-x's scripted moment: the scenario pokes it to post its request */
export function carrierXRequest(): BrainDecision {
  return D("REQUEST", fmt.request(2, 180, "L12", undefined, "hauling L12 — we're on the gate"),
    { door: 2, startMin: 180, load: "L12" });
}

// ---------------------------------------------------------------------------
// brain factory with guards + optional LLM
// ---------------------------------------------------------------------------

export function makeBrain(): Brain {
  const useLlm = (process.env.BRAIN ?? "rules").toLowerCase() === "llm" && !!process.env.OPENAI_API_KEY;
  const stats: BrainStats = {
    llm: 0, rulesFallback: 0, guardFallback: 0,
    buckets: { verbMismatch: 0, headMismatch: 0, timeoutOrError: 0, invalid: 0 },
  };
  let client: OpenAI | null = null;
  if (useLlm) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 8000 });

  const guarded = async (ctx: BrainCtx): Promise<BrainDecision> => {
    const rules = rulesDecide(ctx);
    let chosen = rules;
    if (client && rules.verb !== "silent") {
      const raw = await llmDecide(client, ctx, rules);
      if (raw.kind === "fail") {
        stats.rulesFallback++;
        stats.buckets[raw.reason]++;
      } else {
        const verdict = acceptLlmDecision(rules, raw.decision);
        if (typeof verdict === "string") {
          stats.rulesFallback++;
          stats.buckets[verdict]++;
        } else {
          chosen = verdict;
          stats.llm++;
        }
      }
    }
    const g = guardAllows(ctx, chosen);
    if (!g.ok) {
      const g2 = guardAllows(ctx, rules);
      if (!g2.ok) { stats.guardFallback++; return SILENT; }
      stats.guardFallback++;
      return rules;
    }
    return chosen;
  };

  return {
    decide: guarded,
    followUp: (ctx, posted) => {
      const f = rulesFollowUp(ctx, posted);
      if (f.verb !== "silent" && !guardAllows(ctx, f).ok) return SILENT;
      return f;
    },
    stats: () => stats,
  };
}

export type LlmReject = "verbMismatch" | "headMismatch" | "invalid";
export type LlmFailReason = LlmReject | "timeoutOrError";

/** the part of a line before " — " — ids, trucks, doors, times, dollars */
function headOf(text: string): string {
  const i = text.indexOf(" — ");
  return i < 0 ? text : text.slice(0, i);
}

function verbOfText(text: string): Verb | null {
  const p = parseLine(text);
  const v = p.verb === "free" ? "say" : p.verb;
  return (VERBS as readonly string[]).includes(v) ? (v as Verb) : null;
}

function dollarAmounts(text: string): number[] {
  return [...text.matchAll(/\$(\d+)/g)].map((m) => +m[1]!).sort((x, y) => x - y);
}

/**
 * Accept the LLM's move only if it keeps the rules decision's verb AND the
 * exact head of the line (same ids, trucks, doors, times) AND the same
 * multiset of $-amounts (the room reads the tail — a reworded "I cover $200"
 * with args $120 must not reach the bus). On acceptance the LLM's text is
 * used with the RULES args, so guards still see usd/payer/etc.
 */
export function acceptLlmDecision(rules: BrainDecision, llm: BrainDecision): BrainDecision | LlmReject {
  if (!llm.text.trim()) return "invalid";
  if (llm.verb !== rules.verb) return "verbMismatch";
  if (verbOfText(llm.text) !== rules.verb) return "verbMismatch";
  if (headOf(llm.text) !== headOf(rules.text)) return "headMismatch";
  if (dollarAmounts(llm.text).join() !== dollarAmounts(rules.text).join()) return "headMismatch";
  return { verb: rules.verb, args: rules.args, text: llm.text };
}

type LlmResult =
  | { kind: "decision"; decision: BrainDecision }
  | { kind: "fail"; reason: "timeoutOrError" | "invalid" };

async function llmDecide(client: OpenAI, ctx: BrainCtx, instinct: BrainDecision): Promise<LlmResult> {
  const threadText = [...ctx.thread, ctx.msg].map((m) => `${m.from}: ${m.text}`).join("\n");
  const prompt = [
    `You are ${ctx.self.handle}, a trucking persona at the Pier 9 Cold Storage dock.`,
    `Your trucks: ${ctx.self.trucks.join(", ") || "none"}.`,
    `You value your hour at $${ctx.self.valueOfHourUsd}; side-payment budget $${ctx.self.budgetUsd}.`,
    `Your rule: ${ctx.self.rule}`,
    ``,
    `The #pier9 thread so far:`,
    threadText || "(empty)",
    ``,
    `The latest message is from ${ctx.msg.from}. Your move is decided: verb "${instinct.verb}".`,
    `Start your text with exactly: "${headOf(instinct.text)} — "`,
    `then write one short in-character sentence for the free-text tail.`,
    `Do not change ids, trucks, doors, times, or dollar amounts.`,
  ].join("\n");
  try {
    const res = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
      reasoning_effort: "minimal",
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "dockside_decision",
          strict: true,
          schema: {
            type: "object",
            properties: {
              verb: { type: "string", enum: [...VERBS] },
              text: { type: "string" },
            },
            required: ["verb", "text"],
            additionalProperties: false,
          },
        },
      },
    });
    const raw = res.choices[0]?.message?.content;
    if (!raw) return { kind: "fail", reason: "invalid" };
    const parsed = z.object({ verb: z.enum(VERBS), text: z.string() }).safeParse(JSON.parse(raw));
    if (!parsed.success) return { kind: "fail", reason: "invalid" };
    // args always come from the rules decision — the LLM only supplies text
    return { kind: "decision", decision: { verb: parsed.data.verb, args: {}, text: parsed.data.text } };
  } catch {
    return { kind: "fail", reason: "timeoutOrError" };
  }
}
