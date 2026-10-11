import { describe, it, expect, beforeAll } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { rocketFuelSample, type RocketFuelSample } from "./generate-blueprint-test-helpers";

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
            expect(alternative(id).verdict).toBe("stable");
            expect(alternative(id).result.stability_check.as_built?.is_stable).toBe(true);
            expect(alternative(id).assessment.items_per_second).toBe(60);
        });

        it("selects batched swings for a moving belt", () => {
            expect(sample.alternatives[0].id).toBe("planned-belt-slack");
            expect(sample.alternatives[0].verdict).toBe("stable");
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

        // the observed windows are run as they are for the view, not observed again
        it("has the fuel every burner machine held in the fuel consumption view of every clock alternative", () => {
            for (const alternative of sample.alternatives) {
                const view = alternative.result.fuel_consumption_view!;
                expect(view.fuel_levels.map(levels => levels.machine_id), alternative.id).toEqual(["machine:1", "machine:2", "machine:3"]);
                view.fuel_levels.forEach(levels => expect(Number.isFinite(levels.min_level), alternative.id).toBe(true));
            }
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
            expect(alternative(id).verdict).toBe("stable");
            expect(alternative(id).result.stability_check.as_built?.is_stable).toBe(true);
            expect(alternative(id).assessment.items_per_second).toBe(60);
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
});
