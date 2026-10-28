import fs from "fs";
import { describe, expect, it } from "vitest";
import assert from "../common/assert";
import { assertInserterCoverage } from "../config/inserter-coverage-validator";
import { laneLoads } from "../config/lane-capacity-validator";
import { parseConfig } from "../config/loader";
import { assertOutputTransferGenerationSupported } from "../config/output-transfer-generation";
import { validateCopies } from "../config/copies-validator";
import { Config } from "../config/schema";
import Fraction, { fraction } from "../data-types/fraction";
import { Belt, Entity, handSizeFor, isNeverBlockingSink, Machine, ReadableEntityRegistry } from "../entities";
import { laneItemsPerSecond, laneStackFor } from "../entities/belt/belt";
import { ConfigTraits } from "../entities/traits/build-traits";
import { beltLanes } from "../entities/traits/lane";
import { decimalOf, fractionOf } from "../entities/traits/ratio";
import { SAMPLE_CONFIG_FILES } from "../entities/traits/sample-configs.fixture";
import { handOfItem, machinesInOrder, mainProductRateOf, neverRefuses, traitsOf, traitsOfMachine } from "../entities/traits/traits-of";
import { outputCapacityPerSecond } from "./alternatives";
import { beltPickupSlackTicks, fuelHandRoomTicks } from "./clock";
import { computeMachineTargetRates, MachineTargetRate } from "./machine-target-rates";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";
import type { EntityTransferCountMap } from "./sequence/cycle/swing-counts";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { TargetProductionRate } from "./target-production-rate";
import { neverBlockingBranchesOf, TerminalBranch } from "./terminal-rate";

// ============================================================================
// The planner's reads of the traits (R21), held to what it read before
// ============================================================================
//
// The replay check reaches the as-built and planning runs, not the search, the other taker orders, the trials or the
// insights, where a figure one float ulp off moves a clock unseen. So each place R21 moved onto the traits is held here
// to the derivation it read before, kept below as test code only, on every config the repository keeps with a target
// and on configs derived from each as the search derives them (the belts backed up or moving, other copies):
// fractions by their numerator and denominator (toStrictEqual), decimals bit for bit (toBe), whole results and maps
// with toStrictEqual. Nothing is rounded.

/** What the old derivations below gave, against the traits, summed over the configs */
const checked = { configs: 0, derived: 0, machines: 0, results: 0, targets: 0, rates: 0, lanes: 0, loads: 0, sinks: 0, hands: 0, belt_inserters: 0 };

// ---------------------------------------------------------------------------------------------------------------------
// The old derivations (before R21), as they were
// ---------------------------------------------------------------------------------------------------------------------

/** plan-run's, primitive-grouped-hands' and machine-target-rates' read of a machine's capacity */
const oldMainProductRate = (machine: Machine): Fraction => machine.output.production_rate.amount_per_second;

/** alternatives.ts outputCapacityPerSecond before R21: a registry built to read the machines */
function oldOutputCapacityPerSecond(config: Config): number {
    const item = TargetProductionRate.fromConfig(config.target_output).machine_production_rate.item;
    return createEntityRegistryFromConfig(config).getAll().filter(Entity.isMachine)
        .filter(machine => machine.output.item_name === item)
        .reduce((sum, machine) => sum + machine.output.production_rate.amount_per_second.toDecimal(), 0) * (config.target_output.copies ?? 1);
}

