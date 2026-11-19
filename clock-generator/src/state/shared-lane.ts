import assert from "../common/assert";
import { BeltSpeed } from "../entities/belt";
import { laneItemsPerSecond } from "../entities/belt/belt-speed";
import { Ratio, ratioOf } from "../entities/traits/ratio";
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

/**
 * An inserter that puts the lane's items onto it from a chest that never runs out (a feeder): where it puts them down, and
 * how its arm moves. It is never disabled by a clock: it runs as the game runs an unwired inserter.
 */
export interface SharedLaneFeeder {
    /** Its drop spot, the middle of its belt tile, in tiles from the lane's entry along the flow */
    readonly spot_tiles: number;
    /** Items in a full hand; it puts them down a stack of the lane's stack size at a time, the last one what is left */
    readonly hand_items: number;
    /** Ticks the arm turns each way between the chest and the belt */
    readonly rotation_ticks: number;
    /** Ticks it takes to pick a hand up from the chest */
    readonly pickup_ticks: number;
}

/** What a shared lane is made of: the belt, the stack size, its supply rate at the entry and its end */
export interface SharedLaneArgs {
    readonly belt_speed: BeltSpeed;
    readonly stack_size: number;
    /** Items a second that come onto the lane at its entry, where it has no feeders */
    readonly supply_rate: Ratio;
    readonly lane_end: LaneEnd;
    /** Where the lane ends, in tiles from its entry */
    readonly length_tiles: number;
    /**
     * The inserters that put the items onto the lane, upstream first; where they are given, the items come on as their
     * drops do (`FeederState`), in place of a flow at `supply_rate`
     */
    readonly feeders?: readonly SharedLaneFeeder[];
    /** The lane as lines cut at its underground entrances (`SharedLaneLines`); without it, one line moved whole each tick */
    readonly lines?: SharedLaneLines;
}

/**
 * A lane cut into lines, as the game cuts one at each underground entrance that has an exit after it: each line runs from
 * one entrance's end to the next. The game moves the lines of a tick before the inserters take, and only the lines on its
 * active list, in the order they went on it:
 * - a line first moves the line it feeds, where that line is on the list and has not moved this tick;
 * - a line that moved nothing goes off the list; one that moved puts the line feeding it on;
 * - a stack that crosses into the next line puts that line on, and counts as that line moving; a stack moves once a tick;
 * - a line put back on after it was updated in a tick does not move again until the next tick;
 * - the takes of a tick put their line and the line feeding it on, downstream first, then the lines the entry put stacks on
 *   (each feeder's drop, upstream feeder first).
 *
 * So a stack can wait one tick at a line's end where the one-line lane would move it: where its line was updated while the
 * line ahead stood off the list, and that line went back on later in the same tick. Measured in Factorio 2.1.24 on the
 * nine-copy automation science 240 scaffold (#737): every copper wait of a recording of a copper stop, at the entrances'
 * ends and nowhere else, and the run of its time-study clock, every tick. The order of the takes in a tick (downstream
 * first) is the one those recordings fit; the game's own order of them is not established.
 */
export interface SharedLaneLines {
    /** The line ends, in tiles from the lane's entry, ascending: a stack exactly at one is on the line upstream of it */
    readonly cuts_tiles: readonly number[];
}

/**
 * Where a stack put down at `spot` lands on a lane whose stacks moved this tick, `stacks` from the head: one belt step
 * downstream of the spot, or a quarter tile behind the nearest stack ahead of it, and only strictly less than a quarter
 * tile behind the spot; null where there is no room. A stack one belt step upstream of the landing (a follower) does not
 * push it back: the new stack goes in ahead of it, and the follower stands until the spacing opens again. This is
 * `LaneTraffic`'s landing (lane-traffic.ts) but for the follower, which the game shows: the gear feeders of the
 * automation science 240 scaffold, twice in a recording of its copper stop (Factorio 2.1.24, #737).
 */
export function dropLanding(spot: number, speed: number, stacks: readonly { x: number }[]): number | null {
    let landing = spot + speed;
    // the stacks a spacing or more ahead of the first landing leave it where it is: start from the most downstream one nearer
    let first = stacks.length;
    while (first > 0 && stacks[first - 1].x < landing + STACK_SPACING) first--;
    for (let index = first; index < stacks.length; index++) {
        const x = stacks[index].x;
        // the stacks are in order from the head: once one is at or behind the landing less a step, so is every later one
        if (x <= landing - speed) break;
        landing = Math.min(landing, x - STACK_SPACING);
    }
    return landing <= spot - STACK_SPACING ? null : landing;
}

