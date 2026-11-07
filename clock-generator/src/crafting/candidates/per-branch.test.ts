import { describe, expect, it } from "vitest";
import { partGroups, tiledWindows, upstreamOrder, type GroupedInserter } from "./per-branch";
import { collectingParts, offerPart, partKey, partsWanted, perBranchInputOf, type PerBranchPart } from "./per-branch-parts";

const window = (start: number, end: number) => ({ start, end });

/** A machine fed from a belt, its product taken by a second machine, whose product goes onto a belt */
const CHAIN: GroupedInserter[] = [
    { id: "inserter:1", source: "belt:1", sink: "machine:1" },
    { id: "inserter:2", source: "machine:1", sink: "machine:2" },
    { id: "inserter:3", source: "machine:1", sink: "machine:2" },
    { id: "inserter:4", source: "machine:2", sink: "belt:2" },
];

const part = (name: string, period_ticks: number, windows: PerBranchPart["windows"], extra: Partial<PerBranchPart> = {}): PerBranchPart =>
    ({ name, period_ticks, windows, counted: true, ...extra });

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
        // on half the period: repeated, other windows for every group, and inserter 1 left always enabled
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

describe("the input of the per-branch clock", () => {
    const stable = part("planned-belt-slack", 24, { "inserter:1": [window(0, 3)] }, { alternative_id: "planned-belt-slack", verdict: "stable" });
    const unstable = part("swings-2", 48, { "inserter:1": [window(0, 7)] }, { alternative_id: "swings-2", verdict: "unstable" });
    const way = part("staged", 24, { "inserter:1": [window(1, 3)] }, { counted: false });
    const same_way = part("compact", 24, { "inserter:1": [window(0, 3)] });
    const per_hand = part("staged, per hand", 24, { "inserter:1": [window(2, 2)] }, { counted: undefined });
    const counted_per_hand = part("compact, per hand", 24, { "inserter:1": [window(2, 2)] });

    it("lists the stable alternatives first, then the ways, each set of windows once, a counted one before one not yet counted", () => {
        const input = perBranchInputOf([{ parts: [way, per_hand] }, null, { parts: [stable, unstable, same_way], also: [{ parts: [counted_per_hand] }] }], "planned-belt-slack");
        expect(input.recommended_id).toBe("planned-belt-slack");
        expect(input.parts.map(it => it.name)).toEqual(["planned-belt-slack", "staged", "compact, per hand"]);
    });

    it("keeps the recommended clock though it is not stable", () => {
        expect(perBranchInputOf([{ parts: [stable, unstable] }], "swings-2").parts.map(it => it.name)).toEqual(["planned-belt-slack", "swings-2"]);
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
