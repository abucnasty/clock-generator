/** Reachable stock, preserved between hands and when an inserter's control is replaced. */
export interface BeltPickupStock {
    snapshot(tick: number): readonly (readonly [position: number, count: number])[];
    peek(tick: number): {position: number; count: number} | undefined;
    take(tick: number, capacity: number): number;
    hasTakenAt(tick: number): boolean;
    stateKey(tick: number): string;
}
