import { describe, expect, it } from "vitest";
import { CoordinatedSourcesNotApplicable, localChoiceFromStarts, localChoiceStarts, localChoiceWithCopies, onWindowCycles, partGroups, SEARCH_FROM_EVERY_START_VARIABLE, sourceControlsOf, tiledWindows, upstreamOrder,
    type GroupedInserter, type LocalChoiceJudge } from "./coordinated-sources";
import { EntityRouteError } from "../enable-control-router";
import { collectingParts, offerPart, partKey, partsWanted, coordinatedSourcesInputOf, type CoordinatedSourcesPart } from "./coordinated-sources-parts";
import type { ClockStrategy } from "../clock-strategy";

const window = (start: number, end: number) => ({ start, end });

/** A machine fed from a belt, its product taken by a second machine, whose product goes onto a belt */
const CHAIN: GroupedInserter[] = [
    { id: "inserter:1", source: "belt:1", sink: "machine:1" },
    { id: "inserter:2", source: "machine:1", sink: "machine:2" },
    { id: "inserter:3", source: "machine:1", sink: "machine:2" },
    { id: "inserter:4", source: "machine:2", sink: "belt:2" },
];

const part = (name: string, window_cycle_ticks: number, windows: CoordinatedSourcesPart["windows"], extra: Partial<CoordinatedSourcesPart> = {}): CoordinatedSourcesPart =>
    ({ name, window_cycle_ticks, windows, counted: true, ...extra });

describe("the windows of a part on the shared period", () => {
    it("repeat a period that divides it, and stay as they are on their own", () => {
        const windows = { "inserter:1": [window(2, 3)] };
        expect(tiledWindows(windows, 10, 10)).toBe(windows);
        expect(tiledWindows(windows, 10, 30)).toEqual({ "inserter:1": [window(2, 3), window(12, 13), window(22, 23)] });
    });
});

describe("the groups of the local choice", () => {
    it("come from the output upstream, by the hops to the output, then by the source's id", () => {
        expect(upstreamOrder(CHAIN)).toEqual(["machine:2", "machine:1", "belt:1"]);
    });

    it("take the inserters of one source together, each distinct set of windows once, in the order of the parts", () => {
        const recommended = part("recommended", 20, { "inserter:1": [window(0, 4)], "inserter:2": [window(5, 6)], "inserter:3": [window(5, 6)], "inserter:4": [window(0, 0)] });
        // on half the window cycle: repeated, other windows for every group, and inserter 1 left always enabled
        const other = part("other", 10, { "inserter:2": [window(5, 6)], "inserter:3": [window(5, 6)], "inserter:4": [window(0, 0)] });
        const groups = partGroups(CHAIN, [recommended, other], 20);
        expect(groups.map(group => [group.source, group.inserters, group.choices.length])).toEqual([
            ["machine:2", ["inserter:4"], 2],
            ["machine:1", ["inserter:2", "inserter:3"], 2],
            ["belt:1", ["inserter:1"], 2],
        ]);
        expect(groups[0].choices[0].parts.map(it => it.name)).toEqual(["recommended"]);
        expect(groups[0].choices[1].windows).toEqual({ "inserter:4": [window(0, 0), window(10, 10)] });
        expect(groups[1].choices[1].windows).toEqual({ "inserter:2": [window(5, 6), window(15, 16)], "inserter:3": [window(5, 6), window(15, 16)] });
        // an inserter a part leaves without windows is always enabled in that choice
        expect(groups[2].choices[1].windows).toEqual({ "inserter:1": null });
    });

    it("take a part's windows only for the sources it is taken for, one source at a time", () => {
        const recommended = part("recommended", 20, { "inserter:1": [window(0, 4)], "inserter:2": [window(5, 6)], "inserter:3": [window(5, 6)], "inserter:4": [window(0, 0)] });
        const other = part("other", 20, { "inserter:1": [window(1, 5)], "inserter:2": [window(7, 8)], "inserter:3": [window(7, 8)], "inserter:4": [window(2, 2)] });
        const groups = partGroups(CHAIN, [recommended, other], 20, (it, source) => it === recommended || source === "machine:1");
        expect(groups.map(group => [group.source, group.choices.map(choice => choice.parts.map(it => it.name))])).toEqual([
            ["machine:2", [["recommended"]]],
            ["machine:1", [["recommended"], ["other"]]],
            ["belt:1", [["recommended"]]],
        ]);
    });
});

