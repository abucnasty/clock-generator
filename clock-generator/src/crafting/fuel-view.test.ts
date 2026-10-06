import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { Machine, MachineType, RecipeMetadata } from "../entities";
import { MachineState } from "../state";
import { FuelLevelRecorder, fuelPlan } from "./fuel-view";
import { generateClockForConfig } from "./generate-blueprint";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { unplannedInserterClocks } from "./sequence/unplanned-inserter-clock";

const quiet = { log: () => { }, warn: () => { }, error: () => { }, debug: () => { } };

describe("the fuel plan", () => {
    it("is absent when no inserter only fills a fuel slot", async () => {
        const config = await loadConfigFromFile(ConfigPaths.JELLYNUT_PROCESSING_ROCKET_FUEL);
        expect(generateClockForConfig(config, { logger: quiet }).fuel_plan).toBeUndefined();
    });

    describe("rocket fuel biochambers on a 128 tick clock", async () => {
        const config = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
        const result = generateClockForConfig(config, { logger: quiet });
        const plan = result.fuel_plan!;

        it("gives what each burner machine uses at its planned crafting share", () => {
            expect(plan.period_ticks).toBe(128);
            expect(plan.machines.map(machine => machine.machine_id)).toEqual(["machine:1", "machine:2", "machine:3"]);
            for (const machine of plan.machines) {
                expect(machine.fuel_item).toBe("nutrients");
                expect(machine.crafting_share).toBeGreaterThan(0.5);
                expect(machine.crafting_share).toBeLessThan(1);
                expect(machine.effective_burn_rate_per_second).toBeCloseTo(machine.burn_rate_per_second * machine.crafting_share);
                expect(machine.burned_per_period).toBeCloseTo(machine.effective_burn_rate_per_second * 128 / 60);
                expect(machine.insertion_limit).toBe(5);
                expect(machine.insertion_limit_lasts_ticks).toBeCloseTo(5 / machine.effective_burn_rate_per_second * 60);
                expect(machine.energy_consumption_bonus).toBeGreaterThan(0);
            }
        });

        it("gives the exported fuel clock of each fuel inserter and how often it should swing on it", () => {
            expect(plan.inserters.map(inserter => [inserter.inserter_id, inserter.machine_id, inserter.modulus])).toEqual([
                ["inserter:10", "machine:1", 95],
                ["inserter:12", "machine:2", 138],
                ["inserter:13", "machine:3", 95],
            ]);
            for (const inserter of plan.inserters) {
                const exported = result.unplanned_inserter_clocks![inserter.inserter_id];
                expect(inserter.modulus).toBe(exported.modulus);
                expect(inserter.window).toEqual(exported.window);
                expect(inserter.hand_size).toBe(16);
                expect(inserter.enables_per_minute).toBeCloseTo(3600 / inserter.modulus);
                expect(inserter.expected_swings_per_minute).toBeCloseTo(3600 / inserter.hand_lasts_ticks);
                // the window repeats while the insertion limit lasts, a hand of 16 lasts about three times that
                expect(inserter.swing_share).toBeCloseTo(inserter.modulus / inserter.hand_lasts_ticks);
                expect(inserter.swing_share).toBeGreaterThan(0.25);
                expect(inserter.swing_share).toBeLessThan(0.35);
            }
        });

        it("counts the period and every fuel clock on one merged clock", () => {
            // lcm(128, 95, 138)
            expect(plan.merged_clock_ticks).toBe(839040);
            expect(plan.separate_clocks_reason).toBeUndefined();
        });

        it("says why the fuel clocks are counted apart when there is no merged clock", () => {
            const registry = createEntityRegistryFromConfig(config);
            const fractional = fuelPlan(registry, unplannedInserterClocks(registry, 128), new Map(), 128.5)!;
            expect(fractional.merged_clock_ticks).toBeNull();
            expect(fractional.separate_clocks_reason).toBe("fractional_period");

            const long_period = 2 ** 30 + 1;
            const too_long = fuelPlan(registry, unplannedInserterClocks(registry, long_period), new Map(), long_period)!;
            expect(too_long.merged_clock_ticks).toBeNull();
            expect(too_long.separate_clocks_reason).toBe("merged_clock_too_long");
        });

        describe("the fuel consumption view", () => {
            const view = result.fuel_consumption_view!;

            it("covers a few hands of fuel for every machine", () => {
                const longest_hand = Math.max(...plan.inserters.map(inserter => inserter.hand_lasts_ticks));
                expect(view.duration_ticks).toBeGreaterThanOrEqual(3 * longest_hand);
                for (const inserter of plan.inserters) {
                    const swings = view.transfer_history.entities.find(entity => entity.entity_id === inserter.inserter_id)!.transfers;
                    expect(swings.length).toBeGreaterThanOrEqual(3);
                    // the view runs the exported fuel clock: every swing starts inside one of its windows
                    for (const swing of swings) {
                        const clock_tick = swing.start_tick % inserter.modulus;
                        expect(clock_tick).toBeGreaterThanOrEqual(inserter.window.start);
                        expect(clock_tick).toBeLessThanOrEqual(inserter.window.end + 1);
                    }
                }
            });

            it("has the fuel each burner machine held, cut down to a few hundred samples", () => {
                expect(view.fuel_levels.map(levels => levels.machine_id)).toEqual(["machine:1", "machine:2", "machine:3"]);
                for (const levels of view.fuel_levels) {
                    expect(levels.min.length).toBe(levels.max.length);
                    expect(levels.min.length).toBeLessThanOrEqual(480);
                    expect(levels.min.length).toBe(Math.ceil(view.duration_ticks / levels.ticks_per_sample));
                    levels.min.forEach((min, index) => expect(min).toBeLessThanOrEqual(levels.max[index]));
                    expect(Math.min(...levels.min)).toBe(levels.min_level);
                    expect(Math.max(...levels.max)).toBe(levels.max_level);
                }
            });

            it("counts the fuel inserted and burned by each machine", () => {
                for (const levels of view.fuel_levels) {
                    const inserted = view.transfer_history.entities
                        .filter(entity => view.fuel_inserter_ids.includes(entity.entity_id) && entity.sink?.entity_id === levels.machine_id)
                        .flatMap(entity => entity.transfers)
                        .reduce((sum, transfer) => sum + transfer.amount, 0);
                    expect(levels.inserted).toBe(inserted);
                    // the machines burn what the plan says: their crafting share of the burn rate
                    const machine = plan.machines.find(it => it.machine_id === levels.machine_id)!;
                    const planned = machine.effective_burn_rate_per_second * view.duration_ticks / 60;
                    expect(levels.burned).toBeGreaterThan(planned * 0.95);
                    expect(levels.burned).toBeLessThan(planned * 1.05);
                }
            });

            it("says no machine ran out of fuel", () => {
                expect(view.ran_out_of_fuel).toBe(false);
                for (const levels of view.fuel_levels) {
                    expect(levels.empty_ticks).toBe(0);
                    expect(levels.first_empty_tick).toBeNull();
                    expect(levels.min_level).toBeGreaterThan(0);
                }
            });
        });

        it("records no fuel levels for the clock itself", () => {
            expect(result.fuel_levels).toBeUndefined();
        });
    });
});

