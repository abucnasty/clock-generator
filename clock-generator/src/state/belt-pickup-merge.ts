import assert from "../common/assert";
import { BeltPickupMergeConfig } from "../config/schema";

export interface MergeStack {
    id: number;
    position: number;
    count: number;
    item: string;
    origin: "outer" | "inner";
}
export interface MergeSnapshot {
    tick: number;
    stock: MergeStack[];
    outer: MergeStack[];
    inner: MergeStack[];
}
const order = (stacks: MergeStack[]) => [...stacks].sort((a, b) => a.position - b.position);

/** Two saturated turbo side streams sharing finite receiving stock. Distances are 1/256 tile units.
 * Entry checks use the preceding tick, existing stock moves, arrivals join, then an inserter may take one stack.
 * Initial phase is an assumption, as for single-stream supply; observations may seed a verification run once.
 */
export class BeltPickupMerge {
    private stock: MergeStack[];
    private readonly queues: Record<"outer" | "inner", MergeStack[]>;
    private tick: number;
    private next_id = 1;
    private last_take_tick = -Infinity;
    public last_take: MergeStack | undefined;

    constructor(public readonly config: BeltPickupMergeConfig, private readonly backed_up = false,
        initial?: MergeSnapshot, private readonly refill = true) {
        this.tick = initial?.tick ?? 0;
        const stack = (position: number, origin: "outer" | "inner"): MergeStack => ({
            id: this.next_id++, position, origin, count: 4, item: config[origin].ingredient,
        });
        const closed = backed_up || config.outlet === "closed";
        this.stock = [];
        const first = -config.downstream_tiles * 256 + (closed ? 0 : 28);
        for (let position = first; position < (closed ? 256 : 188); position += 64) this.stock.push(stack(position, "outer"));
        this.queues = {
            outer: [0, 64, 128, 192].map(position => stack(position + (closed ? 0 : 28), "outer")),
            inner: [0, 64, 128, 192].map(position => stack(position, "inner")),
        };
        if (initial) {
            this.restore(initial);
        }
    }

    /** Seed a verification/replay once from observed stock; ordinary clock trials use the constructor's phase. */
    public restore(initial: MergeSnapshot): void {
        this.tick = initial.tick;
        this.stock = structuredClone(initial.stock);
        this.queues.outer = structuredClone(initial.outer);
        this.queues.inner = structuredClone(initial.inner);
        this.next_id = Math.max(0, ...this.stock.map(s => s.id), ...initial.outer.map(s => s.id), ...initial.inner.map(s => s.id)) + 1;
        this.last_take_tick = -Infinity;
        this.last_take = undefined;
    }

    public advanceTo(tick: number, outletOpen = !this.backed_up && this.config.outlet === "open", withheld: ReadonlySet<string> = new Set()): void {
        assert(Number.isInteger(tick) && tick >= this.tick, "Merge supply cannot run backwards");
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

    public snapshot(): MergeSnapshot {
        return structuredClone({tick: this.tick, stock: order(this.stock), outer: order(this.queues.outer), inner: order(this.queues.inner)});
    }

    public stateKey(tick: number): string {
        const key = (stacks: MergeStack[]) => order(stacks).map(s => `${s.position}:${s.item}:${s.count}:${s.origin}`).join(",");
        // Identity counters and absolute ticks do not affect future behavior.
        return `${this.last_take_tick === tick};${key(this.stock)};${key(this.queues.outer)};${key(this.queues.inner)}`;
    }

    private step(outletOpen: boolean, withheld: ReadonlySet<string>): void {
        const previous = this.stock;
        const advanced = this.moveExisting(outletOpen);
        const arrivals: MergeStack[] = [];
        for (const origin of ["outer", "inner"] as const) {
            const queue = this.queues[origin];
            const lead = queue[0];
            let entry: number | undefined;
            if (lead && lead.position < 32) entry = this.entryPosition(previous, (origin === "outer" ? 188 : 67) + lead.position);
            if (entry !== undefined) {
                arrivals.push({...queue.shift()!, position: entry});
            }
            if (entry !== undefined || (lead && lead.position >= 32)) for (const stack of queue) stack.position -= 32;
            if (this.refill && !withheld.has(this.config[origin].ingredient)) {
                while (queue.length < 4) queue.push({id: this.next_id++, position: (queue.at(-1)?.position ?? -64) + 64,
                    count: 4, item: this.config[origin].ingredient, origin});
            }
        }
        // An arrival blocked by old stock also holds back a simultaneous arrival behind it. Freely moving
        // arrivals may briefly compress their gap; their followers wait on subsequent ticks, never reverse.
        let blockedArrival: number | undefined;
        for (const stack of order(arrivals)) {
            const entry = stack.position;
            const downstream = previous.filter(s => s.position <= entry)
                .map(s => advanced.find(moved => moved.id === s.id)?.position ?? -Infinity);
            stack.position = Math.max(entry - 32, ...downstream.map(p => p + 64), blockedArrival === undefined ? -Infinity : blockedArrival + 64);
            blockedArrival = stack.position > entry - 32 ? stack.position : undefined;
        }
        this.stock = [...advanced, ...arrivals];
    }

    private entryPosition(stock: MergeStack[], entry: number): number | undefined {
        let position = entry;
        for (const ahead of order(stock).filter(s => s.position >= 0)) {
            if (ahead.position <= position && position - ahead.position < 64) position = ahead.position + 64;
        }
        return position - entry < 96 && position < 256 ? position : undefined;
    }

    private moveExisting(outletOpen: boolean): MergeStack[] {
        const end = -this.config.downstream_tiles * 256;
        let ahead = outletOpen ? -Infinity : end - 64;
        return order(this.stock).map(stack => {
            const position = Math.min(stack.position, Math.max(stack.position - 32, ahead + 64));
            ahead = position;
            return {...stack, position};
        }).filter(stack => stack.position >= end);
    }
}
