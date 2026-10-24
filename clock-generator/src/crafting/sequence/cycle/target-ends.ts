import { TargetCounts } from "../../../config/schema";
import { ItemName } from "../../../data";
import { Entity, Inserter, Machine, ReadableEntityRegistry } from "../../../entities";
import { buildOutputInsertersOf, insertersBringingIn, resultTakersOf } from "./swing-counts";

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

/**
 * The refusal of a target that counts as made an item a machine places into its result target and the build takes back
 * into that machine, none of it leaving the build: a recycler that voids ore, with what it gives back as the target (as
 * the cuts of the ore voider benchmark were first written, before a target could count an item destroyed). It names the
 * target to write instead: the item destroyed, at the rate the given one stands for (crafts are what comes back over its
 * expected amount a craft; each destroys what it uses less what comes back). Null for any other target.
 */
export function returnedTargetRefusal(target: TargetItem, items_per_second: number, registry: Registry): string | null {
    if (target.counts !== "made") {
        return null;
    }
    for (const machine of targetMachinesOf(target, registry)) {
        const takers = resultTakersOf(machine, target.item, registry);
        if (machine.result_target === undefined || takers.length === 0 || buildOutputInsertersOf(machine, registry).length > 0
            || takers.some(taker => taker.sink.entity_id.id !== machine.entity_id.id) || !machine.inputs.has(target.item)) {
            continue;
        }
        const back = machine.output.amount_per_craft.toDecimal();
        const used = machine.inputs.getOrThrow(target.item).ingredient.amount;
        const destroyed = Number((items_per_second * (used - back) / back).toFixed(6));
        return `Machine ${machine.entity_id.number} places the ${target.item} of the target into ${machine.result_target}, and the build takes `
            + "all of it back into the machine: none leaves the build, so it is not made. A machine that destroys an item it is brought "
            + `is planned on what it destroys: set \`target_output.counts\` to "destroyed" and \`items_per_second\` to the ${target.item} it is `
            + `brought from outside, ${destroyed} for the ${Number(items_per_second.toFixed(6))} a second it gives back.`;
    }
    return null;
}
