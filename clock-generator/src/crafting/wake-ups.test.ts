import { describe, expect, it } from "vitest";
import { wakeUps, WatchedMachine, WatchingInserter } from "./wake-ups";

const WORKING = "working";
const SOURCE = "waiting_for_source_items";
const SPACE = "waiting_for_space_in_destination";
const MORE = "waiting_for_more_items";
const OFF = "disabled_by_control_behavior";

/**
 * A machine that finishes a craft (or pays out a bar) in each of `crafts_at`, and, when `starts_at` is given, truly
 * starts a craft in each of those ticks; without it its true starts are not known
 */
function machine(machine_id: string, ticks: number, crafts_at: number[], starts_at?: number[]): WatchedMachine {
    const products_finished: number[] = [];
    let finished = 0;
    for (let tick = 0; tick < ticks; tick++) {
        finished += crafts_at.filter(it => it === tick).length;
        products_finished.push(finished);
    }
    const true_starts = starts_at === undefined ? undefined : Array.from({ length: ticks }, (_, tick) => starts_at.includes(tick));
    return { machine_id, products_finished, true_starts };
}

function inserter(states: string[], ends: Partial<WatchingInserter> = {}): WatchingInserter {
    return { inserter_id: "inserter:1", source_machine_id: "machine:1", sink_machine_id: null, states, ...ends };
}

