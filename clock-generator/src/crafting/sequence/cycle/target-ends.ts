import { TargetCounts } from "../../../config/schema";
import { ItemName } from "../../../data";
import { Entity, Inserter, Machine, ReadableEntityRegistry } from "../../../entities";
import { buildOutputInsertersOf, insertersBringingIn } from "./swing-counts";

/**
 * Where a target is counted. A target that counts the item made is counted at the inserters that take it out of the
 * build, from the machines that make it (`buildOutputInsertersOf`). A target that counts the item destroyed is counted
 * at the inserters that bring it into the build from outside it, into the machines that destroy it: machines that
 * place their results themselves into a result target (a recycler that voids ore), whose results are not counted.
 */
export interface TargetItem {
    readonly item: ItemName;
    readonly counts: TargetCounts;
}

type Registry = Pick<ReadableEntityRegistry, "getAll">;

/** The machines the target is counted at: those that make the item, or those that destroy it as it comes in from outside */
export function targetMachinesOf(target: TargetItem, registry: Registry): Machine[] {
    const machines = registry.getAll().filter(Entity.isMachine);
    if (target.counts === "made") {
        return machines.filter(machine => machine.output.item_name === target.item);
    }
    return machines.filter(machine => machine.inputs.has(target.item) && insertersBringingIn(machine, target.item, registry).length > 0);
}

/** The inserters a target machine's share of the target is counted at */
export function targetInsertersOf(machine: Machine, target: TargetItem, registry: Registry): Inserter[] {
    return target.counts === "made" ? buildOutputInsertersOf(machine, registry) : insertersBringingIn(machine, target.item, registry);
}

/** The target of a config's `target_output` */
export function targetItemOf(target_output: { recipe: ItemName; counts?: TargetCounts }): TargetItem {
    return { item: target_output.recipe, counts: target_output.counts ?? "made" };
}
