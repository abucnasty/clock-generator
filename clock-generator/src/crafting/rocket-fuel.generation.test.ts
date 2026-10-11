import { describe, it, expect, beforeAll } from "vitest";
import { generateClockForConfig, type BlueprintGenerationResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { quiet, rocketFuelSample, type RocketFuelSample } from "./generate-blueprint-test-helpers";

describe("generateClockForConfig", () => {

    // The builds are generated in beforeAll hooks, not in the describe bodies: those all run when the file is collected,
    // so a run of one test by name would generate every build in the file first.

    describe("rocket fuel biochambers at 60 per second", () => {
        let sample: RocketFuelSample;
        let alternative: RocketFuelSample["alternative"];
        let moved: RocketFuelSample["moved"];
        let period: RocketFuelSample["period"];

        beforeAll(async () => {
            sample = await rocketFuelSample(ConfigPaths.GLEBA_ROCKET_FUEL);
            ({ alternative, moved, period } = sample);
        });

        // 16 jelly a hand is 15/4 hands a 32 tick cycle
        it("has a 128 tick period", () => {
            expect(period).toBe(128);
        });

        it.each(["planned-belt-slack", "planned", "fractional", "derived", "shifted-swings"])("%s is stable as built", (id) => {
            expect(alternative(id).is_stable).toBe(true);
            expect(alternative(id).result.stability_check.as_built?.is_stable).toBe(true);
            expect(alternative(id).items_per_second).toBe(60);
        });

        it("selects batched swings for a moving belt", () => {
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

    describe("rocket fuel biochambers fed jelly by inserters with no time to spare", () => {
        // 15 jelly a hand is 8 hands a 64 tick period for each jelly inserter, and a hand takes them 8 ticks
        let sample: RocketFuelSample;
        let alternative: RocketFuelSample["alternative"];
        let period: RocketFuelSample["period"];
        let jelly_inserter_ids: RocketFuelSample["jelly_inserter_ids"];
        let jellynut_inserter_id: RocketFuelSample["jellynut_inserter_id"];

        beforeAll(async () => {
            sample = await rocketFuelSample(ConfigPaths.GLEBA_ROCKET_FUEL_JELLY_STACK_15);
            ({ alternative, period, jelly_inserter_ids, jellynut_inserter_id } = sample);
        });

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
            let result: BlueprintGenerationResult;
            let period: number;
            let fuel_moduli: number[];
            let entities: BlueprintGenerationResult["blueprint"]["entities"];
            let clocks: typeof entities;
            let modulos: typeof entities;
            const behavior = (entity: typeof entities[number]) => JSON.stringify(entity.control_behavior ?? {});

            beforeAll(() => {
                result = generateClockForConfig(config, { logger: quiet });
                period = result.simulation_duration.ticks;
                fuel_moduli = Array.from(new Set(Object.values(result.unplanned_inserter_clocks!)
                    .filter(clock => clock.own_clock).map(clock => clock.modulus))).sort((a, b) => a - b);
                entities = result.blueprint.entities;
                clocks = entities.filter(entity => (entity.player_description ?? "").startsWith("Clock for"));
                modulos = entities.filter(entity => entity.name === "arithmetic-combinator");
            });

            it("has two fuel clocks, one for the rocket fuel biochambers and one for the jellynut one", () => {
                expect(fuel_moduli).toHaveLength(2);
            });

            it("counts one clock long enough for the period and every fuel clock to fit a whole number of times", () => {
                expect(clocks).toHaveLength(1);
                expect(entities.filter(entity => (entity.player_description ?? "").startsWith("Fuel clock"))).toHaveLength(0);
                // the clock counts 1 to its period, so its condition's constant is the period
                const counted_to = Number(/"constant":(\d+)/.exec(behavior(clocks[0]))![1]);
                [period, ...fuel_moduli].forEach(ticks => expect(counted_to % ticks).toBe(0));
                // on a signal of its own, which leaves the clock signal for the clock of the period
                const { conditions, outputs } = (clocks[0].control_behavior as { decider_conditions: { conditions: { first_signal: { name: string } }[]; outputs: { signal: { name: string }; copy_count_from_input: boolean }[] } }).decider_conditions;
                expect(conditions[0].first_signal.name).toBe("signal-T");
                expect(outputs.filter(output => output.copy_count_from_input).map(output => output.signal.name)).toEqual(["signal-T"]);
                // the clock signal is only the clock of the period starting at 1, like every modulo: a constant row
                expect(outputs.filter(output => output.signal.name === "signal-clock").map(output => output.copy_count_from_input)).toEqual([false]);
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
                    entity.name === "decider-combinator" && !clocks.includes(entity) && !behavior(entity).includes('"name":"nutrients"')
                    // the lock filter passes every signal on, it does not read the clock signal
                    && !behavior(entity).includes('"name":"signal-lock"'));
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
});
