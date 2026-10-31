// shared/types.ts
export type DoorType = "dry" | "reefer"
export type Door  = { id: number; type: DoorType; open: boolean }
export type Truck = { id: string; carrier: string; load: string; type: DoorType;
                     priority: 0 | 1 | 2; etaMin: number; hosLimitMin?: number }
export type Appt  = { truckId: string; door: number; startMin: number;
                     status: "booked" | "arrived" | "unloading" | "done" | "noshow" | "tomorrow" }
export type Offer = { id: string; truckId: string; carrier: string; door: number; startMin: number;
                     reason: string; status: "open" | "accepted" | "countered" | "declined" | "expired" }
export type Claim = { truckId: string; carrier: string; minutes: number; amount: number;
                     status: "filed" | "approved" | "waived" }
export type Auction = { id: string; door: number; startMin: number; closesMin: number;
                       bids: { truckId: string; readyMin: number }[]; winner?: string }
export type Thread  = { id: string; offerId: string; deadlineMin: number;
                       status: "open" | "settled" | "expired" }
export type Chat  = { seq: number; atMin: number; from: string; to: string; thread?: string; text: string }
export type Event = { seq: number; atMin: number; kind:
  "collision" | "replanned" | "offer" | "noshow" | "detention" | "tomorrow" | "empty" | "hot" |
  "swap" | "overrun" | "auction_open" | "auction_closed" | "thread_expired" | "refused";
  truckId?: string; offerId?: string; auctionId?: string; threadId?: string; detail: string }
export type Snapshot = { simMin: number; speed: number; doors: Door[]; trucks: Truck[];
  appts: Appt[]; offers: Offer[]; auctions: Auction[]; threads: Thread[]; claims: Claim[];
  chatter: Chat[]; events: Event[];
  counters: { detentionAvoidedUsd: number; sidePaymentsUsd: number; phoneCalls: 0;
              moves: number; backhauls: number } }
