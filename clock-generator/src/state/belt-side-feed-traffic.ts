import assert from "../common/assert";
import { BeltSpeed } from "../entities/belt";

export interface SideFeedTrafficConfig {
    streams: Partial<Record<"outer" | "inner", {ingredient: string; stack_size: number}>>;
    downstream_tiles: number;
    outlet: "open" | "closed";
    belt_speed: BeltSpeed;
}

export interface SideFeedStack {
    id: number;
    position: number;
    count: number;
    item: string;
    origin: "outer" | "inner";
}
export interface SideFeedSnapshot {
    tick: number;
    stock: SideFeedStack[];
    outer: SideFeedStack[];
    inner: SideFeedStack[];
}
const order = (stacks: SideFeedStack[]) => [...stacks].sort((a, b) => a.position - b.position);

/** One or two saturated side streams sharing finite receiving stock. Distances are 1/256 tile units.
 * Entry checks use the preceding tick, existing stock moves, arrivals join, then an inserter may take one stack.
 * Initial phase is an assumption, as for single-stream supply; observations may seed a verification run once.
 */
export class BeltSideFeedTraffic {
    private readonly speed: number;
    private stock: SideFeedStack[];
    private readonly queues: Record<"outer" | "inner", SideFeedStack[]>;
    private tick: number;
    private next_id = 1;
    private last_take_tick = -Infinity;
    public last_take: SideFeedStack | undefined;

    constructor(public readonly supply: SideFeedTrafficConfig, private readonly backed_up = false,
        initial?: SideFeedSnapshot, private readonly refill = true) {
        this.tick = initial?.tick ?? 0;
        this.speed = supply.belt_speed / BeltSpeed.TRANSPORT_BELT * 8;
        const stack = (position: number, origin: "outer" | "inner"): SideFeedStack => ({
            id: this.next_id++, position, origin, count: supply.streams[origin]!.stack_size, item: supply.streams[origin]!.ingredient,
        });
        const closed = backed_up || supply.outlet === "closed";
        this.stock = [];
        const first_origin = supply.streams.outer ? "outer" : "inner";
        const entry = supply.streams.outer ? 188 : 67;
        const first = -supply.downstream_tiles * 256 + (closed ? 0 : 28);
        const limit = closed ? Math.min(256, entry + 64) : entry;
        for (let position = first; position < limit; position += 64) this.stock.push(stack(position, first_origin));
        this.queues = {
            outer: supply.streams.outer ? [0, 64, 128, 192].map(position => stack(position + (closed ? 0 : 28), "outer")) : [],
            inner: supply.streams.inner ? [0, 64, 128, 192].map(position => stack(position, "inner")) : [],
        };
        if (initial) {
            this.restore(initial);
        }
    }

    /** Seed a verification/replay once from observed stock; ordinary clock trials use the constructor's phase. */
    public restore(initial: SideFeedSnapshot): void {
        this.tick = initial.tick;
        this.stock = structuredClone(initial.stock);
        this.queues.outer = structuredClone(initial.outer);
        this.queues.inner = structuredClone(initial.inner);
        this.next_id = Math.max(0, ...this.stock.map(s => s.id), ...initial.outer.map(s => s.id), ...initial.inner.map(s => s.id)) + 1;
        this.last_take_tick = -Infinity;
        this.last_take = undefined;
    }

    public advanceTo(tick: number, outletOpen = !this.backed_up && this.supply.outlet === "open", withheld: ReadonlySet<string> = new Set()): void {
        assert(Number.isInteger(tick) && tick >= this.tick, "Side-feed supply cannot run backwards");
        while (this.tick < tick) {
            this.step(outletOpen && !this.backed_up, withheld);
            this.tick++;
        }
    }

    public availableItems(tick: number): string[] {
        this.advanceTo(tick);
        return [...new Set(order(this.stock).reverse().filter(s => s.position >= 0 && s.count > 0).map(s => s.item))];
    }

