import { BeltSpeed } from "../entities/belt";

/** The room one stack takes on a lane, in 1/256-tile units (BackedUpPickupLane, BeltPickupLane) */
const STACK_SPACING = 64;

/**
 * Whether a belt line is moving: the closing of the gaps that takes leave in a backed-up line. In a tick the belt moves
 * its lines first: a line that is moving closes its gap by its speed (8, 16, 24 or 32 units a tick), and once no gap is
 * left it stops in the next tick. Then the inserters: a take that empties a stack leaves a gap of one stack and sets the
 * line moving at once, so an inserter updated later in that tick finds it moving. A line is so moving in the tick of a
 * take and for ceil(gap / speed) ticks after it; for a stack of four on a turbo belt, 2 ticks a stack taken, plus the tick
 * of the take.
 *
 * Read in Factorio 2.1.24 on a backed-up turbo belt of stacks of four, fed from its start, nothing taking downstream (the
 * sample metallurgic science build): 9,658 of 9,658 ticks in which the game moved either of its two lines, and no other,
 * worked out from the takes in the recording. Other belt speeds, stack sizes, a belt that is not backed up and a belt
 * taken from downstream are not checked.
 */
export class BeltLineMotion {
    /** Whether the motion is kept (`track`): until then a line is still, and keys nothing */
    private tracked = false;
    private readonly speed: number;
    /** The gap left to close, after the belt's part of the tick `at` and the takes in it so far */
    private gap = 0;
    private moving = false;
    private at = 0;

    constructor(belt_speed: BeltSpeed) {
        this.speed = belt_speed / BeltSpeed.TRANSPORT_BELT * 8;
    }

    /** From now on the motion is kept (the new dispatch: a belt-fed hand sleeps only on still lines) */
    public track(): void {
        this.tracked = true;
    }

    public get tracking(): boolean {
        return this.tracked;
    }

    /** A take in `tick` that emptied `stacks` stacks of the line */
    public taken(tick: number, stacks: number): void {
        if (!this.tracked || stacks <= 0) return;
        this.advanceTo(tick);
        this.gap += stacks * STACK_SPACING;
        this.moving = true;
    }

    /** Whether the line is moving in `tick`, after the belt's part of it and the takes in it so far */
    public movingAt(tick: number): boolean {
        this.advanceTo(tick);
        return this.moving;
    }

    /** The ticks the line still moves after `tick`, -1 while it is still: its part of a simulation's key; empty untracked */
    public key(tick: number): string {
        if (!this.tracked) return "";
        this.advanceTo(tick);
        return this.moving ? String(Math.ceil(this.gap / this.speed)) : "-1";
    }

    private advanceTo(tick: number): void {
        if (tick < this.at) throw new Error("A belt line cannot move backwards in time");
        const ticks = tick - this.at;
        this.at = tick;
        if (ticks === 0 || !this.moving) return;
        // a tick a gap is left closes it by the speed; the first tick after none is left stops the line
        this.moving = ticks <= Math.ceil(this.gap / this.speed);
        this.gap = Math.max(0, this.gap - ticks * this.speed);
    }
}