describe("FuelLevelRecorder", () => {
    // a nutrient is 2 MJ
    const biochamberState = (nutrients: number) => {
        const state = MachineState.forMachine(Machine.createMachine(1, {
            crafting_speed: 2,
            productivity: 0,
            recipe: RecipeMetadata.fromRecipeName("nutrients-from-yumako-mash"),
            type: MachineType.BIOCHAMBER,
        }));
        state.fuelInventory.addQuantity("nutrients", nutrients);
        return state;
    };

    it("counts the item being burned as the part of it that is left", () => {
        const state = biochamberState(2);
        state.fuelProgress.energy_remaining_mj = 0.5;
        const recorder = new FuelLevelRecorder([state]);
        expect(recorder.series()[0].start_level).toBe(2.25);
    });

    it("skips machines without a fuel slot", () => {
        const assembler = MachineState.forMachine(Machine.createMachine(2, {
            crafting_speed: 1,
            productivity: 0,
            recipe: RecipeMetadata.fromRecipeName("iron-gear-wheel"),
            type: "machine",
        }));
        expect(new FuelLevelRecorder([assembler]).series()).toEqual([]);
    });

    it("reports the ticks a machine had no fuel at all, and the hands dropped in", () => {
        const state = biochamberState(1);
        const recorder = new FuelLevelRecorder([state]);
        const burn = (mj: number) => {
            if (state.fuelProgress.energy_remaining_mj <= 0 && state.fuelInventory.getQuantity("nutrients") > 0) {
                state.fuelInventory.removeQuantity("nutrients", 1);
                state.fuelProgress.energy_remaining_mj = 2;
            }
            state.fuelProgress.energy_remaining_mj = Math.max(0, state.fuelProgress.energy_remaining_mj - mj);
            recorder.record();
        };
        // one nutrient lasts 4 ticks at 0.5 MJ a tick, then two ticks with nothing, then a hand of 4
        for (let tick = 0; tick < 6; tick++) {
            burn(0.5);
        }
        state.fuelInventory.addQuantity("nutrients", 4);
        burn(0.5);

        const [levels] = recorder.series();
        expect(levels.ticks_per_sample).toBe(1);
        expect(levels.min).toEqual([0.75, 0.5, 0.25, 0, 0, 0, 0]);
        expect(levels.max).toEqual([1, 0.75, 0.5, 0.25, 0, 0, 3.75]);
        expect(levels.empty_ticks).toBe(3);
        expect(levels.first_empty_tick).toBe(3);
        expect(levels.inserted).toBe(4);
        expect(levels.burned).toBeCloseTo(1.25);
        expect(levels.min_level).toBe(0);
        expect(levels.max_level).toBe(3.75);
    });

    it("cuts a long run down to at most 480 samples that keep the lowest and highest fuel", () => {
        const state = biochamberState(20);
        const recorder = new FuelLevelRecorder([state]);
        for (let tick = 0; tick < 1000; tick++) {
            state.fuelInventory.setQuantity("nutrients", tick === 500 ? 0 : 20);
            recorder.record();
        }
        const [levels] = recorder.series();
        expect(levels.ticks_per_sample).toBe(3);
        expect(levels.min.length).toBe(334);
        expect(levels.min[166]).toBe(0);
        expect(levels.max[166]).toBe(20);
        expect(levels.empty_ticks).toBe(1);
        expect(levels.first_empty_tick).toBe(500);
    });
});
