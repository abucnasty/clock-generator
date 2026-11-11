import assert from "../common/assert";
import { BeltSpeed } from "../entities/belt";
import { Ratio } from "../entities/traits/ratio";
import type { LaneEnd } from "../entities/traits/lane-facts";
import { BeltPickupStock } from "./belt-pickup-stock";

/** The gap a stack keeps to the stack ahead of it on a lane, in 1/256-tile units: four stacks a tile */
const STACK_SPACING = 64;

interface LaneStack {
    /** Where the stack stands, in 1/256-tile units from the lane's entry, increasing downstream */
    x: number;
    count: number;
}

/** One taker's reach on a shared lane: a stretch of it, and the tick it last took in */
interface Reach {
    /** The downstream edge of the stretch, in 1/256-tile units from the entry */
    readonly edge: number;
    /** The length of the stretch, in 1/256-tile units */
    readonly length: number;
    last_take_tick: number;
}

/** What a shared lane is made of: the belt, the stack size, its supply rate at the entry and its end */
export interface SharedLaneArgs {
    readonly belt_speed: BeltSpeed;
    readonly stack_size: number;
    /** Items a second that come onto the lane at its entry */
    readonly supply_rate: Ratio;
    readonly lane_end: LaneEnd;
    /** Where the lane ends, in tiles from its entry */
    readonly length_tiles: number;
}

/**
 * One lane of a belt with every taker of every copy on it, tick by tick: stacks come on at the entry at the supply rate
 * while there is room, move downstream at the belt's speed, keep a stack's spacing behind the stack ahead, and at the
 * end either stand (a dead end) or leave at the outlet rate (an outlet). A taker reaches a stretch of the lane and takes
 * at most one stack, or part of one, a tick (`reachOf`). A taken stack leaves a gap that the stacks behind close where
 * they stand, and that travels on with them where they move.
 *
 * The supply is a flow, not a queue: what the entry cannot put on while the lane is full at the entry is lost, as the
 * belt upstream of the entry is not part of the model.
 *
 * Positions are in 1/256 tile, as the pickup stocks have them (`BackpressurePickupLane`, `BeltPickupLane`); a stack
 * takes 64 units.
 */
export class SharedLane {
    private readonly speed: number;
    private readonly end: number;
    private readonly stack_size: number;
    /** The entry's rate, exact: items a tick are `numerator / (60 denominator)`, its bank counts in that unit */
    private readonly supply: Ratio;
    /** The outlet's rate, exact as the entry's; null at a dead end */
    private readonly outlet: Ratio | null;
    /** The stacks from the head (furthest downstream) to the tail */
    private stacks: LaneStack[] = [];
    private supply_bank = 0;
    private outlet_bank = 0;
    private tick = 0;
    /** Whether the entry is closed: nothing comes onto the lane, and its bank stays as it was at the close */
    private entry_closed = false;
    /** Items on the lane at the start */
    public readonly initial: number;
    /** Items the entry put on and the outlet took off, from the start */
    public supplied = 0;
    public drained = 0;

    constructor(args: SharedLaneArgs) {
        assert(args.lane_end.kind !== "unknown", "A shared lane runs with a known end: a lane of unknown end is run under each end");
        this.speed = args.belt_speed / BeltSpeed.TRANSPORT_BELT * 8;
        this.end = Math.round(args.length_tiles * 256);
        this.stack_size = args.stack_size;
        this.supply = args.supply_rate;
        this.outlet = args.lane_end.kind === "outlet" ? args.lane_end.outlet_rate : null;
        // both banks start full, so that a rate of the lane's capacity keeps up from the first tick
        this.supply_bank = this.stack_size * 60 * this.supply.denominator;
        this.outlet_bank = this.outlet === null ? 0 : this.stack_size * 60 * this.outlet.denominator;
        // the lane starts full: a stack every spacing from the end back to the entry
        for (let x = this.end; x >= 0; x -= STACK_SPACING) this.stacks.push({ x, count: this.stack_size });
        this.initial = this.items();
    }

    /** A taker's reach: the stretch of `length_tiles` that ends downstream at `edge_tiles` from the entry */
    public reachOf(edge_tiles: number, length_tiles: number): BeltPickupStock {
        const edge = Math.round(edge_tiles * 256), length = Math.round(length_tiles * 256);
        assert(edge - length >= 0 && edge <= this.end, `A reach of ${edge_tiles - length_tiles}-${edge_tiles} tiles is not on a lane of ${this.end / 256} tiles`);
        return new SharedLaneReach(this, { edge, length, last_take_tick: Number.NEGATIVE_INFINITY });
    }

    /** The lane in `tick`: every tick from the last one it stood in run in turn */
    public advanceTo(tick: number): void {
        assert(tick >= this.tick, "A shared lane cannot move backwards in time");
        while (this.tick < tick) {
            this.tick++;
            this.step();
        }
    }

    /**
     * Closes the entry from the next tick the lane runs: nothing more comes onto the lane, whose stacks go on moving and
     * being taken, so that it drains. What the entry's bank held stays, and it puts its next stack on when it is opened
     * and there is room, as before the close. The lane is brought up to `tick` first: the close takes effect after it.
     */
    public closeEntry(tick: number): void {
        this.advanceTo(tick);
        this.entry_closed = true;
    }