describe("the starts of the local choice", () => {
    // inserter 1 has the same windows in every part: only machine:2 (inserter 4) and machine:1 (inserters 2 and 3) have a choice
    const clock = (id: string, wake_ups_per_minute: number, at: number) => part(id, 20, { "inserter:1": [window(0, 4)], "inserter:2": [window(at, at + 1)],
        "inserter:3": [window(at, at + 1)], "inserter:4": [window(at - 5, at - 5)] }, { alternative_id: id, verdict: "stable", wake_ups_per_minute });
    const recommended = clock("recommended", 40, 5);
    const tied = clock("tied", 40, 7);
    const other = clock("other", 90, 9);
    const groups = (parts: CoordinatedSourcesPart[]) => partGroups(CHAIN, [recommended, ...parts], 20);
    /** A composed clock's wakeups by the choice of machine:2 and of machine:1 ("2,1"); one not in the table does not hold */
    const judge = (wake_ups: Record<string, number>): LocalChoiceJudge => {
        const of = (choice: ReadonlyMap<string, number>) => wake_ups[`${choice.get("machine:2")},${choice.get("machine:1")}`] ?? null;
        return {
            wakeUpsOf: of,
            takes: choice => of(choice) === null ? "passed" : "taken",
            refusal: choice => [...choice.values()].every(it => it === 0) ? "the local choice keeps the recommended clock" : null,
        };
    };
    const logged: string[] = [];
    const logger = { log: (message: string) => { logged.push(message); }, warn: () => { }, error: () => { }, debug: () => { } };
    // from the recommended clock no move is cheaper; from the tied one, machine:2 taking the other clock is
    const only_from_tied = { "0,0": 40, "1,0": 50, "2,0": 60, "0,1": 45, "0,2": 70, "1,1": 40, "2,1": 30, "2,2": 35 };

    it("are the recommended clock and every stable clock whose wakeups tie it, each with every group on its windows", () => {
        const all = groups([tied, other]);
        const starts = localChoiceStarts(CHAIN, all, recommended, [tied, other], 20);
        expect(starts.map(start => [start.part.name, Object.fromEntries(start.choice)]))
            .toEqual([["recommended", { "machine:2": 0, "machine:1": 0, "belt:1": 0 }], ["tied", { "machine:2": 1, "machine:1": 1, "belt:1": 0 }]]);
    });

    it("find the cheaper clock that only the tied clock's start reaches, and say which start it came from", () => {
        const all = groups([tied, other]);
        const found = localChoiceFromStarts(all, localChoiceStarts(CHAIN, all, recommended, [tied, other], 20), judge(only_from_tied), logger);
        expect(found.start.part.name).toBe("tied");
        expect(Object.fromEntries(found.choice)).toEqual({ "machine:2": 2, "machine:1": 1, "belt:1": 0 });
        expect(logged).toEqual([
            "Coordinated Sources: also from tied, whose wakeups a minute tie the recommended clock's (40)",
            "Coordinated Sources, from tied, pass 1: machine:2 takes other (30 wakeups a minute)",
        ]);
        logged.length = 0;
    });

    it("are the recommended clock alone where no clock ties it, which keeps today's choice", () => {
        const not_tied = { ...tied, wake_ups_per_minute: 40.001 };
        const all = groups([not_tied, other]);
        const starts = localChoiceStarts(CHAIN, all, recommended, [not_tied, other], 20);
        expect(starts.map(start => start.part.name)).toEqual(["recommended"]);
        expect(() => localChoiceFromStarts(all, starts, judge(only_from_tied), logger))
            .toThrow(new CoordinatedSourcesNotApplicable("the local choice keeps the recommended clock"));
        expect(logged).toEqual([]);
    });

    it("are every stable clock where CLOCK_SEARCH_FROM_EVERY_START is 1, tied or not, and never a clock that is not stable", () => {
        const not_tied = { ...tied, wake_ups_per_minute: 40.001 };
        const unstable = { ...other, verdict: "unstable" as const };
        const all = groups([not_tied, unstable]);
        const before = process.env[SEARCH_FROM_EVERY_START_VARIABLE];
        try {
            delete process.env[SEARCH_FROM_EVERY_START_VARIABLE];
            expect(localChoiceStarts(CHAIN, all, recommended, [not_tied, unstable], 20).map(start => start.part.name)).toEqual(["recommended"]);
            process.env[SEARCH_FROM_EVERY_START_VARIABLE] = "0";
            expect(localChoiceStarts(CHAIN, all, recommended, [not_tied, unstable], 20).map(start => start.part.name)).toEqual(["recommended"]);
            process.env[SEARCH_FROM_EVERY_START_VARIABLE] = "1";
            expect(localChoiceStarts(CHAIN, all, recommended, [not_tied, unstable], 20).map(start => start.part.name)).toEqual(["recommended", "tied"]);
        } finally {
            if (before === undefined) delete process.env[SEARCH_FROM_EVERY_START_VARIABLE];
            else process.env[SEARCH_FROM_EVERY_START_VARIABLE] = before;
        }
    });

    it("keep the recommended clock's start's result where another start gives the same", () => {
        const all = groups([tied, other]);
        // from the recommended clock: machine:2 takes the other clock (35), then machine:1 the tied one (30); from the tied
        // clock: machine:2 takes the other clock (30), and machine:1 keeps the tied one on a tie
        const same = { ...only_from_tied, "2,0": 35, "2,1": 30, "2,2": 30 };
        const found = localChoiceFromStarts(all, localChoiceStarts(CHAIN, all, recommended, [tied, other], 20), judge(same), logger);
        expect(found.start.part.name).toBe("recommended");
        expect(Object.fromEntries(found.choice)).toEqual({ "machine:2": 2, "machine:1": 1, "belt:1": 0 });
        logged.length = 0;
    });
});

