// THROWAWAY smoke-test actor. Not the real Dock (Person A owns that). Exists only to
// exercise relay/dock.ts TerseDock against a real local durable-actors runtime.
import { Actor, type ActorSocket, Persisted } from "durable-actors"
import type { Appt, Auction, Chat, Claim, Door, Event, Offer, Snapshot, Thread, Truck } from "../../../shared/types.ts"

type SeedSpec = {
    doors: Door[]
    trucks: Truck[]
    appts: (Appt & { arrivalCheck?: boolean })[]
    speed?: number
}
type Metadata = { role: string }
type Socket = ActorSocket<Metadata, Snapshot>

export class Dock extends Actor<Metadata, never, Snapshot> {
    @Persisted simMin = 0
    @Persisted speed = 1
    @Persisted doors: Door[] = []
    @Persisted trucks: Truck[] = []
    @Persisted appts: Appt[] = []
    @Persisted offers: Offer[] = []
    @Persisted auctions: Auction[] = []
    @Persisted threads: Thread[] = []
    @Persisted claims: Claim[] = []
    @Persisted chatter: Chat[] = []
    @Persisted events: Event[] = []
    @Persisted seq = 0
    @Persisted moves = 0

    // NOTE: the runtime rejects any non-async method on an actor class ("actor method
    // Dock.snap must be async"), even TS-private helpers — so snapOf/emit live at
    // module level below.
    async onConnect(socket: Socket): Promise<void> {
        socket.send(snapOf(this))
    }

    async seed(scenario: SeedSpec): Promise<Snapshot> {
        this.simMin = 0
        this.speed = scenario.speed ?? 1
        this.doors = [...scenario.doors]
        this.trucks = [...scenario.trucks]
        this.appts = scenario.appts.map(({ arrivalCheck: _a, ...a }) => a)
        this.offers = []
        this.auctions = []
        this.threads = []
        this.claims = []
        this.chatter = []
        this.events = []
        this.seq = 0
        this.moves = 0
        return emit(this)
    }

    async request(carrier: string, truckId: string, door: number, startMin: number): Promise<{ appt?: Appt; offer?: Offer }> {
        const taken = this.appts.some(a => a.door === door && a.startMin === startMin)
        if (!taken) {
            const appt: Appt = { truckId, door, startMin, status: "booked" }
            this.appts = [...this.appts, appt]
            emit(this)
            return { appt }
        }
        this.seq += 1
        const offer: Offer = {
            id: `o${this.seq}`, truckId, carrier, door, startMin: startMin + 60,
            reason: "slot taken", status: "open"
        }
        this.offers = [...this.offers, offer]
        emit(this)
        return { offer }
    }

    async say(from: string, to: string, text: string, thread?: string): Promise<{ seq: number }> {
        this.seq += 1
        const chat: Chat = thread === undefined
            ? { seq: this.seq, atMin: this.simMin, from, to, text }
            : { seq: this.seq, atMin: this.simMin, from, to, thread, text }
        this.chatter = [...this.chatter, chat]
        emit(this)
        return { seq: this.seq }
    }

    async snapshot(): Promise<Snapshot> {
        return emit(this)
    }

    async setSpeed(speed: number): Promise<{ ok: boolean; reason?: string }> {
        this.speed = speed
        emit(this)
        return { ok: true }
    }
}

function snapOf(d: Dock): Snapshot {
    return {
        simMin: d.simMin,
        speed: d.speed,
        doors: d.doors,
        trucks: d.trucks,
        appts: d.appts,
        offers: d.offers,
        auctions: d.auctions,
        threads: d.threads,
        claims: d.claims,
        chatter: d.chatter,
        events: d.events,
        counters: { detentionAvoidedUsd: 0, sidePaymentsUsd: 0, phoneCalls: 0, moves: d.moves, backhauls: 0 }
    }
}

// broadcast is protected on Actor; reach it through an index access from module scope.
function emit(d: Dock): Snapshot {
    const s = snapOf(d)
    ;(d as unknown as { broadcast(m: Snapshot): void }).broadcast(s)
    return s
}
