/**
 * The transfers of a crafting cycle (EntityTransferCountMap) from the balance of the build's planner graph
 * (planner/balance.ts): the seed of the target's edges is found on the entity registry made from the config (the output
 * path of each machine that makes the target, or the inserters that bring a destroyed target in and take its results
 * out), the balance equations over the config's facts and graph give every other edge, and each transfer is the
 * registry's entity's. The registry's refusals come first, as the facts are built only once they pass.
 */
import { assertMachineResultTargetsSupported } from "../../../config/output-transfer-generation";
import assert from "../../../common/assert";
import Fraction from "../../../data-types/fraction";
import { Entity, EntityId, handSizeFor, Inserter, Machine, MiningDrill, ReadableEntityRegistry } from "../../../entities";
import type { Config } from "../../../config/schema";
import { Balance, balanceBuildOf, balanceOf } from "../../planner/balance";
import { EntityTransferCount, EntityTransferCountMap, insertersBringingIn, outputPathOf, resultTakersOf } from "./swing-counts";

/** The transfers of a balance, each with the registry's entity */
export function transfersOfBalance(balance: Balance, registry: ReadableEntityRegistry): EntityTransferCountMap {
    const entities = new Map(registry.getAll().map(entity => [entity.entity_id.id, entity]));
    return EntityTransferCountMap.fromEntries(balance.transfers.map(transfer => {
        const entity = entities.get(transfer.entity);
        assert(entity !== undefined && (Entity.isInserter(entity) || Entity.isDrill(entity)), `${transfer.entity} is no inserter or drill of the registry`);
        const count: EntityTransferCount = {
            entity: entity as Inserter | MiningDrill,
            item_transfers: transfer.items.map(it => ({ item_name: it.item, transfer_count: it.hands })),
            total_transfer_count: transfer.total,
            ...(transfer.needed === undefined ? {} : { needed_transfer_count: transfer.needed }),
            stack_size: transfer.hand,
        };
        return [entity.entity_id, count];
    }));
}

/**
 * The balance of a cycle of a target that counts an item made: `swings` output swings of each output machine a cycle,
 * in hands of `output_stack_size`, split among the inserters that take the target out of the build; with `cycle_ticks`,
 * what consumers outside the build take off export belts on top
 */
export function madeTargetBalance(
    output_machines: Machine[],
    entity_registry: ReadableEntityRegistry,
    config: Config,
    swings: Fraction,
    output_stack_size: number,
    cycle_ticks?: number,
): Balance {
    assertMachineResultTargetsSupported(entity_registry);
    assert(output_machines.length > 0, "At least one output machine is required");
    const outputs = output_machines.map(machine => {
        const path = outputPathOf(machine, entity_registry);
        const takers = path.container === null ? path.feeders : path.takers;
        assert(takers.length >= 1,
            `Output machine ${machine.entity_id.id} must have at least one dedicated output inserter, but found ${takers.length}.`);
        const first_stack_size = handSizeFor(takers[0], machine.output.item_name);
        for (const inserter of takers) {
            const hand_size = handSizeFor(inserter, machine.output.item_name);
            assert(hand_size === first_stack_size,
                `All output inserters from machine ${machine.entity_id.id} must have the same stack size. `
                + `Found ${hand_size} but expected ${first_stack_size}.`);
        }
        return {
            machine: machine.entity_id.id,
            takers: takers.map(it => it.entity_id.id),
            feeders: path.container === null ? [] : path.feeders.map(it => it.entity_id.id),
        };
    });
    const { facts, graph } = balanceBuildOf(config);
    return balanceOf(facts, graph, {
        counts: "made", item: output_machines[0].output.item_name, outputs, swings, hand: output_stack_size, cycle_ticks,
    });
}

/**
 * The balance of a cycle for a target that counts an item destroyed (target-ends.ts), by plain arithmetic. Each
 * machine that destroys it is brought `hands_per_machine` hands of it from outside the build a cycle, split evenly among
 * the inserters that bring it. That sets its crafts (destroyedTargetCrafts). Every result the machine places into its
 * result target is taken out at its expected amount a cycle, split evenly among the inserters that take that item out of
 * it, whether they bring it back into the machine or take it out of the build; the machine's other ingredients are
 * planned as any machine's. Nothing here is simulated: the simulator checks the plan.
 */
export function destroyedTargetBalance(
    machines: readonly Machine[],
    entity_registry: ReadableEntityRegistry,
    config: Config,
    item: string,
    hands_per_machine: Fraction,
    craftsOf: (machine: Machine, brought: Fraction) => Fraction,
): Balance {
    assertMachineResultTargetsSupported(entity_registry);
    const seeds = machines.map(machine => {
        const name = `Machine ${machine.entity_id.number}`;
        const target_id = machine.result_target;
        assert(target_id !== undefined && machine.metadata.places_results === true,
            `${name} destroys ${item}, which is planned for a machine that places its results itself into a container `
            + "(a recycler with a `result_target`) only");
        const bringing = insertersBringingIn(machine, item, entity_registry);
        assert(bringing.length > 0, `${name}: no inserter brings ${item} into it from outside the build`);
        const hand = handSizeFor(bringing[0], item);
        for (const inserter of bringing) {
            assert(handSizeFor(inserter, item) === hand,
                `${name}: the inserters that bring ${item} in have hands of ${hand} and ${handSizeFor(inserter, item)}; they have to be the same`);
        }
        const crafts = craftsOf(machine, hands_per_machine.multiply(hand));
        const results = machine.outputs.map(output => {
            const takers = resultTakersOf(machine, output.item_name, entity_registry);
            assert(takers.length > 0, `${name} places ${output.item_name} into ${target_id}, and no inserter takes it out: it fills up`);
            for (const taker of takers) {
                assert(EntityId.isMachine(taker.sink.entity_id) ? taker.sink.entity_id.id === machine.entity_id.id : true,
                    `Inserter ${taker.entity_id.number} takes ${output.item_name} out of ${target_id} into another machine, which is not planned yet`);
            }
            return { item: output.item_name, takers: takers.map(it => it.entity_id.id) };
        });
        return { machine: machine.entity_id.id, bringing: bringing.map(it => it.entity_id.id), crafts, results };
    });
    const { facts, graph } = balanceBuildOf(config);
    return balanceOf(facts, graph, { counts: "destroyed", item, hands: hands_per_machine, machines: seeds });
}