describe("the local choice with the copies, end first", () => {
    const clock = (id: string, wake_ups_per_minute: number, at: number) => part(id, 20, { "inserter:1": [window(0, 4)], "inserter:2": [window(at, at + 1)],
        "inserter:3": [window(at, at + 1)], "inserter:4": [window(at - 5, at - 5)] }, { alternative_id: id, verdict: "stable", wake_ups_per_minute });
    const recommended = clock("recommended", 40, 5);
    const other = clock("other", 90, 9);
    const tied = clock("tied", 40, 7);
    const all = partGroups(CHAIN, [recommended, tied, other], 20);
    // the recommended clock's start alone: no other clock ties it
    const starts = localChoiceStarts(CHAIN, all, recommended, [other], 20);
    const keyOf = (choice: ReadonlyMap<string, number>) => `${choice.get("machine:2")},${choice.get("machine:1")}`;
    /** A judge by the wakeups of each choice (one not in the table does not hold); with the copies, the choices of `lose` do not hold */
    const judge = (wake_ups: Record<string, number>, lose: readonly string[] = []): LocalChoiceJudge => {
        const of = (choice: ReadonlyMap<string, number>) => wake_ups[keyOf(choice)] ?? null;
        return {
            wakeUpsOf: of,
            takes: choice => of(choice) === null || lose.includes(keyOf(choice)) ? "passed" : "taken",
            refusal: choice => [...choice.values()].every(it => it === 0) ? "the local choice keeps the recommended clock"
                : lose.includes(keyOf(choice)) ? "the composed clock does not hold with the copies" : null,
        };
    };
    const never: LocalChoiceJudge = { wakeUpsOf: () => { throw new Error("judged with the copies"); }, takes: () => "passed", refusal: () => null };
    const logger = { log: () => { }, warn: () => { }, error: () => { }, debug: () => { } };
    // on one copy, machine:2 takes the other clock (20); with the copies that clock does not hold, and the tied one (30) does
    const wake_ups = { "0,0": 40, "1,0": 30, "2,0": 20 };

    it("keep the clock of the local choice on one copy where it holds with the copies, and run no second local choice", () => {
        const ends: string[] = [];
        const found = localChoiceWithCopies(all, starts, { one_copy: judge(wake_ups), with_copies: never }, choice => { ends.push(keyOf(choice)); return true; }, logger);
        expect(Object.fromEntries(found.choice)).toEqual({ "machine:2": 2, "machine:1": 0, "belt:1": 0 });
        expect(ends).toEqual(["2,0"]);
    });

    it("run the local choice again with the copies where its end does not hold with them, and give its clock", () => {
        const found = localChoiceWithCopies(all, starts, { one_copy: judge(wake_ups), with_copies: judge(wake_ups, ["2,0"]) }, choice => keyOf(choice) !== "2,0", logger);
        expect(Object.fromEntries(found.choice)).toEqual({ "machine:2": 1, "machine:1": 0, "belt:1": 0 });
    });

    it("judge the recommended clock where the local choice keeps it, and keep the refusal where it holds with the copies", () => {
        const ends: string[] = [];
        const kept = { "0,0": 40, "1,0": 50 };
        expect(() => localChoiceWithCopies(all, starts, { one_copy: judge(kept), with_copies: never }, choice => { ends.push(keyOf(choice)); return true; }, logger))
            .toThrow(new CoordinatedSourcesNotApplicable("the local choice keeps the recommended clock"));
        expect(ends).toEqual(["0,0"]);
    });

    it("run the local choice again where the recommended clock it keeps does not hold with the copies", () => {
        const kept = { "0,0": 40, "1,0": 50 };
        const found = localChoiceWithCopies(all, starts, { one_copy: judge(kept), with_copies: judge(kept, ["0,0"]) }, choice => keyOf(choice) !== "0,0", logger);
        expect(Object.fromEntries(found.choice)).toEqual({ "machine:2": 1, "machine:1": 0, "belt:1": 0 });
    });

    it("give the refusal of the local choice with the copies where no composition holds with them", () => {
        expect(() => localChoiceWithCopies(all, starts, { one_copy: judge(wake_ups), with_copies: judge(wake_ups, ["0,0", "1,0", "2,0"]) },
            choice => keyOf(choice) === "none", logger)).toThrow(new CoordinatedSourcesNotApplicable("the local choice keeps the recommended clock"));
    });
});

