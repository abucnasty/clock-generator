import { describe, expect, test } from "vitest";
import { machineGroups, matchCopies } from "./entity-copies";
import { parseRecording } from "./recording";
import { Config } from "../config";

type End = { type: "machine" | "belt" | "chest"; id: number };
const samples = { held_count: [], held_item: [], status: [] };
const machineSamples = { status: [], crafting_progress: [], bonus_progress: [], products_finished: [], inputs: {}, outputs: {} };

/** A build as a recorder describes it: machines (id, recipe) and inserters (source, sink) over two shared belts */
function build(machines: [number, string][], inserters: [End, End][], result_targets?: [number, End][]) {
    return parseRecording({
        format: "clock-generator-recording",
        version: 1,
        start_game_tick: 0,
        sample_count: 0,
        config: {
            ...(result_targets && { machines: result_targets.map(([id, result_target]) => ({ id, result_target })) }),
            inserters: inserters.map(([source, sink]) => ({ source, sink, stack_size: 1 })),
            belts: [
                { id: 1, lanes: [{ ingredient: "ore" }, { ingredient: "ore" }] },
                { id: 2, lanes: [{ ingredient: "gear" }] },
            ],
        },
        machines: machines.map(([id, recipe]) => ({ id, name: "assembling-machine-3", recipe, samples: machineSamples })),
        inserters: inserters.map(([source, sink], index) => ({ id: index + 1, name: "inserter", source, sink, stack_size: 1, samples })),
    });
}

const machine = (id: number): End => ({ type: "machine", id });
const belt = (id: number): End => ({ type: "belt", id });
const chest = (id: number): End => ({ type: "chest", id });

/** One copy: machine `a` makes gears from ore on belt 1 and hands them to `b`, which puts the product on belt 2 */
const copy = (a: number, b: number): [End, End][] => [[belt(1), machine(a)], [machine(a), machine(b)], [machine(b), belt(2)]];

const config = {
    target_output: { recipe: "product", items_per_second: 1, copies: 2 },
    machines: [
        { id: 1, recipe: "gear", productivity: 0, crafting_speed: 1 },
        { id: 2, recipe: "product", productivity: 0, crafting_speed: 1 },
    ],
    inserters: [
        { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 } },
        { id: 2, source: { type: "machine", id: 1 }, sink: { type: "machine", id: 2 } },
        { id: 3, source: { type: "machine", id: 2 }, sink: { type: "belt", id: 2 } },
    ],
    belts: [
        { id: 1, type: "transport-belt", lanes: [{ ingredient: "ore" }, { ingredient: "ore" }] },
        { id: 2, type: "transport-belt", lanes: [{ ingredient: "gear" }] },
    ],
    chests: [],
} as unknown as Config;

const gears = [[1, "gear"], [2, "product"], [3, "gear"], [4, "product"], [5, "gear"], [6, "product"]] as [number, string][];

describe("the groups of machines of a build", () => {
    test("machines that inserters move items between are one group, and a shared belt does not join groups", () => {
        const groups = machineGroups(build(gears.slice(0, 4), [...copy(1, 2), ...copy(3, 4)]));
        expect(groups.map(group => group.machines.map(m => m.id))).toEqual([[1, 2], [3, 4]]);
        expect(groups.map(group => group.inserters.length)).toEqual([3, 3]);
    });

    test("a chest between machines joins them", () => {
        const groups = machineGroups(build(gears.slice(0, 3), [[machine(1), chest(9)], [chest(9), machine(2)], [belt(1), machine(3)]]));
        expect(groups.map(group => group.machines.map(m => m.id))).toEqual([[1, 2], [3]]);
    });

    test("direct machine result targets join copies by recorded id, regardless of metadata order", () => {
        const groups = machineGroups(build(gears.slice(0, 4), [
            [belt(1), machine(1)], [machine(2), belt(2)], [belt(1), machine(3)], [machine(4), belt(2)],
        ], [[3, machine(4)], [1, machine(2)]]));
        expect(groups.map(group => group.machines.map(m => m.id))).toEqual([[1, 2], [3, 4]]);
        expect(groups.map(group => group.inserters.length)).toEqual([2, 2]);
    });

    test("a direct chest result target joins the inserters that carry its results onward", () => {
        const groups = machineGroups(build(gears.slice(0, 4), [
            [belt(1), machine(1)], [chest(9), machine(2)], [machine(2), belt(2)],
            [belt(1), machine(3)], [chest(10), machine(4)], [machine(4), belt(2)],
        ], [[1, chest(9)], [3, chest(10)]]));
        expect(groups.map(group => group.machines.map(m => m.id))).toEqual([[1, 2], [3, 4]]);
        expect(groups.map(group => group.inserters.length)).toEqual([3, 3]);
    });

    test("machines placing their results into the same chest belong to one group", () => {
        const groups = machineGroups(build(gears.slice(0, 2), [
            [belt(1), machine(1)], [machine(2), belt(2)],
        ], [[1, chest(9)], [2, chest(9)]]));
        expect(groups.map(group => group.machines.map(m => m.id))).toEqual([[1, 2]]);
    });

    test("metadata for machines outside the recording cannot join its groups", () => {
        const groups = machineGroups(build([[1, "gear"], [3, "product"]], [
            [belt(1), machine(1)], [machine(3), belt(2)],
        ], [[1, machine(2)], [2, machine(3)]]));
        expect(groups.map(group => group.machines.map(m => m.id))).toEqual([[1], [3]]);
    });

    test("the groups come in the order of their lowest machine ids, whatever order the build lists them in", () => {
        const groups = machineGroups(build([[4, "product"], [3, "gear"], [2, "product"], [1, "gear"]], [...copy(3, 4), ...copy(1, 2)]));
        expect(groups.map(group => Math.min(...group.machines.map(m => m.id)))).toEqual([1, 3]);
    });
});