/** machine-target-rates.ts computeMachineTargetRates before R21, line for line */
function oldComputeMachineTargetRates(config: Config): MachineTargetRate[] {
    assertOutputTransferGenerationSupported(config);
    validateCopies(config);
    assert(Number.isFinite(config.target_output.items_per_second) && config.target_output.items_per_second > 0,
        "Set a positive target output rate to see at-target rates.");
    assertInserterCoverage(config);
    const registry = createEntityRegistryFromConfig(config);
    const target = TargetProductionRate.fromConfig(config.target_output);
    const cycle = CraftingCyclePlan.create(target, registry, fraction(1));
    const seconds = cycle.total_duration_ticks.divide(60);
    const taken = new Map<string, number>();
    const placing = new Map(registry.getAll().filter(Entity.isMachine).flatMap(machine =>
        machine.result_target === undefined ? [] : [[machine.result_target.id, machine] as const]));
    for (const transfer of cycle.entity_transfer_map.values()) {
        if (!Entity.isInserter(transfer.entity)) continue;
        const from = registry.getEntityByIdOrThrow(transfer.entity.source.entity_id);
        const source = Entity.isMachine(from) ? from : placing.get(from.entity_id.id);
        if (source === undefined) continue;
        const product = transfer.item_transfers.find(item => item.item_name === source.output.item_name);
        if (!product) continue;
        const rate = product.transfer_count.multiply(handSizeFor(transfer.entity, source.output.item_name))
            .divide(seconds).toDecimal();
        taken.set(source.entity_id.id, (taken.get(source.entity_id.id) ?? 0) + rate);
    }
    const machines = registry.getAll().filter(Entity.isMachine);
    const counted = new Set<string>();
    const countPlaced = (machine: typeof machines[number]): void => {
        if (counted.has(machine.entity_id.id)) return;
        counted.add(machine.entity_id.id);
        const sink = machines.find(target => target.entity_id.id === machine.result_target?.id);
        if (!sink) return;
        countPlaced(sink);
        const output = machine.outputs.find(result => sink.inputs.has(result.item_name))!;
        const needed = sink.inputs.getOrThrow(output.item_name).ingredient.amount;
        const crafts = (taken.get(sink.entity_id.id) ?? 0) / sink.output.amount_per_craft.toDecimal();
        taken.set(machine.entity_id.id, crafts * needed / output.amount_per_craft.toDecimal() * machine.output.amount_per_craft.toDecimal());
    };
    machines.forEach(countPlaced);
    return machines.map(machine => {
        const rate = taken.get(machine.entity_id.id) ?? 0;
        const capacity = machine.output.production_rate.amount_per_second.toDecimal();
        assert(Number.isFinite(rate) && rate >= 0 && capacity > 0,
            `Cannot calculate at-target rates for Machine ${machine.entity_id.number}.`);
        return { machine_id: machine.entity_id.number, output_rate_per_second: rate, crafting_share: rate / capacity,
            outputs: machine.outputs.map(output => ({ item_name: output.item_name,
                rate_per_second: output.production_rate.amount_per_second.toDecimal() * rate / capacity })) };
    });
}

/** lane-capacity-validator.ts laneCapacity before R21 */
const oldLaneCapacity = (belt: Config["belts"][number], lane: number): Fraction =>
    laneItemsPerSecond(Belt.fromConfig(belt).belt_speed, laneStackFor(belt, lane));

/** terminal-rate.ts neverBlockingBranchesOf before R21 */
function oldNeverBlockingBranchesOf(
    registry: Pick<ReadableEntityRegistry, "getAll">,
    swing_counts: EntityTransferCountMap,
    recipe_lcm: number,
    output_inserter_ids: ReadonlySet<string>,
): TerminalBranch[] {
    const planned = new Map<string, { share: number; hand: number }>();
    for (const [entity_id, transfer] of swing_counts.entries()) {
        if (output_inserter_ids.has(entity_id.id)) {
            planned.set(entity_id.id, { share: transfer.total_transfer_count.toDecimal() * transfer.stack_size * recipe_lcm, hand: transfer.stack_size });
        }
    }
    const outputs = registry.getAll().filter(Entity.isInserter).filter(inserter => output_inserter_ids.has(inserter.entity_id.id));
    const never_blocks = outputs.length > 0 && outputs.every(inserter => {
        const sink = registry.getAll().find(entity => entity.entity_id.id === inserter.sink.entity_id.id);
        return sink !== undefined && isNeverBlockingSink(sink) && planned.has(inserter.entity_id.id);
    });
    if (!never_blocks) return [];
    const branches = new Map<string, TerminalBranch>();
    for (const inserter of outputs) {
        const id = inserter.entity_id.id;
        const source_id = inserter.source.entity_id.id;
        const branch = branches.get(source_id) ?? { source_id, inserter_ids: [], share_per_period: 0, hand: 0 };
        branch.inserter_ids.push(id);
        branch.share_per_period += planned.get(id)!.share;
        branch.hand += planned.get(id)!.hand;
        branches.set(source_id, branch);
    }
    return [...branches.values()].sort((a, b) => a.source_id.localeCompare(b.source_id, undefined, { numeric: true }));
}

/** clock.ts fuelHandRoomTicks before R21 */
function oldFuelHandRoomTicks(entity_registry: ReadableEntityRegistry): Map<string, number> {
    const room = new Map<string, number>();
    for (const entity of entity_registry.getAll()) {
        if (!Entity.isInserter(entity)) {
            continue;
        }
        const source = entity_registry.getEntityByIdOrThrow(entity.source.entity_id);
        const sink = entity_registry.getEntityById(entity.sink.entity_id);
        if (!Entity.isBelt(source) || sink === null || !Entity.isMachine(sink)) {
            continue;
        }
        const fuel_item = sink.fuel_slot?.fuel.item_name;
        const lane = source.lanes.find(it => it.ingredient_name === fuel_item);
        if (fuel_item === undefined || lane === undefined || !entity.filtered_items.has(fuel_item) || sink.isFuelOnly(entity.filtered_items)) {
            continue;
        }
        room.set(entity.entity_id.id, Math.ceil(handSizeFor(entity, fuel_item) / lane.stack_size));
    }
    return room;
}

