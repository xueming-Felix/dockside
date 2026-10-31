// Relay message grammar — one regex per verb, pure functions both ways.
// First token of a line is the verb; text after " — " (em dash; " - " also
// accepted on parse) is free text shown in the chatter feed.

import { hhmm, parseHHMM } from "./clock.js";

export type SettleAssign = { truckId: string; door: number; startMin: number };
export type SettlePay = { from: string; to: string; usd: number };

export type Parsed =
  | { verb: "OFFER"; offerId: string; truckId: string; door: number; startMin: number;
      holder?: { carrier: string; truckId: string; door: number; startMin: number };
      closesMin?: number; text: string }
  | { verb: "AUCTION"; auctionId: string; door: number; startMin: number; closesMin?: number; text: string }
  | { verb: "AWARDED"; auctionId: string; truckId: string; door: number; startMin: number; text: string }
  | { verb: "VERIFY"; ask?: { target: string; load: string }; answer?: "yes" | "no"; text: string }
  | { verb: "REJECTED"; offerId: string; text: string }
  | { verb: "CONFIRMED"; offerId: string; text: string }
  | { verb: "REFUSED"; target: string; text: string }
  | { verb: "EXPIRED"; offerId: string; truckId?: string; door?: number; startMin?: number; text: string }
  | { verb: "EMPTY"; truckId: string; door?: number; text: string }
  | { verb: "TOMORROW"; truckId: string; text: string }
  | { verb: "SWAP?"; mention?: string; text: string }
  | { verb: "COUNTER"; usd: number; text: string }
  | { verb: "AGREE"; usd?: number; text: string }
  | { verb: "SETTLE"; offerId: string; assigns: SettleAssign[]; pays: SettlePay[]; waives: string[]; text: string }
  | { verb: "BID"; auctionId: string; truckId: string; readyMin: number; text: string }
  | { verb: "accept"; offerId: string; text: string }
  | { verb: "counter"; offerId: string; door: number; startMin: number; text: string }
  | { verb: "decline"; offerId: string; text: string }
  | { verb: "REQUEST"; truckId?: string; door: number; startMin: number; load?: string; text: string }
  | { verb: "BACKHAUL"; truckId: string; load?: string; accept: boolean; text: string }
  | { verb: "BOOK"; truckId: string; startMin: number; text: string }
  | { verb: "BOOKED"; truckId: string; startMin: number; text: string }
  | { verb: "free"; text: string };

const T = String.raw`T\d+`;          // truck id
const H = String.raw`\d{1,2}:\d{2}`; // HH:MM
const ID = String.raw`[a-z]+\d+`;    // o21 / a3 / t4 ids
const HDL = String.raw`[a-z0-9-]+`;  // handle without @

// Split "HEAD — free text" on em dash or " - ". Returns [head, text].
function splitDash(line: string): [string, string] {
  const m = /\s[—–-]\s/.exec(line);
  if (!m) return [line.trim(), ""];
  return [line.slice(0, m.index).trim(), line.slice(m.index + m[0].length).trim()];
}

function mentionsOf(line: string): string[] {
  return [...line.matchAll(/@([a-z0-9-]+)/gi)].map((m) => m[1]!.toLowerCase());
}

