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

    /** head_offset is transient stock phase in 1/256-tile units, used when starting from observed full stock. */
    constructor(belt_speed: BeltSpeed, length_tiles: number, private readonly stack_size: number, private readonly head_offset = 0) {
        if (!Number.isFinite(head_offset) || head_offset < 0 || head_offset >= 64) throw new Error("Backed-up head offset must be within one stack spacing");
        this.speed = belt_speed / BeltSpeed.TRANSPORT_BELT * 8;
        this.length = length_tiles * 256;
        // Only visible slots plus one upstream stack are needed. Beyond the tail, the full supply is spaced
        // uniformly; replacing a consumed stack at tail + 64 preserves that boundary without a growing queue.
        this.stock = Array.from({length: Math.ceil(this.length / 64) + 1}, (_, index) => ({position: head_offset + index * 64, count: stack_size}));
    }

    public peek(tick: number): {position: number; count: number} | undefined {
        this.advanceTo(tick);
        for (let index = this.stock.length - 1; index >= 0; index--) {
            const stack = this.stock[index];
            if (stack.position < this.length) return {...stack};
        }
        return undefined;
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
        return `${this.head_offset === 0 ? "" : `${this.head_offset};`}${this.last_take_tick === tick};${this.stock.map(stack => `${stack.position}:${stack.count}`).join(",")}`;
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
        // Between withdrawals, the head clamps at its downstream offset and each follower clamps behind its predecessor. Since
        // spacing is already >= 64, this closed form is equivalent to advancing every intervening tick.
        for (let index = 0; index < this.stock.length; index++) {
            const stack = this.stock[index];
            stack.position = Math.max(stack.position - travel, this.head_offset + index * 64);
        }
        this.tick = tick;
    }
}

/**
 * The ticks one hand grabs its stacks in from backed-up lanes at rest (a full queue of full stacks at the endpoint), from
 * the first grab: a stack a tick while reachable stock lasts, the first lane that has one in the order given (the
 * preferred lane, then the other lane with the same item), and then as fast as the belt brings stacks into reach. The
 * same queue as the simulator's. Recorded in Factorio 2.1.21 with 16-item hands on four-item belt stacks: `0,1,2,3` at
 * every tier on a straight belt and at turbo and express on an underground end, `0,1,2,5` fast and `0,1,2,9` normal on
 * an underground end with the item on one lane (docs/belt-pickup/experiments.md, tick-pattern matrix).
 */
export function backedUpHandGrabTicks(belt_speed: BeltSpeed, lanes: readonly {length_tiles: number; stack_size: number}[], hand: number): number[] {
    if (lanes.length === 0 || hand <= 0) return [];
    const stock = lanes.map(lane => new BackedUpPickupLane(belt_speed, lane.length_tiles, lane.stack_size));
    const grabs: number[] = [];
    let held = 0;
    // a stack spacing is 64 units, and every belt moves at least one unit a tick
    const last_tick = (Math.ceil(hand / Math.min(...lanes.map(lane => lane.stack_size))) + 1) * 64;
    for (let tick = 0; held < hand && tick <= last_tick; tick++) {
        for (const lane of stock) {
            const taken = lane.take(tick, hand - held);
            if (taken > 0) {
                held += taken;
                grabs.push(tick);
                break;
            }
        }
    }
    if (held < hand) throw new Error("A backed-up lane did not refill a hand");
    return grabs;
}