describe("the input of the per-branch clock", () => {
    const stable = part("planned-belt-slack", 24, { "inserter:1": [window(0, 3)] }, { alternative_id: "planned-belt-slack", verdict: "stable" });
    const unstable = part("swings-2", 48, { "inserter:1": [window(0, 7)] }, { alternative_id: "swings-2", verdict: "unstable" });
    const way = part("staged", 24, { "inserter:1": [window(1, 3)] }, { counted: false });
    const same_way = part("compact", 24, { "inserter:1": [window(0, 3)] });
    const per_hand = part("staged, per hand", 24, { "inserter:1": [window(2, 2)] }, { counted: undefined });
    const counted_per_hand = part("compact, per hand", 24, { "inserter:1": [window(2, 2)] });

    it("lists the stable alternatives first, then the ways, each set of windows once, a counted one before one not yet counted", () => {
        const input = coordinatedSourcesInputOf([{ parts: [way, per_hand] }, null, { parts: [stable, unstable, same_way], also: [{ parts: [counted_per_hand] }] }], ["planned-belt-slack"]);
        expect(input.recommended_id).toBe("planned-belt-slack");
        expect(input.parts.map(it => it.name)).toEqual(["planned-belt-slack", "staged", "compact, per hand"]);
    });

    it("takes a clock that holds on one copy though it is not stable, after the ways, and leaves out one that does not hold", () => {
        const holds_unstable = { ...unstable, holds: true };
        const no_recovery = part("swings-1", 24, { "inserter:1": [window(0, 5)] }, { alternative_id: "swings-1", verdict: "no recovery", holds: true });
        const does_not_hold = part("derived", 24, { "inserter:1": [window(0, 6)] }, { alternative_id: "derived", verdict: "unstable", holds: false });
        // a clock that is not stable with the windows of a stable one or a way is that part already
        const same_as_stable = part("shifted-swings", 24, { "inserter:1": [window(0, 3)] }, { alternative_id: "shifted-swings", verdict: "unstable", holds: true });
        const input = coordinatedSourcesInputOf([{ parts: [holds_unstable, stable, does_not_hold, same_as_stable, way, no_recovery] }], ["planned-belt-slack"]);
        expect(input.parts.map(it => it.name)).toEqual(["planned-belt-slack", "staged", "swings-2", "swings-1"]);
    });

    it("keeps the recommended clock though it is not stable", () => {
        expect(coordinatedSourcesInputOf([{ parts: [stable, unstable] }], ["swings-2"]).parts.map(it => it.name)).toEqual(["planned-belt-slack", "swings-2"]);
    });

    it("composes on the window cycles of the recommended clock and the next best-ranked stable clock, one a window cycle, none longer, at most two", () => {
        const on = (name: string, ticks: number, verdict: CoordinatedSourcesPart["verdict"], start: number) =>
            part(name, ticks, { "inserter:1": [window(start, start)] }, { alternative_id: name, verdict, holds: true });
        const parts = [on("swings-4", 96, "stable", 0), on("observed", 96, "stable", 1), on("swings-7", 12, "unstable", 2), on("time-study", 192, "stable", 6),
            on("time-division", 48, "stable", 3), on("swings-3", 24, "stable", 4), on("swings-1", 6, "stable", 5)];
        const input = coordinatedSourcesInputOf([{ parts }], ["swings-4", "observed", "swings-7", "time-study", "time-division", "swings-3", "swings-1"]);
        expect(input.recommended_id).toBe("swings-4");
        expect(input.window_cycle_ids).toEqual(["swings-4", "time-division"]);
        // one window cycle: the recommended clock's alone, as before
        expect(coordinatedSourcesInputOf([{ parts }], ["swings-4", "observed"]).window_cycle_ids).toBeUndefined();
    });

    it("keys a part by its period and its windows, in the order of the inserters' ids", () => {
        expect(partKey(part("a", 24, { "inserter:2": [window(1, 1)], "inserter:1": [window(0, 0)], "inserter:3": [] })))
            .toBe(partKey(part("b", 24, { "inserter:1": [window(0, 0)], "inserter:2": [window(1, 1)] })));
        expect(partKey(part("a", 24, { "inserter:1": [window(0, 0)] }))).not.toBe(partKey(part("a", 48, { "inserter:1": [window(0, 0)] })));
    });
});

