import { describe, it, expect, beforeAll } from "vitest";
import { generateClockForConfig, generateClockAlternatives, generateClockWithSwingBackoff, validateConfig, BlueprintGenerationResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
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

            it("has no swings to shift with one round of swings per period", () => {
                expect(alternatives.find(a => a.id === "shifted-swings")).toBeUndefined();
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

    // Two nutrient biochambers [1], [2] feed two pentapod egg biochambers [3], [4], which give each other the egg a
    // craft starts from and send the rest to the science biochamber [5]. Bioflux and nutrients come off one belt on
    // inserters 1, 2 and 11; inserters 3, 4, 6 and 7 bring nutrients to the egg biochambers; 12 takes the science away.
    // The target is 250 a second over 5 modules, 93% of what the egg biochambers can make. Recorded in Factorio 2.1.21
    // for 36000 ticks with 1 output swing per cycle, one module made exactly 50 a second (400 packs in each of 75
    // periods), and exactly 53 at a target of 265. Those recordings were made with inserters 3, 4, 6 and 7 always
    // enabled; with the windows they have now the clock has not been recorded.
    describe("agricultural science from two pentapod egg biochambers that feed each other", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);
        const { alternatives, selected_index } = generateClockAlternatives(config);
        const one_swing = alternatives.find(a => a.label === "1 output swing per cycle")!;
        const windows = one_swing.result.clock_windows;

        it("holds the target of 250 a second with one output swing per cycle, on a clock of 480 ticks", () => {
            expect(alternatives[selected_index]).toBe(one_swing);
            expect(one_swing.is_stable).toBe(true);
            expect(one_swing.items_per_second).toBeCloseTo(250, 6);
            expect(one_swing.result.simulation_duration.ticks).toBe(480);
        });

        it("leaves the inserters that take eggs from the egg biochambers always enabled, and clocks the rest", () => {
            const clocked = Object.keys(windows).map(id => Number(id.replace("inserter:", ""))).sort((a, b) => a - b);
            expect(clocked).toEqual([1, 2, 3, 4, 6, 7, 11, 12]);
        });

        it("gives the inserters bringing nutrients to the egg biochambers a window for every planned hand and one to spare", () => {
            // 30 nutrients a craft and what the biochamber burns: 7/5 of a hand an inserter a cycle, 35 hands in 25 cycles
            for (const id of ["inserter:3", "inserter:4", "inserter:6", "inserter:7"]) {
                expect(windows[id]).toHaveLength(36);
                expect(windows[id].slice(0, 3)).toEqual([{ start: 0, end: 9 }, { start: 13, end: 22 }, { start: 26, end: 35 }]);
            }
        });

        it("opens the output window at the start of every cycle, for one pickup", () => {
            // 16 packs every 19.2 ticks: 25 hands in a period of 480 ticks
            const output_windows = windows["inserter:12"];
            expect(output_windows).toHaveLength(25);
            expect(output_windows.slice(0, 3)).toEqual([{ start: 0, end: 4 }, { start: 19, end: 23 }, { start: 38, end: 42 }]);
        });

        it("keeps the inserter of the science biochamber enabled: a window as long as a late pickup needs is longer than the cycle", () => {
            expect(windows["inserter:11"]).toEqual([{ start: 0, end: 479 }]);
        });

        it("spreads the hands of the nutrient biochambers evenly over the period, fuel included and rounded up", () => {
            // 400 packs take 160 eggs from 64 crafts: 1920 nutrients and 42 burned, from 98 bioflux: 3.1 hands a machine,
            // and a hand of nutrients every few periods
            for (const id of ["inserter:1", "inserter:2"]) {
                expect(windows[id]).toHaveLength(5);
                expect(windows[id].map(it => it.start)).toEqual([0, 96, 192, 288, 384]);
            }
        });

        it("says how many hands back to back the stock of the science biochamber is sure to cover", () => {
            const insight = one_swing.insights.find(it => it.id === "output-burst")!;
            expect(insight.scope).toBe("build");
            // a hand of 16 every 8 ticks from a machine that makes one every 17: the output block of 28 covers 2 hands
            expect(insight.title).toBe("Machine 5 (agricultural-science-pack) is sure to have 28 agricultural-science-pack in stock: enough for 2 hands back to back");
            expect(insight.table?.rows.slice(0, 3)).toEqual([["1", "14.1", "yes"], ["2", "22.6", "yes"], ["3", "31.1", "no"]]);
            expect(insight.what).not.toContain("This clock takes");
        });

        it("says of a clock with 5 output swings that it asks for more than that stock, and does not call it stable", () => {
            // recorded for 36000 ticks, a clock with 5 output swings a cycle made 29920 of 30000 packs
            const five_swings = alternatives.find(a => a.label === "5 output swings per cycle")!;
            expect(five_swings.is_stable).toBe(false);
            expect(five_swings.insights.find(it => it.id === "output-burst")!.what)
                .toContain("This clock takes 5 hands back to back, which needs 48.");
        });

        it("says that the egg recipe loops and that the machines start with eggs inside", () => {
            const insight = one_swing.insights.find(it => it.id === "looping-recipe")!;
            expect(insight.scope).toBe("build");
            expect(insight.what).toContain("starts each of these machines with 7 pentapod-egg already inside");
            expect(insight.table?.rows.map(row => row[0])).toHaveLength(2);
        });
    });

    // Two iron bacteria cultivation biochambers that give each other the bacteria a craft starts from. Each has two
    // inserters to a chest (1 and 3, 4 and 6); 7 and 8 go between the machines; 9 and 10 bring bioflux and nutrients.
    // Recorded in Factorio 2.1.21 for 36000 ticks a clock: 576 bacteria in each of 399 periods on the subtick clock,
    // exactly 380 a second, and in each of 400 periods on the clock rounded to 90 ticks, 384 a second. With belt
    // windows of 8 ticks the subtick clock made 373: a fifth of them closed on a partly filled hand.
    describe("iron bacteria from two biochambers, each with two output inserters", async () => {
        const config = await loadConfigFromFile(ConfigPaths.IRON_BACTERIA_CULTIVATION);
        const validation = validateConfig(config);
        const { alternatives, selected_index } = generateClockAlternatives(config);
        const selected = alternatives[selected_index];
        const windows = selected.result.clock_windows;

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

        it("says that the stock of a biochamber covers the 3 hands each of its output inserters takes", () => {
            const insight = selected.insights.find(it => it.id === "output-burst")!;
            // two inserters take 32 every 8 ticks from a machine that makes 30: a burst hardly draws on the stock of 50
            expect(insight.title).toContain("is sure to have 50 iron-bacteria in stock: enough for 14 hands back to back");
            expect(insight.what).toContain("can each take a hand of 16 every 8 ticks");
            expect(insight.what).not.toContain("This clock takes");
        });

        it("leaves the inserters between the machines always enabled", () => {
            expect(windows["inserter:7"]).toBeUndefined();
            expect(windows["inserter:8"]).toBeUndefined();
        });
    });

    /** What the rocket fuel samples have in common: two rocket fuel biochambers fed jelly by one jellynut biochamber */
    const rocketFuelSample = async (path: string) => {
        const config = await loadConfigFromFile(path);
        const ids = (matches: (inserter: Config["inserters"][number]) => boolean) =>
            config.inserters.filter(matches).map(inserter => `inserter:${inserter.id}`);
        const { alternatives } = generateClockAlternatives(config);
        const alternative = (id: string) => alternatives.find(a => a.id === id)!;
        /** Items an inserter moves in the planned period */
        const moved = (inserter_id: string): number => alternative("planned").result.serializable_transfer_history.entities
            .find(entity => entity.entity_id === inserter_id)!.transfers.reduce((sum, t) => sum + t.amount, 0);
        return {
            config,
            alternatives,
            alternative,
            moved,
            period: alternative("planned").result.simulation_duration.ticks,
            jelly_inserter_ids: ids(it => it.source.type === "machine" && it.sink.type === "machine"),
            output_inserter_ids: ids(it => it.source.type === "machine" && it.sink.type === "belt" && it.source.id !== 2),
            // belt 1 carries bioflux and jellynut: machine 2 takes the jellynut, the rocket fuel machines the bioflux
            jellynut_inserter_id: ids(it => it.source.type === "belt" && it.source.id === 1 && it.sink.id === 2)[0],
            bioflux_inserter_ids: ids(it => it.source.type === "belt" && it.source.id === 1 && it.sink.id !== 2),
        };
    };

    describe("rocket fuel biochambers at 60 per second", async () => {
        const sample = await rocketFuelSample(ConfigPaths.GLEBA_ROCKET_FUEL);
        const { alternative, moved, period } = sample;

        // 16 jelly a hand is 15/4 hands a 32 tick cycle
        it("has a 128 tick period", () => {
            expect(period).toBe(128);
        });

        it.each(["planned-belt-slack", "planned", "fractional", "derived", "shifted-swings"])("%s is stable as built", (id) => {
            expect(alternative(id).is_stable).toBe(true);
            expect(alternative(id).result.stability_check.as_built?.is_stable).toBe(true);
            expect(alternative(id).items_per_second).toBe(60);
        });

        it("selects the planned clock with belt pickup slack", () => {
            expect(sample.alternatives[0].id).toBe("planned-belt-slack");
            expect(sample.alternatives[0].is_stable).toBe(true);
        });

        it("moves what a period needs through every planned inserter", () => {
            // 128 rocket fuel is 32 crafts of 30 jelly and 2 bioflux, and 480 jelly is 48 jellynut a 64 ticks
            sample.output_inserter_ids.forEach(id => expect(moved(id)).toBe(64));
            sample.jelly_inserter_ids.forEach(id => expect(moved(id)).toBe(240));
            sample.bioflux_inserter_ids.forEach(id => expect(moved(id)).toBe(32));
            expect(moved(sample.jellynut_inserter_id)).toBe(96);
        });

        // one hand of bioflux each 64 ticks rather than both at once: both at once holds the rocket fuel machine's
        // bioflux over its insertion limit, and the jelly inserters wait for it
        it("spreads the two hands of bioflux a period over two windows", () => {
            const windows = alternative("planned").result.clock_windows;
            for (const id of sample.bioflux_inserter_ids) {
                expect(windows[id].length).toBe(2);
                expect(windows[id][1].start - windows[id][0].start).toBe(64);
            }
        });

        it("clocks the fuel and seed inserters outside the plan", () => {
            const clocks = Object.values(alternative("planned").result.unplanned_inserter_clocks ?? {});
            expect(clocks.filter(clock => clock.kind === "fuel").length).toBe(3);
            expect(clocks.filter(clock => clock.kind === "by-product").length).toBe(1);
        });

        // A rocket fuel biochamber's slot is filled up to 11 nutrients and the jellynut one's to 9. In a run of the
        // exported clock they lasted at least 208 and 246 ticks, as in game. Less the 14 ticks a hand takes to arrive,
        // the fuel clocks are 192 and 224, divisors of 21 periods, so one clock of 2688 ticks holds them; on the 128
        // tick clock both were 64.
        it("looks at each fuel slot nearly as seldom as its fuel is sure to last, on fuel clocks of their own", () => {
            const clocks = alternative("planned").result.unplanned_inserter_clocks!;
            const fuel_moduli = sample.config.inserters
                .filter(it => it.source.type === "belt" && it.source.id === 3)
                .map(it => [it.sink.id, clocks[`inserter:${it.id}`]] as const);
            expect(fuel_moduli).toHaveLength(3);
            for (const [machine_id, clock] of fuel_moduli) {
                expect(clock.own_clock).toBe(true);
                expect(clock.modulus).toBe(machine_id === 2 ? 224 : 192);
                expect(clock.window).toEqual({ start: 0, end: 7 });
            }
            expect(alternative("planned").result.fuel_plan?.merged_clock_ticks).toBe(2688);
            const lasted = alternative("planned").result.fuel_consumption_view!.fuel_levels.map(levels => levels.limit_lasts_ticks);
            expect(lasted).toEqual([208, 246, 208]);
        });

        it("keeps every machine fuelled over the fuel consumption view", () => {
            const view = alternative("planned").result.fuel_consumption_view!;
            expect(view.fuel_swings_recorded).toBe(true);
            // a hand of 16 nutrients each time, and a slot that never runs dry shows as a machine that never lacks ingredients
            const fuel_transfers = view.transfer_history.entities
                .filter(entity => view.fuel_inserter_ids.includes(entity.entity_id))
                .flatMap(entity => entity.transfers);
            expect(fuel_transfers.length).toBeGreaterThan(0);
            fuel_transfers.forEach(transfer => expect(transfer.amount).toBe(16));
            const jellynut_machine = view.state_transition_history.entities.find(entity => entity.entity_id === "machine:2")!;
            expect(jellynut_machine.transitions.map(transition => transition.to_status)).not.toContain("INGREDIENT_SHORTAGE");
        });
    });

    describe("rocket fuel biochambers fed jelly by inserters with no time to spare", async () => {
        // 15 jelly a hand is 8 hands a 64 tick period for each jelly inserter, and a hand takes them 8 ticks
        const sample = await rocketFuelSample(ConfigPaths.GLEBA_ROCKET_FUEL_JELLY_STACK_15);
        const { alternative, period, jelly_inserter_ids, jellynut_inserter_id } = sample;

        it("sets the jelly inserters to 15 a hand", () => {
            const jelly_inserters = sample.config.inserters.filter(it => it.source.type === "machine" && it.sink.type === "machine");
            expect(jelly_inserters.map(it => it.stack_size)).toEqual([15, 15, 15, 15]);
        });

        it("has a 64 tick period", () => {
            expect(period).toBe(64);
        });

        it.each(["planned-belt-slack", "planned", "fractional", "derived"])("%s is stable as built", (id) => {
            expect(alternative(id).is_stable).toBe(true);
            expect(alternative(id).result.stability_check.as_built?.is_stable).toBe(true);
            expect(alternative(id).items_per_second).toBe(60);
        });

        // the hand a jelly inserter picks up at the end of a period is dropped in the next one: its pickup needs a
        // window at the end of the period, or the exported clock moves 7 of the 8 hands
        it("keeps the jelly inserters enabled for the hand that is in flight when the period starts", () => {
            const windows = alternative("planned").result.clock_windows;
            for (const id of jelly_inserter_ids) {
                const last_window = windows[id][windows[id].length - 1];
                expect(windows[id].length).toBe(2);
                expect(last_window.end).toBeGreaterThanOrEqual(period - 1);
            }
        });

        it("moves the planned 8 hands of jelly a period", () => {
            const history = alternative("planned").result.serializable_transfer_history;
            for (const id of jelly_inserter_ids) {
                const moved = history.entities.find(entity => entity.entity_id === id)!.transfers.reduce((sum, t) => sum + t.amount, 0);
                expect(moved).toBe(8 * 15);
            }
        });

        // 3 hands of 16 jellynut a period: refilled up to the insertion limit of 67 instead, the hands come 5 at a
        // time every 100 ticks or so, and the one period that is observed sees 1 of them
        it("brings the planned 3 hands of jellynut in the planned period", () => {
            const history = alternative("planned").result.serializable_transfer_history;
            const moved = history.entities.find(entity => entity.entity_id === jellynut_inserter_id)!.transfers.reduce((sum, t) => sum + t.amount, 0);
            expect(moved).toBe(3 * 16);
        });
    });

    // Three furnaces fed by mining drills that drop straight into them, 40 bricks a second each. A furnace makes 43 a
    // second, so the window of its output inserter is all that holds it to 40. Recorded in Factorio 2.1.21: the clocks
    // with 1, 3 and 6 output swings each moved exactly their hands every period for 10 periods, from every furnace.
    describe("stone bricks from mining drills that drop into the furnaces", async () => {
        const config = await loadConfigFromFile(ConfigPaths.STONE_BRICKS_DIRECT_INSERT_2_1);
        const { alternatives } = generateClockAlternatives(config);
        const alternative = (id: string) => alternatives.find(a => a.id === id)!;
        const outputWindows = (id: string) => alternative(id).result.clock_windows["inserter:1"].map(w => [w.start, w.end]);

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

    // 4 output swings per 64 tick cycle is the optimal clock; the planner alone only reaches 2 swings
    describe("two foundry low density structures with plastic exports", async () => {
        const config = await loadConfigFromFile(ConfigPaths.LOW_DENSITY_TWO_FOUNDRY);
        const { alternatives } = generateClockAlternatives(config);
        const four_swings = alternatives.find(a => a.id === "swings-4");

        it("offers 4 output swings per cycle", () => {
            expect(four_swings?.result.used_terminal_swing_count).toBe(4);
            expect(four_swings?.result.crafting_cycle_plan.total_duration.ticks).toBe(64);
        });

        // The plastic inserters to the foundries swing by what the machines hold, 32 hands a period on average but 33
        // in some periods and 31 in others. A foundry that got a hand more has product to spare, and its output
        // inserter, whose window is on for the whole period, takes a hand more in that period.
        it("is not stable as built: the plastic inserters bring a hand more in some periods", () => {
            expect(four_swings?.is_stable).toBe(false);
            expect(four_swings?.result.stability_check.as_built?.is_stable).toBe(false);
        });

        it("is stable as built with the planned clock", () => {
            expect(alternatives.find(a => a.id === "planned")?.is_stable).toBe(true);
        });

        it("is stable at the target rate with 3 output swings per cycle", () => {
            const three_swings = alternatives.find(a => a.id === "swings-3");
            expect(three_swings?.is_stable).toBe(true);
            expect(three_swings?.items_per_second).toBe(120);
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

    describe("a machine with a by-product", () => {
        it("is stable as built when an inserter takes the by-product off for good", async () => {
            // jellynut-processing makes jelly for two machines and the seed at 2%; the seeds fill their stack of 10 and
            // block the machine unless the inserter taking them off picks them up although they are not its main product
            const config = await loadConfigFromFile(ConfigPaths.JELLYNUT_PROCESSING_ROCKET_FUEL);
            const result = generateClockForConfig(config, { verify_as_built: true, logger: { log() {}, warn() {}, error() {}, debug() {} } });

            expect(result.stability_check.is_stable).toBe(true);
            expect(result.stability_check.actual_output_items).toBeGreaterThan(0);
            expect(result.stability_check.as_built?.is_stable).toBe(true);
        });

        it("clocks the inserter taking the by-product off, so it only looks at the machine now and then", async () => {
            const config = await loadConfigFromFile(ConfigPaths.JELLYNUT_PROCESSING_ROCKET_FUEL);
            const result = generateClockForConfig(config, { logger: { log() {}, warn() {}, error() {}, debug() {} } });

            // it is not in the plan, so its clock repeats within the period instead of coming from swing counts
            const windows = result.clock_windows["inserter:11"];
            expect(windows.length).toBeGreaterThanOrEqual(1);
            expect(windows[0].end - windows[0].start).toBeLessThan(20);
            expect(result.serializable_transfer_plan.entities.map(entity => entity.entity_id)).not.toContain("inserter:11");

            const described = result.blueprint.entities
                .map(entity => entity.player_description ?? "")
                .find(description => description.includes("(by-product)"));
            expect(described).toContain("Inserter 11 for [item=jellynut-seed]");
            expect(described).toContain("looks every");
        });
    });

    describe("a biochamber with a fuel inserter", () => {
        const quiet = { log() {}, warn() {}, error() {}, debug() {} };

        it("is stable as built, with the fuel inserter on a clock of its own", async () => {
            // 926% energy consumption: the biochamber burns about 5 nutrients a craft, most of the 6 it makes
            const config = await loadConfigFromFile(ConfigPaths.BIOCHAMBER_FUEL);
            const result = generateClockForConfig(config, { verify_as_built: true, logger: quiet });

            expect(result.stability_check.is_stable).toBe(true);
            expect(result.stability_check.as_built?.is_stable).toBe(true);

            // the fuel clock counts its own ticks, so the fuel inserter has no windows on the clock of the period
            expect(result.clock_windows["inserter:3"]).toBeUndefined();
            const fuel_clock = result.unplanned_inserter_clocks!["inserter:3"];
            expect(fuel_clock).toMatchObject({ kind: "fuel", own_clock: true });
        });

        it("does not change the LCM", async () => {
            const config = await loadConfigFromFile(ConfigPaths.BIOCHAMBER_FUEL);
            const without_fuel = { ...config, machines: config.machines.map(machine => ({ ...machine, type: "machine" as const })) };
            const with_fuel_inserter = generateClockForConfig(config, { logger: quiet });
            const plain = generateClockForConfig(
                { ...without_fuel, inserters: config.inserters.filter(inserter => inserter.id !== 3) }, { logger: quiet });
            expect(with_fuel_inserter.used_lcm).toBe(plain.used_lcm);
        });

        it("keeps the rocket fuel chain stable as built with the fuel of three biochambers", async () => {
            const config = await loadConfigFromFile(ConfigPaths.JELLYNUT_PROCESSING_ROCKET_FUEL_BIOCHAMBERS);
            const result = generateClockForConfig(config, { verify_as_built: true, logger: quiet });

            expect(result.stability_check.is_stable).toBe(true);
            expect(result.stability_check.as_built?.is_stable).toBe(true);
            const fuel_inserter_ids = ["inserter:10", "inserter:12", "inserter:13"];
            fuel_inserter_ids.forEach(id => {
                expect(result.clock_windows[id]).toBeUndefined();
                expect(result.unplanned_inserter_clocks![id].own_clock).toBe(true);
            });
        });

        describe("the fuel consumption view", () => {
            it("runs the exported clock for several periods so the fuel inserter shows inserting", async () => {
                const config = await loadConfigFromFile(ConfigPaths.BIOCHAMBER_FUEL);
                const result = generateClockForConfig(config, { logger: quiet });
                const view = result.fuel_consumption_view!;

                // a hand of fuel lasts the machine longer than the 960 tick clock, so one period seldom has a swing
                expect(view.periods).toBeGreaterThanOrEqual(2);
                expect(view.duration_ticks).toBe(view.periods * result.simulation_duration.ticks);
                expect(view.state_transition_history.total_duration_ticks).toBe(view.duration_ticks);
                expect(view.fuel_inserter_ids).toEqual(["inserter:3"]);
                expect(view.fuel_swings_recorded).toBe(true);

                const fuel_transfers = view.transfer_history.entities.find(entity => entity.entity_id === "inserter:3")!.transfers;
                expect(fuel_transfers.length).toBeGreaterThan(0);
                fuel_transfers.forEach(transfer => {
                    expect(transfer.item_name).toBe("nutrients");
                    expect(transfer.amount).toBe(16);
                });
            });

            it("leaves the clock and its stability as they are", async () => {
                const config = await loadConfigFromFile(ConfigPaths.BIOCHAMBER_FUEL);
                const result = generateClockForConfig(config, { logger: quiet });
                expect(result.simulation_duration.ticks).toBe(result.serializable_state_transition_history.total_duration_ticks);
                expect(result.stability_check.is_stable).toBe(true);
            });

            it("shows the fuel being consumed in a chain that also moves a by-product", async () => {
                const config = await loadConfigFromFile(ConfigPaths.JELLYNUT_PROCESSING_ROCKET_FUEL_BIOCHAMBERS);
                const view = generateClockForConfig(config, { logger: quiet }).fuel_consumption_view!;

                expect(view.fuel_swings_recorded).toBe(true);
                const swung = view.transfer_history.entities
                    .filter(entity => view.fuel_inserter_ids.includes(entity.entity_id) && entity.transfers.length > 0);
                expect(swung.length).toBeGreaterThan(0);
            });

            it("is absent when no machine burns fuel", async () => {
                const config = await loadConfigFromFile(ConfigPaths.JELLYNUT_PROCESSING_ROCKET_FUEL);
                expect(generateClockForConfig(config, { logger: quiet }).fuel_consumption_view).toBeUndefined();
            });
        });

        describe("the blueprint of rocket fuel biochambers", async () => {
            const config = await loadConfigFromFile(ConfigPaths.JELLYNUT_PROCESSING_ROCKET_FUEL_BIOCHAMBERS);
            const result = generateClockForConfig(config, { logger: quiet });
            const period = result.simulation_duration.ticks;
            const fuel_moduli = Array.from(new Set(Object.values(result.unplanned_inserter_clocks!)
                .filter(clock => clock.own_clock).map(clock => clock.modulus))).sort((a, b) => a - b);
            const entities = result.blueprint.entities;
            const behavior = (entity: typeof entities[number]) => JSON.stringify(entity.control_behavior ?? {});
            const clocks = entities.filter(entity => (entity.player_description ?? "").startsWith("Clock for"));
            const modulos = entities.filter(entity => entity.name === "arithmetic-combinator");

            it("has two fuel clocks, one for the rocket fuel biochambers and one for the jellynut one", () => {
                expect(fuel_moduli).toHaveLength(2);
            });

            it("counts one clock long enough for the period and every fuel clock to fit a whole number of times", () => {
                expect(clocks).toHaveLength(1);
                expect(entities.filter(entity => (entity.player_description ?? "").startsWith("Fuel clock"))).toHaveLength(0);
                const counted_to = Number(/"constant":(\d+)/.exec(behavior(clocks[0]))![1]) + 1;
                [period, ...fuel_moduli].forEach(ticks => expect(counted_to % ticks).toBe(0));
                // on a signal of its own, which leaves the clock signal for the clock of the period
                expect(behavior(clocks[0])).toContain('"name":"signal-T"');
                expect(behavior(clocks[0])).not.toContain('"name":"signal-clock"');
            });

            it("gives the clock of the period and each fuel clock as a modulo of the one clock", () => {
                // a fuel clock of as many ticks as the period is the clock of the period
                expect(modulos).toHaveLength(new Set([period, ...fuel_moduli]).size);
                modulos.forEach(modulo => expect(behavior(modulo)).toContain('"first_signal":{"name":"signal-T"'));
                const period_clock = modulos.filter(modulo => behavior(modulo).includes('"output_signal":{"name":"signal-clock"'));
                expect(period_clock).toHaveLength(1);
                expect(behavior(period_clock[0])).toContain(`"second_constant":${period}`);
                fuel_moduli.forEach(modulus =>
                    expect(modulos.filter(modulo => behavior(modulo).includes(`"second_constant":${modulus}`))).toHaveLength(1));
            });

            it("puts fuel inserters with the same windows on one described combinator", () => {
                const nutrient_deciders = entities.filter(entity =>
                    entity.name === "decider-combinator" && behavior(entity).includes('"name":"nutrients"'));
                // the two rocket fuel biochambers burn at the same rate and share a combinator; the jellynut one has its own
                expect(nutrient_deciders).toHaveLength(2);
                nutrient_deciders.forEach(decider => {
                    const description = decider.player_description ?? "";
                    expect(description).toContain("(fuel)");
                    expect(description).toContain("swings every");
                    expect(description).toContain("fuel clock");
                    // reads a modulo of the one clock
                    expect(behavior(decider)).not.toContain('"name":"signal-T"');
                });
            });

            it("leaves the other combinators reading the clock signal", () => {
                const planned_deciders = entities.filter(entity =>
                    entity.name === "decider-combinator" && !clocks.includes(entity) && !behavior(entity).includes('"name":"nutrients"'));
                expect(planned_deciders.length).toBeGreaterThan(0);
                planned_deciders.forEach(decider => expect(behavior(decider)).toContain('"name":"signal-clock"'));
            });

            it("is not offered again as a modulo blueprint for the fuel clocks alone", () => {
                if (result.modulo_blueprint) {
                    expect(result.modulo_blueprint.label).toContain("(modulo clock)");
                }
                expect(result.blueprint.label).not.toContain("(modulo clock)");
            });
        });
    });

    describe("combinator descriptions", () => {
        const quiet = { log() {}, warn() {}, error() {}, debug() {} };

        // Factorio keeps at most 500 bytes of the description of a combinator
        it.each([
            ["rocket fuel biochambers", ConfigPaths.JELLYNUT_PROCESSING_ROCKET_FUEL_BIOCHAMBERS],
            ["a biochamber with a fuel inserter", ConfigPaths.BIOCHAMBER_FUEL],
            ["flying robot frames", ConfigPaths.FLYING_ROBOT_FRAME],
        ])("are at most 500 bytes in the blueprint of %s", async (_name, path) => {
            const config = await loadConfigFromFile(path);
            const result = generateClockForConfig(config, { logger: quiet });
            const descriptions = [result.blueprint, result.modulo_blueprint, result.subtick?.blueprint]
                .flatMap(blueprint => blueprint?.entities ?? [])
                .map(entity => entity.player_description)
                .filter((description): description is string => description !== undefined);

            expect(descriptions.length).toBeGreaterThan(0);
            descriptions.forEach(description => expect(new TextEncoder().encode(description).length).toBeLessThanOrEqual(500));
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

        describe("insights", () => {
            const { alternatives } = generateClockAlternatives(config);
            const insightsOf = (id: string) => alternatives.find(a => a.id === id)!.insights;
            const insight = (id: string, insight_id: string) => insightsOf(id).find(it => it.id === insight_id);

            it("says how much time the machine has to spare", () => {
                expect(insight("planned", "spare-time")).toMatchObject({
                    scope: "build",
                    title: "Machine 1 (flying-robot-frame) has 9 ticks to spare each clock period",
                    table: { rows: [["Machine 1 (flying-robot-frame)", "279", "9", "17.4"]] },
                });
            });

            it("lists every ingredient's insertion limit and hands per period", () => {
                expect(insight("planned", "insertion-limits")?.table?.rows).toEqual([
                    ["Machine 1 (flying-robot-frame)", "steel-plate", "1", "6", "Inserter 2", "16", "1"],
                    ["Machine 1 (flying-robot-frame)", "electric-engine-unit", "1", "6", "Inserter 2", "16", "1"],
                    ["Machine 1 (flying-robot-frame)", "electronic-circuit", "3", "18", "Inserter 3", "16", "3"],
                    ["Machine 1 (flying-robot-frame)", "battery", "2", "12", "Inserter 3", "16", "2"],
                ]);
                expect(insight("planned", "insertion-limits")?.what).toContain("takes electronic-circuit only while it holds fewer than 18");
            });

            it("says how long a full output hand takes", () => {
                expect(insight("planned", "output-hand")?.title).toBe("A full hand of flying-robot-frame takes 139.4 ticks to make");
            });

            it("points out where the exported clock swings differently than the plan", () => {
                expect(insight("planned", "plan-versus-clock")?.what)
                    .toContain("Inserter 1 drops at ticks 7, 19 where the plan had 5, 149");
            });

            it("does not compare shifted swings with the plan they were moved off", () => {
                expect(insight("shifted-swings", "plan-versus-clock")).toBeUndefined();
            });

            it("explains an unstable clock instead of reading build numbers from it", () => {
                const ids = insightsOf("swings-2").map(it => it.id);
                expect(ids).toContain("unstable");
                expect(ids).not.toContain("spare-time");
                expect(insight("swings-2", "unstable")?.what).toContain("moved 16 of 32 items in a clock period");
                expect(insight("swings-2", "insertion-limits")?.table?.rows).toHaveLength(4);
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
                expect(uneven.result.derived_clock_windows?.moved_output_swing).toMatchObject({ swing: 2, shift_ticks: -17 });
                expect(uneven.result.clock_windows["inserter:1"]).toEqual([{ start: 1, end: 13 }, { start: 128, end: 140 }]);
                expect(uneven.description).toContain("Output swing 2 starts 17 ticks earlier than planned.");
            });

            it("lists every position tried with whether it passed", () => {
                const rows = uneven.result.derived_clock_windows!.moved_output_swing!.shifts_checked;
                expect(rows.map(row => row.index)).toEqual([2]);
                expect(rows[0].shifts.filter(shift => shift.is_stable).map(shift => shift.shift_ticks))
                    .toEqual([-70, -52, -35, -17, 17, 35, 52, 70]);
                // 52 works since a machine at its output block crafts the ingredients that reach it, as in game
                expect(rows[0].shifts.filter(shift => !shift.is_stable).map(shift => shift.shift_ticks))
                    .toEqual([-105, -87, 87, 105]);
            });

            it("observes the input windows again for the moved swing", () => {
                expect(uneven.result.clock_windows["inserter:3"]).toEqual([
                    { start: 13, end: 50 }, { start: 128, end: 143 }, { start: 160, end: 175 },
                ]);
            });
        });

        describe("shifted swings", () => {
            const { alternatives } = generateClockAlternatives(config);
            const shifted = alternatives.find(a => a.id === "shifted-swings")!;
            const primary = alternatives.find(a => a.id === "planned-belt-slack")!;

            it("is offered and stable", () => {
                expect(shifted.is_stable).toBe(true);
                expect(shifted.result.stability_check.as_built?.repeat_periods).toBe(1);
            });

            it("moves the second output swing and the top-up after it 40 ticks earlier as a block", () => {
                expect(shifted.result.shifted_cycle).toMatchObject({
                    cycle: 2,
                    shift_ticks: -40,
                    planned_ticks: { start: 145, end: 183 },
                    moved: [
                        { entity_id: "inserter:1", item_names: ["flying-robot-frame"] },
                        { entity_id: "inserter:3", item_names: ["battery", "electronic-circuit"] },
                    ],
                });
                expect(shifted.description).toContain("The swings planned in clock ticks 145–183 (inserter 1: flying-robot-frame; "
                    + "inserter 3: battery, electronic-circuit) start 40 ticks earlier than planned.");
                expect(shifted.result.clock_windows).toEqual({
                    "inserter:1": [{ start: 1, end: 13 }, { start: 105, end: 117 }],
                    "inserter:2": [{ start: 13, end: 39 }],
                    "inserter:3": [{ start: 13, end: 50 }, { start: 117, end: 143 }],
                });
            });

            it("lists the range of shifts that work, the planned position included", () => {
                const rows = shifted.result.shifted_cycle!.shifts_checked;
                expect(rows.map(row => row.index)).toEqual([2]);
                const stable = rows[0].shifts.filter(shift => shift.is_stable).map(shift => shift.shift_ticks);
                // one unbroken range, checked every 5 ticks
                expect(stable).toEqual(Array.from({ length: 23 }, (_, n) => -65 + 5 * n));
                expect(rows[0].shifts.some(shift => !shift.is_stable)).toBe(true);
            });

            it("says which machine limit ends the range on each side", () => {
                expect(shifted.result.shifted_cycle!.earliest).toEqual({
                    shift_ticks: -65,
                    is_search_limit: false,
                    notes: ["Inserter 3 waits 9 ticks for Machine 1 (flying-robot-frame) to drop below its insertion limit for electronic-circuit"],
                });
                expect(shifted.result.shifted_cycle!.latest).toEqual({
                    shift_ticks: 45,
                    is_search_limit: false,
                    // full output while its output is at the block, then short of ingredients: one 9 tick stop
                    notes: ["Machine 1 (flying-robot-frame) is out of ingredients for 9 ticks until these swings arrive"],
                });
            });

            it("keeps the planned windows of the first cycle and the planned window lengths", () => {
                const lengths = (windows: typeof shifted.result.clock_windows) => Object.fromEntries(
                    Object.entries(windows).map(([key, ranges]) => [key, ranges.map(range => range.end - range.start)]));
                expect(lengths(shifted.result.clock_windows)).toEqual(lengths(primary.result.clock_windows));
                expect(shifted.inserter_window_count).toBe(primary.inserter_window_count);
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
