import { BeltSpeed } from "../entities/belt";

const STACK_SPACING = 64;
const DROP_REACH = 64;

/**
 * Finite traffic at the drop spots on a freely draining lane. Positions increase downstream in 1/256-tile units.
 * Existing stacks move first. A new stack lands one movement step beyond its nominal spot, or behind preceding
 * stock, strictly within a quarter tile behind that spot. An insertion can compress the gap of an upstream
 * follower; it then waits for spacing to reopen, never moving backwards. Calibrated on legendary stack inserters.
 */
export class LaneTraffic {
    private positions: number[] = [];
    private tick = 0;
    private last_spot_units = Number.NEGATIVE_INFINITY;
    private readonly speed: number;

    constructor(belt_speed: BeltSpeed = BeltSpeed.TURBO_TRANSPORT_BELT, initial?: {tick: number; positions: readonly number[]}) {
        this.speed = belt_speed / BeltSpeed.TRANSPORT_BELT * 8;
        if (initial) {
            this.tick = initial.tick;
            this.positions = [...initial.positions];
        }
    }

    /** Spot coordinates retain the public ticks-of-belt-travel convention; fractional ticks are supported. */
    public registerSpot(spot_ticks: number): void {
        this.last_spot_units = Math.max(this.last_spot_units, this.spotUnits(spot_ticks));
    }

    public tryPlace(tick: number, spot_ticks: number): boolean {
        this.registerSpot(spot_ticks);
        this.advanceTo(tick);
        const spot = this.spotUnits(spot_ticks);
        let landing = spot + this.speed;
        for (const ahead of [...this.positions].sort((a, b) => b - a)) {
            if (ahead >= landing - this.speed) landing = Math.min(landing, ahead - STACK_SPACING);
        }
        if (landing <= spot - DROP_REACH) return false;
        this.positions.push(landing);
        return true;
    }

    public stateKey(tick: number): string {
        this.advanceTo(tick);
        // Keep the existing relative-origin encoding, adjusted for post-movement landing coordinates.
        return this.positions.map(position => 1 - position / this.speed).sort((a, b) => a - b).join(",");
    }

    /** Physical stock for native comparisons; not a reference to the lane's mutable state. */
    public snapshot(tick: number): readonly number[] {
        this.advanceTo(tick);
        return [...this.positions].sort((a, b) => b - a);
    }

    private spotUnits(spot_ticks: number): number {
        return Math.round(spot_ticks * this.speed);
    }

    private advanceTo(tick: number): void {
        if (tick < this.tick) throw new Error("Output lane traffic cannot move backwards in time");
        const travel = (tick - this.tick) * this.speed;
        if (travel === 0) return;
        let ahead = Number.POSITIVE_INFINITY;
        this.positions = this.positions.sort((a, b) => b - a).map(position => {
            const moved = Math.max(position, Math.min(position + travel, ahead - STACK_SPACING));
            ahead = moved;
            return moved;
        }).filter(position => position <= this.last_spot_units + 128);
        this.tick = tick;
    }
}
