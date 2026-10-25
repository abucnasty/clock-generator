import { Item } from "../data";
import { directMachineInsertionLimit } from "../entities/drill/mining-drill-ext";
import { MachineState, WritableInventoryState } from "../state";

/** A drill or a machine placing a result directly: transfer up to the drill's stop; leave the rest at the source. */
export function placeIntoMachine(source: WritableInventoryState, target: MachineState, item: Item): number {
    if (!target.machine.inputs.has(item.name)) return 0;
    const room = Math.max(0, directMachineInsertionLimit(item, target.machine)
        - MachineState.ingredientQuantity(target, item.name));
    const amount = Math.min(source.getQuantity(item.name), room);
    if (amount > 0) {
        source.removeQuantity(item.name, amount);
        MachineState.ingredientInventory(target, item.name).addQuantity(item.name, amount);
    }
    return amount;
}
