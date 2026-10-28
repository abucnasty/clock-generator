import { describe, it, expect, beforeAll } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { alwaysOnReasonProblemsOf, rocketFuelSample, type RocketFuelSample } from "./generate-blueprint-test-helpers";

// The other build of this suite is in rocket-fuel.generation.test.ts.
describe("generateClockForConfig", () => {

    // The builds are generated in beforeAll hooks, not in the describe bodies: those all run when the file is collected,
    // so a run of one test by name would generate every build in the file first.

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

        it("names why every inserter and drill a clock leaves always on is", () => {
            expect(alwaysOnReasonProblemsOf(sample.config, sample)).toEqual([]);
        });

        it("sets the jelly inserters to 15 a hand", () => {
            const jelly_inserters = sample.config.inserters.filter(it => it.source.type === "machine" && it.sink.type === "machine");
            expect(jelly_inserters.map(it => it.stack_size)).toEqual([15, 15, 15, 15]);
        });

        it("has a 64 tick period", () => {
            expect(period).toBe(64);
        });

        it.each(["planned-belt-slack", "fractional", "derived"])("%s is stable as built", (id) => {
            expect(alternative(id).verdict).toBe("stable");
            expect(alternative(id).result.stability_check.as_built?.holds).toBe(true);
            expect(alternative(id).assessment.items_per_second).toBe(60);
        });

        // the hand a jelly inserter picks up at the end of a period is dropped in the next one: its pickup needs a
        // window at the end of the period, or the exported clock moves 7 of the 8 hands
        it("keeps the jelly inserters enabled for the hand that is in flight when the period starts", () => {
            const windows = alternative("planned-belt-slack").result.clock_windows;
            for (const id of jelly_inserter_ids) {
                const last_window = windows[id][windows[id].length - 1];
                expect(windows[id].length).toBe(2);
                expect(last_window.end).toBeGreaterThanOrEqual(period - 1);
            }
        });

        it("moves the planned 8 hands of jelly a period", () => {
            const history = alternative("planned-belt-slack").result.serializable_transfer_history;
            for (const id of jelly_inserter_ids) {
                const moved = history.entities.find(entity => entity.entity_id === id)!.transfers.reduce((sum, t) => sum + t.amount, 0);
                expect(moved).toBe(8 * 15);
            }
        });

        // 3 hands of 16 jellynut a period: refilled up to the insertion limit of 67 instead, the hands come 5 at a
        // time every 100 ticks or so, and the one period that is observed sees 1 of them
        it("brings the planned 3 hands of jellynut in the planned period", () => {
            const history = alternative("planned-belt-slack").result.serializable_transfer_history;
            const moved = history.entities.find(entity => entity.entity_id === jellynut_inserter_id)!.transfers.reduce((sum, t) => sum + t.amount, 0);
            expect(moved).toBe(3 * 16);
        });
    });
});
