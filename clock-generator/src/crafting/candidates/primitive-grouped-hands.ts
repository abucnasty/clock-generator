import assert from "../../common/assert";
import type { Config } from "../../config/schema";
import { assertInserterCoverage } from "../../config/inserter-coverage-validator";
import { assertMachineResultTargetsSupported, assertOutputTransferGenerationSupported } from "../../config/output-transfer-generation";
import { fraction } from "../../data-types/fraction";
import { Entity, type ReadableEntityRegistry } from "../../entities";
import { TargetProductionRate } from "../target-production-rate";
import { CraftingCyclePlan, plannedTerminalSwingCount } from "../sequence/cycle/crafting-cycle";
import { EntityTransferCountMap, outputPathOf, type SerializableTransferPlan } from "../sequence/cycle/swing-counts";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { alwaysEnabledInserters, unplannedInserterClocks } from "../sequence/unplanned-inserter-clock";
import { canonicalVerificationJson } from "../verification-signature";
import { MAX_SIMULATION_TICKS } from "../plan/plan-run";
import { ClockPeriodLimitError } from "../plan/clock-period-limit";
import { isNeverBlockingSink } from "../terminal-rate";
import { groupedHandsCycles, groupedHandsPlan, GroupedHandsNotApplicable, type GroupedHandsComposition, type GroupedHandsOptions } from "./grouped-hands";

type Windows = Record<string, { start: number; end: number }[]>;
export interface PrimitiveGroupedAttempt {
    options: GroupedHandsOptions;
    result: { kind: "constructed"; planned_windows: Windows; control_windows: Windows; busy: string[]; control_key: string; duplicate_of?: number;
        dispositions: { inserter_id: string; control: "clocked" | "always"; basis: "grouped-window" | "computed-by-product" | "grouped-busy"; reason: string }[] }
        | { kind: "refused"; reason: string };
}
export interface PrimitiveGroupedConstruction {
    /** Construction facts only: no prepare, simulated output, stability or recovery verdict. */
    kind: "pure-construction";
    terminal_swing_count: number;
    base_cycle_ticks: number;
    grouped_cycles: number;
    period_ticks: number;
    transfer_plan: SerializableTransferPlan;
    final_output_inserter_ids: string[];
    inserters: { id: string; source: string; sink: string; items: string[];
        role: "terminal-output" | "internal-buffer-drain" | "machine-input" | "planned-transfer" | "by-product" }[];
    direct_dependencies: { source: string; target: string }[];
    retained_clocks: Record<string, { kind: "by-product"; modulus: number; own_clock: false; window: { start: number; end: number } }>;
    attempts: PrimitiveGroupedAttempt[];
}

/** Reject cycles before transfer planning, including direct edges which do not have synthetic inserters. */
export function assertAcyclicGroupedDependencies(registry: Pick<ReadableEntityRegistry, "getAll">): void {
    const graph = new Map<string, string[]>();
    const edge = (source: string, target: string) => graph.set(source, [...(graph.get(source) ?? []), target]);
    for (const entity of registry.getAll()) {
        if (Entity.isInserter(entity)) edge(entity.source.entity_id.id, entity.sink.entity_id.id);
        if (Entity.isMachine(entity) && entity.result_target !== undefined) edge(entity.entity_id.id, entity.result_target.id);
    }
    const active = new Set<string>(), done = new Set<string>();
    const visit = (id: string): void => {
        if (active.has(id)) throw new GroupedHandsNotApplicable("the chain of machines loops");
        if (done.has(id)) return;
        active.add(id);
        for (const target of graph.get(id) ?? []) visit(target);
        active.delete(id); done.add(id);
    };
    for (const id of graph.keys()) visit(id);
}

/**
 * Opt-in pure Stage1 candidate. The output unit supplies the primitive count, not prepared inventory or a changed
 * user override. Normal generation/selection do not call this function yet. Existing stock/hand/slack rules decide
 * each construction; a constructed artifact does not imply its windows hold.
 */
/** Whether a config leaves the made item's counts and every control to the generator, as primitive construction needs */
export function primitiveGroupedConfigSupported(config: Config): boolean {
    return !(config.target_output.counts === "destroyed" || config.overrides?.terminal_swing_count !== undefined
        || config.overrides?.lcm !== undefined || config.overrides?.use_fractional_swings === true
        || config.inserters.some(it => it.overrides?.enable_control !== undefined && it.overrides.enable_control.mode !== "AUTO")
        || (config.drills?.configs ?? []).some(it => it.overrides?.enable_control !== undefined && it.overrides.enable_control.mode !== "AUTO"));
}

