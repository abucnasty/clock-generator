/** Reachable stock, preserved between hands and when an inserter's control is replaced. */
export interface BeltPickupStock {
    peek(tick: number): {position: number; count: number} | undefined;
    take(tick: number, capacity: number): number;
    hasTakenAt(tick: number): boolean;
    stateKey(tick: number): string;
}