describe("the per-branch clock on the window cycles of the best few clocks", () => {
    // the recommended clock on 96 ticks, and the next best-ranked stable clock on 48
    const recommended = part("swings-4", 96, { "inserter:1": [window(0, 3)] }, { alternative_id: "swings-4", verdict: "stable", wake_ups_per_minute: 11.669 });
    const second = part("time-division", 48, { "inserter:1": [window(0, 1)] }, { alternative_id: "time-division", verdict: "stable", wake_ups_per_minute: 13.340 });
    const input = coordinatedSourcesInputOf([{ parts: [recommended, second] }], ["swings-4", "time-division"]);
    /** A maker that composes, around each clock, a clock of the wakeups given for it (none where null) */
    const makerOf = (wake_ups: Record<string, number | null>) => (around: { recommended_id: string; parts: CoordinatedSourcesPart[] }) => {
        expect(around.parts).toBe(input.parts);
        const made = wake_ups[around.recommended_id];
        return made === null ? null : { around: around.recommended_id, window_cycle_ticks: around.parts.find(it => it.alternative_id === around.recommended_id)!.window_cycle_ticks, wake_ups: made };
    };
    const fewest = (made: readonly { wake_ups: number }[]) => made.reduce((best, it, index) => it.wake_ups < made[best].wake_ups ? index : best, 0);

    it("lists the composition on the second-best clock's window cycle where it has fewer wakeups", () => {
        expect(onWindowCycles(input, makerOf({ "swings-4": 6.668, "time-division": 3.335 }), fewest))
            .toEqual({ made: { around: "time-division", window_cycle_ticks: 48, wake_ups: 3.335 }, index: 1 });
    });

    it("keeps the recommended clock's window cycle's where it is first, or tied", () => {
        expect(onWindowCycles(input, makerOf({ "swings-4": 3.335, "time-division": 3.335 }), fewest)?.index).toBe(0);
    });

    it("lists what another window cycle makes where the recommended clock's makes none, and none where none makes one", () => {
        expect(onWindowCycles(input, makerOf({ "swings-4": null, "time-division": 13 }), fewest)?.made.around).toBe("time-division");
        expect(onWindowCycles(input, makerOf({ "swings-4": null, "time-division": null }), fewest)).toBeNull();
    });

    it("is made on the recommended clock's window cycle alone where the input names no other", () => {
        const tried: string[] = [];
        onWindowCycles({ recommended_id: "swings-4", parts: [recommended, second] }, around => { tried.push(around.recommended_id); return null; }, fewest);
        expect(tried).toEqual(["swings-4"]);
    });
});

describe("the collection of parts", () => {
    it("gives the parts offered while the work ran to every collection open, and wants none where none is open", () => {
        expect(partsWanted()).toBe(false);
        offerPart(part("lost", 1, {}));
        const outer = collectingParts(() => {
            offerPart(part("first", 1, {}));
            const inner = collectingParts(() => { offerPart(part("second", 1, {})); return partsWanted(); });
            return inner;
        });
        expect(outer.value.value).toBe(true);
        expect(outer.value.parts.map(it => it.name)).toEqual(["second"]);
        expect(outer.parts.map(it => it.name)).toEqual(["first", "second"]);
        expect(partsWanted()).toBe(false);
    });
});

