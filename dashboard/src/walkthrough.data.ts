// Static content for the Walkthrough view: scenarios 1 and 2 as an illustration, step by step.
// Nothing here talks to the actor or to Agent Relay; it is what the live run does, frozen so the presenter can
// point at each beat. Times are sim times; slots are hour slots from 08:00 (startMin 0) to 18:00.

export type Tech = "actor" | "agents" | "alarm" | "dispatcher"
export type MiniSlot = { truck: string; carrier: string; startMin: number; status: "booked" | "pending" | "arrived" | "done"; note?: string; highlight?: boolean }
export type MiniDoor = { id: number; type: "dry" | "reefer"; open: boolean; slots: MiniSlot[] }
export type Bubble = { from: string; to: string; text: string; thread: string; kind?: "offer" | "swap" | "counter" | "agree" | "settle" | "system" }
/** Nodes of the fixed system picture every step animates on. */
export type Node = "carrier-a" | "carrier-b" | "carrier-c" | "pier9-ops" | "dispatcher" | "dock" | "screens"
/** One arrow of a step: who talks to whom, with a short label (≤ 40 chars). kind picks the colour: call = into the actor,
 *  broadcast = out of the actor, post = agent to agent over Relay, settle = the settlement path, timer = the actor's alarm. */
export type Flow = { from: Node; to: Node; label: string; kind: "call" | "broadcast" | "post" | "settle" | "timer" | "mirror" }
export type WalkStep = {
  /** The step as arrows on the fixed picture, in order. */
  flows: Flow[]
  /** Short lines to show as speech bubbles on agent nodes this step (≤ 70 chars each). */
  speech?: { node: Node; text: string }[]
  /** Chips to show inside the dock node this step, e.g. "offer o1 open", "timer th1 08:35". */
  chips?: string[]
  title: string
  tech: Tech
  what: string
  why: string
  /** The actor's side: calls made, events emitted, what it broadcast. Cumulative across steps is built by the view. */
  actor: string[]
  /** The board after this step: only the doors the scenario is about. */
  doors: MiniDoor[]
  /** New messages that land in the agents' inboxes at this step (the view accumulates them). */
  bubbles: Bubble[]
  /** Which inboxes to show side by side. */
  inboxes: [string, string]
  callout?: string
}
export type Background = { stakes: string; cast: { handle: string; wants: string }[]; story: string[] }
export type Walkthrough = { id: string; n: number; title: string; subtitle: string; background: Background; steps: WalkStep[]; outcome: string }

// The opening screen: the setting, before any scenario.
export const SETTING = {
  title: "Pier 9 Cold Storage, one Saturday",
  lede: "A warehouse with six dock doors: four dry, two refrigerated. Twelve trucks are booked between 08:00 and 13:00. Detention costs $75 an hour after two free hours, and the warehouse is the one who pays it.",
  paragraphs: [
    "The dock itself is a Durable Actor on Terse: one object that holds every door, truck, appointment, offer and timer for the day, handles one request at a time, and wakes itself up when a clock runs out.",
    "Every company that wants a door is an agent on Agent Relay: four carriers, a broker, a shipper, the warehouse, and one stranger. They talk to each other in #pier9. The dock never talks to them; a dispatcher mirrors what they say and acts only on settlements, bids and answers to offers.",
    "Today two things go wrong. We follow each one step by step: what the dock does, what the agents say to each other, and why nobody picks up a phone.",
  ],
  cast: [
    { handle: "carrier-a", role: "the pusher", hour: "$120", line: "Always wants the earliest slot and will pay for it." },
    { handle: "carrier-b", role: "cooperative", hour: "$60", line: "Will move later for cash; counters once, then agrees." },
    { handle: "carrier-c", role: "reefer", hour: "$200", line: "Cold chain; refuses dry doors; pays for the earliest reefer slot." },
    { handle: "carrier-d", role: "owner-operator", hour: "$90", line: "Cash-poor; hours end at 15:30." },
    { handle: "broker", role: "trades, never pays", hour: "$100", line: "Vets strangers against its tender list." },
    { handle: "shipper", role: "has the hot load", hour: "$300", line: "Will pay to be unloaded by 11:00." },
    { handle: "pier9-ops", role: "the warehouse", hour: "—", line: "Approves waivers under $200; announces doors and auctions." },
  ],
}

