import { describe, it, expect, beforeAll } from "vitest";
import { generateClockForConfig, generateClockAlternatives, validateConfig, type BlueprintGenerationResult, type ClockAlternative, type ConfigValidation, type SerializableClockWindows } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { EntityId } from "../entities";
import { OpenRange } from "../data-types";

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

        it("generates a blueprint", () => {
            expect(result.blueprint).toBeDefined();
        });

        it("has a crafting cycle plan", () => {
            expect(result.crafting_cycle_plan).toBeDefined();
        });

        it("has a simulation duration", () => {
            expect(result.simulation_duration).toBeDefined();
            expect(result.simulation_duration.ticks).toBeGreaterThan(0);
        });

        describe("output inserter transfer ranges", () => {
            it("transfer counts equal to 6 for the output inserter (inserter:1)", () => {
                const transferCounts = result.crafting_cycle_plan.entity_transfer_map.getOrThrow(inserterId);

                expect(transferCounts.total_transfer_count.toDecimal()).toBe(6);
            });

            it("has stone-brick as the transferred item for the output inserter", () => {
                const transferCounts = result.crafting_cycle_plan.entity_transfer_map.getOrThrow(inserterId);

                expect(transferCounts.item_transfers.length).toBe(1);
                expect(transferCounts.item_transfers[0].item_name).toBe("stone-brick");
            });

            it("has 6 transfers for the output inserter", () => {
                const transferCounts = result.crafting_cycle_plan.entity_transfer_map.getOrThrow(inserterId);

                expect(transferCounts.item_transfers.length).toBe(1);
                expect(transferCounts.item_transfers[0].transfer_count.toDecimal()).toBe(6);
            });

            it("has the correct stack size for the output inserter", () => {
                const transferCounts = result.crafting_cycle_plan.entity_transfer_map.getOrThrow(inserterId);

                expect(transferCounts.stack_size).toBe(16);
            });
        });

        describe("drill transfer ranges", () => {
            it("has transfer counts for the drill (drill:1)", () => {
                const transferCounts = result.crafting_cycle_plan.entity_transfer_map.getOrThrow(drillId);

                expect(transferCounts.total_transfer_count.toDecimal()).toBeGreaterThan(0);
            });

            it("has stone as the transferred item for the drill", () => {
                const transferCounts = result.crafting_cycle_plan.entity_transfer_map.getOrThrow(drillId);

                expect(transferCounts.item_transfers.length).toBe(1);
                expect(transferCounts.item_transfers[0].item_name).toBe("stone");
            });
        });

        describe("crafting cycle plan properties", () => {
            it("total duration is 144 ticks", () => {
                expect(result.crafting_cycle_plan.total_duration.ticks).toBe(144);
            });

            it("has stone-brick as the production rate item", () => {
                expect(result.crafting_cycle_plan.production_rate.machine_production_rate.item).toBe("stone-brick");
            });
        });

        describe("transfer history", () => {
            it("contains transfer history entries", () => {
                expect(result.transfer_history.size).toBeGreaterThan(0);
            });

            it("contains entries for the output inserter", () => {
                const inserterTransfers = result.transfer_history.getOrThrow(inserterId);
                expect(inserterTransfers.length).toBeGreaterThan(0);
            });

            it("contains entries for the drill", () => {
                const drillTransfers = result.transfer_history.getOrThrow(drillId);
                expect(drillTransfers.length).toBeGreaterThan(0);
            });

            it("has correct tick ranges for inserter transfers", () => {
                const inserterTransfers = result.transfer_history.getOrThrow(inserterId);
                const expected_start_inclusive = 1
                // the output inserter swings 6 times, so the end range can be anywhere between 61 and 71
                // if 72 or more, the inserter will cause instability due to swinging a 7th time
                const expected_end_inclusive = OpenRange.from(61, 71);

                expect(inserterTransfers.length).toBe(1);
                const transfer = inserterTransfers[0];
                expect(transfer.tick_range.start_inclusive).toBe(expected_start_inclusive);
                expect(transfer.tick_range.end_inclusive).toBeGreaterThanOrEqual(expected_end_inclusive.start_inclusive);
                expect(transfer.tick_range.end_inclusive).toBeLessThanOrEqual(expected_end_inclusive.end_inclusive);
            });

        });
    });

    describe("LOGISTIC_SCIENCE_SHARED_INSERTER config", async () => {

        const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_SHARED_INSERTER);
        let result: BlueprintGenerationResult;
        let input_inserter_id: EntityId;
        let output_inserter_id: EntityId;

        beforeAll(() => {
            result = generateClockForConfig(config);

            // Get the actual EntityId instances from the map keys
            const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
            input_inserter_id = keys.find(k => k.id === EntityId.forInserter(1).id)!;
            output_inserter_id = keys.find(k => k.id === EntityId.forInserter(2).id)!;
        });


        describe("transfer history", () => {
            it("contains transfer history entries", () => {
                expect(result.transfer_history.size).toBeGreaterThan(0);
            });

            it("contains entries for the input inserter", () => {
                const inserterTransfers = result.transfer_history.getOrThrow(input_inserter_id);
                expect(inserterTransfers.length).toBeGreaterThan(0);
            });

            it("contains entries for the output inserter", () => {
                const inserterTransfers = result.transfer_history.getOrThrow(output_inserter_id);
                expect(inserterTransfers.length).toBeGreaterThan(0);
            });

            it("has correct tick ranges for output inserter transfers", () => {
                const inserterTransfers = result.transfer_history.getOrThrow(output_inserter_id);
                const expected_start_inclusive = 1
                const expected_end_inclusive = 49

                expect(inserterTransfers.length).toBe(1);
                const transfer = inserterTransfers[0];
                expect(transfer.tick_range.start_inclusive).toBe(expected_start_inclusive);
                expect(transfer.tick_range.end_inclusive).toBe(expected_end_inclusive);
            });

            it("has correct tick ranges for input inserter transfers", () => {
                const inserter_transfers = result.transfer_history.getOrThrow(input_inserter_id)
                const sorted_transfers = [...inserter_transfers].sort((a, b) => a.tick_range.start_inclusive - b.tick_range.start_inclusive);
                const expected_ranges = [
                    OpenRange.from(52, 63),
                    OpenRange.from(63, 74),
                    OpenRange.from(76, 88),
                    OpenRange.from(88, 99)
                ]

                expect(sorted_transfers.length).toBe(4);
                sorted_transfers.forEach((transfer, index) => {
                    const expected_range = expected_ranges[index];
                    expect(transfer.tick_range.start_inclusive).toBe(expected_range.start_inclusive);
                    expect(transfer.tick_range.end_inclusive).toBe(expected_range.end_inclusive);
                })
            });

        });

        // these three alternatives were confirmed to hold full output in game
        describe("clock alternatives", () => {
            let alternatives: ClockAlternative[];
            const windowsOf = (id: string) => alternatives.find(a => a.id === id)?.result.clock_windows;

            beforeAll(() => {
                ({ alternatives } = generateClockAlternatives(config));
            });

            it.each(["planned-belt-slack", "planned", "derived"])("%s is stable", (id) => {
                expect(alternatives.find(a => a.id === id)?.is_stable).toBe(true);
            });

            it("batched swings for a moving belt add 4 ticks to the belt input inserter", () => {
                expect(windowsOf("planned-belt-slack")).toEqual({
                    "inserter:2": [{ start: 1, end: 49 }],
                    "inserter:1": [{ start: 52, end: 103 }],
                });
            });

            it("planned keeps the simulated windows", () => {
                expect(windowsOf("planned")).toEqual({
                    "inserter:2": [{ start: 1, end: 49 }],
                    "inserter:1": [{ start: 52, end: 74 }, { start: 76, end: 99 }],
                });
            });

            it("observed windows follow the input inserter's activity", () => {
                expect(windowsOf("derived")).toEqual({
                    "inserter:2": [{ start: 1, end: 49 }],
                    "inserter:1": [{ start: 25, end: 78 }],
                });
            });

            it("has no uneven output swings to offer with one output window per period", () => {
                expect(alternatives.find(a => a.id === "uneven-output")).toBeUndefined();
            });

            it("has no swings to shift with one round of swings per period", () => {
                expect(alternatives.find(a => a.id === "shifted-swings")).toBeUndefined();
            });
        });

    });

    describe("CHEMICAL_SCIENCE_ENGINES config (multi-output machine)", async () => {

        const config = await loadConfigFromFile(ConfigPaths.CHEMICAL_SCIENCE_ENGINES);
        let result: BlueprintGenerationResult;
        let output_inserter_1_id: EntityId;
        let output_inserter_2_id: EntityId;

        beforeAll(() => {
            result = generateClockForConfig(config);

            // Get the actual EntityId instances from the map keys
            const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
            output_inserter_1_id = keys.find(k => k.id === EntityId.forInserter(1).id)!;
            output_inserter_2_id = keys.find(k => k.id === EntityId.forInserter(2).id)!;
        });

        describe("crafting cycle plan properties", () => {
            it("has engine-unit as the production rate item", () => {
                expect(result.crafting_cycle_plan.production_rate.machine_production_rate.item).toBe("engine-unit");
            });

            it("total duration is 160 ticks (80 ticks per swing × 2 swings)", () => {
                // With 2 output machines and target rate of 24 items/sec,
                // each machine produces at 0.2 items/tick (24/60/2).
                // A stack of 16 items takes 80 ticks per machine.
                // With 2 swings per cycle, total duration = 160 ticks.
                expect(result.crafting_cycle_plan.total_duration.ticks).toBe(160);
            });

            it("has 2 transfers for each output inserter", () => {
                const transferCounts1 = result.crafting_cycle_plan.entity_transfer_map.getOrThrow(output_inserter_1_id);
                const transferCounts2 = result.crafting_cycle_plan.entity_transfer_map.getOrThrow(output_inserter_2_id);

                expect(transferCounts1.total_transfer_count.toDecimal()).toBe(2);
                expect(transferCounts2.total_transfer_count.toDecimal()).toBe(2);
            });
        });

        describe("copies parameter equivalence", () => {
            it("doubling target rate with copies=2 produces same cycle duration", async () => {
                // Load the config and modify it to double the rate with 2 copies
                const modifiedConfig = { ...config };
                modifiedConfig.target_output = {
                    ...config.target_output,
                    items_per_second: config.target_output.items_per_second * 2,
                    copies: 2
                };

                const modifiedResult = generateClockForConfig(modifiedConfig);

                // The cycle duration should be the same because:
                // - Original: 24 items/sec, 1 copy → per-machine rate = 24/60/2 = 0.2 items/tick
                // - Modified: 48 items/sec, 2 copies → per-machine rate = 48/60/2/2 = 0.2 items/tick
                expect(modifiedResult.crafting_cycle_plan.total_duration.ticks)
                    .toBe(result.crafting_cycle_plan.total_duration.ticks);
            });
        });
    });

    describe("PROCESSING_UNITS config (multi-ingredient chest input)", async () => {

        const config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNITS);
        let result: BlueprintGenerationResult;
        let input_inserter_id: EntityId;

        beforeAll(() => {
            result = generateClockForConfig(config);

            // Get the actual EntityId instances from the map keys
            const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
            input_inserter_id = keys.find(k => k.id === EntityId.forInserter(1).id)!;
        });

        it("records input inserter transfers", () => {
            const inserterTransfers = result.transfer_history.getOrThrow(input_inserter_id);
            expect(inserterTransfers.length).toBeGreaterThan(0);
        });

        it("transfers both required ingredient types", () => {
            const inserterTransfers = result.transfer_history.getOrThrow(input_inserter_id);
            const transferredItems = new Set(inserterTransfers.map(t => t.item_name));

            expect(transferredItems.has("electronic-circuit")).toBe(true);
            expect(transferredItems.has("advanced-circuit")).toBe(true);
        });
    });

    describe("belt used as a buffer between machines", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_BELTED_BUFFER);
        let result: BlueprintGenerationResult;
        const moved = (inserter_id: number) => Array.from(result.transfer_history.entries())
            .find(([id]) => id.id === EntityId.forInserter(inserter_id).id)![1]
            .reduce((sum, t) => sum + t.amount, 0);

        beforeAll(() => {
            result = generateClockForConfig(config);
        });

        it("is stable", () => {
            expect(result.stability_check.is_stable).toBe(true);
        });

        it("clocks the inserters filling the belt for what is taken off it", () => {
            expect(moved(1) + moved(2)).toBe(moved(3));
        });
    });

    describe("belt lane consumed outside the config", async () => {
        const config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNITS_BELT_EXPORT);
        let result: BlueprintGenerationResult;

        beforeAll(() => {
            result = generateClockForConfig(config);
        }, 120_000);

        it("fills the lane at its consumption rate", () => {
            const lane = config.belts.find(belt => belt.id === 5)!.lanes[0];
            const consumption_per_second = "consumption_per_second" in lane ? lane.consumption_per_second! : 0;
            const [, transfers] = Array.from(result.transfer_history.entries())
                .find(([id]) => id.id === EntityId.forInserter(12).id)!;
            const exported = transfers.reduce((sum, t) => sum + t.amount, 0);
            expect(exported).toBe(consumption_per_second * result.simulation_duration.ticks / 60);
        });
    });

    // Two iron bacteria cultivation biochambers that give each other the bacteria a craft starts from. Each has two
    // inserters to a chest (1 and 3, 4 and 6); 7 and 8 go between the machines; 9 and 10 bring bioflux and nutrients.
    // Recorded in Factorio 2.1.21 for 36000 ticks a clock: 576 bacteria in each of 399 periods on the subtick clock,
    // exactly 380 a second, and in each of 400 periods on the clock rounded to 90 ticks, 384 a second. With belt
    // windows of 8 ticks the subtick clock made 373: a fifth of them closed on a partly filled hand.
    // Recorded again on 2026-10-09 on the scaffold in the samples, for 72,576 ticks: 10,944 in each of the 42 repeats
    // of 1728 ticks the subtick clock counts, which cut into their 19 periods are 576 in each of 798. These tests
    // were skipped for a day because the long run counted a period of 90.947 ticks in bins of 90, which hold 570 of
    // the 576; the clock and the belt pickup rules were never at fault.
    describe("iron bacteria from two biochambers, each with two output inserters", async () => {
        const config = await loadConfigFromFile(ConfigPaths.IRON_BACTERIA_CULTIVATION);
        let validation: ConfigValidation;
        let alternatives: ClockAlternative[];
        let selected: ClockAlternative;
        let windows: SerializableClockWindows;

        beforeAll(() => {
            validation = validateConfig(config);
            const generated = generateClockAlternatives(config);
            alternatives = generated.alternatives;
            selected = alternatives[generated.selected_index];
            windows = selected.result.clock_windows;
        }, 60_000);

        it("validates with the hands a machine gives up a cycle, over both of its output inserters", () => {
            // 190 a second a machine: 3 hands of 16 every 15.158 ticks
            expect(validation.output_swings_per_cycle).toBe(3);
            expect(validation.cycle_ticks).toBeCloseTo(15.158, 3);
        });

        it("holds the target of 380 a second with 3 hands an inserter a cycle", () => {
            expect(selected.label).toBe("6 output swings per cycle, subtick clock");
            expect(selected.is_stable).toBe(true);
            expect(selected.items_per_second).toBeCloseTo(380, 6);
        });

        it("counts what all four output inserters move", () => {
            // 6 hands a machine in each of the 3 cycles of the period
            expect(selected.result.stability_check.expected_output_items).toBe(2 * 6 * 16 * 3);
        });

        it("does not call a clock stable whose swings do not come out whole for each output inserter", () => {
            const odd = alternatives.filter(a => /(: | )?[135] output swings? per cycle/.test(a.label));
            expect(odd.length).toBeGreaterThan(0);
            expect(odd.every(a => !a.is_stable)).toBe(true);
        });

        it("opens one window a cycle for each output inserter, for its 3 hands", () => {
            for (const id of ["inserter:1", "inserter:3", "inserter:4", "inserter:6"]) {
                expect(windows[id]).toEqual([{ start: 0, end: 20 }, { start: 30, end: 50 }, { start: 60, end: 80 }]);
            }
        });

        it("keeps the window of an inserter on the belt open long enough for a pickup that starts late or fills slowly", () => {
            for (const id of ["inserter:9", "inserter:10"]) {
                expect(windows[id]).toEqual([{ start: 0, end: 16 }, { start: 30, end: 46 }, { start: 60, end: 76 }]);
            }
        });

        it("leaves the inserters between the machines always enabled", () => {
            expect(windows["inserter:7"]).toBeUndefined();
            expect(windows["inserter:8"]).toBeUndefined();
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

        it.each([
            ["swings-1", 72, 48, [[1, 10], [25, 34], [49, 58]]],
            ["fractional", 72, 48, [[1, 34]]],
            ["planned-belt-slack", 144, 96, [[1, 70]]],
        ] as const)("%s is stable as built with the windows that ran in game", (id, period, bricks, windows) => {
            const result = alternative(id).result;
            expect(result.simulation_duration.ticks).toBe(period);
            expect(outputWindows(id)).toEqual(windows);
            expect(alternative(id).is_stable).toBe(true);
            expect(result.stability_check.as_built).toMatchObject({ is_stable: true, actual_output_items: bricks });
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
        let result: BlueprintGenerationResult;

        beforeAll(() => {
            result = generateClockForConfig({
                ...config,
                overrides: { ...config.overrides, terminal_swing_count: 2 },
            });
        });

        const rangesFor = (id: number) => result.transfer_history
            .getOrThrow(Array.from(result.transfer_history.keys()).find(k => k.id === EntityId.forInserter(id).id)!)
            .map(t => [t.tick_range.start_inclusive, t.tick_range.end_inclusive]);

        it("is stable", () => {
            expect(result.stability_check.is_stable).toBe(true);
        });

        it("LDS inserters 6 and 7 swing on the same ticks", () => {
            expect(rangesFor(7)).toEqual(rangesFor(6));
        });

        it("belt input inserters 1 and 4 swing on the same ticks", () => {
            expect(rangesFor(4)).toEqual(rangesFor(1));
        });
    });

    // Recorded in game: the planned windows ran at 48/96 because the furnace/module window
    // landed before the output inserter cleared the machine; the derived windows ran stable.
    describe("PRODUCTION_SCIENCE_JSON derived clock windows", async () => {
        const config = await loadConfigFromFile(ConfigPaths.PRODUCTION_SCIENCE_JSON);

        it("planned windows fail the clock-only check", () => {
            const result = generateClockForConfig(config, { verify_as_built: true });
            expect(result.stability_check.as_built?.is_stable).toBe(false);
        });

        it("derived windows pass the clock-only check", () => {
            const result = generateClockForConfig({
                ...config,
                overrides: { ...config.overrides, derive_clock_windows: true },
            });
            expect(result.derived_clock_windows?.succeeded).toBe(true);
            expect(result.stability_check.as_built?.actual_output_items).toBe(result.stability_check.expected_output_items);
            expect(result.stability_check.is_stable).toBe(true);
        }, 60_000);
    });

    // Regression test for issue #47:
    // A multi-filter belt→machine inserter (copper-plate + iron-gear-wheel) with terminal_swing_count=1
    // causes per-item fractional swing counts (copper=0.5, gear=0.5, total=1.0).
    // The total is an integer so fractional_swings_enabled stays false, but the clocked timing
    // constraint locks the inserter to 1 swing/cycle. Since stack_size(16) < automated_insertion_limit(18),
    // one item is always picked first and never blocked, starving the other item indefinitely.
    describe("AUTOMATION_SCIENCE: issue #47 regression (multi-filter fractional per-item transfers)", async () => {

        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        let result: BlueprintGenerationResult;
        let input_inserter_id: EntityId;
        let output_inserter_id: EntityId;

        beforeAll(() => {
            result = generateClockForConfig(config);

            const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
            // inserter:1 = belt→machine (copper-plate + iron-gear-wheel), no explicit id in config → index+1
            input_inserter_id = keys.find(k => k.id === EntityId.forInserter(1).id)!;
            // inserter:2 = machine→belt (automation-science-pack)
            output_inserter_id = keys.find(k => k.id === EntityId.forInserter(2).id)!;
        });

        it("generates a blueprint without throwing", () => {
            expect(result.blueprint).toBeDefined();
        });

        it("records transfers for the output inserter", () => {
            const transfers = result.transfer_history.getOrThrow(output_inserter_id);
            expect(transfers.length).toBeGreaterThan(0);
        });

        it("records transfers for the input inserter", () => {
            const transfers = result.transfer_history.getOrThrow(input_inserter_id);
            expect(transfers.length).toBeGreaterThan(0);
        });

        it("input inserter transfers both copper-plate and iron-gear-wheel (not just one)", () => {
            const transfers = result.transfer_history.getOrThrow(input_inserter_id);
            const transferred_items = new Set(transfers.map(t => t.item_name));
            expect(transferred_items.has("copper-plate")).toBe(true);
            expect(transferred_items.has("iron-gear-wheel")).toBe(true);
        });

        it("offers a stable clock at the target rate", () => {
            const alternatives = generateClockAlternatives(config);
            const selected = alternatives.alternatives[alternatives.selected_index];
            expect(selected.is_stable).toBe(true);
            expect(selected.items_per_second).toBeCloseTo(config.target_output.items_per_second, 6);
        });
    });
});