    /** Opens the entry again from the tick after `tick` (see closeEntry) */
    public openEntry(tick: number): void {
        this.advanceTo(tick);
        this.entry_closed = false;
    }

    /** One tick: the outlet takes the head where it may, every stack moves, then the entry puts a stack on where there is room */
    private step(): void {
        const stacks = this.stacks;
        const outlet = this.outlet;
        if (outlet !== null) {
            const unit = 60 * outlet.denominator;
            // the outlet takes a whole stack whenever it is not behind its rate, and is then behind by what it took over
            // its rate: over time it takes its rate, whatever the stack size and the ticks the stacks arrive in
            this.outlet_bank = Math.min(this.outlet_bank + outlet.numerator, this.stack_size * unit);
            while (stacks.length > 0 && stacks[0].x >= this.end && this.outlet_bank > 0) {
                this.outlet_bank -= stacks[0].count * unit;
                this.drained += stacks[0].count;
                stacks.shift();
            }
        }
        const speed = this.speed;
        for (let index = 0; index < stacks.length; index++) {
            const stack = stacks[index];
            // the head stops at the end until the outlet takes it; every other stack keeps its spacing behind the one ahead
            const limit = index === 0 ? this.end : stacks[index - 1].x - STACK_SPACING;
            stack.x = Math.max(stack.x, Math.min(stack.x + speed, limit));
        }
        if (this.entry_closed) return;
        const unit = 60 * this.supply.denominator, full = this.stack_size * unit;
        this.supply_bank = Math.min(this.supply_bank + this.supply.numerator, full);
        const tail = stacks[stacks.length - 1];
        if (this.supply_bank >= full && (tail === undefined || tail.x >= STACK_SPACING)) {
            // a stack that comes on right behind the tail keeps the spacing, as a compressed feed does; one into a gap
            // comes on at most one tick's travel past the entry
            stacks.push({ x: tail === undefined ? 0 : Math.min(tail.x - STACK_SPACING, speed), count: this.stack_size });
            this.supply_bank -= full;
            this.supplied += this.stack_size;
        }
    }

    /** The most upstream stack in the reach, as the pickup stocks choose: its index, or -1 */
    public reachable(reach: Reach): number {
        const low = reach.edge - reach.length;
        const stacks = this.stacks;
        for (let index = stacks.length - 1; index >= 0; index--) {
            const x = stacks[index].x;
            if (x > reach.edge) return -1;
            if (x > low) return index;
        }
        return -1;
    }

    /** The stack at `index` as a reach sees it: its position from the reach's downstream edge, upstream positive */
    public stackIn(reach: Reach, index: number): { position: number; count: number } {
        const stack = this.stacks[index];
        return { position: reach.edge - stack.x, count: stack.count };
    }

    /** Takes up to `capacity` of the stack at `index`; a stack taken whole leaves the lane */
    public takeAt(index: number, capacity: number): number {
        const stack = this.stacks[index];
        const taken = Math.min(stack.count, capacity);
        stack.count -= taken;
        if (stack.count === 0) this.stacks.splice(index, 1);
        return taken;
    }

    /** The stacks in the reach, as the pickup stocks' snapshots give them */
    public stacksIn(reach: Reach): (readonly [position: number, count: number])[] {
        const low = reach.edge - reach.length;
        return this.stacks.filter(stack => stack.x > low && stack.x <= reach.edge).map(stack => [reach.edge - stack.x, stack.count] as const);
    }

    /** Everything a later tick of the lane reads, for the state key */
    public key(): string {
        return `${this.entry_closed ? "closed;" : ""}${this.supply_bank};${this.outlet_bank};${this.stacks.map(stack => `${stack.x}:${stack.count}`).join(",")}`;
    }

    /** The items on the lane now */
    public items(): number {
        return this.stacks.reduce((sum, stack) => sum + stack.count, 0);
    }
}

/** One taker's reach on a shared lane, as a pickup stock: the lane is brought up to the tick before each read */
class SharedLaneReach implements BeltPickupStock {
    constructor(private readonly lane: SharedLane, private readonly reach: Reach) {}

    public peek(tick: number): { position: number; count: number } | undefined {
        this.lane.advanceTo(tick);
        const index = this.lane.reachable(this.reach);
        return index < 0 ? undefined : this.lane.stackIn(this.reach, index);
    }

    public take(tick: number, capacity: number): number {
        this.lane.advanceTo(tick);
        if (this.reach.last_take_tick === tick || capacity <= 0) return 0;
        const index = this.lane.reachable(this.reach);
        if (index < 0) return 0;
        this.reach.last_take_tick = tick;
        return this.lane.takeAt(index, capacity);
    }

    public hasTakenAt(tick: number): boolean {
        return this.reach.last_take_tick === tick;
    }

    public snapshot(tick: number): readonly (readonly [position: number, count: number])[] {
        this.lane.advanceTo(tick);
        return this.lane.stacksIn(this.reach);
    }

    /** The reach's own part: the lane's is keyed once, by the lane (`SharedLane.key`) */
    public stateKey(tick: number): string {
        this.lane.advanceTo(tick);
        return String(this.reach.last_take_tick === tick);
    }
}