describe("wakeUps", () => {
    it("counts a craft of the source for an inserter that waited for source items when the tick began", () => {
        const states = [SOURCE, SOURCE, SOURCE, WORKING, WORKING, OFF];
        // the craft in tick 3 is seen: the inserter waited after tick 2; the one in tick 4 finds it working
        const result = wakeUps([inserter(states)], [machine("machine:1", 6, [1, 3, 4])], 0, 6);
        expect(result.ticks).toBe(5);
        expect(result.inserters[0].wake_ups_per_minute).toBe(2 * 3600 / 5);
        expect(result.inserters[0].alarms_per_minute).toBe(3 * 3600 / 5);
        expect(result.wake_ups_per_minute).toBe(2 * 3600 / 5);
    });

    it("counts no craft for an inserter its clock has disabled", () => {
        const states = [OFF, OFF, OFF, OFF];
        const result = wakeUps([inserter(states)], [machine("machine:1", 4, [1, 2, 3])], 0, 4);
        expect(result.inserters[0].wake_ups_per_minute).toBe(0);
        expect(result.inserters[0].enabled_share).toBe(0);
    });

    it("watches the sink while it waits for space, and the source while it waits for items", () => {
        const states = [SPACE, SPACE, SOURCE, SOURCE];
        const ends = { source_machine_id: "machine:1", sink_machine_id: "machine:2" };
        // tick 1: both craft, it waits on the sink; tick 3: both craft, it waits on the source
        const machines = [machine("machine:1", 4, [1, 3]), machine("machine:2", 4, [1, 3])];
        const result = wakeUps([inserter(states, ends)], machines, 0, 4);
        expect(result.inserters[0].wake_ups_per_minute).toBe(2 * 3600 / 3);
        expect(result.inserters[0].alarms_per_minute).toBe(4 * 3600 / 3);
    });

    it("counts nothing for a wait on a belt or a chest", () => {
        const states = [SOURCE, SOURCE, SOURCE];
        const ends = { source_machine_id: null, sink_machine_id: "machine:2" };
        const result = wakeUps([inserter(states, ends)], [machine("machine:2", 3, [1, 2])], 0, 3);
        expect(result.inserters[0].wake_ups_per_minute).toBe(0);
        expect(result.inserters[0].waiting_share).toBe(1);
    });

    it("counts a craft of the source for a partly filled hand that waits for more items", () => {
        const states = [MORE, MORE, WORKING];
        const result = wakeUps([inserter(states)], [machine("machine:1", 3, [1, 2])], 0, 3);
        expect(result.inserters[0].wake_ups_per_minute).toBe(2 * 3600 / 2);
        expect(result.inserters[0].waiting_share).toBe(1 / 2);
    });

    it("wakes an inserter once in a tick, however many products its machine finishes in it", () => {
        const states = [SOURCE, SOURCE, SOURCE];
        // a craft and the productivity bar it fills, both paid in tick 1
        const result = wakeUps([inserter(states)], [machine("machine:1", 3, [1, 1])], 0, 3);
        expect(result.inserters[0].wake_ups_per_minute).toBe(1 * 3600 / 2);
        expect(result.inserters[0].alarms_per_minute).toBe(1 * 3600 / 2);
    });

    it("measures only the ticks asked for", () => {
        const states = [SOURCE, SOURCE, SOURCE, SOURCE, SOURCE, SOURCE];
        const result = wakeUps([inserter(states)], [machine("machine:1", 6, [1, 2, 4, 5])], 4, 6);
        expect(result.ticks).toBe(2);
        expect(result.inserters[0].wake_ups_per_minute).toBe(2 * 3600 / 2);
    });

    describe("the sink list, since 0.13.0", () => {
        const into = (states: string[]) => inserter(states, { source_machine_id: null, sink_machine_id: "machine:2" });

        it("wakes an inserter waiting for space when the machine truly starts a craft, and not when it pays out", () => {
            // asleep on the sink from tick 1; the machine pays out at 2 (a rise with no start) and starts at 4
            const states = [WORKING, SPACE, SPACE, SPACE, SPACE, SPACE];
            const result = wakeUps([into(states)], [machine("machine:2", 6, [2, 4], [4])], 0, 6);
            expect(result.inserters[0].wake_ups_per_minute).toBe(1 * 3600 / 5);
            expect(result.true_starts_unknown).toEqual([]);
        });

        it("lets finishes and payouts stand in where the true starts are not known, and names the machine", () => {
            const states = [WORKING, SPACE, SPACE, SPACE, SPACE, SPACE];
            const result = wakeUps([into(states)], [machine("machine:2", 6, [2, 4])], 0, 6);
            expect(result.inserters[0].wake_ups_per_minute).toBe(2 * 3600 / 5);
            expect(result.true_starts_unknown).toEqual(["machine:2"]);
        });

        it("keeps waking the source list on finishes and payouts", () => {
            // asleep on the source from tick 1; the source pays out at 2 and finishes at 4, and truly starts only at 4
            const states = [WORKING, SOURCE, SOURCE, SOURCE, SOURCE, SOURCE];
            const result = wakeUps([inserter(states)], [machine("machine:1", 6, [2, 4], [4])], 0, 6);
            expect(result.inserters[0].wake_ups_per_minute).toBe(2 * 3600 / 5);
        });
    });
});

describe("wakeUps of a machine that places its results itself", () => {
    // crafts finish in ticks 1 to 5, and results come of those in ticks 2 and 4 only
    const placer = (): WatchedMachine => ({ ...machine("machine:1", 6, [1, 2, 3, 4, 5]), results_placed: [0, 0, 1, 1, 3, 3] });
    const waiting = [MORE, MORE, MORE, MORE, MORE, MORE];

    it("wakes the inserters that take from its output when it places a result there, not when a craft gives none", () => {
        const result = wakeUps([inserter(waiting)], [placer()], 0, 6);
        expect(result.inserters[0].wake_ups_per_minute).toBe(2 * 3600 / 5);
    });

    it("wakes the inserters that take from the chest it places its results into, and no others there", () => {
        const from_chest = { source_machine_id: null, source_placer_id: "machine:1" };
        const result = wakeUps([inserter(waiting, from_chest)], [placer()], 0, 6);
        expect(result.inserters[0].wake_ups_per_minute).toBe(2 * 3600 / 5);
        // a chest no machine places into wakes no one
        const other = wakeUps([inserter(waiting, { source_machine_id: null })], [placer()], 0, 6);
        expect(other.inserters[0].wake_ups_per_minute).toBe(0);
    });
});