describe("what the router gave each entity", () => {
    const takt = { id: "takt_batches", tuning_method: "calculated" } as const;
    const polling = { id: "round_robin_polling", tuning_method: "calculated" } as const;
    const recommended = part("recommended", 20, { "inserter:1": [window(0, 4)], "inserter:2": [window(5, 6)], "inserter:3": [window(5, 6)], "inserter:4": [window(0, 0)] },
        { alternative_id: "recommended", strategy: takt });
    // inserter 1 has no windows in this part, which says why
    const other = part("other", 20, { "inserter:2": [window(7, 8)], "inserter:3": [window(7, 8)], "inserter:4": [window(0, 0)] },
        { strategy: polling, always_on: { "inserter:1": { kind: "full-duty-cycle", window_cycle_ticks: 20 } } });
    const groups = partGroups(CHAIN, [recommended, other], 20);
    const logged: string[] = [];
    const logger = { log: () => { }, warn: () => { }, error: () => { }, debug: (message: string) => { logged.push(message); } };

    it("lists every inserter of every group once, with the strategy of the part its group took", () => {
        const sources = sourceControlsOf(groups, new Map([["machine:2", 0], ["machine:1", 1], ["belt:1", 0]]), {}, logger, "gear");
        expect(sources.map(it => it.source)).toEqual(["machine:2", "machine:1", "belt:1"]);
        expect(sources.flatMap(it => Object.keys(it.entities)).sort()).toEqual(CHAIN.map(it => it.id));
        expect(sources[0].entities).toEqual({ "inserter:4": { kind: "strategy", id: "takt_batches", tuning_method: "calculated" } });
        expect(sources[1].entities).toEqual({
            "inserter:2": { kind: "strategy", id: "round_robin_polling", tuning_method: "calculated" },
            "inserter:3": { kind: "strategy", id: "round_robin_polling", tuning_method: "calculated" },
        });
    });

    it("gives an inserter its part leaves without windows its always-on reason: the part's, else the clock's", () => {
        const from_part = sourceControlsOf(groups, new Map([["machine:2", 0], ["machine:1", 0], ["belt:1", 1]]), {}, logger, "gear");
        expect(from_part[2].entities).toEqual({ "inserter:1": { kind: "always_on", reason: { kind: "full-duty-cycle", window_cycle_ticks: 20 } } });
        const bare = partGroups(CHAIN, [recommended, { ...other, always_on: undefined }], 20);
        expect(sourceControlsOf(bare, new Map([["machine:2", 0], ["machine:1", 0], ["belt:1", 1]]), { "inserter:1": { kind: "loop" } }, logger, "gear")[2].entities)
            .toEqual({ "inserter:1": { kind: "always_on", reason: { kind: "loop" } } });
    });

    it("leaves out an inserter with no reason known, and says so in the log", () => {
        const bare = partGroups(CHAIN, [recommended, { ...other, always_on: undefined }], 20);
        const sources = sourceControlsOf(bare, new Map([["machine:2", 0], ["machine:1", 0], ["belt:1", 1]]), {}, logger, "gear");
        expect(sources[2].entities).toEqual({});
        expect(logged).toEqual(["Coordinated Sources, gear: inserter:1 left out of the sources, it is always enabled with no reason known"]);
        logged.length = 0;
    });

    it("throws an internal error for an inserter given windows by a part with no strategy, naming the inserter", () => {
        const unknown = partGroups(CHAIN, [{ ...recommended, strategy: undefined }], 20);
        expect(() => sourceControlsOf(unknown, new Map([["machine:2", 0], ["machine:1", 0], ["belt:1", 0]]), {}, logger, "gear"))
            .toThrow(new EntityRouteError("Internal error: Coordinated Sources, gear: inserter:4 has enable windows from the clock recommended, which has no strategy"));
    });
});

describe("the strategy of a part", () => {
    it("is the one of the alternative it is, and Round-Robin Polling by the grouped hands for a way", () => {
        const alternative = part("exhaust", 24, { "inserter:1": [window(0, 3)] }, { alternative_id: "exhaust", verdict: "stable" });
        const way = part("staged", 24, { "inserter:1": [window(1, 3)] });
        const input = coordinatedSourcesInputOf([{ alternatives: [{ id: "exhaust", strategy: { id: "exhaust", tuning_method: "calculated" } as ClockStrategy }], parts: [alternative, way] }], ["exhaust"]);
        expect(input.parts.map(it => it.strategy)).toEqual([{ id: "exhaust", tuning_method: "calculated" }, { id: "round_robin_polling", tuning_method: "calculated" }]);
    });
});
