/**
 * The stacks on one lane of a belt that moves, shared by every inserter that drops on it (see docs/simulator.md,
 * "A stack inserter on a moving lane"). A stack put down at tick t at a spot `spot_ticks` of belt travel from the lane's
 * origin, d ticks behind the spot, has the origin t + d - spot_ticks; two stacks keep their origins' difference for as
 * long as they are on the lane, so the origin is all the lane has to remember of a stack.
 */
export class LaneTraffic {
    /** How far behind its spot an inserter may put a stack: a quarter of a tile at the speed of a turbo belt, in ticks */
    public static readonly MAX_DISPLACEMENT = 2;
    /** Stacks whose origins are closer than this are on the same slot of the belt (a quarter of a tile in ticks) */
    public static readonly MIN_SPACING = 2;

    private origins: number[] = [];
    private last_spot_ticks = Number.NEGATIVE_INFINITY;

    /** An inserter that drops on this lane stands this far along it; stacks are forgotten once past the last of them */
    public registerSpot(spot_ticks: number): void {
        this.last_spot_ticks = Math.max(this.last_spot_ticks, spot_ticks);
    }

    /**
     * Puts one stack down in this tick at the smallest displacement that has no stack within a tick of its origin.
     * Returns whether there was room; if not, the inserter tries again in the next tick.
     */
    public tryPlace(tick: number, spot_ticks: number): boolean {
        this.registerSpot(spot_ticks);
        this.forgetStacksPast(tick);
        for (let d = 0; d <= LaneTraffic.MAX_DISPLACEMENT; d++) {
            const origin = tick + d - spot_ticks;
            if (this.origins.every(it => Math.abs(it - origin) >= LaneTraffic.MIN_SPACING)) {
                this.origins.push(origin);
                return true;
            }
        }
        return false;
    }

    /** The origins relative to the tick, for the key that tells whether a simulation repeats */
    public stateKey(tick: number): string {
        this.forgetStacksPast(tick);
        return this.origins.map(it => it - tick).sort((a, b) => a - b).join(",");
    }

    private forgetStacksPast(tick: number): void {
        const oldest = tick - this.last_spot_ticks - LaneTraffic.MIN_SPACING;
        this.origins = this.origins.filter(it => it >= oldest);
    }
}
