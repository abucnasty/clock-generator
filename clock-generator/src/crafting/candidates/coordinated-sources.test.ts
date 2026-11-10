import { describe, expect, it } from "vitest";
import { CoordinatedSourcesNotApplicable, localChoiceFromStarts, localChoiceStarts, partGroups, sourceControlsOf, tiledWindows, upstreamOrder,
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

describe("the input of the per-branch clock", () => {
    const stable = part("planned-belt-slack", 24, { "inserter:1": [window(0, 3)] }, { alternative_id: "planned-belt-slack", verdict: "stable" });
    const unstable = part("swings-2", 48, { "inserter:1": [window(0, 7)] }, { alternative_id: "swings-2", verdict: "unstable" });
    const way = part("staged", 24, { "inserter:1": [window(1, 3)] }, { counted: false });
    const same_way = part("compact", 24, { "inserter:1": [window(0, 3)] });
    const per_hand = part("staged, per hand", 24, { "inserter:1": [window(2, 2)] }, { counted: undefined });
    const counted_per_hand = part("compact, per hand", 24, { "inserter:1": [window(2, 2)] });

    it("lists the stable alternatives first, then the ways, each set of windows once, a counted one before one not yet counted", () => {
        const input = coordinatedSourcesInputOf([{ parts: [way, per_hand] }, null, { parts: [stable, unstable, same_way], also: [{ parts: [counted_per_hand] }] }], "planned-belt-slack");
        expect(input.recommended_id).toBe("planned-belt-slack");
        expect(input.parts.map(it => it.name)).toEqual(["planned-belt-slack", "staged", "compact, per hand"]);
    });

    it("keeps the recommended clock though it is not stable", () => {
        expect(coordinatedSourcesInputOf([{ parts: [stable, unstable] }], "swings-2").parts.map(it => it.name)).toEqual(["planned-belt-slack", "swings-2"]);
    });

    it("keys a part by its period and its windows, in the order of the inserters' ids", () => {
        expect(partKey(part("a", 24, { "inserter:2": [window(1, 1)], "inserter:1": [window(0, 0)], "inserter:3": [] })))
            .toBe(partKey(part("b", 24, { "inserter:1": [window(0, 0)], "inserter:2": [window(1, 1)] })));
        expect(partKey(part("a", 24, { "inserter:1": [window(0, 0)] }))).not.toBe(partKey(part("a", 48, { "inserter:1": [window(0, 0)] })));
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
        const input = coordinatedSourcesInputOf([{ alternatives: [{ id: "exhaust", strategy: { id: "exhaust", tuning_method: "calculated" } as ClockStrategy }], parts: [alternative, way] }], "exhaust");
        expect(input.parts.map(it => it.strategy)).toEqual([{ id: "exhaust", tuning_method: "calculated" }, { id: "round_robin_polling", tuning_method: "calculated" }]);
    });
});
