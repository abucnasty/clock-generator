import { ItemName } from "../data";

/**
 * What a belt or chest of the surroundings does not give or take for now. A belt and an infinity chest are a supply
 * that is always full and a place that always takes: with nothing in either set that is what they are, which is
 * every run but the one that tests a loss of backpressure (see crafting/backpressure-loss.ts).
 */
export class SupplyGate {
    /** Items that have stopped arriving: an inserter finds none of them here */
    public readonly withheld = new Set<ItemName>();
    /** Items that are not taken away any more: the belt is full of them, and so is the chest */
    public readonly refused = new Set<ItemName>();

    public isOpen(): boolean {
        return this.withheld.size === 0 && this.refused.size === 0;
    }
}
