import { describe, it, expect, beforeAll } from "vitest";
import { generateClockForConfig, generateClockAlternatives, generateClockWithSwingBackoff, BlueprintGenerationResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { EntityId } from "../entities";
import { OpenRange } from "../data-types";

describe("generateClockForConfig", () => {

    describe("STONE_BRICKS_DIRECT_INSERT config", async () => {

        const config = await loadConfigFromFile(ConfigPaths.STONE_BRICKS_DIRECT_INSERT);
        const result: BlueprintGenerationResult = generateClockForConfig(config);

        // Get the actual EntityId instances from the map keys
        const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
        const inserterId: EntityId = keys.find(k => k.id === "inserter:1")!;
        const drillId: EntityId = keys.find(k => k.id === "drill:1")!;

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
        const result: BlueprintGenerationResult = generateClockForConfig(config);

        // Get the actual EntityId instances from the map keys
        const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
        const input_inserter_id: EntityId = keys.find(k => k.id === EntityId.forInserter(1).id)!;
        const output_inserter_id: EntityId = keys.find(k => k.id === EntityId.forInserter(2).id)!;


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
                    OpenRange.from(76, 87),
                    OpenRange.from(87, 98)
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
            const { alternatives } = generateClockAlternatives(config);
            const windowsOf = (id: string) => alternatives.find(a => a.id === id)?.result.clock_windows;

            it.each(["planned-belt-slack", "planned", "derived"])("%s is stable", (id) => {
                expect(alternatives.find(a => a.id === id)?.is_stable).toBe(true);
            });

            it("planned + belt pickup slack adds 4 ticks to the belt input inserter", () => {
                expect(windowsOf("planned-belt-slack")).toEqual({
                    "inserter:2": [{ start: 1, end: 49 }],
                    "inserter:1": [{ start: 52, end: 102 }],
                });
            });

            it("planned keeps the simulated windows", () => {
                expect(windowsOf("planned")).toEqual({
                    "inserter:2": [{ start: 1, end: 49 }],
                    "inserter:1": [{ start: 52, end: 74 }, { start: 76, end: 98 }],
                });
            });

            it("observed windows follow the input inserter's activity", () => {
                expect(windowsOf("derived")).toEqual({
                    "inserter:2": [{ start: 1, end: 49 }],
                    "inserter:1": [{ start: 25, end: 76 }],
                });
            });

            it("has no uneven output swings to offer with one output window per period", () => {
                expect(alternatives.find(a => a.id === "uneven-output")).toBeUndefined();
            });
        });

    });

    describe("CHEMICAL_SCIENCE_ENGINES config (multi-output machine)", async () => {

        const config = await loadConfigFromFile(ConfigPaths.CHEMICAL_SCIENCE_ENGINES);
        const result: BlueprintGenerationResult = generateClockForConfig(config);

        // Get the actual EntityId instances from the map keys
        const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
        const output_inserter_1_id: EntityId = keys.find(k => k.id === EntityId.forInserter(1).id)!;
        const output_inserter_2_id: EntityId = keys.find(k => k.id === EntityId.forInserter(2).id)!;

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
        const result: BlueprintGenerationResult = generateClockForConfig(config);

        // Get the actual EntityId instances from the map keys
        const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
        const input_inserter_id: EntityId = keys.find(k => k.id === EntityId.forInserter(1).id)!;

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
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_BELTED_INTERNAL_BUFFER);
        const result = generateClockForConfig(config);
        const moved = (inserter_id: number) => Array.from(result.transfer_history.entries())
            .find(([id]) => id.id === EntityId.forInserter(inserter_id).id)![1]
            .reduce((sum, t) => sum + t.amount, 0);

        it("is stable", () => {
            expect(result.stability_check.is_stable).toBe(true);
        });

        it("clocks the inserters filling the belt for what is taken off it", () => {
            expect(moved(1) + moved(2)).toBe(moved(3));
        });
    });

    describe("belt lane consumed outside the config", async () => {
        const config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNITS_BELT_EXPORT);
        const result = generateClockForConfig(config);

        it("fills the lane at its consumption rate", () => {
            const lane = config.belts.find(belt => belt.id === 5)!.lanes[0];
            const consumption_per_second = "consumption_per_second" in lane ? lane.consumption_per_second! : 0;
            const [, transfers] = Array.from(result.transfer_history.entries())
                .find(([id]) => id.id === EntityId.forInserter(12).id)!;
            const exported = transfers.reduce((sum, t) => sum + t.amount, 0);
            expect(exported).toBe(consumption_per_second * result.simulation_duration.ticks / 60);
        });
    });

    // 4 output swings per 64 tick cycle is the optimal clock; the planner alone only reaches 2 swings
    describe("two foundry low density structures with plastic exports", async () => {
        const config = await loadConfigFromFile(ConfigPaths.LOW_DENSITY_TWO_FOUNDRY);
        const { alternatives } = generateClockAlternatives(config);
        const four_swings = alternatives.find(a => a.id === "swings-4");

        it("offers 4 output swings per cycle", () => {
            expect(four_swings?.result.used_terminal_swing_count).toBe(4);
            expect(four_swings?.result.crafting_cycle_plan.total_duration.ticks).toBe(64);
        });

        it("is stable at the target rate", () => {
            expect(four_swings?.is_stable).toBe(true);
            expect(four_swings?.items_per_second).toBe(120);
        });

        it("enables the output inserters for one batch of swings per cycle", () => {
            const batch = Array.from({ length: 6 }, (_, cycle) => ({ start: 2 + cycle * 64, end: 50 + cycle * 64 }));
            expect(four_swings?.result.clock_windows["inserter:1"]).toEqual(batch);
            expect(four_swings?.result.clock_windows["inserter:2"]).toEqual(batch);
        });
    });

    describe("forced output swing count", async () => {
        const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_DI);
        const result = generateClockWithSwingBackoff(config);
        const { alternatives } = generateClockAlternatives(config);

        it("uses the terminal_swing_count override as-is instead of backing off", () => {
            expect(config.overrides?.terminal_swing_count).toBe(2);
            expect(result.used_terminal_swing_count).toBe(2);
            expect(result.swing_backoff_report?.triggered).toBe(false);
        });

        it("uses it for every clock alternative", () => {
            expect(alternatives.map(a => a.result.used_terminal_swing_count).every(count => count === 2)).toBe(true);
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

    describe("fractional swings", () => {
        describe("PRODUCTION_SCIENCE_SHARED with fractional swings enabled", async () => {
            const configWithFractionalSwings = await loadConfigFromFile(ConfigPaths.PRODUCTION_SCIENCE_SHARED_JSON);

            const result = generateClockForConfig(configWithFractionalSwings);

            it("has fractional_swings_enabled set to true", () => {
                expect(result.crafting_cycle_plan.fractional_swings_enabled).toBe(true);
            });

            it("has a cycle_multiplier defined", () => {
                expect(result.crafting_cycle_plan.cycle_multiplier).toBeDefined();
                expect(result.crafting_cycle_plan.cycle_multiplier).toBeGreaterThan(1);
            });

            it("has swing_distribution defined", () => {
                expect(result.crafting_cycle_plan.swing_distribution).toBeDefined();
                expect(result.crafting_cycle_plan.swing_distribution!.size).toBeGreaterThan(0);
            });

            it("swing distributions sum to correct totals", () => {
                const distribution = result.crafting_cycle_plan.swing_distribution!;
                const cycle_multiplier = result.crafting_cycle_plan.cycle_multiplier!;

                for (const [entityId, swingDist] of distribution.entries()) {
                    const sum = swingDist.swings_per_subcycle.reduce((a, b) => a + b, 0);
                    expect(sum).toBe(swingDist.total_swings);
                    expect(swingDist.swings_per_subcycle.length).toBe(cycle_multiplier);
                }
            });

            it("output inserter has fractional swing distribution", () => {
                const distribution = result.crafting_cycle_plan.swing_distribution!;
                const outputInserterDist = distribution.get("inserter:1");

                expect(outputInserterDist).toBeDefined();
                // Should have alternating distribution (values differ by at most 1)
                const swings = outputInserterDist!.swings_per_subcycle;
                const min = Math.min(...swings);
                const max = Math.max(...swings);
                expect(max - min).toBeLessThanOrEqual(1);
            });

            it("simulation duration is extended by cycle_multiplier", () => {
                const base_duration = result.crafting_cycle_plan.total_duration.ticks;
                const cycle_multiplier = result.crafting_cycle_plan.cycle_multiplier!;
                const expected_simulation_duration = base_duration * cycle_multiplier;

                expect(result.simulation_duration.ticks).toBe(expected_simulation_duration);
            });
        });

        describe("PRODUCTION_SCIENCE_SHARED without fractional swings without fractional swings", async () => {
            const config = await loadConfigFromFile(ConfigPaths.PRODUCTION_SCIENCE_SHARED_JSON);
            const configWithoutFractionalSwings = {
                ...config,
                overrides: {
                    ...config.overrides,
                    use_fractional_swings: false
                }
            };
            const result = generateClockForConfig(configWithoutFractionalSwings);

            it("has fractional_swings_enabled set to false", () => {
                expect(result.crafting_cycle_plan.fractional_swings_enabled).toBe(false);
            });

            it("does not have swing_distribution defined", () => {
                expect(result.crafting_cycle_plan.swing_distribution).toBeUndefined();
            });

            it("does not have cycle_multiplier defined", () => {
                expect(result.crafting_cycle_plan.cycle_multiplier).toBeUndefined();
            });
        });

        describe("Utility Science Belted with Combined Blue and LDS", async () => {
            const config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_BELTED_COMBINED_BLUE_AND_LDS);
            const result = generateClockForConfig(config);

            // there are two valid tick ranges for this specific configuration.
            // both have been tested to be functional in the game using the following blueprint:
            // 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
            const valid_range_set_1 = [
                OpenRange.from(38, 49),
                OpenRange.from(49, 60),
                OpenRange.from(206, 217),
                OpenRange.from(217, 228),
                OpenRange.from(245, 256),
            ]

            const valid_range_set_2 = [
                OpenRange.from(13, 24),
                OpenRange.from(24, 35),
                OpenRange.from(181, 192),
                OpenRange.from(192, 203),
                OpenRange.from(234, 245),
            ]

            // confirmed in game, along with the stable clock alternatives below
            const valid_range_set_3 = [
                OpenRange.from(13, 24),
                OpenRange.from(24, 35),
                OpenRange.from(181, 192),
                OpenRange.from(192, 203),
                OpenRange.from(214, 225),
            ]

            it("has correct tick ranges for input inserter transfers", () => {
                // Get the actual EntityId instances from the map keys
                const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
                // inserter id 3 is the LDS + blue chip inserter in this configuration
                const input_inserter_id: EntityId = keys.find(k => k.id === EntityId.forInserter(3).id)!;

                const inserter_transfers = result.transfer_history.getOrThrow(input_inserter_id)
                const sorted_transfers = [...inserter_transfers].sort((a, b) => a.tick_range.start_inclusive - b.tick_range.start_inclusive);
                const expected_ranges = valid_range_set_3

                expect(sorted_transfers.length).toBe(5);
                sorted_transfers.forEach((transfer, index) => {
                    const expected_range = expected_ranges[index];
                    expect(transfer.tick_range.start_inclusive).toBe(expected_range.start_inclusive);
                    expect(transfer.tick_range.end_inclusive).toBe(expected_range.end_inclusive);
                })
            });

            // these three alternatives were confirmed to hold full output in game
            describe("clock alternatives", () => {
                const { alternatives } = generateClockAlternatives(config);
                const windowsOf = (id: string) => alternatives.find(a => a.id === id)?.result.clock_windows;

                it.each(["planned-belt-slack", "planned", "derived"])("%s is stable", (id) => {
                    expect(alternatives.find(a => a.id === id)?.is_stable).toBe(true);
                });

                it("planned + belt pickup slack adds 4 ticks to the belt input inserters", () => {
                    expect(windowsOf("planned-belt-slack")).toEqual({
                        "inserter:2": [{ start: 1, end: 50 }, { start: 169, end: 210 }],
                        "inserter:3": [{ start: 13, end: 39 }, { start: 181, end: 207 }, { start: 214, end: 229 }],
                        "inserter:1": [{ start: 206, end: 221 }],
                    });
                });

                it("planned keeps the simulated windows", () => {
                    expect(windowsOf("planned")).toEqual({
                        "inserter:2": [{ start: 1, end: 50 }, { start: 169, end: 210 }],
                        "inserter:3": [{ start: 13, end: 35 }, { start: 181, end: 203 }, { start: 214, end: 225 }],
                        "inserter:1": [{ start: 206, end: 217 }],
                    });
                });

                it("observed windows follow each inserter's activity", () => {
                    expect(windowsOf("derived")).toEqual({
                        "inserter:2": [{ start: 1, end: 50 }, { start: 169, end: 210 }],
                        "inserter:1": [{ start: 53, end: 68 }],
                        "inserter:3": [{ start: 25, end: 40 }, { start: 53, end: 79 }, { start: 193, end: 208 }, { start: 213, end: 228 }],
                    });
                });
            });
        });
    });

    // Inserters 1/4 feed the two identical pack machines and 2/3 empty them. Config order puts input 1
    // before output 2 but input 4 after output 3, which used to offset the machines by one tick and
    // desync the shared-clock LDS inserters 6/7.
    describe("UTILITY_SCIENCE_DIRECT_INSERT_LDS (identical machines stay in sync regardless of config order)", async () => {
        const config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE_DIRECT_INSERT_LDS);
        const result = generateClockForConfig({
            ...config,
            overrides: { ...config.overrides, terminal_swing_count: 2 },
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
    describe("AUTOMATION_SCIENCE_PACK issue #47 regression (multi-filter fractional per-item transfers)", async () => {

        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_PACK_FAILING);
        const result: BlueprintGenerationResult = generateClockForConfig(config);

        const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
        // inserter:1 = belt→machine (copper-plate + iron-gear-wheel), no explicit id in config → index+1
        const input_inserter_id: EntityId = keys.find(k => k.id === EntityId.forInserter(1).id)!;
        // inserter:2 = machine→belt (automation-science-pack)
        const output_inserter_id: EntityId = keys.find(k => k.id === EntityId.forInserter(2).id)!;

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
    });

    describe("AUTOMATION_SCIENCE_01_TERMINAL_SWINGS (explicit ALWAYS mode workaround)", async () => {

        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_01_TERMINAL_SWINGS);
        const result: BlueprintGenerationResult = generateClockForConfig(config);

        const keys = Array.from(result.crafting_cycle_plan.entity_transfer_map.keys());
        const input_inserter_id: EntityId = keys.find(k => k.id === EntityId.forInserter(1).id)!;
        const output_inserter_id: EntityId = keys.find(k => k.id === EntityId.forInserter(2).id)!;

        it("records transfers for both inserters", () => {
            expect(result.transfer_history.getOrThrow(output_inserter_id).length).toBeGreaterThan(0);
            expect(result.transfer_history.getOrThrow(input_inserter_id).length).toBeGreaterThan(0);
        });

        it("input inserter transfers both copper-plate and iron-gear-wheel", () => {
            const transfers = result.transfer_history.getOrThrow(input_inserter_id);
            const transferred_items = new Set(transfers.map(t => t.item_name));
            expect(transferred_items.has("copper-plate")).toBe(true);
            expect(transferred_items.has("iron-gear-wheel")).toBe(true);
        });
    });

    // One machine, two output hands and nine input hands per 288 ticks. Clocks for it are easy to get to the
    // expected output in one simulated period without the build actually repeating that period.
    describe("FLYING_ROBOT_FRAME clock-only check", async () => {
        const config = await loadConfigFromFile(ConfigPaths.FLYING_ROBOT_FRAME);

        // enable ranges as the inserters see them (decider windows shifted by the circuit latency)
        const clocked = (windows: Record<number, [number, number][]>) => generateClockForConfig({
            ...config,
            inserters: config.inserters.map(inserter => ({
                ...inserter,
                overrides: {
                    enable_control: {
                        mode: "CLOCKED" as const,
                        ranges: windows[inserter.id!].map(([start, end]) => ({ start, end })),
                        period_duration_ticks: 288,
                    },
                },
            })),
        });

        describe("planned clock", () => {
            const { alternatives } = generateClockAlternatives(config);
            const planned = alternatives.find(a => a.id === "planned")!;

            it("is stable and repeats every period", () => {
                expect(planned.is_stable).toBe(true);
                expect(planned.result.stability_check.as_built?.repeat_periods).toBe(1);
            });

            // the timelines default to this run; it differs from the planning run the windows were taken from
            it("carries the clock-only run, where both hands are dropped after the first window", () => {
                const dropsOf = (history: typeof planned.result.serializable_state_transition_history) => history.entities
                    .find(entity => entity.entity_id === "inserter:1")!.transitions
                    .filter(transition => transition.to_status === "DROP")
                    .map(transition => transition.tick);

                expect(dropsOf(planned.result.serializable_state_transition_history)).toEqual([5, 149]);
                expect(dropsOf(planned.result.clock_only_run!.state_transition_history)).toEqual([7, 19]);
                expect(planned.result.clock_only_run!.transfer_history.total_duration_ticks).toBe(288);
            });
        });

        describe("uneven output swings", () => {
            const { alternatives } = generateClockAlternatives(config);
            const uneven = alternatives.find(a => a.id === "uneven-output")!;

            it("is offered and stable from every start phase checked", () => {
                expect(uneven.is_stable).toBe(true);
                expect(uneven.result.stability_check.as_built?.start_phases_checked).toBe(112);
                expect(uneven.result.stability_check.as_built?.repeat_periods).toBe(1);
            });

            it("moves the second output swing one craft earlier and keeps the first", () => {
                expect(uneven.result.derived_clock_windows?.moved_output_swing).toEqual({ swing: 2, shift_ticks: -17 });
                expect(uneven.result.clock_windows["inserter:1"]).toEqual([{ start: 1, end: 13 }, { start: 128, end: 140 }]);
                expect(uneven.description).toContain("Output swing 2 starts 17 ticks earlier than planned.");
            });

            it("observes the input windows again for the moved swing", () => {
                expect(uneven.result.clock_windows["inserter:3"]).toEqual([
                    { start: 13, end: 50 }, { start: 128, end: 143 }, { start: 160, end: 175 },
                ]);
            });
        });

        // built by hand and run in game: output swings 116 and 172 ticks apart
        describe("hand-made clock with unevenly spaced output swings", () => {
            const result = clocked({
                1: [[2, 15], [118, 131]],
                2: [[15, 35]],
                3: [[15, 45], [131, 149]],
            });

            it("is stable and repeats every period", () => {
                expect(result.stability_check.is_stable).toBe(true);
                expect(result.stability_check.repeat_periods).toBe(1);
                expect(result.stability_check.repeat_output_items).toBeUndefined();
            });
        });

        describe("clock that reaches the expected output only every other period", () => {
            const result = clocked({
                1: [[2, 15], [59, 72]],
                2: [[15, 35]],
                3: [[15, 45], [201, 219]],
            });

            it("moves the expected output in the simulated period", () => {
                expect(result.stability_check.actual_output_items).toBe(result.stability_check.expected_output_items);
            });

            it("is unstable because the two periods it repeats over move half of it", () => {
                expect(result.stability_check.repeat_periods).toBe(2);
                expect(result.stability_check.repeat_output_items).toBe(32);
                expect(result.stability_check.is_stable).toBe(false);
            });
        });
    });
});
