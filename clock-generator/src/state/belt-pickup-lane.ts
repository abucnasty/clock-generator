import { BeltSpeed } from "../entities/belt";

/**
 * A saturated moving lane under one pickup. Distances are in 1/32 tile units: belt stacks are 8 units apart,
 * and the four belt speeds move 1, 2, 3 or 4 units per tick. The exposed line is half a tile at either underground
 * endpoint and one tile on a straight belt. Take the upstream-most remaining stack, at most once per tick.
 * Only holes and partially taken stacks need storage; the untouched supply is an infinite, evenly spaced train.
 */
export class BeltPickupLane {
    private readonly speed: number;
    private readonly length: number;
    private readonly remaining = new Map<number, number>();
    private last_take_tick = Number.NEGATIVE_INFINITY;

    constructor(belt_speed: BeltSpeed, length_tiles: number, private readonly stack_size: number, private readonly phase = 0) {
        this.speed = belt_speed / BeltSpeed.TRANSPORT_BELT;
        this.length = length_tiles * 32;
    }

    public take(tick: number, capacity: number): number {
        this.forgetPassed(tick);
        if (this.last_take_tick === tick) return 0;
        const first = this.firstStack(tick);
        const last = Math.ceil((tick * this.speed - this.phase + this.length) / 8) - 1;
        for (let id = last; id >= first; id--) {
            const available = this.remaining.get(id) ?? this.stack_size;
            if (available === 0) continue;
            const taken = Math.min(available, capacity);
            if (taken <= 0) return 0;
            this.remaining.set(id, available - taken);
            this.last_take_tick = tick;
            return taken;
        }
        return 0;
    }

    public stateKey(tick: number): string {
        this.forgetPassed(tick);
        const first = this.firstStack(tick);
        const holes = [...this.remaining].sort(([a], [b]) => a - b).map(([id, count]) => `${id - first}:${count}`);
        return `${((tick * this.speed - this.phase) % 8 + 8) % 8};${this.last_take_tick === tick};${holes.join(",")}`;
    }

    private firstStack(tick: number): number {
        return Math.ceil((tick * this.speed - this.phase) / 8);
    }

    private forgetPassed(tick: number): void {
        const first = this.firstStack(tick);
        for (const id of this.remaining.keys()) if (id < first) this.remaining.delete(id);
    }
}
