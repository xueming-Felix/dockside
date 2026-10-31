// The eight personas from PLAN's table, as data. The dispatcher identity is
// `dock` and is not a persona.

export type Persona = {
  handle: string;
  trucks: string[];
  valueOfHourUsd: number;
  budgetUsd: number;
  rule: string;
  flags: {
    neverPays?: boolean;        // broker, carrier-d: no side payments
    reeferOnly?: boolean;       // carrier-c: refuses dry doors
    hosEndMin?: number;         // carrier-d: slots must end by this simMin (15:30 = 450)
    bidsEveryAuction?: boolean; // carrier-a
    bidTruck?: string;          // carrier-b: its one uncommitted truck, bid on the first auction
    tenderList?: Record<string, string>; // broker: load -> the only carrier it is tendered to
    coldChain?: boolean;        // carrier-c mentions the cold chain
  };
};

export const PERSONAS: Persona[] = [
  {
    handle: "carrier-a", trucks: ["T1", "T4"], valueOfHourUsd: 120, budgetUsd: 150,
    rule: "Always wants the earliest slot; opens a SWAP with whoever holds it; never yields to anyone; bids on every auction.",
    flags: { bidsEveryAuction: true },
  },
  {
    handle: "carrier-b", trucks: ["T2", "T6", "T9", "T12"], valueOfHourUsd: 60, budgetUsd: 0,
    rule: "Accepts anything within two hours; when offered money to move, counters once for 20% more rounded up to the next $50, then agrees. Never reopens a truck whose deal is already done.",
    flags: { bidTruck: "T6" },
  },
  {
    handle: "carrier-c", trucks: ["T5", "T10"], valueOfHourUsd: 200, budgetUsd: 250,
    rule: "Refuses any dry door outright; opens a SWAP for the earliest reefer slot and pays for it; mentions the cold chain every time.",
    flags: { reeferOnly: true, coldChain: true },
  },
  {
    handle: "carrier-d", trucks: ["T8"], valueOfHourUsd: 90, budgetUsd: 0,
    rule: "Bids on auctions it can reach; if a slot ends after 15:30, declines and asks the warehouse for tomorrow 08:00. No side payments.",
    flags: { neverPays: true, hosEndMin: 450 },
  },
  {
    handle: "broker", trucks: ["T3", "T7"], valueOfHourUsd: 100, budgetUsd: 0,
    rule: "Yields for a hot load only if the warehouse waives T3's detention and someone hands it a later slot; verifies carriers against its tender list; offers a backhaul to any empty truck.",
    flags: { neverPays: true, tenderList: { L12: "carrier-b" } },
  },
  {
    handle: "shipper", trucks: ["T11"], valueOfHourUsd: 300, budgetUsd: 300,
    rule: "Asks the thread who can yield, accepts the broker's package, posts the SETTLE, thanks everyone by name.",
    flags: {},
  },
  {
    handle: "pier9-ops", trucks: [], valueOfHourUsd: 0, budgetUsd: 200,
    rule: "Approves claims and waivers under $200, disputes above; refuses any carrier the broker won't vouch for; books tomorrow slots on request; announces door changes.",
    flags: {},
  },
  {
    handle: "carrier-x", trucks: [], valueOfHourUsd: 0, budgetUsd: 0,
    rule: "Requests door 2 at 11:00 for load L12 once, at the scripted moment; argues once when refused, then goes quiet.",
    flags: {},
  },
];

export const DISPATCHER_HANDLE = "dock";

export function personaByHandle(handle: string): Persona | undefined {
  return PERSONAS.find((p) => p.handle === handle);
}

export function truckOwner(truckId: string): string | undefined {
  return PERSONAS.find((p) => p.trucks.includes(truckId))?.handle;
}
