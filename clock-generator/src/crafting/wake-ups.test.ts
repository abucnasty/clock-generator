import { describe, expect, it } from "vitest";
import { wakeUps, WatchedMachine, WatchingInserter } from "./wake-ups";

const WORKING = "working";
const SOURCE = "waiting_for_source_items";
const SPACE = "waiting_for_space_in_destination";
const MORE = "waiting_for_more_items";
const OFF = "disabled_by_control_behavior";

/** A machine that finishes a craft in each of the given ticks */
function machine(machine_id: string, ticks: number, crafts_at: number[]): WatchedMachine {
    const products_finished: number[] = [];
    let finished = 0;
    for (let tick = 0; tick < ticks; tick++) {
        finished += crafts_at.filter(it => it === tick).length;
        products_finished.push(finished);
    }
    return { machine_id, products_finished };
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
});
