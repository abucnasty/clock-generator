import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import { ConfigPaths } from "../../config/config-paths";
import type { Config } from "../../config/schema";
import { Entity, EntityId, type Machine } from "../../entities";
import { fraction } from "../../data-types/fraction";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { CraftingCyclePlan } from "../sequence/cycle/crafting-cycle";
import { EntityTransferCountMap, outputPathOf } from "../sequence/cycle/swing-counts";
import { unplannedInserterClocks } from "../sequence/unplanned-inserter-clock";
import { TargetProductionRate } from "../target-production-rate";
import * as planning from "../plan/plan-run";
import { ClockPeriodLimitError } from "../plan/clock-period-limit";
import * as unplanned from "../sequence/unplanned-inserter-clock";
import { groupedHandsPlan, GroupedHandsNotApplicable, type GroupedHandsComposition } from "./grouped-hands";
import { assertAcyclicGroupedDependencies, constructPrimitiveGroupedHands } from "./primitive-grouped-hands";

describe("pure primitive grouped construction", () => {
    let config: Config;
    beforeAll(async () => {
        // Same physical original as the historical diagnostic; remove all saved scheduling hints, not physical facts.
        const control = await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_ORIGINAL);
        config = { ...control, overrides: undefined, inserters: control.inserters.map(inserter => ({ ...inserter, overrides: undefined })) };
    });

    it("constructs from the normal output unit without prepare, simulation, a forced batch or config mutation", () => {
        const before = JSON.stringify(config);
        const run = vi.spyOn(planning, "planRun").mockImplementation(() => { throw new Error("scheduled planning is forbidden in pure construction"); });
        try {
            const artifact = constructPrimitiveGroupedHands(config);
            expect(run).not.toHaveBeenCalled();
            expect(artifact).toMatchObject({ kind: "pure-construction", terminal_swing_count: 1, base_cycle_ticks: 40, grouped_cycles: 1, period_ticks: 40 });
            expect(artifact).not.toHaveProperty("stability_check");
            expect(artifact.transfer_plan.computed_lcm).toBe(605);
            expect(artifact.attempts).toHaveLength(8);
            expect(artifact.attempts.some(attempt => attempt.result.kind === "constructed")).toBe(true);
            expect(artifact.inserters).toHaveLength(config.inserters.length);
            for (const attempt of artifact.attempts) if (attempt.result.kind === "constructed") {
                expect(attempt.result.dispositions).toHaveLength(config.inserters.length);
                expect(new Set(attempt.result.dispositions.map(row => row.inserter_id)).size).toBe(config.inserters.length);
                expect(attempt.result.dispositions.every(row => row.reason.includes("construction") || row.reason.includes("not verified"))).toBe(true);
            }
            expect(JSON.stringify(config)).toBe(before);
            expect(config.overrides).toBeUndefined();
        } finally { run.mockRestore(); }
    });

    it("counts final buffered takers once while preserving the internal drain and direct dependency", () => {
        const artifact = constructPrimitiveGroupedHands(config);
        expect(artifact.final_output_inserter_ids).toEqual(["inserter:4", "inserter:7"]);
        expect(artifact.inserters.find(inserter => inserter.id === "inserter:5")!.role).toBe("internal-buffer-drain");
        expect(artifact.inserters.find(inserter => inserter.id === "inserter:4")!.role).toBe("terminal-output");
        expect(artifact.direct_dependencies).toEqual([{ source: "machine:2", target: "machine:3" }]);
        expect(artifact.transfer_plan.entities).toHaveLength(11); // twelve real arms, red only is outside demand accounting
        const count = (id: number) => artifact.transfer_plan.entities.find(entity => entity.entity_number === id)!.item_transfers[0];
        for (const id of [4, 5, 7, 8]) expect(count(id)).toMatchObject({ numerator: 1, denominator: 1 });
        expect(artifact.transfer_plan.entities.some(entity => entity.entity_id.includes("direct"))).toBe(false);
        for (const attempt of artifact.attempts) if (attempt.result.kind === "constructed") {
            for (const id of [2, 4, 5, 7, 8]) expect(attempt.result.planned_windows[`inserter:${id}`]).toBeDefined();
        }
    });

    it("retains the computed rejected-result control in composed windows and control keys without a planned red hand", () => {
        const artifact = constructPrimitiveGroupedHands(config);
        const registry = createEntityRegistryFromConfig(config);
        const red = unplannedInserterClocks(registry, artifact.period_ticks).get("inserter:3")!;
        expect(artifact.retained_clocks["inserter:3"]).toEqual({ kind: red.kind, modulus: red.modulus, own_clock: false,
            window: { start: red.window.start_inclusive, end: red.window.end_inclusive } });
        expect(artifact.transfer_plan.entities.some(entity => entity.entity_number === 3)).toBe(false);
        for (const attempt of artifact.attempts) if (attempt.result.kind === "constructed") {
            expect(attempt.result.planned_windows["inserter:3"]).toBeUndefined();
            expect(attempt.result.control_windows["inserter:3"]).toBeDefined();
            expect(attempt.result.dispositions.find(row => row.inserter_id === "inserter:3")).toMatchObject({ control: "clocked", basis: "computed-by-product" });
            expect(JSON.parse(attempt.result.control_key).retained_clocks["inserter:3"]).toEqual(artifact.retained_clocks["inserter:3"]);
        }
    });

    it("keeps both mixed items on one arm and budgets their combined occupancy with the actual stacked-belt slack", () => {
        const artifact = constructPrimitiveGroupedHands(config);
        const mixed = artifact.transfer_plan.entities.find(entity => entity.entity_number === 10)!;
        expect(mixed.item_transfers.map(item => [item.item_name, item.numerator, item.denominator]).sort()).toEqual([
            ["holmium-plate", 64, 121], ["superconductor", 64, 121],
        ]);
        for (const attempt of artifact.attempts) if (attempt.result.kind === "constructed") {
            expect(attempt.result.busy).not.toContain("inserter:10");
            const ranges = attempt.result.planned_windows["inserter:10"];
            // Two different item hands share one11-tick arm. Stack4 supply adds4 slack ticks, not16.
            expect(ranges.reduce((ticks, range) => ticks + range.end - range.start + 1, 0)).toBeGreaterThan(2 * 11);
            expect(Object.keys(attempt.result.planned_windows).filter(id => id === "inserter:10")).toHaveLength(1);
        }
    });

    it("does not invent a hand or delay for the direct edge when ordering its feeder", () => {
        const artifact = constructPrimitiveGroupedHands(config);
        const compact = artifact.attempts.find(attempt => !attempt.options.share_windows && attempt.options.feeder_offset === 1 && !attempt.options.surplus_guard)!;
        expect(compact.result.kind).toBe("constructed");
        if (compact.result.kind !== "constructed") throw new Error(compact.result.reason);
        // Blue and battery both supply the capacitor chain; direct green placement adds no synthetic transfer stage.
        expect(compact.result.planned_windows["inserter:2"][0].start).toBe(compact.result.planned_windows["inserter:11"][0].start);
    });

    it.each(["iron-plate", "processing-unit"])("preserves zero/multiple accepted-result refusal for target recipe %s", recipe => {
        const unsupported = { ...config, machines: config.machines.map(machine => machine.id === 3 ? { ...machine, recipe } : machine) };
        expect(() => constructPrimitiveGroupedHands(unsupported)).toThrow(/takes none|several results/);
    });

    it.each([{ terminal_swing_count: 1 }, { lcm: 1 }, { use_fractional_swings: true }])("does not replace an explicit scheduling policy %j", overrides => {
        expect(() => constructPrimitiveGroupedHands({ ...config, overrides })).toThrow(/requires automatic/);
    });

    it("keeps explicit Always and missing physical outlet coverage as refusals", () => {
        const forced = { ...config, inserters: config.inserters.map(inserter => inserter.id === 2 ? { ...inserter,
            overrides: { enable_control: { mode: "ALWAYS" as const } } } : inserter) };
        expect(() => constructPrimitiveGroupedHands(forced)).toThrow(/requires automatic/);
        expect(() => constructPrimitiveGroupedHands({ ...config, inserters: config.inserters.filter(inserter => inserter.id !== 3) })).toThrow();
    });

    it.each([500000, 600000])("rejects primitive period %s before computing/unrolling by-product clocks", period => {
        const too_slow = { ...config, target_output: { ...config.target_output, items_per_second: config.target_output.items_per_second * 40 / period } };
        const compute = vi.spyOn(unplanned, "unplannedInserterClocks");
        try {
            expect(() => constructPrimitiveGroupedHands(too_slow)).toThrow(ClockPeriodLimitError);
            expect(compute).not.toHaveBeenCalled();
        } finally { compute.mockRestore(); }
    });

    it.each([NaN, Infinity, -Infinity, 0, -1])("rejects invalid computed period %s without classifying it as retryable", period => {
        const ticks = vi.spyOn(CraftingCyclePlan, "ticksOfCycles").mockReturnValue(period);
        try {
            let failure: unknown;
            try { constructPrimitiveGroupedHands(config); } catch (error) { failure = error; }
            expect(failure).toBeInstanceOf(Error);
            expect(failure).not.toBeInstanceOf(ClockPeriodLimitError);
            expect((failure as Error).message).toMatch(/positive and finite/);
        } finally { ticks.mockRestore(); }
    });

    it("refuses an under-capacity drill's out-of-period window without clamping or advertising it as constructed", async () => {
        const grenade = await loadConfigFromFile(ConfigPaths.REAL_OWNER_GRENADE);
        const slow = { ...grenade, overrides: undefined, inserters: grenade.inserters.map(inserter => ({ ...inserter, overrides: undefined })),
            drills: { ...grenade.drills!, configs: grenade.drills!.configs.map(drill => ({ ...drill, overrides: undefined, speed_bonus: -0.99 })) } };
        const artifact = constructPrimitiveGroupedHands(slow);
        expect(artifact.attempts.every(attempt => attempt.result.kind === "refused")).toBe(true);
        expect(artifact.attempts.map(attempt => attempt.result.kind === "refused" ? attempt.result.reason : "unexpected").join(" ")).toMatch(/drill:.*outside/);
    });

    it("preserves consecutive-hand room refusal and cannot exclude a planned loader as an unplanned clock", () => {
        const registry = createEntityRegistryFromConfig(config), target = TargetProductionRate.fromConfig(config.target_output);
        const cycle = CraftingCyclePlan.create(target, registry, fraction(1));
        const paths = registry.getAll().filter(Entity.isMachine).filter(machine => machine.output.item_name === target.machine_production_rate.item).map(machine => outputPathOf(machine, registry));
        const clocks = unplannedInserterClocks(registry, 40);
        const composition: GroupedHandsComposition = { retained_clocks: clocks, output_paths: paths, direct_sources: new Map([["machine:3", ["machine:2"]]]) };
        const overloaded = EntityTransferCountMap.fromEntries([...cycle.entity_transfer_map].map(([id, transfer]): [typeof id, typeof transfer] => [id,
            id.number === 10 && EntityId.isInserter(id) ? { ...transfer, item_transfers: transfer.item_transfers.map(item => ({ ...item, transfer_count: fraction(100) })) } : transfer]));
        expect(() => groupedHandsPlan(registry, overloaded, 1, 40, true, undefined, null, composition)).toThrow(/do not follow each other under the limit/);
        const forged = new Map([["inserter:2", { ...clocks.get("inserter:3")!, inserter_id: EntityId.forInserter(2) }]]);
        expect(() => groupedHandsPlan(registry, cycle.entity_transfer_map, 1, 40, true, undefined, null,
            { ...composition, retained_clocks: forged })).toThrow(/not a retained/);
    });

    it("detects direct/inserter dependency cycles rather than bypassing them with an implicit edge", () => {
        const machine = (id: number, target?: number) => ({ entity_id: EntityId.forMachine(id),
            ...(target === undefined ? {} : { result_target: EntityId.forMachine(target) }) }) as Machine;
        const feeder = { entity_id: EntityId.forInserter(1), source: { entity_id: EntityId.forMachine(2) }, sink: { entity_id: EntityId.forMachine(1) } };
        expect(() => assertAcyclicGroupedDependencies({ getAll: () => [machine(1, 2), machine(2), feeder] })).toThrow(GroupedHandsNotApplicable);
        expect(() => assertAcyclicGroupedDependencies({ getAll: () => [machine(1, 2), machine(2)] })).not.toThrow();
    });

    it("retains ordinary grouped windows exactly when no new route composition is needed", async () => {
        const ordinary = await loadConfigFromFile(ConfigPaths.REAL_THAELN_CELL09);
        const auto = { ...ordinary, overrides: undefined, inserters: ordinary.inserters.map(inserter => ({ ...inserter, overrides: undefined })) };
        const registry = createEntityRegistryFromConfig(auto), target = TargetProductionRate.fromConfig(auto.target_output);
        const cycle = CraftingCyclePlan.create(target, registry, fraction(1));
        const artifact = constructPrimitiveGroupedHands(auto);
        for (const attempt of artifact.attempts) if (attempt.result.kind === "constructed") {
            const old = groupedHandsPlan(registry, cycle.entity_transfer_map, artifact.grouped_cycles, artifact.period_ticks, true, attempt.options);
            expect(attempt.result.planned_windows).toEqual(Object.fromEntries([...old.windows].map(([id, ranges]) => [id,
                ranges.map(range => ({ start: range.start_inclusive, end: range.end_inclusive }))])));
            expect(attempt.result.busy).toEqual(old.busy);
        }
    });
});
