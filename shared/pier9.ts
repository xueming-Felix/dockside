// shared/pier9.ts — the default Pier 9 Cold Storage day. seed(PIER9) loads it; the scenario runner may tune it.
// Doors 1-4 dry, 5-6 reefer. 12 trucks booked 08:00 to 13:00. Sim minutes count from 08:00.
//
// Layout (door: slot → truck):
//   1 dry:    08:00 T3 (broker)   10:00 T4 (carrier-a)   11:00 T7 (broker)     12:00 T11 (shipper, hot load L17 at key 7)
//   2 dry:    09:00 T1 (carrier-a) 11:00 T2 (carrier-b)   12:00 T6 (carrier-b, can be at the gate by 08:50: bids in act 2)
//   3 dry:    11:00 T12 (carrier-b, the no-show)          13:00 T8 (carrier-d, hours end 15:30)
//   4 dry:    free: key 1's two requests collide here at 14:00
//   5 reefer: 10:00 T5 (carrier-c): key 4 closes this door (PLAN said door 3, but T5 is a reefer load)
//   6 reefer: 09:00 T10 (carrier-c) 10:00 T9 (carrier-b, the slot carrier-c wants after door 5 goes down)
import type { Scenario } from "./types.js"

export const PIER9: Scenario = {
  doors: [
    { id: 1, type: "dry", open: true },
    { id: 2, type: "dry", open: true },
    { id: 3, type: "dry", open: true },
    { id: 4, type: "dry", open: true },
    { id: 5, type: "reefer", open: true },
    { id: 6, type: "reefer", open: true },
  ],
  trucks: [
    { id: "T1", carrier: "carrier-a", load: "L1", type: "dry", priority: 0, etaMin: 60 },
    { id: "T2", carrier: "carrier-b", load: "L2", type: "dry", priority: 0, etaMin: 180 },
    { id: "T3", carrier: "broker", load: "L3", type: "dry", priority: 0, etaMin: 0 },
    { id: "T4", carrier: "carrier-a", load: "L4", type: "dry", priority: 0, etaMin: 120 },
    { id: "T5", carrier: "carrier-c", load: "L5", type: "reefer", priority: 0, etaMin: 120 },
    { id: "T6", carrier: "carrier-b", load: "L6", type: "dry", priority: 0, etaMin: 50 },
    { id: "T7", carrier: "broker", load: "L7", type: "dry", priority: 0, etaMin: 180 },
    { id: "T8", carrier: "carrier-d", load: "L8", type: "dry", priority: 0, etaMin: 70, hosLimitMin: 450 },
    { id: "T9", carrier: "carrier-b", load: "L9", type: "reefer", priority: 0, etaMin: 120 },
    { id: "T10", carrier: "carrier-c", load: "L10", type: "reefer", priority: 0, etaMin: 60 },
    { id: "T11", carrier: "shipper", load: "L17", type: "dry", priority: 0, etaMin: 180 },
    { id: "T12", carrier: "carrier-b", load: "L12", type: "dry", priority: 0, etaMin: 180 },
  ],
  appts: [
    { truckId: "T3", door: 1, startMin: 0 },
    { truckId: "T4", door: 1, startMin: 120 },
    { truckId: "T7", door: 1, startMin: 180 },
    { truckId: "T11", door: 1, startMin: 240 },
    { truckId: "T1", door: 2, startMin: 60 },
    { truckId: "T2", door: 2, startMin: 180 },
    { truckId: "T6", door: 2, startMin: 240 },
    { truckId: "T12", door: 3, startMin: 180 },
    { truckId: "T8", door: 3, startMin: 300 },
    { truckId: "T5", door: 5, startMin: 120 },
    { truckId: "T10", door: 6, startMin: 60 },
    { truckId: "T9", door: 6, startMin: 120 },
  ],
  startMin: 0,
  speed: 60,
}
