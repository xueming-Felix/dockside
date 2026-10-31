import { DETENTION_FREE_MIN, type Appt } from "../../shared/types"

/** The colour class of an appointment on the board; the carrier tabs reuse it so a truck row matches its block. */
export function blockClass(a: Appt, sim: number, expected: Set<string>): string {
  if (a.status === "done") return "done"
  if (a.status === "noshow") return "noshow"
  if (a.status === "arrived" || a.status === "unloading") return a.arrivedMin !== undefined && sim >= a.arrivedMin + DETENTION_FREE_MIN ? "detention" : "arrived"
  return sim > a.startMin + 5 && expected.has(a.truckId) ? "late" : "booked"
}

// The word printed inside a block for the states a colour alone doesn't explain on a projector.
export const STATUS_WORD: Record<string, string> = { noshow: "no-show", detention: "detention", late: "late", done: "done" }

/** Which verb a chat line opens with, for the coloured left border (#pier9 feed and the Relay inbox alike). */
export function lineKind(text: string): string {
  if (/^SETTLE\b/.test(text)) return "settle"
  if (/^REJECTED\b/.test(text)) return "rejected"
  if (/^(OFFER|AUCTION|VERIFY)\b/.test(text)) return "post"
  if (/^(SWAP\?|COUNTER|AGREE|BID)\b/.test(text)) return "deal"
  if (/^(accept|counter|decline)\b/i.test(text)) return "answer"
  return ""
}