export function constructPrimitiveGroupedHands(config: Config): PrimitiveGroupedConstruction {
    assertOutputTransferGenerationSupported(config);
    if (!primitiveGroupedConfigSupported(config)) {
        throw new GroupedHandsNotApplicable("primitive grouped construction requires automatic made-item controls and count policy");
    }
    assertInserterCoverage(config);
    const registry = createEntityRegistryFromConfig(config);
    assertMachineResultTargetsSupported(registry);
    assertAcyclicGroupedDependencies(registry);
    if (alwaysEnabledInserters(registry).length > 0) throw new GroupedHandsNotApplicable("the build has inserters outside the plan");
    const target = TargetProductionRate.fromConfig(config.target_output);
    const output_machines = registry.getAll().filter(Entity.isMachine).filter(it => it.output.item_name === target.machine_production_rate.item);
    const capacity = output_machines.reduce((sum, machine) => sum.add(machine.output.production_rate.amount_per_second), fraction(0)).multiply(target.copies);
    assert(capacity.toDecimal() >= target.total_production_rate.amount_per_second.toDecimal(), "The current configuration cannot meet the target production rate.");
    const cycle = CraftingCyclePlan.create(target, registry, fraction(1), config.overrides);
    const output_paths = output_machines.map(machine => outputPathOf(machine, registry));
    const direct_sources = new Map<string, string[]>();
    const direct_dependencies: PrimitiveGroupedConstruction["direct_dependencies"] = [];
    for (const machine of registry.getAll().filter(Entity.isMachine)) {
        if (machine.result_target === undefined) continue;
        const sink = registry.getEntityByIdOrThrow(machine.result_target);
        if (!Entity.isMachine(sink)) throw new GroupedHandsNotApplicable("primitive grouped construction does not support direct placement into a container");
        // The shared generation guard above proves exactly one accepted item; no demand is added here.
        const source = machine.entity_id.id, target = sink.entity_id.id;
        direct_sources.set(target, [...(direct_sources.get(target) ?? []), source]);
        direct_dependencies.push({ source, target });
    }
    const route_facts = { output_paths, direct_sources, retained_clocks: new Map() } satisfies GroupedHandsComposition;
    const grouped_cycles = groupedHandsCycles(registry, cycle.entity_transfer_map, route_facts);
    if (grouped_cycles === null) throw new GroupedHandsNotApplicable("the plan has no output hands");
    const period_ticks = CraftingCyclePlan.ticksOfCycles(cycle, grouped_cycles);
    if (Number.isFinite(period_ticks) && period_ticks > 0 && period_ticks >= MAX_SIMULATION_TICKS) {
        throw new ClockPeriodLimitError({ terminal_swing_count: plannedTerminalSwingCount(cycle)!,
            base_cycle_ticks: cycle.total_duration_ticks.toDecimal(), computed_lcm: EntityTransferCountMap.lcm(cycle.entity_transfer_map),
            effective_lcm: grouped_cycles, period_ticks, limit_ticks: MAX_SIMULATION_TICKS });
    }
    assert(Number.isFinite(period_ticks) && period_ticks > 0, `Clock period must be positive and finite, got ${period_ticks}`);
    if (!Number.isInteger(period_ticks)) throw new GroupedHandsNotApplicable(`the period is ${period_ticks} ticks, not a whole number`);
    const clocks = unplannedInserterClocks(registry, period_ticks);
    if ([...clocks.values()].some(clock => clock.kind !== "by-product")) throw new GroupedHandsNotApplicable("primitive grouped construction retains by-product clocks only");
    const composition: GroupedHandsComposition = { ...route_facts, retained_clocks: clocks };
    const retained_clocks = Object.fromEntries([...clocks].map(([id, clock]) => [id, { kind: "by-product" as const,
        modulus: clock.modulus, own_clock: false as const, window: { start: clock.window.start_inclusive, end: clock.window.end_inclusive } }]));
    const final_output_inserter_ids = [...new Set(output_paths.flatMap(path => path.container === null ? path.feeders : path.takers).map(it => it.entity_id.id))];
    const drains = new Set(output_paths.filter(path => path.container !== null).flatMap(path => path.feeders).map(it => it.entity_id.id));
    const transfers = new Map([...cycle.entity_transfer_map].map(([id, transfer]) => [id.id, transfer]));
    const inserters: PrimitiveGroupedConstruction["inserters"] = registry.getAll().filter(Entity.isInserter).map(inserter => ({
        id: inserter.entity_id.id, source: inserter.source.entity_id.id, sink: inserter.sink.entity_id.id,
        items: transfers.get(inserter.entity_id.id)?.item_transfers.map(item => item.item_name) ?? [...inserter.filtered_items],
        role: clocks.has(inserter.entity_id.id) ? "by-product" : final_output_inserter_ids.includes(inserter.entity_id.id) ? "terminal-output"
            : drains.has(inserter.entity_id.id) ? "internal-buffer-drain" : Entity.isMachine(registry.getEntityByIdOrThrow(inserter.sink.entity_id)) ? "machine-input" : "planned-transfer",
    }));
    const attempts: PrimitiveGroupedAttempt[] = [], known = new Map<string, number>();
    // Same separate/shared, staged/compact and surplus-guard choices as existing grouped construction. The ways with room
    // for one more output swing (`output_room`) come after all the others: they are verified only where none of those
    // holds (see verifiedPrimitiveGroupedClock), and made only where a terminal output takes from a machine and drops into
    // a sink that never blocks
    const machine_outputs = output_paths.some(path => path.container === null
        && path.feeders.some(it => Entity.isMachine(registry.getEntityByIdOrThrow(it.source.entity_id))
            && isNeverBlockingSink(registry.getEntityByIdOrThrow(it.sink.entity_id))));
    for (const output_room of machine_outputs ? [false, true] : [false])
    for (const share_windows of [false, true]) for (const feeder_offset of [16, 1]) for (const surplus_guard of [false, true]) {
        const options: GroupedHandsOptions = { share_windows, feeder_offset, surplus_guard, ...(output_room && { output_room }) };
        try {
            const plan = groupedHandsPlan(registry, cycle.entity_transfer_map, grouped_cycles, period_ticks,
                config.overrides?.backed_up_belts !== true, options, null, composition);
            for (const [id, ranges] of plan.windows) for (const range of ranges) {
                if (!Number.isInteger(range.start_inclusive) || !Number.isInteger(range.end_inclusive)
                    || range.start_inclusive < 0 || range.end_inclusive < range.start_inclusive || range.end_inclusive >= period_ticks) {
                    throw new GroupedHandsNotApplicable(`${id} has a grouped window outside the ${period_ticks}-tick period`);
                }
            }
            const planned_windows = Object.fromEntries([...plan.windows].map(([id, ranges]) => [id,
                ranges.map(range => ({ start: range.start_inclusive, end: range.end_inclusive }))]));
            const control_windows = { ...planned_windows };
            for (const [id, clock] of clocks) {
                control_windows[id] = [];
                for (let start = 0; start < period_ticks; start += clock.modulus) control_windows[id].push({
                    start: start + clock.window.start_inclusive, end: start + clock.window.end_inclusive });
            }
            const dispositions = inserters.map((inserter): Extract<PrimitiveGroupedAttempt["result"], { kind: "constructed" }>["dispositions"][number] => {
                const id = inserter.id;
                if (clocks.has(id)) return { inserter_id: id, control: "clocked", basis: "computed-by-product", reason: "Existing computed by-product control retained; not verified by construction." };
                if (plan.busy.includes(id)) return { inserter_id: id, control: "always", basis: "grouped-busy", reason: "The grouped opportunity occupies this period; this is a construction consequence, not proof that Always is necessary." };
                if (planned_windows[id]?.length) return { inserter_id: id, control: "clocked", basis: "grouped-window", reason: "Candidate grouped windows; stock, throughput and recovery are not verified." };
                throw new GroupedHandsNotApplicable(`${id} has no construction control disposition`);
            });
            // Construction deduplication only. This is never a cached verification verdict.
            const control_key = canonicalVerificationJson({ config, period_ticks, control_windows, retained_clocks, busy: plan.busy });
            const duplicate_of = known.get(control_key);
            if (duplicate_of === undefined) known.set(control_key, attempts.length);
            attempts.push({ options, result: { kind: "constructed", planned_windows, control_windows, busy: plan.busy,
                control_key, dispositions, ...(duplicate_of === undefined ? {} : { duplicate_of }) } });
        } catch (error) {
            if (!(error instanceof GroupedHandsNotApplicable)) throw error;
            attempts.push({ options, result: { kind: "refused", reason: error.message } });
        }
    }
    return { kind: "pure-construction", terminal_swing_count: plannedTerminalSwingCount(cycle)!,
        base_cycle_ticks: cycle.total_duration_ticks.toDecimal(), grouped_cycles, period_ticks,
        transfer_plan: EntityTransferCountMap.serialize(cycle.entity_transfer_map),
        final_output_inserter_ids, inserters,
        direct_dependencies, retained_clocks, attempts };
}
