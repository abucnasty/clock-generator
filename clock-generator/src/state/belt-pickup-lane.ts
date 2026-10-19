import { BeltPickupSupplyProfile } from "../config/schema";
import { BeltSpeed } from "../entities/belt";
import { BeltPickupStock } from "./belt-pickup-stock";

/**
 * One continuously supplied moving stream at a pickup. Internally distances use 1/256 tile units:
 * stacks are 64 units apart, belt speeds are 8/16/24/32 units per tick. Through streams span the
 * exposed line; a single side stream spans its measured free-flow entry boundary. Holes and partial
 * stacks persist, and at most one stack can be taken per tick. Merges/backpressure need a shared supply model.
 */
export class BeltPickupLane implements BeltPickupStock {
    private readonly speed: number;
    private readonly length: number;
    private readonly phase: number;
    private readonly remaining = new Map<number, number>();
    private last_take_tick = Number.NEGATIVE_INFINITY;

    /** phase keeps its existing public 1/32-tile units; side-entry offset is added internally. */
    constructor(belt_speed: BeltSpeed, length_tiles: number, private readonly stack_size: number, phase = 0,
        profile: BeltPickupSupplyProfile = "through") {
        this.speed = belt_speed / BeltSpeed.TRANSPORT_BELT * 8;
        const entry = profile === "side-inner" ? 67 : profile === "side-outer" ? 188 : undefined;
        this.length = entry ?? length_tiles * 256;
        this.phase = phase * 8 + (entry === undefined ? 0 : entry % 64);
        if (entry !== undefined && length_tiles !== 1) throw new Error("Side-entry supply requires a straight, one-tile pickup");
    }

    public take(tick: number, capacity: number): number {
        if (this.last_take_tick === tick || capacity <= 0) return 0;
        const stack = this.candidate(tick);
        if (!stack) return 0;
        const taken = Math.min(stack.count, capacity);
        this.remaining.set(stack.id, stack.count - taken);
        this.last_take_tick = tick;
        return taken;
    }

    /** Observe the next reachable stack without removing it; the arm may need another tick to reach it. */
    public peek(tick: number): {position: number; count: number} | undefined {
        const stack = this.candidate(tick);
        return stack && {position: stack.position, count: stack.count};
    }

    public snapshot(tick: number): readonly (readonly [position: number, count: number])[] {
        this.forgetPassed(tick);
        const stock: [number, number][] = [];
        for (let id = this.firstStack(tick); id <= this.lastStack(tick); id++) {
            const count = this.remaining.get(id) ?? this.stack_size;
            if (count > 0) stock.push([this.phase + id * 64 - tick * this.speed, count]);
        }
        return stock;
    }

    private candidate(tick: number): {id: number; position: number; count: number} | undefined {
        this.forgetPassed(tick);
        const first = this.firstStack(tick);
        for (let id = this.lastStack(tick); id >= first; id--) {
            const count = this.remaining.get(id) ?? this.stack_size;
            if (count > 0) return {id, position: this.phase + id * 64 - tick * this.speed, count};
        }
        return undefined;
    }

    private lastStack(tick: number): number {
        return Math.ceil((tick * this.speed - this.phase + this.length) / 64) - 1;
    }

    public hasTakenAt(tick: number): boolean {
        return this.last_take_tick === tick;
    }

    public stateKey(tick: number): string {
        this.forgetPassed(tick);
        const first = this.firstStack(tick);
        const holes = [...this.remaining].sort(([a], [b]) => a - b).map(([id, count]) => `${id - first}:${count}`);
        return `${((tick * this.speed - this.phase) % 64 + 64) % 64};${this.last_take_tick === tick};${holes.join(",")}`;
    }

    private firstStack(tick: number): number {
        return Math.ceil((tick * this.speed - this.phase) / 64);
    }

    private forgetPassed(tick: number): void {
        const first = this.firstStack(tick);
        for (const id of this.remaining.keys()) if (id < first) this.remaining.delete(id);
    }
}