export function parseLine(raw: string): Parsed {
  const line = raw.trim();
  const [head, text] = splitDash(line);
  let m: RegExpExecArray | null;

  if ((m = new RegExp(`^OFFER (${ID}) truck (${T}) door (\\d+) at (${H})$`, "i").exec(head))) {
    const o: Parsed = { verb: "OFFER", offerId: m[1]!, truckId: m[2]!.toUpperCase(), door: +m[3]!,
      startMin: parseHHMM(m[4]!), text };
    const h = /Holder of door (\d+) (\d{1,2}:\d{2}): @([a-z0-9-]+) \((T\d+)\)/i.exec(text);
    if (h) o.holder = { door: +h[1]!, startMin: parseHHMM(h[2]!), carrier: h[3]!.toLowerCase(), truckId: h[4]!.toUpperCase() };
    const c = /Thread closes (\d{1,2}:\d{2})/i.exec(text);
    if (c) o.closesMin = parseHHMM(c[1]!);
    return o;
  }
  if ((m = new RegExp(`^AUCTION (${ID}) door (\\d+) at (${H})$`, "i").exec(head))) {
    const a: Parsed = { verb: "AUCTION", auctionId: m[1]!, door: +m[2]!, startMin: parseHHMM(m[3]!), text };
    const c = /Closes (\d{1,2}:\d{2})/i.exec(text);
    if (c) a.closesMin = parseHHMM(c[1]!);
    return a;
  }
  if ((m = new RegExp(`^AWARDED (${ID}) (${T}) door (\\d+) at (${H})$`, "i").exec(head)))
    return { verb: "AWARDED", auctionId: m[1]!, truckId: m[2]!.toUpperCase(), door: +m[3]!, startMin: parseHHMM(m[4]!), text };
  if ((m = new RegExp(`^AWARDED (${ID}) (${T})$`, "i").exec(head))) {
    const dm = /door (\d+) (\d{1,2}:\d{2})/i.exec(text);
    return { verb: "AWARDED", auctionId: m[1]!, truckId: m[2]!.toUpperCase(),
      door: dm ? +dm[1]! : 0, startMin: dm ? parseHHMM(dm[2]!) : 0, text };
  }
  if ((m = new RegExp(`^VERIFY @(${HDL}) load ([A-Z0-9]+)\\?$`, "i").exec(head)))
    return { verb: "VERIFY", ask: { target: m[1]!.toLowerCase(), load: m[2]!.toUpperCase() }, text };
  if ((m = /^VERIFY (yes|no)$/i.exec(head)))
    return { verb: "VERIFY", answer: m[1]!.toLowerCase() as "yes" | "no", text };
  if ((m = new RegExp(`^REJECTED (${ID})$`, "i").exec(head)))
    return { verb: "REJECTED", offerId: m[1]!, text };
  if ((m = new RegExp(`^CONFIRMED (${ID})$`, "i").exec(head)))
    return { verb: "CONFIRMED", offerId: m[1]!, text };
  if ((m = new RegExp(`^REFUSED @(${HDL})$`, "i").exec(head)))
    return { verb: "REFUSED", target: m[1]!.toLowerCase(), text };
  if ((m = new RegExp(`^EXPIRED (${ID})$`, "i").exec(head))) {
    const e: Parsed = { verb: "EXPIRED", offerId: m[1]!, text };
    const k = new RegExp(`(${T}) keeps door (\\d+) (${H})`, "i").exec(text);
    if (k) { e.truckId = k[1]!.toUpperCase(); e.door = +k[2]!; e.startMin = parseHHMM(k[3]!); }
    return e;
  }
  if ((m = new RegExp(`^EMPTY (${T})$`, "i").exec(head))) {
    const e: Parsed = { verb: "EMPTY", truckId: m[1]!.toUpperCase(), text };
    const d = /door (\d+) free/i.exec(text);
    if (d) e.door = +d[1]!;
    return e;
  }
  if ((m = new RegExp(`^TOMORROW (${T})$`, "i").exec(head)))
    return { verb: "TOMORROW", truckId: m[1]!.toUpperCase(), text };
  if ((m = new RegExp(`^SWAP\\?(?: @(${HDL}))?$`, "i").exec(head)))
    return { verb: "SWAP?", mention: m[1]?.toLowerCase(), text };
  if ((m = /^COUNTER \$(\d+)$/i.exec(head)))
    return { verb: "COUNTER", usd: +m[1]!, text };
  if ((m = /^AGREE(?: \$(\d+))?$/i.exec(head)))
    return { verb: "AGREE", usd: m[1] ? +m[1] : undefined, text };
  if ((m = new RegExp(`^SETTLE (${ID}):\\s*(.*)$`, "i").exec(head))) {
    const assigns: SettleAssign[] = [];
    const pays: SettlePay[] = [];
    const waives: string[] = [];
    for (const part of m[2]!.split("·").map((s) => s.trim()).filter(Boolean)) {
      let p: RegExpExecArray | null;
      if ((p = new RegExp(`^(${T}) door (\\d+) (${H})$`, "i").exec(part)))
        assigns.push({ truckId: p[1]!.toUpperCase(), door: +p[2]!, startMin: parseHHMM(p[3]!) });
      else if ((p = new RegExp(`^pay (${HDL})(?:→|->)(${HDL}) \\$(\\d+)$`, "i").exec(part)))
        pays.push({ from: p[1]!.toLowerCase(), to: p[2]!.toLowerCase(), usd: +p[3]! });
      else if ((p = new RegExp(`^waive (${T})$`, "i").exec(part)))
        waives.push(p[1]!.toUpperCase());
    }
    return { verb: "SETTLE", offerId: m[1]!, assigns, pays, waives, text };
  }
  if ((m = new RegExp(`^BID (${ID}) (${T}) ready (${H})$`, "i").exec(head)))
    return { verb: "BID", auctionId: m[1]!, truckId: m[2]!.toUpperCase(), readyMin: parseHHMM(m[3]!), text };
  if ((m = new RegExp(`^accept (${ID})$`, "i").exec(head)))
    return { verb: "accept", offerId: m[1]!, text };
  if ((m = new RegExp(`^counter (${ID}) door (\\d+) at (${H})$`, "i").exec(head)))
    return { verb: "counter", offerId: m[1]!, door: +m[2]!, startMin: parseHHMM(m[3]!), text };
  if ((m = new RegExp(`^decline (${ID})$`, "i").exec(head)))
    return { verb: "decline", offerId: m[1]!, text };
  if ((m = new RegExp(`^REQUEST(?: (${T}))? door (\\d+) at (${H})(?: load ([A-Z0-9]+))?$`, "i").exec(head)))
    return { verb: "REQUEST", truckId: m[1]?.toUpperCase(), door: +m[2]!, startMin: parseHHMM(m[3]!), load: m[4]?.toUpperCase(), text };
  if ((m = new RegExp(`^BACKHAUL accept (${T})$`, "i").exec(head)))
    return { verb: "BACKHAUL", truckId: m[1]!.toUpperCase(), accept: true, text };
  if ((m = new RegExp(`^BACKHAUL (${T})(?: load ([A-Z0-9]+))?$`, "i").exec(head)))
    return { verb: "BACKHAUL", truckId: m[1]!.toUpperCase(), load: m[2]?.toUpperCase(), accept: false, text };
  if ((m = new RegExp(`^BOOK tomorrow (${T}) (${H})$`, "i").exec(head)))
    return { verb: "BOOK", truckId: m[1]!.toUpperCase(), startMin: parseHHMM(m[2]!), text };
  if ((m = new RegExp(`^BOOKED tomorrow (${T}) (${H})$`, "i").exec(head)))
    return { verb: "BOOKED", truckId: m[1]!.toUpperCase(), startMin: parseHHMM(m[2]!), text };
  return { verb: "free", text: line };
}

