import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { returnTicksOf, wakeUps, WatchedMachine, WatchingInserter } from "./wake-ups";

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

/** The machine with each result it finishes placed in its output the tick it is paid, as the rule "kept-lists" reads it */
function placing(plant: WatchedMachine): WatchedMachine {
    const done = plant.products_finished;
    return { ...plant, outputs: { "iron-plate": done.map((count, tick) => count > (done[tick - 1] ?? 0) ? 1 : 0) } };
}

function inserter(states: string[], ends: Partial<WatchingInserter> = {}): WatchingInserter {
    return { inserter_id: "inserter:1", source_machine_id: "machine:1", sink_machine_id: null, states, ...ends };
}

/**
 * An inserter with the hand its states show (a full one of 4 items working, 1 waiting for more, none otherwise, unless given): the rule "kept-lists"
 * lets an inserter sleep on what its hand and the machine's output show
 */
function with_hand(states: string[], held: number[] = states.map(state => state === WORKING ? 4 : state === MORE ? 1 : 0),
    ends: Partial<WatchingInserter> = {}): WatchingInserter {
    return inserter(states, { held, held_item: held.map(count => count > 0 ? "iron-plate" : ""), hand_size_of: () => 4, ...ends });
}

describe("wakeUps", () => {
    it("counts a craft of the source for an inserter that waited for source items when the tick began", () => {
        const states = [SOURCE, SOURCE, SOURCE, WORKING, WORKING, OFF];
        // the craft in tick 3 is seen: the inserter waited after tick 2; the one in tick 4 finds it working
        const result = wakeUps([with_hand(states)], [placing(machine("machine:1", 6, [1, 3, 4]))], 0, 6);
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
        const result = wakeUps([with_hand(states, [1, 1, 2])], [placing(machine("machine:1", 3, [1, 2]))], 0, 3);
        expect(result.inserters[0].wake_ups_per_minute).toBe(2 * 3600 / 2);
        expect(result.inserters[0].waiting_share).toBe(1 / 2);
    });

    it("wakes an inserter once in a tick, however many products its machine finishes in it", () => {
        const states = [SOURCE, SOURCE, SOURCE];
        // a craft and the productivity bar it fills, both paid in tick 1
        const result = wakeUps([with_hand(states)], [placing(machine("machine:1", 3, [1, 1]))], 0, 3);
        expect(result.inserters[0].wake_ups_per_minute).toBe(1 * 3600 / 2);
        expect(result.inserters[0].alarms_per_minute).toBe(1 * 3600 / 2);
    });

    it("measures only the ticks asked for", () => {
        const states = [SOURCE, SOURCE, SOURCE, SOURCE, SOURCE, SOURCE];
        const result = wakeUps([with_hand(states)], [placing(machine("machine:1", 6, [1, 2, 4, 5]))], 4, 6);
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

// the circuit export build's takers in the game (CELL02-MISS): grab, hold 4 ticks, drop, back 4 ticks later, "waiting for space" on the
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
        // woken in ticks 8 to 10, once it is at home; the arm is away in 5 to 7 and those wake-ups are not counted
        expect(result.inserters[0].wake_ups_per_minute).toBe(3 * 3600 / 10);
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
        expect(result.inserters[0].wake_ups_per_minute).toBe(4 * 3600 / 5);
        expect(result.inserters[0].uncounted_per_minute).toEqual({ "arm away": 0 });
    });

    it("counts every waiting state as before without the hand or the turn", () => {
        const held = [16, 16, 16, 16, 0, 0, 0, 0, 0, 0, 0];
        const states = [WORKING, WORKING, WORKING, WORKING, WORKING, SPACE, SPACE, SPACE, SPACE, SPACE, SPACE];
        const machines = [machine("machine:2", 11, every_tick(11), every_tick(11))];
        const without = inserter(states, { source_machine_id: null, sink_machine_id: "machine:2", held });
        expect(wakeUps([without], machines, 0, 11).inserters[0].wake_ups_per_minute).toBe(6 * 3600 / 10);
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
 * One clock period recorded in Factorio 2.1.24, with the ticks in which the game delivered a wake-up by the plant to each
 * inserter, read in the running game:
 * - FRONT_EXIT (fixtures/wake-ups-capture-2.1.24.json): an electromagnetic plant, the stack inserter that takes its
 *   science packs to a belt (inserter:1) and the one that feeds it from a belt (inserter:2);
 * - CHESTS (fixtures/wake-ups-capture-electromagnetic-science-2.1.24.json, the sample electromagnetic science build): the
 *   inserter that feeds the plant from a belt (inserter:1) and two that take its science packs into a chest each
 *   (inserter:2 and inserter:3, the one the game updates first).
 */
const FRONT_EXIT = "wake-ups-capture-2.1.24.json";
const CHESTS = "wake-ups-capture-electromagnetic-science-2.1.24.json";

function capture(file: string = FRONT_EXIT): { inserters: WatchingInserter[]; machines: WatchedMachine[]; ticks: number; woken: Map<string, number[]> } {
    interface Series { source: string; sink: string; states: [number, string][]; held: number[]; held_item: [number, string][];
        hand_size: number; return_ticks: number; drop_room?: [number, boolean][]; woken_by_machine: number[] }
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", file), "utf8")) as {
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

function wokenIn(file: string = FRONT_EXIT): Map<string, number[]> {
    const { inserters, machines, ticks } = capture(file);
    const woken = new Map<string, number[]>(inserters.map(it => [it.inserter_id, []]));
    wakeUps(inserters, machines, 0, ticks, (inserter_id, tick) => woken.get(inserter_id)!.push(tick));
    return woken;
}

describe("the rule \"kept-lists\" against a period of the game", () => {
    it("counts the game's wake-ups by the machine tick for tick: 13 of the inserter that takes from it, 2 of the one that feeds it", () => {
        const { woken } = capture();
        expect(woken.get("inserter:1")).toHaveLength(13);
        expect(woken.get("inserter:2")).toHaveLength(2);
        expect(wokenIn()).toEqual(woken);
    });

    it("counts them tick for tick on a build with two takers into chests: 10, 10 and 11, none false", () => {
        const { woken } = capture(CHESTS);
        expect(woken.get("inserter:1")).toHaveLength(10);
        expect(woken.get("inserter:2")).toHaveLength(10);
        expect(woken.get("inserter:3")).toHaveLength(11);
        // among them inserters asleep from the update their arm came home in, with an empty hand: the feeder at 600 (home
        // in 599, nothing needed, switched off), the second taker at 76 and 267 (the first took the whole output; a result
        // later in the tick) and 460 (switched off in 459)
        expect(woken.get("inserter:1")).toContain(600);
        expect(woken.get("inserter:3")).toEqual(expect.arrayContaining([76, 267, 460]));
        expect(wokenIn(CHESTS)).toEqual(woken);
    });
});

/**
 * Ten periods of the sample agricultural science build recorded in Factorio 2.1.24 (fixtures/wake-ups-capture-agricultural-
 * science-2.1.24.json, five biochambers and twelve inserters, clock 3450755e), with the ticks the game woke each inserter
 * from a machine's list and why, read in the running game. Counted from `count_from`; the period before lets the lists
 * settle.
 */
const AGRICULTURAL = "wake-ups-capture-agricultural-science-2.1.24.json";

function agriculturalCapture(): { inserters: WatchingInserter[]; machines: WatchedMachine[]; ticks: number; from: number; woken: Map<string, [number, string][]> } {
    interface Series { source: string; sink: string; states: [number, string][]; held: [number, number][]; held_item: [number, string][];
        hand_size: number; return_ticks: number; woken_by_machine: [number, string][] }
    interface Machine { products_finished: [number, number][]; true_starts: number[]; fuel_taken: number[]; fuel_put_in: number[];
        outputs: Record<string, [number, number][]> }
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", AGRICULTURAL), "utf8")) as {
        ticks: number; count_from: number; machines: Record<string, Machine>; inserters: Record<string, Series>;
    };
    const { ticks } = fixture;
    const at = (list: number[]) => { const flags = new Array<boolean>(ticks).fill(false); for (const tick of list) flags[tick] = true; return flags; };
    const machines = Object.entries(fixture.machines).map(([machine_id, it]): WatchedMachine => ({
        machine_id, products_finished: expanded(it.products_finished, ticks), true_starts: at(it.true_starts),
        fuel_taken: at(it.fuel_taken), fuel_put_in: at(it.fuel_put_in),
        outputs: Object.fromEntries(Object.entries(it.outputs).map(([item, series]) => [item, expanded(series, ticks)])),
    }));
    const inserters = Object.entries(fixture.inserters).map(([inserter_id, it]): WatchingInserter => ({
        inserter_id,
        source_machine_id: it.source.startsWith("machine:") ? it.source : null,
        sink_machine_id: it.sink.startsWith("machine:") ? it.sink : null,
        states: expanded(it.states, ticks), held: expanded(it.held, ticks), return_ticks: it.return_ticks,
        held_item: expanded(it.held_item, ticks), hand_size_of: () => it.hand_size,
    }));
    const woken = new Map(Object.entries(fixture.inserters).map(([id, it]) => [id, it.woken_by_machine.filter(([tick]) => tick >= fixture.count_from)]));
    return { inserters, machines, ticks, from: fixture.count_from, woken };
}

describe("the rule \"kept-lists\" against ten periods of agricultural science", () => {
    const { inserters, machines, ticks, from, woken } = agriculturalCapture();
    const counted = new Map<string, number[]>(inserters.map(it => [it.inserter_id, []]));
    wakeUps(inserters, machines, from, ticks, (inserter_id, tick) => counted.get(inserter_id)!.push(tick));

    it("counts the game's wake-ups tick for tick on ten of the twelve inserters", () => {
        for (const id of ["inserter:1", "inserter:2", "inserter:3", "inserter:4", "inserter:6", "inserter:7", "inserter:9", "inserter:10", "inserter:11", "inserter:12"]) {
            expect(counted.get(id), id).toEqual(woken.get(id)!.map(([tick]) => tick));
        }
        // 2,792 wake-ups by the machines in all, of every kind the game woke them by
        const causes = new Set([...woken.values()].flatMap(list => list.map(([, cause]) => cause)));
        expect(causes).toEqual(new Set(["craft start", "fuel taken", "output taken", "result", "fuel put in"]));
    });

    it("on the two takers between the egg machines, all of the game's and 7 more where two machines alarm in one tick", () => {
        // in each, the inserter and another taker of the same machine joined the update list in one tick, woken by two
        // machines: which joined last, and is updated first, follows the game's order of updating machines, which a
        // recording does not hold; the rule takes the inserter first
        for (const [id, extra] of [["inserter:5", [914, 1874, 2834, 3794, 4754, 5235]], ["inserter:8", [1045]]] as const) {
            const game = woken.get(id)!.map(([tick]) => tick);
            expect(counted.get(id)!.filter(tick => !game.includes(tick)), id).toEqual(extra);
            expect(game.filter(tick => !counted.get(id)!.includes(tick)), id).toEqual([]);
        }
    });

    it("keeps a list across a switch-off on either side until an alarm: none counted from a list the game had left", () => {
        // an alarm the rule reads (a fuel item taken, an output taken) wakes it while it is off, and the update that
        // brings leaves it on no list: the next craft start finds it there (inserter:3 at 2896 and 2917 of the capture)
        expect(counted.get("inserter:3")).toEqual(expect.arrayContaining([496, 517]));
        expect(counted.get("inserter:3")).not.toEqual(expect.arrayContaining([504]));
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
        expect(wakeUps([taker], [plant], 0, 4).inserters[0].wake_ups_per_minute).toBe(3600 / 3);
    });

    it("not when the result came before its update (it took everything), nor when the belt had no room at its drop", () => {
        const [first, plant] = partHand({}, 0);
        expect(wakeUps([first], [plant], 0, 4).inserters[0].wake_ups_per_minute).toBe(0);
        const [no_room, plant_again] = partHand({ drop_room: [true, true, false, true] }, 1);
        expect(wakeUps([no_room], [plant_again], 0, 4).inserters[0].wake_ups_per_minute).toBe(0);
    });

    it("keeps an inserter switched off asleep on the list there until the machine's next alarm, and on none after it", () => {
        const states = [SOURCE, OFF, OFF, OFF, OFF, OFF];
        const plant = machine("machine:1", 6, [3, 5]);
        const result = wakeUps([inserter(states)], [plant], 0, 6);
        expect(result.inserters[0].wake_ups_per_minute).toBe(3600 / 5);
        // switched off while working: on no list
        const working = wakeUps([inserter([WORKING, OFF, OFF, OFF, OFF, OFF])], [plant], 0, 6);
        expect(working.inserters[0].wake_ups_per_minute).toBe(0);
    });
});

/**
 * Ten settled periods of the sample metallurgic science build recorded in Factorio 2.1.24 (fixtures/wake-ups-capture-
 * metallurgic-science-2.1.24.json, four machines and eight inserters, clock cec15038; four periods before them let the
 * lists settle), with the ticks the game woke each inserter from a machine's list and why, read in the running game.
 * Inserters 4 and 5 take tungsten ore from a backed-up turbo belt that inserter 7 takes from too; their machine refuses
 * the ore at its insertion limit, and they go to sleep on its input list only while both lines of the belt are still.
 */
const METALLURGIC = "wake-ups-capture-metallurgic-science-2.1.24.json";

function metallurgicCapture(lines = true): { inserters: WatchingInserter[]; machines: WatchedMachine[]; ticks: number; from: number; woken: Map<string, [number, string][]> } {
    interface Series { source: string; sink: string; states: [number, string][]; held: [number, number][]; held_item: [number, string][];
        hand_size: number; return_ticks: number; belt_lines?: WatchingInserter["belt_lines"]; woken_by_machine: [number, string][] }
    interface Machine { products_finished: [number, number][]; true_starts: number[]; outputs: Record<string, [number, number][]> }
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", METALLURGIC), "utf8")) as {
        ticks: number; count_from: number; machines: Record<string, Machine>; inserters: Record<string, Series>;
    };
    const { ticks } = fixture;
    const at = (list: number[]) => { const flags = new Array<boolean>(ticks).fill(false); for (const tick of list) flags[tick] = true; return flags; };
    const machines = Object.entries(fixture.machines).map(([machine_id, it]): WatchedMachine => ({
        machine_id, products_finished: expanded(it.products_finished, ticks), true_starts: at(it.true_starts),
        outputs: Object.fromEntries(Object.entries(it.outputs).map(([item, series]) => [item, expanded(series, ticks)])),
    }));
    const inserters = Object.entries(fixture.inserters).map(([inserter_id, it]): WatchingInserter => ({
        inserter_id,
        source_machine_id: it.source.startsWith("machine:") ? it.source : null,
        sink_machine_id: it.sink.startsWith("machine:") ? it.sink : null,
        states: expanded(it.states, ticks), held: expanded(it.held, ticks), return_ticks: it.return_ticks,
        held_item: expanded(it.held_item, ticks), hand_size_of: () => it.hand_size,
        ...(lines && it.belt_lines !== undefined && { belt_lines: it.belt_lines }),
    }));
    return { inserters, machines, ticks, from: fixture.count_from, woken: new Map(Object.entries(fixture.inserters).map(([id, it]) => [id, it.woken_by_machine])) };
}

function countedOn(capture: ReturnType<typeof metallurgicCapture>): Map<string, number[]> {
    const { inserters, machines, ticks, from } = capture;
    const counted = new Map<string, number[]>(inserters.map(it => [it.inserter_id, []]));
    wakeUps(inserters, machines, from, ticks, (inserter_id, tick) => counted.get(inserter_id)!.push(tick));
    return counted;
}

describe("the rule \"kept-lists\" against ten periods of metallurgic science", () => {
    const capture = metallurgicCapture();
    const counted = countedOn(capture);

    it("counts the 56 wake-ups of each belt-fed inserter its machine refuses tick for tick, by the belt lines read off the takes", () => {
        for (const id of ["inserter:4", "inserter:5"]) {
            const game = capture.woken.get(id)!;
            expect(game).toHaveLength(56);
            expect(new Set(game.map(([, cause]) => cause))).toEqual(new Set(["craft start", "output taken"]));
            expect(counted.get(id), id).toEqual(game.map(([tick]) => tick));
        }
        // without the belt lines, as before: on a belt's list that nothing wakes
        const without = countedOn(metallurgicCapture(false));
        expect(without.get("inserter:4")).toEqual([]);
    });

    it("counts every other inserter tick for tick, but for four of inserter 7's, asleep with a part hand from its switch-off", () => {
        // inserter 7 took part of a hand from the belt and went to sleep on its machine's input list in the tick its clock
        // switched it off, woken by a craft start two ticks later (clock positions 54 and 187): a case the rule does not read
        for (const [id, game] of capture.woken) {
            const ticks = game.map(([tick]) => tick);
            expect(ticks.filter(tick => !counted.get(id)!.includes(tick)), id).toEqual(id === "inserter:7" ? [5174, 5307, 8374, 8507] : []);
            expect(counted.get(id)!.filter(tick => !ticks.includes(tick)), id).toEqual([]);
        }
    });
});