const d4 = (slots: MiniSlot[]): MiniDoor => ({ id: 4, type: "dry", open: true, slots })
const d5 = (open: boolean, slots: MiniSlot[]): MiniDoor => ({ id: 5, type: "reefer", open, slots })
const d6 = (slots: MiniSlot[]): MiniDoor => ({ id: 6, type: "reefer", open: true, slots })

export const WALKTHROUGHS: Walkthrough[] = [
  {
    id: "collision", n: 1, title: "Two trucks, one door",
    subtitle: "Two carriers ask for door 4 at 14:00 in the same instant. The loser buys the slot from the winner.",
    background: {
      stakes: "Afternoon slots on the dry doors are scarce. Whoever gets 14:00 on door 4 unloads before the evening rush; the other waits an hour, and an hour is worth $120 to carrier-a and $60 to carrier-b.",
      cast: [
        { handle: "carrier-a", wants: "the earliest slot, and will pay up to $150 to get it" },
        { handle: "carrier-b", wants: "to be paid if it moves later; it counters once for 20% more, then agrees" },
        { handle: "pier9-ops", wants: "no double bookings and no phone calls" },
      ],
      story: [
        "At 08:05 both carriers' agents ask the dock for door 4 at 14:00 in the same instant. In a spreadsheet world that is a double booking and six phone calls.",
        "The dock is a Durable Actor and handles one request at a time: one truck books, the other gets the next hour and an offer. Then the agents settle it between themselves, in public, in #pier9, with money.",
        "Watch for three things: the dock never double-books, the agents talk to each other and not to us, and the final swap is one atomic call that every screen sees at once.",
      ],
    },
    outcome: "T13 at 14:00, T14 at 15:00, $150 changed hands between the carriers, the dock never double-booked, nobody picked up a phone.",
    steps: [
      {
        title: "carrier-b asks for door 4 at 14:00", tech: "actor",
        flows: [{ from: "carrier-b", to: "dock", label: "request(T14, door 4, 14:00)", kind: "call" }, { from: "dock", to: "screens", label: "snapshot: T14 booked", kind: "broadcast" }],
        chips: ["T14 door 4 14:00 booked"],
        what: "A normal booking. request(carrier-b, T14, door 4, 14:00) reaches the Dock actor; it answers in one call.",
        why: "The dock is the single source of truth for every door. No spreadsheet, no phone.",
        actor: ["← request(carrier-b, T14, door 4, 14:00)", "booked: T14 door 4 14:00", "→ snapshot broadcast to every screen"],
        doors: [d4([{ truck: "T14", carrier: "carrier-b", startMin: 360, status: "booked", highlight: true }])],
        bubbles: [], inboxes: ["carrier-a", "carrier-b"],
      },
      {
        title: "carrier-a asks for the same slot, in the same instant", tech: "actor",
        flows: [{ from: "carrier-a", to: "dock", label: "request(T13, door 4, 14:00)", kind: "call" }, { from: "dock", to: "screens", label: "snapshot: collision · offer o1", kind: "broadcast" }],
        chips: ["one request at a time", "collision: 14:00 is T14's", "offer o1: T13 → 15:00 (open)"],
        what: "request(carrier-a, T13, door 4, 14:00). The actor handles one request at a time, so it sees that 14:00 is already taken and books T13 the next hour with an offer attached.",
        why: "Durable Actor: serialized by construction. Two simultaneous requests can never double-book; the second gets the next slot and an offer, not an error and not a race.",
        actor: ["← request(carrier-a, T13, door 4, 14:00)", "event: collision — door 4 14:00 is held by T14 (carrier-b)", "offer o1 → carrier-a: T13 door 4 15:00 (open)", "event: offer", "→ snapshot broadcast"],
        doors: [d4([{ truck: "T14", carrier: "carrier-b", startMin: 360, status: "booked" }, { truck: "T13", carrier: "carrier-a", startMin: 420, status: "pending", note: "offer o1", highlight: true }])],
        bubbles: [], inboxes: ["carrier-a", "carrier-b"],
        callout: "Dashed border = an offer the carrier has not answered yet.",
      },
      {
        title: "The dock announces the offer in #pier9", tech: "dispatcher",
        flows: [{ from: "dispatcher", to: "dock", label: "openThread(th1, o1, 08:35)", kind: "call" }, { from: "dock", to: "dock", label: "timer th1 → 08:35", kind: "timer" }, { from: "dispatcher", to: "carrier-a", label: "OFFER o1 (names carrier-b)", kind: "post" }],
        speech: [{ node: "pier9-ops", text: "OFFER o1 → carrier-a: T13 door 4 15:00 — 14:00 is held by carrier-b (T14)." }],
        chips: ["offer o1 open", "timer th1 08:35"],
        what: "The dispatcher reads the offer from the actor's snapshot and posts it on Agent Relay, naming who holds the slot carrier-a wanted. A thread opens for this deal, with a deadline timer inside the actor.",
        why: "The offer carries exactly what a human dispatcher would have to look up and phone around for: the slot, the alternative, and who holds it.",
        actor: ["← openThread(th1, o1, deadline 08:35)", "timer armed: thread_deadline 08:35", "→ snapshot broadcast"],
        doors: [d4([{ truck: "T14", carrier: "carrier-b", startMin: 360, status: "booked" }, { truck: "T13", carrier: "carrier-a", startMin: 420, status: "pending", note: "offer o1" }])],
        bubbles: [{ from: "pier9-ops", to: "#pier9", thread: "th1", kind: "offer", text: "OFFER o1 → carrier-a: T13 door 4 15:00 — 14:00 is held by carrier-b (T14). Thread closes 08:35." }],
        inboxes: ["carrier-a", "carrier-b"],
      },
      {
        title: "The loser goes straight to the winner with cash", tech: "agents",
        flows: [{ from: "carrier-a", to: "carrier-b", label: "SWAP? $120", kind: "post" }, { from: "dispatcher", to: "dock", label: "say() mirror only", kind: "mirror" }],
        speech: [{ node: "carrier-a", text: "SWAP? @carrier-b — T13 takes 14:00, T14 takes 15:00, we pay $120." }],
        chips: ["offer o1 open", "timer th1 08:35", "nothing moves"],
        what: "carrier-a's agent replies in the thread, to carrier-b directly: swap the two slots for $120. The dock is not addressed and does not act.",
        why: "Agents negotiate with each other on Agent Relay. The dispatcher only mirrors the line so the room can read it; the dock only listens.",
        actor: ["← say(carrier-a → carrier-b, \"SWAP? …\", th1)   (mirror only; nothing moves)", "→ snapshot broadcast (chatter)"],
        doors: [d4([{ truck: "T14", carrier: "carrier-b", startMin: 360, status: "booked" }, { truck: "T13", carrier: "carrier-a", startMin: 420, status: "pending", note: "offer o1" }])],
        bubbles: [{ from: "carrier-a", to: "carrier-b", thread: "th1", kind: "swap", text: "SWAP? @carrier-b — T13 takes door 4 14:00, T14 takes 15:00, we pay $120." }],
        inboxes: ["carrier-a", "carrier-b"],
      },
      {
        title: "Counter, then agree", tech: "agents",
        flows: [{ from: "carrier-b", to: "carrier-a", label: "COUNTER $150", kind: "post" }, { from: "carrier-a", to: "carrier-b", label: "AGREE $150", kind: "post" }, { from: "dispatcher", to: "dock", label: "say() mirror only", kind: "mirror" }],
        speech: [{ node: "carrier-b", text: "COUNTER $150 — 15:00 costs us a driver swap." }, { node: "carrier-a", text: "AGREE $150." }],
        chips: ["offer o1 open", "timer th1 08:35", "2 messages each: cap reached"],
        what: "carrier-b counters at $150 (its rule: counter once for 20% more, then agree). carrier-a agrees: $150 is inside its budget.",
        why: "Multi-round bargaining with limits in code: budgets are checked before the model answers, two messages per agent per thread, and the actor's deadline timer decides if they stall.",
        actor: ["← say(carrier-b → carrier-a, \"COUNTER $150 …\", th1)", "← say(carrier-a → carrier-b, \"AGREE $150.\", th1)", "→ snapshot broadcasts (chatter)"],
        doors: [d4([{ truck: "T14", carrier: "carrier-b", startMin: 360, status: "booked" }, { truck: "T13", carrier: "carrier-a", startMin: 420, status: "pending", note: "offer o1" }])],
        bubbles: [
          { from: "carrier-b", to: "carrier-a", thread: "th1", kind: "counter", text: "COUNTER $150 — 15:00 costs us a driver swap." },
          { from: "carrier-a", to: "carrier-b", thread: "th1", kind: "agree", text: "AGREE $150." },
        ],
        inboxes: ["carrier-a", "carrier-b"],
      },
      {
        title: "SETTLE: the dock swaps the slots atomically", tech: "dispatcher",
        flows: [{ from: "carrier-a", to: "dispatcher", label: "SETTLE th1", kind: "settle" }, { from: "dispatcher", to: "dock", label: "swap(T13, T14) · pay($150) · settleThread", kind: "settle" }, { from: "dock", to: "screens", label: "snapshot: blocks trade places", kind: "broadcast" }],
        speech: [{ node: "carrier-a", text: "SETTLE th1: T13 door 4 14:00 · T14 door 4 15:00 · pay carrier-a→carrier-b $150" }],
        chips: ["swap ok (atomic)", "side payments $150", "o1 accepted · timer cleared"],
        what: "carrier-a posts the settlement. The dispatcher calls the actor in order: swap(T13, T14), then pay(carrier-a → carrier-b, $150), then settleThread(th1). Both blocks trade places on every screen at once.",
        why: "The actor validates every settlement. If two agents had settled conflicting deals in the same second, one would land and the other would come back REJECTED with the reason.",
        actor: ["← say(carrier-a → pier9-ops, \"SETTLE th1 …\", th1)", "← swap(T13, T14) → ok (both booked, door types fit, atomic)", "event: swap", "← pay(carrier-a → carrier-b, $150) → side payments $150", "← settleThread(th1) → offer o1 accepted, timer cleared", "→ snapshot broadcast: the Gantt moves"],
        doors: [d4([{ truck: "T13", carrier: "carrier-a", startMin: 360, status: "booked", highlight: true }, { truck: "T14", carrier: "carrier-b", startMin: 420, status: "booked", highlight: true }])],
        bubbles: [{ from: "carrier-a", to: "pier9-ops", thread: "th1", kind: "settle", text: "SETTLE th1: T13 door 4 14:00 · T14 door 4 15:00 · pay carrier-a→carrier-b $150" }],
        inboxes: ["carrier-a", "carrier-b"],
        callout: "Side payments +$150. Detention avoided unchanged: nobody waits less, the market just chose who goes first.",
      },
    ],
  },
  {
    id: "doordown", n: 2, title: "Door 5 goes down",
    subtitle: "A reefer door fails. The cold load's agent buys its way back in two rounds; the dock pins the result.",
    background: {
      stakes: "Pier 9 has two refrigerated doors. When one fails, every cold load behind it is suddenly competing for the other, and a reefer truck that waits is a reefer truck burning fuel to stay cold. An hour is worth about $200 to carrier-c and $60 to carrier-b.",
      cast: [
        { handle: "carrier-c", wants: "the earliest reefer slot; budget $250 a deal; mentions the cold chain every time" },
        { handle: "carrier-b", wants: "to be paid for moving T9 an hour later" },
        { handle: "pier9-ops", wants: "the doors re-planned without a cascade and without a phone" },
      ],
      story: [
        "At 09:20 the compressor on door 5 fails. carrier-c's T5 was due there at 10:00.",
        "The dock re-plans in one call: only T5 moves, to the other reefer door an hour later, and the offer tells carrier-c who holds the 10:00 it would rather have. From there the two carriers haggle, two rounds, and settle for $200.",
        "Watch for: only the affected truck moves; the offer names the counterparty; the dock checks door type and priority before it pins the deal; both carriers are better off and the warehouse paid nothing.",
      ],
    },
    outcome: "T5 unloads cold at 10:00 on door 6; carrier-b took $200 to wait an hour it values at $60; the warehouse paid nothing and T5 waits one hour less.",
    steps: [
      {
        title: "Door 5 fails; the dock re-plans in one call", tech: "actor",
        flows: [{ from: "pier9-ops", to: "dock", label: "setDoor(5, out of service)", kind: "call" }, { from: "dock", to: "screens", label: "snapshot: replan · offer o5", kind: "broadcast" }],
        chips: ["door 5 closed", "replan: only T5 moves → door 6 11:00", "offer o5: T5 (open)"],
        what: "setDoor(5, out of service). The actor re-plans: the reefer truck on door 5, carrier-c's T5, is the only truck that moves, to door 6 at 11:00. Door 6 at 10:00 is carrier-b's T9.",
        why: "State and planning live in the actor. Trucks that are not affected keep their slots; there is no cascade for anyone to clean up.",
        actor: ["← setDoor(5, false)", "event: door 5 out of service", "replan: T5 door 5 10:00 → door 6 11:00 (nothing else moves)", "offer o5 → carrier-c: T5 door 6 11:00 (open)", "→ snapshot broadcast"],
        doors: [d5(false, []), d6([{ truck: "T10", carrier: "carrier-c", startMin: 60, status: "booked" }, { truck: "T9", carrier: "carrier-b", startMin: 120, status: "booked" }, { truck: "T5", carrier: "carrier-c", startMin: 180, status: "pending", note: "offer o5", highlight: true }])],
        bubbles: [], inboxes: ["carrier-c", "carrier-b"],
        callout: "Door 5 is striped: out of service. T5 landed on the other reefer door, an hour later than it had.",
      },
      {
        title: "The dock offers carrier-c the new slot and names who holds 10:00", tech: "dispatcher",
        flows: [{ from: "dispatcher", to: "dock", label: "openThread(th-cold, o5, 09:50)", kind: "call" }, { from: "dock", to: "dock", label: "timer th-cold → 09:50", kind: "timer" }, { from: "dispatcher", to: "carrier-c", label: "OFFER o5 (names carrier-b)", kind: "post" }],
        speech: [{ node: "pier9-ops", text: "OFFER o5 → carrier-c: T5 door 6 11:00. Holder of door 6 10:00: carrier-b (T9)." }],
        chips: ["offer o5 open", "timer th-cold 09:50"],
        what: "OFFER o5 → carrier-c: T5 door 6 11:00. Holder of door 6 10:00: carrier-b (T9). A thread opens with a deadline in the actor.",
        why: "The offer carries the one fact the carrier needs to act: who to talk to.",
        actor: ["← openThread(th-cold, o5, deadline 09:50)", "timer armed: thread_deadline 09:50", "→ snapshot broadcast"],
        doors: [d5(false, []), d6([{ truck: "T10", carrier: "carrier-c", startMin: 60, status: "booked" }, { truck: "T9", carrier: "carrier-b", startMin: 120, status: "booked" }, { truck: "T5", carrier: "carrier-c", startMin: 180, status: "pending", note: "offer o5" }])],
        bubbles: [{ from: "pier9-ops", to: "#pier9", thread: "th-cold", kind: "offer", text: "Door 5 is out of service. OFFER o5 → carrier-c: T5 door 6 11:00. Holder of door 6 10:00: @carrier-b (T9). Thread closes 09:50." }],
        inboxes: ["carrier-c", "carrier-b"],
      },
      {
        title: "carrier-c wants 10:00 back and offers carrier-b $150", tech: "agents",
        flows: [{ from: "carrier-c", to: "carrier-b", label: "SWAP? $150, cold chain", kind: "post" }, { from: "dispatcher", to: "dock", label: "say() mirror only", kind: "mirror" }],
        speech: [{ node: "carrier-c", text: "SWAP? @carrier-b — T5 takes door 6 10:00, T9 takes 11:00, we cover $150. Cold chain." }],
        chips: ["offer o5 open", "timer th-cold 09:50", "nothing moves"],
        what: "A reefer hour is worth about $200 to carrier-c (the cold chain). carrier-b values an hour at $60. carrier-c's agent opens with $150.",
        why: "There is a deal to be found between those two numbers, and no human has to find it.",
        actor: ["← say(carrier-c → carrier-b, \"SWAP? …\", th-cold)   (mirror only)", "→ snapshot broadcast (chatter)"],
        doors: [d5(false, []), d6([{ truck: "T10", carrier: "carrier-c", startMin: 60, status: "booked" }, { truck: "T9", carrier: "carrier-b", startMin: 120, status: "booked" }, { truck: "T5", carrier: "carrier-c", startMin: 180, status: "pending", note: "offer o5" }])],
        bubbles: [{ from: "carrier-c", to: "carrier-b", thread: "th-cold", kind: "swap", text: "SWAP? @carrier-b — T5 takes door 6 10:00, T9 takes 11:00, we cover $150 of your detention. Cold chain." }],
        inboxes: ["carrier-c", "carrier-b"],
      },
      {
        title: "Round two: $200, agreed", tech: "agents",
        flows: [{ from: "carrier-b", to: "carrier-c", label: "COUNTER $200", kind: "post" }, { from: "carrier-c", to: "carrier-b", label: "AGREE $200", kind: "post" }, { from: "dispatcher", to: "dock", label: "say() mirror only", kind: "mirror" }],
        speech: [{ node: "carrier-b", text: "COUNTER $200 — 11:00 pushes our next pickup." }, { node: "carrier-c", text: "AGREE $200 — the cold chain is worth it." }],
        chips: ["offer o5 open", "timer th-cold 09:50", "2 messages each: cap reached"],
        what: "carrier-b counters at $200. carrier-c agrees: still inside its $250 budget. Two rounds, then silence.",
        why: "Hard caps keep language-model agents from talking forever: two messages each, and the actor's deadline timer decides if they stall.",
        actor: ["← say(carrier-b → carrier-c, \"COUNTER $200 …\", th-cold)", "← say(carrier-c → carrier-b, \"AGREE $200 …\", th-cold)", "→ snapshot broadcasts (chatter)"],
        doors: [d5(false, []), d6([{ truck: "T10", carrier: "carrier-c", startMin: 60, status: "booked" }, { truck: "T9", carrier: "carrier-b", startMin: 120, status: "booked" }, { truck: "T5", carrier: "carrier-c", startMin: 180, status: "pending", note: "offer o5" }])],
        bubbles: [
          { from: "carrier-b", to: "carrier-c", thread: "th-cold", kind: "counter", text: "COUNTER $200 — 11:00 pushes our next pickup." },
          { from: "carrier-c", to: "carrier-b", thread: "th-cold", kind: "agree", text: "AGREE $200 — the cold chain is worth it." },
        ],
        inboxes: ["carrier-c", "carrier-b"],
      },
      {
        title: "SETTLE: the dock pins T5 to 10:00 and bumps T9", tech: "actor",
        flows: [{ from: "carrier-c", to: "dispatcher", label: "SETTLE th-cold", kind: "settle" }, { from: "dispatcher", to: "dock", label: "counter(o5, door 6, 10:00) · pay($200)", kind: "settle" }, { from: "dock", to: "screens", label: "snapshot: T5 and T9 trade places", kind: "broadcast" }],
        speech: [{ node: "carrier-c", text: "SETTLE th-cold: T5 door 6 10:00 · T9 door 6 11:00 · pay carrier-c→carrier-b $200" }],
        chips: ["counter ok: no higher-priority truck moved", "T9 → 11:00 (offer o6 accepted)", "side payments $350 · detention avoided +$75"],
        what: "carrier-c posts the settlement. The dispatcher calls counter(o5, door 6, 10:00): the actor re-plans with T5 pinned, checks that no higher-priority truck would move, and gives T9 the 11:00 slot with its own offer. Then pay(carrier-c → carrier-b, $200) and settleThread.",
        why: "The actor checks door type and priority before accepting. Both carriers are better off: carrier-c pays $200 for an hour it values at $200 or more, carrier-b earns $200 for an hour it values at $60. The warehouse paid nothing, and T5 waits one hour less.",
        actor: ["← say(carrier-c → pier9-ops, \"SETTLE th-cold …\", th-cold)", "← counter(o5, door 6, 10:00) → ok; T9 → door 6 11:00 (offer o6)", "event: countered, replanned", "← accept(o6) for carrier-b", "← pay(carrier-c → carrier-b, $200) → side payments $350", "← settleThread(th-cold) → timer cleared", "→ snapshot broadcast: T5 and T9 trade places"],
        doors: [d5(false, []), d6([{ truck: "T10", carrier: "carrier-c", startMin: 60, status: "booked" }, { truck: "T5", carrier: "carrier-c", startMin: 120, status: "booked", highlight: true }, { truck: "T9", carrier: "carrier-b", startMin: 180, status: "booked", highlight: true }])],
        bubbles: [{ from: "carrier-c", to: "pier9-ops", thread: "th-cold", kind: "settle", text: "SETTLE th-cold: T5 door 6 10:00 · T9 door 6 11:00 · pay carrier-c→carrier-b $200" }],
        inboxes: ["carrier-c", "carrier-b"],
        callout: "Detention avoided · warehouse +$75 (T5 waits an hour less). Side payments · carrier to carrier +$200.",
      },
    ],
  },
]