    public take(tick: number, item: string, capacity: number): number {
        this.advanceTo(tick);
        if (this.last_take_tick === tick || capacity <= 0) return 0;
        const stack = order(this.stock).reverse().find(s => s.position >= 0 && s.item === item && s.count > 0);
        if (!stack) return 0;
        const taken = Math.min(stack.count, capacity);
        this.last_take = {...stack, count: taken};
        stack.count -= taken;
        if (stack.count === 0) this.stock.splice(this.stock.indexOf(stack), 1);
        this.last_take_tick = tick;
        return taken;
    }

    public hasTakenAt(tick: number): boolean { return this.last_take_tick === tick; }

    public snapshot(): SideFeedSnapshot {
        return structuredClone({tick: this.tick, stock: order(this.stock), outer: order(this.queues.outer), inner: order(this.queues.inner)});
    }

    public stateKey(tick: number): string {
        const key = (stacks: SideFeedStack[]) => order(stacks).map(s => `${s.position}:${s.item}:${s.count}:${s.origin}`).join(",");
        // Identity counters and absolute ticks do not affect future behavior.
        return `${this.last_take_tick === tick};${key(this.stock)};${key(this.queues.outer)};${key(this.queues.inner)}`;
    }

    private step(outletOpen: boolean, withheld: ReadonlySet<string>): void {
        const previous = this.stock;
        const advanced = this.moveExisting(outletOpen);
        const arrivals: SideFeedStack[] = [];
        for (const origin of ["outer", "inner"] as const) {
            const stream = this.supply.streams[origin];
            if (!stream) continue;
            const queue = this.queues[origin];
            const lead = queue[0];
            let entry: number | undefined;
            if (lead && lead.position < this.speed) entry = this.entryPosition(previous, (origin === "outer" ? 188 : 67) + lead.position);
            if (entry !== undefined) {
                arrivals.push({...queue.shift()!, position: entry});
            }
            // A blocked lead still moves toward the entry boundary when less than a full movement step remains.
            const travel = entry !== undefined ? this.speed : Math.min(this.speed, lead?.position ?? 0);
            for (const stack of queue) stack.position -= travel;
            if (this.refill && !withheld.has(stream.ingredient)) {
                while (queue.length < 4) queue.push({id: this.next_id++, position: (queue.at(-1)?.position ?? -64) + 64,
                    count: stream.stack_size, item: stream.ingredient, origin});
            }
        }
        // An arrival blocked by old stock also holds back a simultaneous arrival behind it. Freely moving
        // arrivals may briefly compress their gap; their followers wait on subsequent ticks, never reverse.
        let blockedArrival: number | undefined;
        for (const stack of order(arrivals)) {
            const entry = stack.position;
            const downstream = previous.filter(s => s.position <= entry)
                .map(s => advanced.find(moved => moved.id === s.id)?.position ?? -Infinity);
            stack.position = Math.max(entry - this.speed, ...downstream.map(p => p + 64), blockedArrival === undefined ? -Infinity : blockedArrival + 64);
            blockedArrival = stack.position > entry - this.speed ? stack.position : undefined;
        }
        this.stock = [...advanced, ...arrivals];
    }

    private entryPosition(stock: SideFeedStack[], entry: number): number | undefined {
        let position = entry;
        for (const ahead of order(stock).filter(s => s.position >= 0)) {
            if (ahead.position <= position && position - ahead.position < 64) position = ahead.position + 64;
        }
        return position - entry < 64 + this.speed && position < 256 ? position : undefined;
    }

    private moveExisting(outletOpen: boolean): SideFeedStack[] {
        const end = -this.supply.downstream_tiles * 256;
        let ahead = outletOpen ? -Infinity : end - 64;
        return order(this.stock).map(stack => {
            const position = Math.min(stack.position, Math.max(stack.position - this.speed, ahead + 64));
            ahead = position;
            return {...stack, position};
        }).filter(stack => stack.position >= end);
    }
}
