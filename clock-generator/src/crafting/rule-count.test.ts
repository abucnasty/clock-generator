import { describe, expect, it } from "vitest";
import { RuleCountInserter, RuleCountMachine, ruleCount } from "./rule-count";

const WORKING = "working";
const SOURCE = "waiting_for_source_items";
const MORE = "waiting_for_more_items";
const SPACE = "waiting_for_space_in_destination";
const OFF = "disabled_by_control_behavior";

/** A series of `length` values that is `base` except at the given indices */
function series<T>(length: number, base: T, at: Record<number, T> = {}): T[] {
    return Array.from({ length }, (_, t) => at[t] ?? base);
}

/** A counter that rises by one at each of the given indices */
function counter(length: number, rises_at: number[]): number[] {
    return Array.from({ length }, (_, t) => rises_at.filter(it => it <= t).length);
}

/** A machine that finishes a craft at each of `finishes` and is working from `starts` until the next finish */
function machine(length: number, finishes: number[], working_at: number[] = [], extra: Partial<RuleCountMachine> = {}): RuleCountMachine {
    return {
        machine_id: "machine:1", recipe: "gear", products_finished: counter(length, finishes),
        working: Array.from({ length }, (_, t) => working_at.includes(t)), ...extra,
    };
}

function inserter(states: string[], held: number[], extra: Partial<RuleCountInserter> = {}): RuleCountInserter {
    return {
        inserter_id: "inserter:1", source_kind: "machine", sink_kind: "belt", source_machine_id: "machine:1", sink_machine_id: null,
        items: ["gear"], wired: false, states, held, ...extra,
    };
}