describe("matching a build that holds the config more than once", () => {
    test.each(["machine", "chest"] as const)("matches repeated direct-result %s paths as complete copies", type => {
        const through_chest = type === "chest";
        const ends = (a: number, b: number): [End, End][] => [
            [belt(1), machine(a)],
            ...(through_chest ? [[chest(a), machine(b)] as [End, End]] : []),
            [machine(b), belt(2)],
        ];
        const configured = { ...config,
            machines: config.machines.map(m => m.id === 1 ? { ...m, result_target: { type, id: through_chest ? 1 : 2 } } : m),
            inserters: [config.inserters[0],
                ...(through_chest ? [{ ...config.inserters[1], source: chest(1) }] : []), config.inserters[2]],
        } as Config;
        const recording = build(gears.slice(0, 4), [...ends(1, 2), ...ends(3, 4)], [
            [1, through_chest ? chest(1) : machine(2)], [3, through_chest ? chest(3) : machine(4)],
        ]);
        const result = matchCopies(recording, configured);
        expect(result.copies).toHaveLength(2);
        expect(result.copies.map(copy => copy.machines.size)).toEqual([2, 2]);
        expect(result.copies.map(copy => copy.inserters.size)).toEqual(through_chest ? [3, 3] : [2, 2]);
        expect(result.merged.unmatched_recorded_machines).toEqual([]);
        expect(result.merged.unmatched_recorded_inserters).toEqual([]);
    });

    test("three copies are matched one by one, each to the whole config", () => {
        const result = matchCopies(build(gears, [...copy(1, 2), ...copy(3, 4), ...copy(5, 6)]), config);
        expect(result.copies).toHaveLength(3);
        for (const [index, match] of result.copies.entries()) {
            const [a, b] = [1 + 2 * index, 2 + 2 * index];
            expect(match.machines.get(a)).toBe(1);
            expect(match.machines.get(b)).toBe(2);
            expect(match.inserters.size).toBe(3);
            expect(match.unmatched_config_inserters).toEqual([]);
        }
        expect(result.merged.machines.size).toBe(6);
        expect(result.merged.inserters.size).toBe(9);
        expect(result.merged.unmatched_recorded_machines).toEqual([]);
        expect(result.merged.unmatched_recorded_inserters).toEqual([]);
    });

    test("a build of the config once is matched as it always was", () => {
        const result = matchCopies(build(gears.slice(0, 2), copy(1, 2)), config);
        expect(result.copies).toHaveLength(1);
        expect(result.merged).toBe(result.copies[0]);
        expect(result.merged.inserters.size).toBe(3);
    });

    test("machines that are no copy are left unmatched, as are the inserters on them", () => {
        // a third gear machine on the ore belt with nothing to hand its gears to
        const recording = build([...gears.slice(0, 4), [5, "gear"]], [...copy(1, 2), ...copy(3, 4), [belt(1), machine(5)]]);
        const result = matchCopies(recording, config);
        expect(result.copies).toHaveLength(2);
        expect(result.merged.unmatched_recorded_machines).toEqual([5]);
        expect(result.merged.unmatched_recorded_inserters).toEqual([7]);
    });

    test("one copy and a stray machine is no copies: the build is matched whole", () => {
        const recording = build([...gears.slice(0, 2), [5, "gear"]], [...copy(1, 2), [belt(1), machine(5)]]);
        const result = matchCopies(recording, config);
        expect(result.copies).toHaveLength(1);
        expect(result.merged.unmatched_recorded_machines).toEqual([5]);
    });

    test("a copy with a machine short is not counted a copy", () => {
        const result = matchCopies(build([...gears.slice(0, 2), [3, "gear"]], [...copy(1, 2), [belt(1), machine(3)]]), config);
        expect(result.copies).toHaveLength(1);
    });
});
