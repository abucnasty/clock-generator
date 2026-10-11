import { OpenRange } from "../../data-types";

export interface InventoryTransfer {
    item_name: string;
    tick_range: OpenRange;
    amount: number;
    /**
     * Set on a swing that was picked up before the recorded run started and so is in flight at its first tick: the
     * tick of that pickup, which is negative. The tick range of such a swing starts at the first tick of the run.
     */
    pickup_tick_before_run?: number;
}