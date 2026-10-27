import { describe, it, expect, beforeAll } from "vitest";
import { generateClockForConfig, generateClockAlternatives, validateConfig, type BlueprintGenerationResult, type ClockAlternative } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { EntityId } from "../entities";
import { alwaysOnReasonProblems, alwaysOnReasonProblemsOf, withSearches } from "./generate-blueprint-test-helpers";

/** The transfers recorded for an inserter, as [start, end] tick ranges in the order they were recorded */
const transferRanges = (result: BlueprintGenerationResult, inserter_id: number): [number, number][] => result.transfer_history
    .getOrThrow(Array.from(result.transfer_history.keys()).find(k => k.id === EntityId.forInserter(inserter_id).id)!)
    .map(t => [t.tick_range.start_inclusive, t.tick_range.end_inclusive]);

/** Items an inserter moved in the recorded run */
const moved = (result: BlueprintGenerationResult, inserter_id: number): number => Array.from(result.transfer_history.entries())
    .find(([id]) => id.id === EntityId.forInserter(inserter_id).id)![1]
    .reduce((sum, t) => sum + t.amount, 0);

// The samples that take longest to generate (iron bacteria, a belt lane consumed outside the config, derived windows
// of production science) are in generate-blueprint.generation.test.ts.
describe("generateClockForConfig", () => {

    // The builds are generated in beforeAll hooks, not in the describe bodies: those all run when the file is collected,
    // so a run of one test by name would generate every build in the file first.

    describe("STONE_BRICKS_DIRECT_INSERT config", async () => {
        const config = await loadConfigFromFile(ConfigPaths.STONE_BRICKS_DIRECT_INSERT);
        let result: BlueprintGenerationResult;
        let inserterId: EntityId;
        let drillId: EntityId;

        beforeAll(() => {
            result = generateClockForConfig(config);

            // Get the actual EntityId instances from the map keys
            const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
            inserterId = keys.find(k => k.id === "inserter:1")!;
            drillId = keys.find(k => k.id === "drill:1")!;
        });

        it("names why every inserter and drill the clock leaves always on is", () => {
            expect(alwaysOnReasonProblems(config, result, "planned")).toEqual([]);
        });

        it("generates a blueprint, a crafting cycle plan of 144 ticks for stone bricks and a simulation duration", () => {
            expect(result.blueprint).toBeDefined();
            expect(result.crafting_cycle_plan.total_duration.ticks).toBe(144);
            expect(result.crafting_cycle_plan.production_rate.machine_production_rate.item).toBe("stone-brick");
            expect(result.simulation_duration.ticks).toBeGreaterThan(0);
        });

        it("plans 6 transfers of stone bricks, in hands of 16, for the output inserter (inserter:1)", () => {
            const transferCounts = result.crafting_cycle_plan.entity_transfer_map.getOrThrow(inserterId);
            expect(transferCounts.total_transfer_count.toDecimal()).toBe(6);
            expect(transferCounts.item_transfers.length).toBe(1);
            expect(transferCounts.item_transfers[0].item_name).toBe("stone-brick");
            expect(transferCounts.item_transfers[0].transfer_count.toDecimal()).toBe(6);
            expect(transferCounts.stack_size).toBe(16);
        });

        it("plans transfers of stone for the drill (drill:1)", () => {
            const transferCounts = result.crafting_cycle_plan.entity_transfer_map.getOrThrow(drillId);
            expect(transferCounts.total_transfer_count.toDecimal()).toBeGreaterThan(0);
            expect(transferCounts.item_transfers.length).toBe(1);
            expect(transferCounts.item_transfers[0].item_name).toBe("stone");
        });

        it("records the transfers of the output inserter and the drill, the inserter's from tick 1 to between 61 and 71", () => {
            expect(result.transfer_history.size).toBeGreaterThan(0);
            expect(result.transfer_history.getOrThrow(drillId).length).toBeGreaterThan(0);
            // the output inserter swings 6 times, so the end range can be anywhere between 61 and 71
            // if 72 or more, the inserter will cause instability due to swinging a 7th time
            const inserterTransfers = result.transfer_history.getOrThrow(inserterId);
            expect(inserterTransfers.length).toBe(1);
            expect(inserterTransfers[0].tick_range.start_inclusive).toBe(1);
            expect(inserterTransfers[0].tick_range.end_inclusive).toBeGreaterThanOrEqual(61);
            expect(inserterTransfers[0].tick_range.end_inclusive).toBeLessThanOrEqual(71);
        });
    });

    describe("LOGISTIC_SCIENCE_SHARED_INSERTER config", async () => {
        const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_SHARED_INSERTER);
        let result: BlueprintGenerationResult;

        beforeAll(() => {
            result = generateClockForConfig(config);
        });

        it("records one transfer of the output inserter (2) from tick 1 to 49, and four of the input inserter (1)", () => {
            expect(result.transfer_history.size).toBeGreaterThan(0);
            expect(transferRanges(result, 2)).toEqual([[1, 49]]);
            // the third hand starts in the tick after the craft start that made room for it, as the game's does
            expect(transferRanges(result, 1).sort((a, b) => a[0] - b[0])).toEqual([[52, 63], [63, 74], [76, 87], [87, 98]]);
        });

        // These three alternatives were confirmed to hold full output in game with their windows from before the belt
        // window trim, which ended 4 ticks later than these; the build has no scaffold, so these were not recorded
        describe("clock alternatives", () => {
            let alternatives: ClockAlternative[];
            const windowsOf = (id: string) => alternatives.find(a => a.id === id)?.result.clock_windows;

            beforeAll(() => {
                // batched swings is stable, so observed windows are only made when they are asked for
                ({ alternatives } = generateClockAlternatives(withSearches(config)));
            });

            it("names why every inserter and drill a clock leaves always on is", () => {
                expect(alwaysOnReasonProblemsOf(config, { alternatives })).toEqual([]);
            });

            it.each(["planned-belt-slack", "planned", "derived"])("%s is stable", (id) => {
                expect(alternatives.find(a => a.id === id)?.verdict).toBe("stable");
            });

            // inserter 1's windows end 3 ticks earlier since belt windows close before their last return swing, and
            // one more since its hands after a craft start come a tick sooner
            it("batched swings for a moving belt add 4 ticks to the belt input inserter", () => {
                expect(windowsOf("planned-belt-slack")).toEqual({
                    "inserter:2": [{ start: 1, end: 49 }],
                    "inserter:1": [{ start: 52, end: 99 }],
                });
            });

            it("planned keeps the simulated windows", () => {
                expect(windowsOf("planned")).toEqual({
                    "inserter:2": [{ start: 1, end: 49 }],
                    "inserter:1": [{ start: 52, end: 71 }, { start: 76, end: 95 }],
                });
            });

            it("observed windows follow the input inserter's activity", () => {
                expect(windowsOf("derived")).toEqual({
                    "inserter:2": [{ start: 1, end: 49 }],
                    "inserter:1": [{ start: 25, end: 77 }],
                });
            });

            it("has no uneven output swings to offer with one output window per period, and no swings to shift with one round of swings", () => {
                expect(alternatives.find(a => a.id === "uneven-output")).toBeUndefined();
                expect(alternatives.find(a => a.id === "shifted-swings")).toBeUndefined();
            });
        });
    });

    describe("LOGISTIC_SCIENCE_DI config (two machines making the output)", async () => {
        const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_DI);
        let result: BlueprintGenerationResult;

        beforeAll(() => {
            result = generateClockForConfig(config);
        });

        it("plans logistic science packs in a cycle of 192 ticks (48 ticks per swing × 4 swings), with 4 transfers for each output inserter", () => {
            expect(result.crafting_cycle_plan.production_rate.machine_production_rate.item).toBe("logistic-science-pack");
            // With 2 output machines and a target rate of 240 items/sec over 6 copies,
            // each machine produces at 1/3 items/tick (240/6/60/2).
            // A stack of 16 items takes 48 ticks per machine.
            // With 4 swings per cycle, total duration = 192 ticks.
            expect(result.crafting_cycle_plan.total_duration.ticks).toBe(192);
            const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
            for (const inserter of [1, 7]) {
                const transferCounts = result.crafting_cycle_plan.entity_transfer_map.getOrThrow(keys.find(k => k.id === EntityId.forInserter(inserter).id)!);
                expect(transferCounts.total_transfer_count.toDecimal()).toBe(4);
            }
        });

        it("plans the same cycle duration for a doubled target rate over doubled copies", () => {
            // - Original: 240 items/sec, 6 copies → per-machine rate = 240/6/60/2 = 1/3 items/tick
            // - Modified: 480 items/sec, 12 copies → per-machine rate = 480/12/60/2 = 1/3 items/tick
            const modifiedResult = generateClockForConfig({
                ...config,
                target_output: { ...config.target_output, items_per_second: config.target_output.items_per_second * 2, copies: config.target_output.copies * 2 },
            });
            expect(modifiedResult.crafting_cycle_plan.total_duration.ticks).toBe(result.crafting_cycle_plan.total_duration.ticks);
        });
    });

    describe("PROCESSING_UNITS config (multi-ingredient chest input)", async () => {
        const config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNITS);

        it("records the input inserter transferring both required ingredient types", () => {
            const result = generateClockForConfig(config);
            expect(alwaysOnReasonProblems(config, result, "planned")).toEqual([]);
            const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
            const inserterTransfers = result.transfer_history.getOrThrow(keys.find(k => k.id === EntityId.forInserter(1).id)!);
            expect(inserterTransfers.length).toBeGreaterThan(0);
            const transferredItems = new Set(inserterTransfers.map(t => t.item_name));
            expect(transferredItems.has("electronic-circuit")).toBe(true);
            expect(transferredItems.has("advanced-circuit")).toBe(true);
        });
    });

    describe("belt used as a buffer between machines", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_BELTED_BUFFER);

        it("is stable, and clocks the inserters filling the belt for what is taken off it", () => {
            const result = generateClockForConfig(config);
            expect(alwaysOnReasonProblems(config, result, "planned")).toEqual([]);
            expect(result.stability_check.holds).toBe(true);
            expect(moved(result, 1) + moved(result, 2)).toBe(moved(result, 3));
        });
    });

    // Three furnaces fed by mining drills that drop straight into them, 40 bricks a second each. A furnace makes 43 a
    // second, so the window of its output inserter is all that holds it to 40. Recorded in Factorio 2.1.21: the clocks
    // with 1, 3 and 6 output swings each moved exactly their hands every period for 10 periods, from every furnace.
    describe("stone bricks from mining drills that drop into the furnaces", async () => {
        const config = await loadConfigFromFile(ConfigPaths.STONE_BRICKS_DIRECT_INSERT_2_1);
        let alternatives: ClockAlternative[];
        const alternative = (id: string) => alternatives.find(a => a.id === id)!;
        const outputWindows = (id: string) => alternative(id).result.clock_windows["inserter:1"].map(w => [w.start, w.end]);

        beforeAll(() => {
            ({ alternatives } = generateClockAlternatives(config));
        });

        it("names why every inserter and drill a clock leaves always on is", () => {
            expect(alwaysOnReasonProblemsOf(config, { alternatives })).toEqual([]);
        });

        it.each([
            ["swings-1", 72, 48, [[1, 10], [25, 34], [49, 58]]],
            ["fractional", 72, 48, [[1, 34]]],
            ["planned-belt-slack", 144, 96, [[1, 70]]],
        ] as const)("%s is stable as built with the windows that ran in game", (id, period, bricks, windows) => {
            const result = alternative(id).result;
            expect(result.simulation_duration.ticks).toBe(period);
            expect(outputWindows(id)).toEqual(windows);
            expect(alternative(id).verdict).toBe("stable");
            expect(result.stability_check.as_built).toMatchObject({ holds: true, actual_output_items: bricks });
        });

        // a hand takes the inserter 12 ticks: a window for 3 hands is on for at least 2 of them, and off before a
        // fourth can start, whether the furnace has bricks to spare or not
        it("keeps a window for 3 hands shorter than 3 hands take", () => {
            const [[start, end]] = outputWindows("fractional");
            expect(end - start).toBeGreaterThanOrEqual(2 * 12);
            expect(end - start).toBeLessThan(3 * 12);
        });

        it("enables each drill for a few ticks a cycle, which fills the furnace up to what a drill may insert", () => {
            expect(alternative("fractional").result.clock_windows["drill:1"].map(w => [w.start, w.end])).toEqual([[1, 3]]);
        });
    });

    describe("validateConfig", () => {
        it("returns the transfer plan a generation uses, without generating", async () => {
            const config = await loadConfigFromFile(ConfigPaths.FLYING_ROBOT_FRAME);
            const validation = validateConfig(config);
            const generated = generateClockForConfig(config);

            expect(alwaysOnReasonProblems(config, generated, "planned")).toEqual([]);
            expect(validation.transfer_plan).toEqual(generated.serializable_transfer_plan);
            expect(validation).toMatchObject({ used_lcm: 2, output_swings_per_cycle: 1, cycle_ticks: 144, period_ticks: 288 });
        });

        it("does not plan the inserter taking away a by-product nothing in the config uses", async () => {
            // jellynut-processing makes jellynut-seed at 2%; its inserter just clears it onto an export belt
            const config = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
            const validation = validateConfig(config);
            const seed_inserters = validation.transfer_plan.entities
                .filter(entity => entity.item_transfers.some(transfer => transfer.item_name === "jellynut-seed"));
            expect(seed_inserters).toEqual([]);
            // the nutrients its biochambers burn are not part of the plan, so they leave the LCM alone
            const fuel_inserters = validation.transfer_plan.entities
                .filter(entity => entity.item_transfers.some(transfer => transfer.item_name === "nutrients"));
            expect(fuel_inserters).toEqual([]);
            expect(validation.used_lcm).toBe(4);
        });

        it("uses the forced output swings and LCM of the config", async () => {
            const config = await loadConfigFromFile(ConfigPaths.FLYING_ROBOT_FRAME);
            const validation = validateConfig({ ...config, overrides: { ...config.overrides, terminal_swing_count: 2 } });
            expect(validation).toMatchObject({ output_swings_per_cycle: 2, cycle_ticks: 288 });
        });

        it("throws for a machine without inserters", async () => {
            const config = await loadConfigFromFile(ConfigPaths.BAD_ACCUMULATOR_CONFIG);
            expect(() => validateConfig(config)).toThrow("Missing inserter coverage");
        });

        it("throws when the machines cannot reach the target rate", async () => {
            const config = await loadConfigFromFile(ConfigPaths.FLYING_ROBOT_FRAME);
            expect(() => validateConfig({ ...config, target_output: { ...config.target_output, items_per_second: 1600 } }))
                .toThrow("cannot meet the target production rate");
        });
    });

    describe("config validation", () => {
        it("throw error if the current configuration cannot meet the target production rate", async () => {
            const config = await loadConfigFromFile(ConfigPaths.STONE_BRICKS_DIRECT_INSERT);
            expect(config.target_output.items_per_second).toBe(120)
            expect(() => generateClockForConfig(config)).not.toThrowError();
            config.target_output.items_per_second = 240;
            expect(() => generateClockForConfig(config)).toThrowError();
        })
    })

    // Inserters 1/4 feed the two identical pack machines and 2/3 empty them. Config order puts input 1
    // before output 2 but input 4 after output 3, which used to offset the machines by one tick and
    // desync the shared-clock LDS inserters 6/7.
    describe("UTILITY_SCIENCE_DIRECT_INSERT_LDS_CHAIN_ALWAYS_ON (identical machines stay in sync regardless of config order)", async () => {
        const config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_DIRECT_INSERT_LDS_CHAIN_ALWAYS_ON);

        it("is stable, with the LDS inserters 6 and 7 and the belt input inserters 1 and 4 swinging on the same ticks", () => {
            const result = generateClockForConfig({ ...config, overrides: { ...config.overrides, terminal_swing_count: 2 } });
            expect(result.stability_check.holds).toBe(true);
            expect(transferRanges(result, 7)).toEqual(transferRanges(result, 6));
            expect(transferRanges(result, 4)).toEqual(transferRanges(result, 1));
        });
    });

    // Regression test for issue #47:
    // A multi-filter belt→machine inserter (copper-plate + iron-gear-wheel) with terminal_swing_count=1
    // causes per-item fractional swing counts (copper=0.5, gear=0.5, total=1.0).
    // The total is an integer so fractional_swings_enabled stays false, but the clocked timing
    // constraint locks the inserter to 1 swing/cycle. Since stack_size(16) < automated_insertion_limit(18),
    // one item is always picked first and never blocked, starving the other item indefinitely.
    // That the sample's selected clock is stable at the target rate is checked with its alternatives in
    // backpressure-loss.test.ts.
    describe("AUTOMATION_SCIENCE: issue #47 regression (multi-filter fractional per-item transfers)", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);

        it("generates a blueprint whose input inserter (1) transfers both copper-plate and iron-gear-wheel (not just one), and whose output inserter (2) transfers", () => {
            const result = generateClockForConfig(config);
            expect(result.blueprint).toBeDefined();
            const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
            // inserter:1 = belt→machine (copper-plate + iron-gear-wheel), no explicit id in config → index+1
            const input_transfers = result.transfer_history.getOrThrow(keys.find(k => k.id === EntityId.forInserter(1).id)!);
            // inserter:2 = machine→belt (automation-science-pack)
            expect(result.transfer_history.getOrThrow(keys.find(k => k.id === EntityId.forInserter(2).id)!).length).toBeGreaterThan(0);
            expect(input_transfers.length).toBeGreaterThan(0);
            const transferred_items = new Set(input_transfers.map(t => t.item_name));
            expect(transferred_items.has("copper-plate")).toBe(true);
            expect(transferred_items.has("iron-gear-wheel")).toBe(true);
        });
    });
});