describe("ruleCount", () => {
    describe("source wake-ups", () => {
        it("counts a craft the source finishes when the inserter waited for source items, or for more, at the index before", () => {
            const states = series(8, WORKING, { 1: SOURCE, 2: SOURCE, 4: MORE });
            // finishes at 2 (it waited at 1: counted), 3 (waited at 2: counted), 5 (waited at 4: counted), 6 (working before: not)
            const run = ruleCount([inserter(states, series(8, 0))], [machine(8, [2, 3, 5, 6])], 0, 8);
            expect(run.inserters[0].source_wake_ups).toBe(3);
            expect(run.inserters[0].sink_wake_ups).toBe(0);
        });

        it("counts nothing for a source that is not a machine with data, however long the inserter waits", () => {
            const states = series(8, SOURCE);
            const belt = inserter(states, series(8, 0), { source_kind: "belt", source_machine_id: null });
            const run = ruleCount([belt], [machine(8, [2, 3, 4])], 0, 8);
            expect(run.inserters[0].wake_ups).toBe(0);
            const unknown = inserter(states, series(8, 0), { source_machine_id: "machine:9" });
            expect(ruleCount([unknown], [machine(8, [2, 3, 4])], 0, 8).inserters[0].wake_ups).toBe(0);
        });

        it("counts a productivity payout as a finish: any rise of products finished", () => {
            const bonus: RuleCountMachine = { ...machine(6, []), products_finished: [0, 0, 2, 2, 2, 2] };
            const run = ruleCount([inserter(series(6, SOURCE), series(6, 0))], [bonus], 0, 6);
            expect(run.inserters[0].source_wake_ups).toBe(1);
        });
    });

    describe("sink wake-ups", () => {
        /** A machine working from `from` up to the finish at `to`, where it goes idle, for each pair: it starts at `from` and finishes at `to` */
        const crafts = (length: number, spans: [number, number][], extra: Partial<RuleCountMachine> = {}) => machine(
            length, spans.map(([, to]) => to), spans.flatMap(([from, to]) => Array.from({ length: to - from }, (_, i) => from + i)),
            { machine_id: "machine:2", ...extra });
        const into_machine = (states: string[], held: number[]) =>
            inserter(states, held, { source_kind: "belt", sink_kind: "machine", source_machine_id: null, sink_machine_id: "machine:2" });

        it("counts a craft the sink starts when the inserter waited for space at the index before", () => {
            // the sink starts crafts at 3 and 6 (the status turns to working) and finishes at 5 and 8
            const sink = crafts(10, [[3, 5], [6, 8]]);
            const states = series(10, WORKING, { 2: SPACE, 5: SPACE, 7: SPACE });
            const run = ruleCount([into_machine(states, series(10, 0))], [sink], 0, 10);
            // waited at 2 (start at 3) and at 5 (start at 6); at 7 the machine starts nothing at 8, it finishes and goes idle
            expect(run.inserters[0].sink_wake_ups).toBe(2);
        });

        it("counts a finish as a start where the machine goes on working, and the status turning to working as a start", () => {
            // working from the first index, finishing at 2 and 5 and starting the next craft at once: a start at each finish
            const sink = machine(8, [2, 5], [0, 1, 2, 3, 4, 5, 6, 7], { machine_id: "machine:2" });
            const states = series(8, WORKING, { 1: SPACE, 4: SPACE, 6: SPACE });
            const run = ruleCount([into_machine(states, series(8, 0))], [sink], 0, 8);
            expect(run.inserters[0].sink_wake_ups).toBe(2);
        });

        it("leaves out a start on the index of the inserter's own drop", () => {
            const machine_2 = machine(8, [2], [], { machine_id: "machine:2" });
            const states = series(8, WORKING, { 1: SPACE });
            // the hand empties at 2, the index the sink finishes (and starts) a craft at
            const dropped = ruleCount([into_machine(states, [0, 4, 0, 0, 0, 0, 0, 0])], [machine_2], 0, 8);
            expect(dropped.inserters[0].sink_wake_ups).toBe(0);
            const kept = ruleCount([into_machine(states, series(8, 0))], [machine_2], 0, 8);
            expect(kept.inserters[0].sink_wake_ups).toBe(1);
        });

        it("counts no craft the sink finishes while the inserter waits for source items: only the source end listens for those", () => {
            const machine_2 = machine(8, [2], [], { machine_id: "machine:2" });
            const states = series(8, SOURCE);
            expect(ruleCount([into_machine(states, series(8, 0))], [machine_2], 0, 8).inserters[0].wake_ups).toBe(0);
        });
    });

    describe("pickups", () => {
        // the hand rises at 10 and nothing else is on in the series
        const picked_at_10 = [...series(10, 0), 1, 1, 1, 1];
        const length = 14;

        it("counts a pickup from a machine that no wake-up and no disabled index explains", () => {
            const run = ruleCount([inserter(series(length, WORKING), picked_at_10)], [machine(length, [])], 0, length);
            expect(run.inserters[0].pickups).toBe(1);
            expect(run.inserters[0].wake_ups).toBe(1);
        });

        it("counts no pickup from a belt or a chest", () => {
            const belt = inserter(series(length, WORKING), picked_at_10, { source_kind: "belt", source_machine_id: null });
            expect(ruleCount([belt], [machine(length, [])], 0, length).inserters[0].pickups).toBe(0);
        });

        it("explains a pickup by a wake-up at its index and at up to three indices before it, not four", () => {
            // the source finishes at `finish` and the inserter waited for items the index before
            const pickups = (finish: number) => {
                const states = series(length, WORKING, { [finish - 1]: SOURCE });
                return ruleCount([inserter(states, picked_at_10)], [machine(length, [finish])], 0, length).inserters[0];
            };
            for (const finish of [10, 9, 8, 7]) {
                expect(pickups(finish)).toMatchObject({ source_wake_ups: 1, pickups: 0 });
            }
            expect(pickups(6)).toMatchObject({ source_wake_ups: 1, pickups: 1 });
        });

        it("explains a pickup by a sink wake-up as well", () => {
            const states = series(length, WORKING, { 7: SPACE });
            const sunk = inserter(states, picked_at_10, { sink_kind: "machine", sink_machine_id: "machine:2" });
            const sink = machine(length, [8], [], { machine_id: "machine:2" });
            const run = ruleCount([sunk], [machine(length, []), sink], 0, length);
            expect(run.inserters[0]).toMatchObject({ sink_wake_ups: 1, pickups: 0 });
        });

        it("explains a pickup by a disabled index at the same index and at up to three before it, not four", () => {
            const pickups = (off_at: number) =>
                ruleCount([inserter(series(length, WORKING, { [off_at]: OFF }), picked_at_10)], [machine(length, [])], 0, length).inserters[0].pickups;
            for (const off_at of [10, 9, 8, 7]) {
                expect(pickups(off_at)).toBe(0);
            }
            expect(pickups(6)).toBe(1);
        });

        it("looks at indices before the range counted, and at index 0 only knows the disabled state", () => {
            const early = [0, 1, 1, 1, 1, 1];
            // a disabled index at 0 explains a pickup at 1, 2 and 3 but not at 4
            const run = (off_at: number, picked: number[]) =>
                ruleCount([inserter(series(6, WORKING, { [off_at]: OFF }), picked)], [machine(6, [])], 0, 6).inserters[0].pickups;
            expect(run(0, early)).toBe(0);
            expect(run(0, [0, 0, 0, 0, 1, 1])).toBe(1);
            // counted from index 4, the disabled index at 1 still explains it
            const later = ruleCount([inserter(series(6, WORKING, { 1: OFF }), [0, 0, 0, 0, 1, 1])], [machine(6, [])], 4, 6);
            expect(later.inserters[0].pickups).toBe(0);
        });
    });

    describe("the start rule", () => {
        it("falls back to the finishes of a machine whose starts differ from them by more than 3%, and reports it", () => {
            // 10 finishes, but working turns on 12 times: 20% off
            const length = 100;
            const finishes = [5, 15, 25, 35, 45, 55, 65, 75, 85, 95];
            const working_at = Array.from({ length }, (_, t) => t).filter(t => Math.floor(t / 4) % 2 === 0 && t < 48);
            const flicker = machine(length, finishes, working_at, { machine_id: "machine:2", recipe: "ore" });
            const states = series(length, WORKING, { 4: SPACE, 7: SPACE });
            const sink = inserter(states, series(length, 0), { source_kind: "belt", source_machine_id: null, sink_kind: "machine", sink_machine_id: "machine:2" });
            const run = ruleCount([sink], [flicker], 0, length);
            expect(run.start_rule_fallback).toHaveLength(1);
            expect(run.start_rule_fallback[0]).toMatchObject({ machine_id: "machine:2", recipe: "ore", finishes: 10 });
            expect(run.start_rule_fallback[0].starts).toBeGreaterThan(10.3);
            // the status turns to working at 8, 16, ...: starts the rule does not use here. SPACE at 4 meets the finish at 5
            // (counted); SPACE at 7 would meet the turn to working at 8 (not counted)
            expect(run.inserters[0].sink_wake_ups).toBe(1);
        });

        it("keeps the starts of a machine within 3% of its finishes", () => {
            const length = 40;
            // 20 finishes and no turn to working: its starts are its finishes
            const finishes = Array.from({ length: 20 }, (_, i) => 2 * i + 1);
            const run = ruleCount([inserter(series(length, WORKING), series(length, 0))], [machine(length, finishes)], 0, length);
            expect(run.start_rule_fallback).toEqual([]);
        });
    });

    describe("what is counted", () => {
        it("counts a dump of n samples over n - 1 ticks, and gives wake-ups a minute over them", () => {
            const length = 3601;
            const states = series(length, WORKING, { 9: SOURCE });
            const run = ruleCount([inserter(states, series(length, 0))], [machine(length, [10])], 0, length);
            expect(run.ticks).toBe(3600);
            expect(run.minutes).toBe(1);
            expect(run.inserters[0].source_wake_ups_per_minute).toBe(1);
            expect(run.groups[0].wake_ups_per_minute).toBe(1);
        });

        it("counts nothing before from_index, and nothing at or after to_index", () => {
            const states = series(12, WORKING, { 2: SOURCE, 5: SOURCE, 8: SOURCE });
            const all = (from: number, to: number) => ruleCount([inserter(states, series(12, 0))], [machine(12, [3, 6, 9])], from, to);
            expect(all(0, 12).inserters[0].source_wake_ups).toBe(3);
            expect(all(4, 12).inserters[0].source_wake_ups).toBe(2);
            expect(all(4, 9).inserters[0].source_wake_ups).toBe(1);
            expect(all(4, 9)).toMatchObject({ ticks: 5 });
            expect(all(8, 8)).toMatchObject({ ticks: 0, minutes: 0 });
        });

        it("counts a belt-fed inserter's waiting ticks for nothing", () => {
            const belt_fed = inserter(series(10, SOURCE), series(10, 0), { source_kind: "belt", source_machine_id: null, sink_kind: "machine", sink_machine_id: "machine:1" });
            expect(ruleCount([belt_fed], [machine(10, [3, 4, 5])], 0, 10).inserters[0].wake_ups).toBe(0);
        });
    });

    describe("groups", () => {
        it("keys by the ends, the items and the recipes, and sums wired and unwired inserters together", () => {
            const length = 6;
            const states = series(length, WORKING, { 1: SOURCE });
            const members = [
                inserter(states, series(length, 0), { inserter_id: "inserter:1", wired: true }),
                inserter(states, series(length, 0), { inserter_id: "inserter:2", items: [] }),
                inserter(states, series(length, 0), { inserter_id: "inserter:3", items: ["b", "a"], source_kind: "chest", source_machine_id: null, sink_kind: "machine", sink_machine_id: "machine:1" }),
                inserter(states, series(length, 0), { inserter_id: "inserter:4", items: ["gear"], wired: false, sink_recipe: "ignored" }),
            ];
            const run = ruleCount(members, [machine(length, [2])], 0, length);
            const by_key = Object.fromEntries(run.groups.map(group => [group.key, group]));
            expect(Object.keys(by_key).sort()).toEqual([
                "chest to machine | a+b |  > gear",
                "machine to belt | - | gear > ",
                "machine to belt | gear | gear > ",
            ]);
            expect(by_key["machine to belt | gear | gear > "]).toMatchObject({ inserters: 2, wired: 1, source_wake_ups: 2, wake_ups: 2 });
            expect(by_key["chest to machine | a+b |  > gear"]).toMatchObject({ role: "chest to machine", items: "a+b", recipes: " > gear", inserters: 1 });
        });
    });

    describe("the count in true starts", () => {
        const length = 10;
        // the sink truly starts at 3 and 7; it pays out a productivity bar at 5 (a finish that is no start)
        const sink = (extra: Partial<RuleCountMachine> = {}) => machine(length, [3, 5, 7], [3, 4, 5, 6, 7, 8, 9], {
            machine_id: "machine:2", true_starts: series(length, false, { 3: true, 7: true }), ...extra,
        });
        const states = series(length, WORKING, { 2: SPACE, 4: SPACE, 6: SPACE });
        const into = inserter(states, series(length, 0), { source_kind: "belt", source_machine_id: null, sink_kind: "machine", sink_machine_id: "machine:2" });

        it("wakes an input on a true start and not on a payout, where the original count takes the payout for a start", () => {
            const run = ruleCount([into], [sink()], 0, length);
            expect(run.inserters[0]).toMatchObject({ sink_wake_ups: 3, true_sink_wake_ups: 2, true_wake_ups: 2, wake_ups: 3 });
            expect(run.groups[0]).toMatchObject({ wake_ups: 3, true_wake_ups: 2 });
            expect(run.true_start_unknown).toEqual([]);
        });

        it("lets a machine without true starts stand in with its inferred starts, and names it", () => {
            const run = ruleCount([into], [sink({ true_starts: undefined })], 0, length);
            expect(run.inserters[0]).toMatchObject({ sink_wake_ups: 3, true_sink_wake_ups: 3 });
            expect(run.true_start_unknown).toEqual([{ machine_id: "machine:2", recipe: "gear" }]);
        });

        it("reads a pickup against the true-start count's own wake-ups", () => {
            // the output's source pays out at 5 and the output takes the payout's item at 6: explained by the source
            // wake-up in both counts, since the source half is the same
            const source = machine(length, [5], [], { true_starts: series(length, false) });
            const out = inserter(series(length, MORE, { 6: WORKING }), series(length, 0, { 6: 1, 7: 1, 8: 1, 9: 1 }));
            const run = ruleCount([out], [source], 0, length);
            expect(run.inserters[0]).toMatchObject({ source_wake_ups: 1, pickups: 0, true_pickups: 0, true_wake_ups: 1 });
        });
    });
});
