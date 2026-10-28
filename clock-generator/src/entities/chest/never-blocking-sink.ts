import { Entity } from "../entity";
import { Chest } from "./chest";

/** Whether an inserter's sink never refuses a hand: an infinity chest (a chest with room for the whole run is not told apart yet) */
export function isNeverBlockingSink(sink: Entity): boolean {
    return Entity.isChest(sink) && Chest.isInfinityChest(sink);
}
