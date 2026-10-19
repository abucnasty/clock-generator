import { BeltSpeed } from "../entities/belt";
import { BeltPickupStock } from "./belt-pickup-stock";

interface Stack {position: number; count: number}

/**
 * A closed endpoint with continuously full upstream supply. Positions use 1/256 tile units; a full stack
 * occupies 64 units regardless of its item count. Withdrawals leave holes that refill at belt speed.
 */
export class BackedUpPickupLane implements BeltPickupStock {
    private readonly stock: Stack[];
    private readonly speed: number;
    private readonly length: number;
    private tick = 0;
    private last_take_tick = Number.NEGATIVE_INFINITY;

    constructor(belt_speed: BeltSpeed, length_tiles: number, private readonly stack_size: number) {
        this.speed = belt_speed / BeltSpeed.TRANSPORT_BELT * 8;
        this.length = length_tiles * 256;
        // Only visible slots plus one upstream stack are needed. Beyond the tail, the full supply is spaced
        // uniformly; replacing a consumed stack at tail + 64 preserves that boundary without a growing queue.
        this.stock = Array.from({length: Math.ceil(this.length / 64) + 1}, (_, index) => ({position: index * 64, count: stack_size}));
    }

    public take(tick: number, capacity: number): number {
        this.advanceTo(tick);
        if (this.last_take_tick === tick || capacity <= 0) return 0;
        for (let index = this.stock.length - 1; index >= 0; index--) {
            const stack = this.stock[index];
            if (stack.position >= this.length) continue;
            const taken = Math.min(stack.count, capacity);
            stack.count -= taken;
            this.last_take_tick = tick;
            if (stack.count === 0) {
                this.stock.splice(index, 1);
                this.stock.push({position: this.stock[this.stock.length - 1].position + 64, count: this.stack_size});
            }
            return taken;
        }
        return 0;
    }

    public hasTakenAt(tick: number): boolean {
        return this.last_take_tick === tick;
    }

    public stateKey(tick: number): string {
        this.advanceTo(tick);
        return `${this.last_take_tick === tick};${this.stock.map(stack => `${stack.position}:${stack.count}`).join(",")}`;
    }

    /** Visible stock for native comparisons; callers cannot mutate the lane through this snapshot. */
    public snapshot(tick: number): readonly (readonly [position: number, count: number])[] {
        this.advanceTo(tick);
        return this.stock.filter(stack => stack.position < this.length).map(stack => [stack.position, stack.count] as const);
    }

    private advanceTo(tick: number): void {
        if (tick < this.tick) throw new Error("Backed-up pickup stock cannot move backwards in time");
        const travel = (tick - this.tick) * this.speed;
        if (travel === 0) return;
        // Between withdrawals, the head clamps at zero and each follower clamps behind its predecessor. Since
        // spacing is already >= 64, this closed form is equivalent to advancing every intervening tick.
        for (let index = 0; index < this.stock.length; index++) {
            const stack = this.stock[index];
            stack.position = Math.max(stack.position - travel, index * 64);
        }
        this.tick = tick;
    }
}
