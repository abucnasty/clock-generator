import { describe, it, expect, beforeAll } from "vitest";
import { generateClockForConfig, type BlueprintGenerationResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { TestConfigPaths } from "../../tests/configs/paths";
import { quiet } from "./generate-blueprint-test-helpers";

// The clock alternatives of the rocket fuel samples, which take a minute to generate, are in rocket-fuel.generation.test.ts
describe("generateClockForConfig", () => {

    // The builds are generated in beforeAll hooks, not in the describe bodies: those all run when the file is collected,
    // so a run of one test by name would generate every build in the file first. Each sample is generated once, with
    // the as-built check, for every describe that reads it.
    let rocket_fuel: BlueprintGenerationResult;
    let fuel_inserter: BlueprintGenerationResult;
    let flying_robot_frame: BlueprintGenerationResult;

    beforeAll(async () => {
        const verified = async (path: string) => generateClockForConfig(await loadConfigFromFile(path), { verify_as_built: true, logger: quiet });
        rocket_fuel = await verified(ConfigPaths.ROCKET_FUEL_60);
        fuel_inserter = await verified(TestConfigPaths.BIOCHAMBER_FUEL);
        flying_robot_frame = generateClockForConfig(await loadConfigFromFile(ConfigPaths.FLYING_ROBOT_FRAME_160), { logger: quiet });
    });

    describe("a machine with a by-product", () => {
        it("holds as built when an inserter takes the by-product off for good, with the jelly takers served in every order", () => {
            // jellynut-processing makes jelly for two machines and the seed at 2%; the seeds fill their stack of 10 and
            // block the machine unless the inserter taking them off picks them up although they are not its main product.
            // The planned clock holds with the four jelly inserters served in the default order and in each of the other
            // three, and so does its long run (the fractional clock does under every order: rocket-fuel.generation.test.ts)
            expect(rocket_fuel.stability_check.actual_output_items).toBeGreaterThan(0);
            expect(rocket_fuel.stability_check.as_built?.taker_orders_checked).toBe(4);
            expect(rocket_fuel.stability_check.as_built?.failed_taker_order).toBeUndefined();
            expect(rocket_fuel.stability_check.as_built?.holds).toBe(true);
        });

        it("clocks the inserter taking the by-product off, so it only looks at the machine now and then", () => {
            // it is not in the plan, so its clock repeats within the window cycle instead of coming from swing counts
            const windows = rocket_fuel.clock_windows["inserter:11"];
            expect(windows.length).toBeGreaterThanOrEqual(1);
            expect(windows[0].end - windows[0].start).toBeLessThan(20);
            expect(rocket_fuel.serializable_transfer_plan.entities.map(entity => entity.entity_id)).not.toContain("inserter:11");

            const described = rocket_fuel.blueprint.entities
                .map(entity => entity.player_description ?? "")
                .find(description => description.startsWith("By-product: "));
            expect(described).toContain("[item=jellynut-seed] (inserter 11)");
            expect(described).toContain("of every 32 ticks; outside the main plan");
        });

    });

    describe("a biochamber with a fuel inserter", () => {
        it("is stable as built, with the fuel inserter on a clock of its own", () => {
            // 926% energy consumption: the biochamber burns about 5 nutrients a craft, most of the 6 it makes
            expect(fuel_inserter.stability_check.holds).toBe(true);
            expect(fuel_inserter.stability_check.as_built?.holds).toBe(true);

            // the fuel clock counts its own ticks, so the fuel inserter has no windows on the clock of the window cycle
            expect(fuel_inserter.clock_windows["inserter:3"]).toBeUndefined();
            const fuel_clock = fuel_inserter.unplanned_inserter_clocks!["inserter:3"];
            expect(fuel_clock).toMatchObject({ kind: "fuel", own_clock: true });
        });

        it("does not change the LCM", async () => {
            const config = await loadConfigFromFile(TestConfigPaths.BIOCHAMBER_FUEL);
            const plain = generateClockForConfig({
                ...config,
                machines: config.machines.map(machine => ({ ...machine, prototype: undefined })),
                inserters: config.inserters.filter(inserter => inserter.id !== 3),
            }, { logger: quiet });
            expect(fuel_inserter.used_lcm).toBe(plain.used_lcm);
        });

        it("keeps the rocket fuel chain stable as built with the fuel of three biochambers", () => {
            expect(rocket_fuel.stability_check.holds).toBe(true);
            expect(rocket_fuel.stability_check.as_built?.holds).toBe(true);
            for (const id of ["inserter:10", "inserter:12", "inserter:13"]) {
                expect(rocket_fuel.clock_windows[id]).toBeUndefined();
                expect(rocket_fuel.unplanned_inserter_clocks![id].own_clock).toBe(true);
            }
        });

        describe("the fuel consumption view", () => {
            it("runs the exported clock for several periods so the fuel inserter shows inserting", () => {
                const view = fuel_inserter.fuel_consumption_view!;

                // a hand of fuel lasts the machine longer than the 960 tick clock, so one window cycle seldom has a swing
                expect(view.window_cycles).toBeGreaterThanOrEqual(2);
                expect(view.duration_ticks).toBe(view.window_cycles * fuel_inserter.simulation_duration.ticks);
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

            it("leaves the clock and its stability as they are", () => {
                expect(fuel_inserter.simulation_duration.ticks).toBe(fuel_inserter.serializable_state_transition_history.total_duration_ticks);
                expect(fuel_inserter.stability_check.holds).toBe(true);
            });

            it("shows the fuel being consumed in a chain that also moves a by-product", () => {
                const view = rocket_fuel.fuel_consumption_view!;
                expect(view.fuel_swings_recorded).toBe(true);
                const swung = view.transfer_history.entities
                    .filter(entity => view.fuel_inserter_ids.includes(entity.entity_id) && entity.transfers.length > 0);
                expect(swung.length).toBeGreaterThan(0);
            });
        });

        describe("the blueprint of rocket fuel biochambers", () => {
            let window_cycle_ticks: number;
            let fuel_moduli: number[];
            let entities: BlueprintGenerationResult["blueprint"]["entities"];
            let clocks: typeof entities;
            let modulos: typeof entities;
            const behavior = (entity: typeof entities[number]) => JSON.stringify(entity.control_behavior ?? {});

            beforeAll(() => {
                window_cycle_ticks = rocket_fuel.simulation_duration.ticks;
                fuel_moduli = Array.from(new Set(Object.values(rocket_fuel.unplanned_inserter_clocks!)
                    .filter(clock => clock.own_clock).map(clock => clock.modulus))).sort((a, b) => a - b);
                entities = rocket_fuel.blueprint.entities;
                clocks = entities.filter(entity => (entity.player_description ?? "").startsWith("Clock for"));
                modulos = entities.filter(entity => entity.name === "arithmetic-combinator");
            });

            it("has two fuel clocks, one for the rocket fuel biochambers and one for the jellynut one", () => {
                expect(fuel_moduli).toHaveLength(2);
            });

            it("counts one clock long enough for the period and every fuel clock to fit a whole number of times", () => {
                expect(clocks).toHaveLength(1);
                expect(entities.filter(entity => (entity.player_description ?? "").includes("Fuel clock:"))).toHaveLength(0);
                // the clock counts 1 to its window cycle, so its condition's constant is the window cycle
                const counted_to = Number(/"constant":(\d+)/.exec(behavior(clocks[0]))![1]);
                [window_cycle_ticks, ...fuel_moduli].forEach(ticks => expect(counted_to % ticks).toBe(0));
                // on a signal of its own, which leaves the clock signal for the clock of the window cycle
                const { conditions, outputs } = (clocks[0].control_behavior as { decider_conditions: { conditions: { first_signal: { name: string } }[]; outputs: { signal: { name: string }; copy_count_from_input: boolean }[] } }).decider_conditions;
                expect(conditions[0].first_signal.name).toBe("signal-T");
                expect(outputs.filter(output => output.copy_count_from_input).map(output => output.signal.name)).toEqual(["signal-T"]);
                // the clock signal is only the clock of the window cycle starting at 1, like every modulo: a constant row
                expect(outputs.filter(output => output.signal.name === "signal-clock").map(output => output.copy_count_from_input)).toEqual([false]);
            });

            it("gives the clock of the period and each fuel clock as a modulo of the one clock", () => {
                // a fuel clock of as many ticks as the window cycle is the clock of the window cycle
                expect(modulos).toHaveLength(new Set([window_cycle_ticks, ...fuel_moduli]).size);
                modulos.forEach(modulo => expect(behavior(modulo)).toContain('"first_signal":{"name":"signal-T"'));
                const window_cycle_clock = modulos.filter(modulo => behavior(modulo).includes('"output_signal":{"name":"signal-clock"'));
                expect(window_cycle_clock).toHaveLength(1);
                expect(behavior(window_cycle_clock[0])).toContain(`"second_constant":${window_cycle_ticks}`);
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
                    expect(description).toMatch(/^Fuel: /);
                    expect(description).toMatch(/Open \[virtual-signal=signal-[A-Z]\] 1–\d+, once every \d+ ticks/);
                    // reads a modulo of the one clock
                    expect(behavior(decider)).not.toContain('"name":"signal-T"');
                });
            });

            it("leaves the other combinators reading the clock signal", () => {
                const planned_deciders = entities.filter(entity =>
                    entity.name === "decider-combinator" && !clocks.includes(entity) && !behavior(entity).includes('"name":"nutrients"')
                    // the lock filter passes every signal on, it does not read the clock signal
                    && !behavior(entity).includes('"name":"signal-lock"'));
                expect(planned_deciders.length).toBeGreaterThan(0);
                planned_deciders.forEach(decider => expect(behavior(decider)).toContain('"name":"signal-clock"'));
            });

            it("is not offered again as a modulo blueprint for the fuel clocks alone", () => {
                if (rocket_fuel.modulo_blueprint) {
                    expect(rocket_fuel.modulo_blueprint.label).toContain("(modulo clock)");
                }
                expect(rocket_fuel.blueprint.label).not.toContain("(modulo clock)");
            });
        });
    });

    describe("combinator descriptions", () => {
        // Factorio keeps at most 500 bytes of the description of a combinator
        it.each([
            ["rocket fuel biochambers", () => rocket_fuel],
            ["a biochamber with a fuel inserter", () => fuel_inserter],
            ["flying robot frames", () => flying_robot_frame],
        ])("are at most 500 bytes in the blueprint of %s", (_name, result) => {
            const descriptions = [result().blueprint, result().modulo_blueprint, result().subtick?.blueprint]
                .flatMap(blueprint => blueprint?.entities ?? [])
                .map(entity => entity.player_description)
                .filter((description): description is string => description !== undefined);

            expect(descriptions.length).toBeGreaterThan(0);
            descriptions.forEach(description => expect(new TextEncoder().encode(description).length).toBeLessThanOrEqual(500));
        });
    });
});