/**
 * A feeder as it runs: a full hand goes down one stack a tick wherever `dropLanding` finds room, the empty hand turns back
 * to the chest, picks a hand up and turns out again. Timed on the legendary stack inserters of the automation science 240
 * scaffold (Factorio 2.1.24, #737): after the tick its last stack goes down the arm turns back, picks up, turns
 * out, and tries its next stack the tick after (2 rotations + the pickup + 1 ticks); a hand is full from the pickup's tick.
 */
interface FeederState {
    readonly spot: number;
    readonly hand_items: number;
    readonly rotation_ticks: number;
    readonly away_ticks: number;
    /** Items in the hand */
    hand: number;
    /** Ticks the arm still turns or picks up before it tries a stack; 0 at the belt */
    away: number;
}

/**
 * One lane of a belt with every taker of every copy on it, tick by tick: stacks come on at the entry at the supply rate
 * while there is room, move downstream at the belt's speed, keep a stack's spacing behind the stack ahead, and at the
 * end either stand (a dead end) or leave at the lane's capacity (an infinite end). A taker reaches a stretch of the lane and takes
 * at most one stack, or part of one, a tick (`reachOf`). A taken stack leaves a gap that the stacks behind close where
 * they stand, and that travels on with them where they move.
 *
 * The supply is a flow, not a queue: what the entry cannot put on while the lane is full at the entry is lost, as the
 * belt upstream of the entry is not part of the model. The entry is where the items come onto the lane: the lane's supply
 * length (`supply_tiles`) before copy 1's pickup, so the belt from the feeders to copy 1 is on the lane
 * (shared-lane-model.ts `sharedLaneLayoutOf`). Where the lane's feeders are given, they are the supply in place of the
 * flow: each puts its hand down a stack at a time where there is room at its spot (`dropLanding`), so the holes and the
 * places of the stacks at the entry are the game's. A feeder's stack may land up to 1/8 tile upstream of its spot, so
 * upstream of the entry where the feeder stands there.
 *
 * A lane given its underground entrances (`lines`) moves as the game's lines cut there (`SharedLaneLines`), in place of
 * one line moved whole.
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
    /** The rate at which the infinite end takes, the lane's capacity, exact as the entry's; null at a dead end */
    private readonly infinite_end: Ratio | null;
    /** The stacks from the head (furthest downstream) to the tail */
    private stacks: LaneStack[] = [];
    private supply_bank = 0;
    private infinite_end_bank = 0;
    private tick = 0;
    /** Whether the entry is closed: nothing comes onto the lane, and its bank stays as it was at the close */
    private entry_closed = false;
    /** The feeders, upstream first; none where the lane takes its items as a flow at the supply rate */
    private readonly feeders: FeederState[];
    /** Items on the lane at the start */
    public readonly initial: number;
    /** Items the entry put on and the infinite end took off, from the start */
    public supplied = 0;
    public drained = 0;
    /** The line ends in 1/256 tile (`SharedLaneLines`); null for a lane of one line */
    private readonly cuts: number[] | null = null;
    /** The lines on the active list, in the order they went on it: 0 is the line at the entry */
    private active: number[] = [];
    /** Where the takes of the tick that stands took, and where the entry put stacks on: their lines go on the list next tick */
    private taken_at: number[] = [];
    private put_on_at: number[] = [];

    constructor(args: SharedLaneArgs) {
        assert(args.lane_end.kind !== "unknown", "A shared lane runs with a known end: a lane of unknown end is run under each end");
        this.speed = args.belt_speed / BeltSpeed.TRANSPORT_BELT * 8;
        this.end = Math.round(args.length_tiles * 256);
        this.stack_size = args.stack_size;
        this.supply = args.supply_rate;
        // the lane's capacity: half the belt's speed times the stack size, as laneFactsOf gives it
        this.infinite_end = args.lane_end.kind === "infinite" ? ratioOf(laneItemsPerSecond(args.belt_speed, args.stack_size)) : null;
        // both banks start full, so that a rate of the lane's capacity keeps up from the first tick
        this.supply_bank = this.stack_size * 60 * this.supply.denominator;
        this.infinite_end_bank = this.infinite_end === null ? 0 : this.stack_size * 60 * this.infinite_end.denominator;
        // each feeder starts at the belt with a full hand
        this.feeders = (args.feeders ?? []).map(feeder => {
            assert(feeder.hand_items > 0 && feeder.rotation_ticks >= 0 && feeder.pickup_ticks >= 0, "A feeder carries a hand and turns forwards");
            return {
                spot: Math.round(feeder.spot_tiles * 256), hand_items: feeder.hand_items, rotation_ticks: feeder.rotation_ticks,
                away_ticks: 2 * feeder.rotation_ticks + feeder.pickup_ticks, hand: feeder.hand_items, away: 0,
            };
        });
        if (this.feeders.length > 0 && this.infinite_end === null) {
            // the lane starts full as its feeders fill it: from empty until it stands, every feeder at the belt with what its
            // hand still holds, as the game's lane stands before the build starts
            this.fillFromFeeders();
            this.supplied = 0;
        } else {
            // the lane starts full: a stack every spacing from the end back to the entry
            for (let x = this.end; x >= 0; x -= STACK_SPACING) this.stacks.push({ x, count: this.stack_size });
        }
        this.initial = this.items();
        if (args.lines !== undefined) {
            assert(this.infinite_end === null, "A lane in lines runs to a dead end only");
            const cuts = args.lines.cuts_tiles.map(tiles => Math.round(tiles * 256));
            assert(cuts.every((cut, at) => cut > 0 && cut < this.end && (at === 0 || cut > cuts[at - 1])),
                `The line ends of a lane of ${this.end / 256} tiles go up inside it: ${args.lines.cuts_tiles.join(", ")}`);
            this.cuts = cuts;
            // every line goes on at the start, downstream first: one that cannot move goes off in the first tick
            this.active = Array.from({ length: cuts.length + 1 }, (_, at) => cuts.length - at);
        }
    }

    /** The line a position is on: the number of line ends upstream of it (a stack at an end is on the line upstream of it) */
    private lineOf(x: number): number {
        const cuts = this.cuts!;
        let line = 0;
        while (line < cuts.length && cuts[line] < x) line++;
        return line;
    }

    private putOn(line: number): void {
        if (line >= 0 && !this.active.includes(line)) this.active.push(line);
    }

    /** One tick of a lane in lines (`SharedLaneLines`): the lines on the list move, then the entry puts its stacks on */
    private stepLines(): void {
        const stacks = this.stacks;
        // what the takes of the tick before put on the list, downstream first, then the entry's stacks
        for (const x of this.taken_at.sort((a, b) => b - a)) {
            const line = this.lineOf(x);
            this.putOn(line);
            this.putOn(line - 1);
        }
        for (const x of this.put_on_at) this.putOn(this.lineOf(x));
        this.taken_at = [];
        this.put_on_at = [];

        const lines = this.cuts!.length + 1;
        // each stack's line at the start of the tick, kept as stacks cross: the stacks of a line stand together, head first
        const line_of = stacks.map(stack => this.lineOf(stack.x));
        const updated = new Array<boolean>(lines).fill(false);
        const got = new Array<boolean>(lines).fill(false);
        const moved_this_tick = new Array<boolean>(stacks.length).fill(false);
        const speed = this.speed;
        const update = (line: number): void => {
            updated[line] = true;
            if (line + 1 < lines && !updated[line + 1] && this.active.includes(line + 1)) update(line + 1);
            let moved = false;
            for (let index = 0; index < stacks.length; index++) {
                if (line_of[index] !== line || moved_this_tick[index]) continue;
                const stack = stacks[index];
                const limit = index === 0 ? this.end : stacks[index - 1].x - STACK_SPACING;
                const x = Math.max(stack.x, Math.min(stack.x + speed, limit));
                if (x === stack.x) continue;
                moved = true;
                moved_this_tick[index] = true;
                stack.x = x;
                const into = this.lineOf(x);
                if (into !== line) {
                    line_of[index] = into;
                    got[into] = true;
                    this.putOn(into);
                }
            }
            if (moved || got[line]) this.putOn(line - 1);
            else this.active = this.active.filter(it => it !== line);
        };
        // the list in its order: a line put on (back) during the walk is reached in it, and one already updated waits
        for (let at = 0; at < this.active.length;) {
            if (updated[this.active[at]]) {
                at++;
                continue;
            }
            update(this.active[at]);
            at = 0;
        }
        if (!this.entry_closed) this.enter();
    }

    /** The feeders fill the empty lane, tick by tick, until no stack moves, no feeder puts a stack down and none is away */
    private fillFromFeeders(): void {
        // a lane of n stacks fills in fewer than n hands' turns and n ticks of travel each: a bound, not a guess of the length
        const bound = (this.end / STACK_SPACING + 2) * (Math.max(...this.feeders.map(feeder => feeder.away_ticks)) + this.end / this.speed + 2);
        for (let tick = 0; tick < bound; tick++) {
            const moved = this.move();
            const fed = this.feed();
            if (!moved && !fed && this.feeders.every(feeder => feeder.away === 0)) return;
        }
        assert(false, "The feeders never filled the lane");
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
     * and there is room, as before the close. Feeders stand as they are, hand and arm, as the game's stand when they are
     * disabled by script. The lane is brought up to `tick` first: the close takes effect after it.
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

    /** One tick: the infinite end takes the head where it may, every stack moves, then the entry puts a stack on where there is room */
    private step(): void {
        if (this.cuts !== null) {
            this.stepLines();
            return;
        }
        const stacks = this.stacks;
        const infinite_end = this.infinite_end;
        if (infinite_end !== null) {
            const unit = 60 * infinite_end.denominator;
            // the infinite end takes a whole stack whenever it is not behind its rate, and is then behind by what it took
            // over its rate: over time it takes its rate, whatever the stack size and the ticks the stacks arrive in
            this.infinite_end_bank = Math.min(this.infinite_end_bank + infinite_end.numerator, this.stack_size * unit);
            while (stacks.length > 0 && stacks[0].x >= this.end && this.infinite_end_bank > 0) {
                this.infinite_end_bank -= stacks[0].count * unit;
                this.drained += stacks[0].count;
                stacks.shift();
            }
        }
        this.move();
        if (!this.entry_closed) this.enter();
    }

    /** The entry's part of a tick, after the stacks moved: the feeders put their stacks down, or the flow puts one on where there is room */
    private enter(): void {
        if (this.feeders.length > 0) {
            this.feed();
            return;
        }
        const stacks = this.stacks;
        const unit = 60 * this.supply.denominator, full = this.stack_size * unit;
        this.supply_bank = Math.min(this.supply_bank + this.supply.numerator, full);
        const tail = stacks[stacks.length - 1];
        if (this.supply_bank >= full && (tail === undefined || tail.x >= STACK_SPACING)) {
            // a stack that comes on right behind the tail keeps the spacing, as a compressed feed does; one into a gap
            // comes on at most one tick's travel past the entry
            const x = tail === undefined ? 0 : Math.min(tail.x - STACK_SPACING, this.speed);
            stacks.push({ x, count: this.stack_size });
            this.supply_bank -= full;
            this.supplied += this.stack_size;
            if (this.cuts !== null) this.put_on_at.push(x);
        }
    }

    /** Every stack moves: the head stops at the end until the infinite end takes it, every other keeps its spacing behind the one ahead; whether any moved */
    private move(): boolean {
        const stacks = this.stacks, speed = this.speed;
        let moved = false;
        for (let index = 0; index < stacks.length; index++) {
            const stack = stacks[index];
            const limit = index === 0 ? this.end : stacks[index - 1].x - STACK_SPACING;
            const x = Math.max(stack.x, Math.min(stack.x + speed, limit));
            if (x !== stack.x) moved = true;
            stack.x = x;
        }
        return moved;
    }

    /**
     * The feeders' part of a tick, after the stacks moved, upstream feeder first: each at the belt puts a stack down where
     * it lands (`dropLanding`), or waits with its hand; each away turns or picks up. Whether any put a stack down.
     */
    private feed(): boolean {
        const stacks = this.stacks;
        let fed = false;
        for (const feeder of this.feeders) {
            if (feeder.away > 0) {
                feeder.away--;
                // the arm has turned back and picked a hand up: it turns out from the next tick
                if (feeder.away === feeder.rotation_ticks) feeder.hand = feeder.hand_items;
                continue;
            }
            const landing = dropLanding(feeder.spot, this.speed, stacks);
            if (landing === null) continue;
            let index = stacks.length;
            while (index > 0 && stacks[index - 1].x < landing) index--;
            const count = Math.min(this.stack_size, feeder.hand);
            stacks.splice(index, 0, { x: landing, count });
            if (this.cuts !== null) this.put_on_at.push(landing);
            this.supplied += count;
            fed = true;
            feeder.hand -= count;
            if (feeder.hand > 0) continue;
            feeder.away = feeder.away_ticks;
            if (feeder.away === feeder.rotation_ticks) feeder.hand = feeder.hand_items;
        }
        return fed;
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
        // in lines, a take puts its line on the list (a take of part of a stack too: not established for a part)
        if (this.cuts !== null && taken > 0) this.taken_at.push(stack.x);
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
        const feeders = this.feeders.length === 0 ? "" : `${this.feeders.map(feeder => `${feeder.hand}/${feeder.away}`).join(",")};`;
        // in lines, the list's order and what the tick's takes and entry put on decide what moves next
        const lines = this.cuts === null ? "" : `;lines ${this.active.join(".")};${[...this.taken_at].sort((a, b) => b - a).join(".")};${this.put_on_at.join(".")}`;
        return `${this.entry_closed ? "closed;" : ""}${feeders}${this.supply_bank};${this.infinite_end_bank};${this.stacks.map(stack => `${stack.x}:${stack.count}`).join(",")}${lines}`;
    }

    /** The items in each feeder's hand now, upstream first */
    public feederHands(): number[] {
        return this.feeders.map(feeder => feeder.hand);
    }

    /** Every stack on the lane now, from the head: its place in tiles from the entry, and its count */
    public stackPositions(): (readonly [tiles: number, count: number])[] {
        return this.stacks.map(stack => [stack.x / 256, stack.count] as const);
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
