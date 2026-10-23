import { chestName, ChestType } from "../common/entity-types";
import { FactorioDataService, ItemName } from "../data";
import { Chest, Entity } from "../entities";
import { EntityState, InserterState } from "../state";
import { isEmptiedByTheBuild, itemsCarried } from "./backpressure-loss";
import type { SimulationContext } from "./sequence/simulation-context";

/**
 * A chest the build puts its output into that nothing takes from and that has no room for it any more, where a run
 * ended: the clock cannot move the output while it stays full.
 */
export interface FullOutputChest {
    /** The chest's id in the config */
    chest_id: number;
    chest_type: ChestType;
    /** The chest as a player names it: "Chest 1", "Car 2" */
    name: string;
    item: ItemName;
    /** The game's name of the item, in lower case: "electromagnetic science pack" */
    item_label: string;
    /** What it held of the item, and the most it holds of it */
    held: number;
    capacity: number;
    /** The output inserters that drop into it, by number */
    inserter_ids: number[];
}

/**
 * The finite chests that the output inserters drop into, that no inserter of the build takes from, and that are full
 * for the item they are given, as the state of the simulation is now. The output inserters are those that take the
 * build's product out of its machines.
 */
export function fullOutputChestsOf(context: SimulationContext, output_inserters: readonly InserterState[]): FullOutputChest[] {
    const registry = context.entity_registry;
    const inserters = registry.getAll().filter(Entity.isInserter);
    const full = new Map<string, FullOutputChest>();
    for (const state of output_inserters) {
        const sink = context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id);
        if (!EntityState.isFiniteChest(sink) || isEmptiedByTheBuild(inserters, sink.entity_id)) {
            continue;
        }
        const item = itemsCarried(registry, state.inserter).find(it => sink.isFull(it));
        if (item === undefined) {
            continue;
        }
        const key = `${sink.entity_id.id}:${item}`;
        const known = full.get(key);
        if (known !== undefined) {
            known.inserter_ids.push(state.inserter.entity_id.number);
            continue;
        }
        const chest: Chest = sink.chest;
        full.set(key, {
            chest_id: sink.entity_id.number,
            chest_type: chest.chest_type,
            name: chestName(chest.chest_type, sink.entity_id.number),
            item,
            item_label: FactorioDataService.itemDisplayName(item).toLowerCase(),
            held: sink.getCurrentQuantity(item),
            capacity: sink.getCapacity(item),
            inserter_ids: [state.inserter.entity_id.number],
        });
    }
    return Array.from(full.values());
}
