import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { returnTicksOf, WakeRule, wakeUps, WatchedMachine, WatchingInserter } from "./wake-ups";

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

// cell 02's takers in the game (CELL02-MISS): grab, hold 4 ticks, drop, back 4 ticks later, "waiting for space" on the
// 2nd to 4th tick of the return; a machine at their sink that starts a craft on almost every tick
describe("the arm at home, since 0.26.0", () => {
    const into = (states: string[], held: number[]) =>
        inserter(states, { source_machine_id: null, sink_machine_id: "machine:2", held, return_ticks: returnTicksOf(3) });
    const every_tick = (ticks: number) => Array.from({ length: ticks }, (_, tick) => tick);

    it("is away for the drop tick and the turn back: the turn's ticks and one, 4 for the legendary stack inserter", () => {
        expect(returnTicksOf(3)).toBe(4);
    });

    it("counts no wake-up on an arm swinging back from a drop that emptied its hand, whatever state the game shows", () => {
        // the hand falls to empty in tick 4 and the arm turns back in 5 to 7; from 8 on it waits at home for space
        const held = [16, 16, 16, 16, 0, 0, 0, 0, 0, 0, 0];
        const states = [WORKING, WORKING, WORKING, WORKING, WORKING, SPACE, SPACE, SPACE, SPACE, SPACE, SPACE];
        const result = wakeUps([into(states, held)], [machine("machine:2", 11, every_tick(11), every_tick(11))], 0, 11);
        // shown waiting after ticks 5 to 9, so alarmed in 6 to 10: after 5 to 7 the arm is away, after 8 and 9 at home
        expect(result.inserters[0].wake_ups_per_minute).toBe(2 * 3600 / 10);
        expect(result.inserters[0].uncounted_per_minute).toEqual({ "arm away": 3 * 3600 / 10 });
        expect(result.uncounted_per_minute).toEqual({ "arm away": 3 * 3600 / 10 });
    });

    it("counts the wake-up that makes a full hand drop: the arm waits at the machine before it", () => {
        // waiting for space with a full hand after tick 2; the start in tick 3 lets it drop
        const held = [16, 16, 16, 0, 0];
        const states = [WORKING, WORKING, SPACE, WORKING, WORKING];
        const result = wakeUps([into(states, held)], [machine("machine:2", 5, [3], [3])], 0, 5);
        expect(result.inserters[0].wake_ups_per_minute).toBe(1 * 3600 / 4);
        expect(result.inserters[0].uncounted_per_minute).toEqual({ "arm away": 0 });
    });

    it("counts a part hand dropped: the arm waits where it is", () => {
        const held = [16, 16, 8, 8, 8, 8];
        const states = [WORKING, WORKING, SPACE, SPACE, SPACE, SPACE];
        const result = wakeUps([into(states, held)], [machine("machine:2", 6, every_tick(6), every_tick(6))], 0, 6);
        expect(result.inserters[0].wake_ups_per_minute).toBe(3 * 3600 / 5);
        expect(result.inserters[0].uncounted_per_minute).toEqual({ "arm away": 0 });
    });

    it("counts every waiting state as before without the hand or the turn", () => {
        const held = [16, 16, 16, 16, 0, 0, 0, 0, 0, 0, 0];
        const states = [WORKING, WORKING, WORKING, WORKING, WORKING, SPACE, SPACE, SPACE, SPACE, SPACE, SPACE];
        const machines = [machine("machine:2", 11, every_tick(11), every_tick(11))];
        const without = inserter(states, { source_machine_id: null, sink_machine_id: "machine:2", held });
        expect(wakeUps([without], machines, 0, 11).inserters[0].wake_ups_per_minute).toBe(5 * 3600 / 10);
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

/** A series the fixture keeps as [tick, value] where it changes, at its full length */
function expanded<T>(changes: [number, T][], ticks: number): T[] {
    const values: T[] = [];
    let at = 0;
    for (let tick = 0; tick < ticks; tick++) {
        while (at < changes.length && changes[at][0] <= tick) at++;
        values.push(changes[at - 1][1]);
    }
    return values;
}

/**
 * One clock period recorded in Factorio 2.1.24 (fixtures/wake-ups-capture-2.1.24.json): an electromagnetic plant, the
 * stack inserter that takes its science packs to a belt (inserter:1) and the one that feeds it from a belt
 * (inserter:2), with the ticks in which the game delivered a wake-up by the plant to each, read in the running game.
 */
function capture(): { inserters: WatchingInserter[]; machines: WatchedMachine[]; ticks: number; woken: Map<string, number[]> } {
    interface Series { source: string; sink: string; states: [number, string][]; held: number[]; held_item: [number, string][];
        hand_size: number; return_ticks: number; drop_room?: [number, boolean][]; woken_by_machine: number[] }
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "wake-ups-capture-2.1.24.json"), "utf8")) as {
        machine: { products_finished: number[]; true_starts: [number, boolean][]; outputs: Record<string, number[]> };
        inserters: Record<string, Series>;
    };
    const ticks = fixture.machine.products_finished.length;
    const machines: WatchedMachine[] = [{
        machine_id: "machine:1", products_finished: fixture.machine.products_finished,
        true_starts: expanded(fixture.machine.true_starts, ticks), outputs: fixture.machine.outputs,
    }];
    const inserters = Object.entries(fixture.inserters).map(([inserter_id, series]): WatchingInserter => ({
        inserter_id,
        source_machine_id: series.source === "machine" ? "machine:1" : null,
        sink_machine_id: series.sink === "machine" ? "machine:1" : null,
        states: expanded(series.states, ticks), held: series.held, return_ticks: series.return_ticks,
        held_item: expanded(series.held_item, ticks), hand_size_of: () => series.hand_size,
        ...(series.drop_room !== undefined && { drop_room: expanded(series.drop_room, ticks) }),
    }));
    return { inserters, machines, ticks, woken: new Map(Object.entries(fixture.inserters).map(([id, series]) => [id, series.woken_by_machine])) };
}

function wokenIn(rule: WakeRule): Map<string, number[]> {
    const { inserters, machines, ticks } = capture();
    const woken = new Map<string, number[]>(inserters.map(it => [it.inserter_id, []]));
    wakeUps(inserters, machines, 0, ticks, (inserter_id, tick) => woken.get(inserter_id)!.push(tick), rule);
    return woken;
}

describe("the rule \"kept-lists\" against a period of the game", () => {
    it("counts the game's wake-ups by the machine tick for tick: 13 of the inserter that takes from it, 2 of the one that feeds it", () => {
        const { woken } = capture();
        expect(woken.get("inserter:1")).toHaveLength(13);
        expect(woken.get("inserter:2")).toHaveLength(2);
        expect(wokenIn("kept-lists")).toEqual(woken);
    });

    it("where \"shown-waiting\" misses two inserters asleep and woken in one tick and three switched off asleep on the list", () => {
        const { woken } = capture();
        const missed = woken.get("inserter:1")!.filter(tick => !wokenIn("shown-waiting").get("inserter:1")!.includes(tick));
        // clock positions 24 and 280: shown working after the tick before; 288, 687 and 1072: shown disabled
        expect(missed).toEqual([23, 279, 287, 686, 1071]);
        expect(wokenIn("shown-waiting").get("inserter:2")).toEqual(woken.get("inserter:2"));
    });
});

describe("the rule \"kept-lists\"", () => {
    // a part hand rises in tick 2 and the machine places a result after it; the inserter shows working throughout
    const partHand = (ends: Partial<WatchingInserter>, output_after: number): [WatchingInserter, WatchedMachine] => [
        inserter([WORKING, WORKING, WORKING, WORKING], {
            held: [4, 4, 5, 6], held_item: ["pack", "pack", "pack", "pack"], hand_size_of: () => 16, ...ends,
        }),
        { ...machine("machine:1", 4, [2]), outputs: { pack: [0, 1, output_after, 0] } },
    ];

    it("counts an inserter that went to sleep in its own update with room at its drop and was woken later in that tick", () => {
        const [taker, plant] = partHand({}, 1);
        expect(wakeUps([taker], [plant], 0, 4, undefined, "kept-lists").inserters[0].wake_ups_per_minute).toBe(3600 / 3);
        expect(wakeUps([taker], [plant], 0, 4, undefined, "shown-waiting").inserters[0].wake_ups_per_minute).toBe(0);
    });

    it("not when the result came before its update (it took everything), nor when the belt had no room at its drop", () => {
        const [first, plant] = partHand({}, 0);
        expect(wakeUps([first], [plant], 0, 4, undefined, "kept-lists").inserters[0].wake_ups_per_minute).toBe(0);
        const [no_room, plant_again] = partHand({ drop_room: [true, true, false, true] }, 1);
        expect(wakeUps([no_room], [plant_again], 0, 4, undefined, "kept-lists").inserters[0].wake_ups_per_minute).toBe(0);
    });

    it("keeps an inserter switched off asleep on the list there until the machine's next alarm, and on none after it", () => {
        const states = [SOURCE, OFF, OFF, OFF, OFF, OFF];
        const plant = machine("machine:1", 6, [3, 5]);
        const result = wakeUps([inserter(states)], [plant], 0, 6, undefined, "kept-lists");
        expect(result.inserters[0].wake_ups_per_minute).toBe(3600 / 5);
        expect(wakeUps([inserter(states)], [plant], 0, 6, undefined, "shown-waiting").inserters[0].wake_ups_per_minute).toBe(0);
        // switched off while working: on no list
        const working = wakeUps([inserter([WORKING, OFF, OFF, OFF, OFF, OFF])], [plant], 0, 6, undefined, "kept-lists");
        expect(working.inserters[0].wake_ups_per_minute).toBe(0);
    });
});
