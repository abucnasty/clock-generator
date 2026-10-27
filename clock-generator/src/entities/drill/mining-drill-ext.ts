import { MiningDrill } from "./mining-drill";
import { Machine } from "../machine";
import { Item } from "../../data";

/**
 * the actual limit of how much the drill can insert into a machine per tick is the automated insertion limit + 64
 * however, in practice it is observed that the mining drill will stop at a minimum of 114 items
 * the assumption is due to the stack size of stone being 50 + 64 = 114
 */
export function miningDrillMaxInsertion(
    drill: MiningDrill,
    sink_machine: Machine
): number {
    return directMachineInsertionLimit(drill.item, sink_machine);
}

/** Results placed directly into a machine use the mining drill's stop, not an inserter's limit. */
export function directMachineInsertionLimit(mined_item: Item, sink_machine: Machine): number {
    const machine_input = sink_machine.inputs.getOrThrow(mined_item.name);
    const automated_insertion_limit = machine_input.automated_insertion_limit.quantity;
    const mined_item_stack_size = mined_item.stack_size;
    const max_insertion_per_tick = Math.max(mined_item_stack_size, automated_insertion_limit);
    return max_insertion_per_tick + 64;
}