/** clock.ts beltPickupSlackTicks before R21 */
function oldBeltPickupSlackTicks(entity_registry: ReadableEntityRegistry): Map<string, number> {
    const slack = new Map<string, number>();
    for (const entity of entity_registry.getAll()) {
        if (!Entity.isInserter(entity)) {
            continue;
        }
        const source = entity_registry.getEntityByIdOrThrow(entity.source.entity_id);
        if (!Entity.isBelt(source)) {
            continue;
        }
        const lanes = source.lanes.filter(lane => entity.filtered_items.has(lane.ingredient_name));
        const lane_stack_size = Math.min(...(lanes.length > 0 ? lanes : source.lanes).map(lane => lane.stack_size));
        const ticks = Math.ceil(entity.metadata.stack_size / lane_stack_size);
        slack.set(entity.entity_id.id, Math.min(ticks, 16));
    }
    return slack;
}

// ---------------------------------------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------------------------------------

/** The outcome of a call: its value, or the message it throws */
function outcomeOf<T>(call: () => T): { value: T } | { error: string } {
    try {
        return { value: call() };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

/** The output capacity: each machine's main product rate, the four places' sums, the rounded clock's capacity */
function checkOutputCapacity(config: Config, registry: ReadableEntityRegistry, traits: ConfigTraits): void {
    const machines = registry.getAll().filter(Entity.isMachine);
    // the registry's order is the traits' (machinesInOrder): the sums below run over the same machines in the same order
    expect(machinesInOrder(config, traits).map(it => it.entity), "machine order").toStrictEqual(machines.map(it => it.entity_id.id));
    for (const machine of machines) {
        checked.machines += 1;
        const id = machine.entity_id.id;
        expect(mainProductRateOf(traits, id), `${id} main product rate`).toStrictEqual(oldMainProductRate(machine));
        const results = traitsOfMachine(traits, id).yield.results;
        expect(results.map(result => result.item), `${id} results`).toStrictEqual(machine.outputs.map(output => output.item_name));
        machine.outputs.forEach((output, index) => {
            checked.results += 1;
            expect(fractionOf(results[index].per_second), `${id} ${output.item_name} rate`).toStrictEqual(output.production_rate.amount_per_second);
            expect(decimalOf(results[index].per_second), `${id} ${output.item_name} rate a second`).toBe(output.production_rate.amount_per_second.toDecimal());
        });
    }
    const target = TargetProductionRate.fromConfig(config.target_output);
    const makers = machines.filter(machine => machine.output.item_name === target.machine_production_rate.item);
    checked.targets += 1;
    // plan-run (made) and primitive-grouped-hands: the exact sum, times the copies
    const sum = (rates: Fraction[]) => rates.reduce((a, b) => a.add(b), fraction(0));
    expect(sum(makers.map(machine => mainProductRateOf(traits, machine.entity_id.id))).multiply(fraction(config.target_output.copies)), "capacity")
        .toStrictEqual(sum(makers.map(oldMainProductRate)).multiply(fraction(config.target_output.copies)));
    expect(sum(makers.map(machine => mainProductRateOf(traits, machine.entity_id.id))).multiply(target.copies), "capacity of the primitive plan")
        .toStrictEqual(sum(makers.map(oldMainProductRate)).multiply(target.copies));
    // alternatives: the decimals added up in order
    expect(outputCapacityPerSecond(config), "rounded clock's capacity").toBe(oldOutputCapacityPerSecond(config));
}

/** The machines' rates at the target, the whole result or the same refusal */
function checkMachineTargetRates(config: Config): void {
    const before = outcomeOf(() => oldComputeMachineTargetRates(config));
    expect(outcomeOf(() => computeMachineTargetRates(config)), "at-target rates").toStrictEqual(before);
    if ("value" in before) checked.rates += before.value.length;
}

/** A hand read off the traits, as the inserter's (handSizeFor), for every item it carries and one it does not */
function checkHands(registry: ReadableEntityRegistry, traits: ConfigTraits): void {
    for (const inserter of registry.getAll().filter(Entity.isInserter)) {
        for (const item of [...inserter.filtered_items, "an item it does not carry"]) {
            checked.hands += 1;
            expect(handOfItem(traits, inserter.entity_id.id, item), `${inserter.entity_id.id} hand of ${item}`).toBe(handSizeFor(inserter, item));
        }
    }
}

/** What a lane carries, lane by lane, and the capacity of every load of the lane check */
function checkLanes(config: Config): void {
    const supply = config.overrides?.backed_up_belts === true ? "backed_up" : "moving";
    for (const belt of config.belts) {
        const lanes = beltLanes(belt, supply);
        for (const lane of [1, 2]) {
            checked.lanes += 1;
            expect(fractionOf(lanes[lane - 1].items_per_second_ceiling), `belt ${belt.id} lane ${lane}`).toStrictEqual(oldLaneCapacity(belt, lane));
        }
    }
    const loads = outcomeOf(() => laneLoads(config));
    if ("error" in loads) return;
    for (const load of loads.value) {
        checked.loads += 1;
        const belt = config.belts.find(it => it.id === load.belt_id)!;
        expect(load.capacity_per_second, `belt ${load.belt_id} lanes ${load.lanes}`)
            .toStrictEqual(load.lanes.reduce((sum, lane) => sum.add(oldLaneCapacity(belt, lane)), fraction(0)));
    }
}

/** Whether an inserter's sink never refuses a hand, by its node's Storage trait, as the sink entity's kind said */
function checkSinks(registry: ReadableEntityRegistry, traits: ConfigTraits): void {
    for (const inserter of registry.getAll().filter(Entity.isInserter)) {
        const sink = registry.getEntityByIdOrThrow(inserter.sink.entity_id);
        expect(neverRefuses(traits, sink.entity_id.id), `${inserter.entity_id.id} sink never refuses`).toBe(isNeverBlockingSink(sink));
    }
}

/**
 * The sinks that never refuse a hand: each inserter alone as a terminal output, then all of them, each planned to move
 * one hand of 16 a period (the branches are the same whatever the hands)
 */
function checkTerminalBranches(registry: ReadableEntityRegistry, traits: ConfigTraits): void {
    const inserters = registry.getAll().filter(Entity.isInserter);
    const swing_counts = { entries: () => inserters.map(inserter => [inserter.entity_id,
        { total_transfer_count: { toDecimal: () => 1 }, stack_size: 16 }]) } as unknown as EntityTransferCountMap;
    for (const ids of [...inserters.map(inserter => new Set([inserter.entity_id.id])), new Set(inserters.map(inserter => inserter.entity_id.id))]) {
        checked.sinks += 1;
        expect(neverBlockingBranchesOf(registry, traits, swing_counts, 3, ids), `branches of ${[...ids]}`)
            .toStrictEqual(oldNeverBlockingBranchesOf(registry, swing_counts, 3, ids));
    }
}

/** The belt pickup slack and the room for a hand of fuel */
function checkBeltCounts(registry: ReadableEntityRegistry): void {
    checked.belt_inserters += beltPickupSlackTicks(registry).size;
    expect(beltPickupSlackTicks(registry), "belt pickup slack").toStrictEqual(oldBeltPickupSlackTicks(registry));
    expect(fuelHandRoomTicks(registry), "fuel hand room").toStrictEqual(oldFuelHandRoomTicks(registry));
}

/** Every check on one config object, its traits read through the planner's memo */
function checkConfig(config: Config): void {
    const registry = createEntityRegistryFromConfig(config);
    const traits = traitsOf(config);
    checkOutputCapacity(config, registry, traits);
    checkMachineTargetRates(config);
    checkHands(registry, traits);
    checkLanes(config);
    checkSinks(registry, traits);
    checkTerminalBranches(registry, traits);
    checkBeltCounts(registry);
}

/** Configs derived from a config as the search derives them, each a new object: the belts' supply turned over, one copy more */
function derivedConfigsOf(config: Config): Config[] {
    return [
        { ...config, overrides: { ...config.overrides, backed_up_belts: config.overrides?.backed_up_belts !== true } },
        { ...config, target_output: { ...config.target_output, copies: (config.target_output.copies ?? 1) + 1 } },
    ];
}

describe("the planner's reads of the traits", () => {
    it("give every config the numbers the planner read before, bit for bit", async () => {
        for (const file of SAMPLE_CONFIG_FILES) {
            const config = await parseConfig(fs.readFileSync(file, "utf8")) as Config;
            checked.configs += 1;
            checkConfig(config);
            for (const derived of derivedConfigsOf(config)) {
                checked.derived += 1;
                checkConfig(derived);
            }
        }
        expect(checked.configs).toBeGreaterThan(50);
        expect(checked.machines).toBeGreaterThan(100);
        expect(checked.rates).toBeGreaterThan(100);
        expect(checked.loads).toBeGreaterThan(50);
        expect(checked.belt_inserters).toBeGreaterThan(100);
        console.info(`planner reads held to the old derivations: ${JSON.stringify(checked)}`);
    });

    it("build a config's traits once and keep them with the config object", async () => {
        const config = await parseConfig(fs.readFileSync(SAMPLE_CONFIG_FILES[0], "utf8")) as Config;
        expect(traitsOf(config)).toBe(traitsOf(config));
        expect(traitsOf({ ...config })).not.toBe(traitsOf(config));
        expect(traitsOf({ ...config })).toStrictEqual(traitsOf(config));
    });
});
