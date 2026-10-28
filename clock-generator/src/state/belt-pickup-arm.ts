/**
 * Collection reach of the calibrated legendary stack inserter. Between belt grabs the arm extends/retracts
 * at its prototype speed. A stack within one more extension step can be collected and the hand snaps to it.
 * This is a radial collection constraint, not a model of the complete swing or of other inserter qualities.
 */
export class BeltPickupArm {
    private radius?: number;
    private last_move_tick = Number.NEGATIVE_INFINITY;

    constructor(private readonly extension_per_tick: number) {}

    /** Radius and extension use the same units. Start a new hand at its first already-arrived collection. */
    public tryCollect(tick: number, target_radius: number, new_hand: boolean): boolean {
        if (new_hand || this.radius === undefined) {
            this.radius = target_radius;
            this.last_move_tick = tick;
            return true;
        }
        if (tick < this.last_move_tick) throw new Error("Pickup arm cannot move backwards in time");
        if (this.last_move_tick !== tick) {
            const travel = this.extension_per_tick;
            this.radius += Math.max(-travel, Math.min(travel, target_radius - this.radius));
            this.last_move_tick = tick;
        }
        if (Math.abs(target_radius - this.radius) > this.extension_per_tick + 1e-9) return false;
        this.radius = target_radius;
        return true;
    }

    public stateKey(tick: number): string {
        return `${this.radius ?? ""};${this.last_move_tick === tick}`;
    }
}