export { mentionsOf };

// ---- formatters -------------------------------------------------------------

export const fmt = {
  offer(o: { offerId: string; truckId: string; door: number; startMin: number; reason: string;
             holder?: { carrier: string; truckId: string; door: number; startMin: number };
             closesMin?: number }): string {
    let s = `OFFER ${o.offerId} truck ${o.truckId} door ${o.door} at ${hhmm(o.startMin)} — ${o.reason}.`;
    if (o.holder) s += ` Holder of door ${o.holder.door} ${hhmm(o.holder.startMin)}: @${o.holder.carrier} (${o.holder.truckId}).`;
    if (o.closesMin != null) s += ` Thread closes ${hhmm(o.closesMin)}.`;
    return s;
  },
  auction(a: { auctionId: string; door: number; startMin: number; why: string; closesMin: number }): string {
    return `AUCTION ${a.auctionId} door ${a.door} at ${hhmm(a.startMin)} — ${a.why}. Closes ${hhmm(a.closesMin)}. BID ${a.auctionId} <truck> ready <HH:MM>`;
  },
  verifyAsk(target: string, load: string, why: string): string {
    return `VERIFY @${target} load ${load}? — ${why}`;
  },
  rejected(offerId: string, reason: string): string {
    return `REJECTED ${offerId} — ${reason}`;
  },
  confirmed(offerId: string, summary: string): string {
    return `CONFIRMED ${offerId} — ${summary}`;
  },
  awarded(auctionId: string, truckId: string, door: number, startMin: number): string {
    return `AWARDED ${auctionId} ${truckId} — door ${door} ${hhmm(startMin)}`;
  },
  refused(target: string, why: string): string {
    return `REFUSED @${target} — ${why}`;
  },
  expired(offerId: string, truckId: string, door: number, startMin: number): string {
    return `EXPIRED ${offerId} — the clock decides: ${truckId} keeps door ${door} ${hhmm(startMin)}`;
  },
  empty(truckId: string, door: number): string {
    return `EMPTY ${truckId} — door ${door} free`;
  },
  tomorrow(truckId: string): string {
    return `TOMORROW ${truckId} — slot ends after hours`;
  },
  swapQ(mention: string | undefined, text: string): string {
    return `SWAP?${mention ? ` @${mention}` : ""} — ${text}`;
  },
  counterUsd(usd: number, text: string): string {
    return `COUNTER $${usd} — ${text}`;
  },
  agree(usd: number | undefined, text: string): string {
    return `AGREE${usd != null ? ` $${usd}` : ""} — ${text}`;
  },
  settle(offerId: string, assigns: SettleAssign[], pays: SettlePay[], waives: string[]): string {
    const parts = [
      ...assigns.map((a) => `${a.truckId} door ${a.door} ${hhmm(a.startMin)}`),
      ...pays.map((p) => `pay ${p.from}→${p.to} $${p.usd}`),
      ...waives.map((t) => `waive ${t}`),
    ];
    return `SETTLE ${offerId}: ${parts.join(" · ")}`;
  },
  bid(auctionId: string, truckId: string, readyMin: number): string {
    return `BID ${auctionId} ${truckId} ready ${hhmm(readyMin)}`;
  },
  accept(offerId: string, text = ""): string {
    return `accept ${offerId}${text ? ` — ${text}` : ""}`;
  },
  counterOffer(offerId: string, door: number, startMin: number, text = ""): string {
    return `counter ${offerId} door ${door} at ${hhmm(startMin)}${text ? ` — ${text}` : ""}`;
  },
  decline(offerId: string, text = ""): string {
    return `decline ${offerId}${text ? ` — ${text}` : ""}`;
  },
  request(door: number, startMin: number, load?: string, truckId?: string, text = ""): string {
    return `REQUEST${truckId ? ` ${truckId}` : ""} door ${door} at ${hhmm(startMin)}${load ? ` load ${load}` : ""}${text ? ` — ${text}` : ""}`;
  },
  backhaulOffer(truckId: string, load: string, text = ""): string {
    return `BACKHAUL ${truckId} load ${load}${text ? ` — ${text}` : ""}`;
  },
  backhaulAccept(truckId: string): string {
    return `BACKHAUL accept ${truckId}`;
  },
  bookTomorrow(truckId: string, startMin: number): string {
    return `BOOK tomorrow ${truckId} ${hhmm(startMin)}`;
  },
  bookedTomorrow(truckId: string, startMin: number): string {
    return `BOOKED tomorrow ${truckId} ${hhmm(startMin)}`;
  },
  verifyAnswer(yes: boolean, text: string): string {
    return `VERIFY ${yes ? "yes" : "no"} — ${text}`;
  },
};
