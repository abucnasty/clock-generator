/** Reachable stock, preserved between hands and when an inserter's control is replaced. */
export interface BeltPickupStock {
    take(tick: number, capacity: number): number;
    hasTakenAt(tick: number): boolean;
    stateKey(tick: number): string;
}
