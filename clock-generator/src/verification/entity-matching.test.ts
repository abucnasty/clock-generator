import { describe, expect, test } from "vitest";
import { matchRecordingToConfig } from "./entity-matching";
import { parseRecording } from "./recording";
import { Config } from "../config";

/** A build of one machine fed from a belt of two items and emptied onto a belt, as a recorder describes it */
function recordingOf(filters: string[] | undefined) {
    return parseRecording({
        format: "clock-generator-recording",
        version: 1,
        start_game_tick: 0,
        sample_count: 0,
        config: {
            machines: [{ id: 1, recipe: "automation-science-pack" }],
            inserters: [
                { source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16, filters },
                { source: { type: "machine", id: 1 }, sink: { type: "belt", id: 2 }, stack_size: 16, filters },
            ],
            belts: [
                { id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 4 }, { ingredient: "copper-plate", stack_size: 4 }] },
                { id: 2, type: "turbo-transport-belt", lanes: [{ ingredient: "automation-science-pack", stack_size: 4 }] },
            ],
        },
        machines: [{ id: 1, name: "assembling-machine-3", recipe: "automation-science-pack", samples: { status: [], crafting_progress: [], bonus_progress: [], products_finished: [], inputs: {}, outputs: {} } }],
        inserters: [
            { id: 1, name: "stack-inserter", source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16, samples: { held_count: [], held_item: [], status: [] } },
            { id: 2, name: "stack-inserter", source: { type: "machine", id: 1 }, sink: { type: "belt", id: 2 }, stack_size: 16, samples: { held_count: [], held_item: [], status: [] } },
        ],
    });
}

const config = {
    target_output: { recipe: "automation-science-pack", items_per_second: 240, copies: 9 },
    machines: [{ id: 1, recipe: "automation-science-pack", productivity: 0, crafting_speed: 1, type: "machine" }],
    inserters: [
        { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16, filters: ["copper-plate", "iron-gear-wheel"] },
        { id: 2, source: { type: "machine", id: 1 }, sink: { type: "belt", id: 2 }, stack_size: 16, filters: ["automation-science-pack"] },
    ],
    belts: [
        { id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "copper-plate", stack_size: 4 }, { ingredient: "iron-gear-wheel", stack_size: 4 }] },
        { id: 2, type: "turbo-transport-belt", lanes: [{ ingredient: "automation-science-pack", stack_size: 4 }] },
    ],
    chests: [],
} as unknown as Config;

describe("matching a build to a config whose inserters name their items", () => {
    test("a build inserter with the same filters is matched on them", () => {
        const match = matchRecordingToConfig(recordingOf(["copper-plate", "iron-gear-wheel"]), config);
        expect(match.inserters.get(1)).toBe(1);
    });

    test("a build inserter without filters on the same endpoints is matched too", () => {
        const match = matchRecordingToConfig(recordingOf(undefined), config);
        expect(match.inserters.get(1)).toBe(1);
        expect(match.inserters.get(2)).toBe(2);
        expect(match.unmatched_config_inserters).toEqual([]);
    });
});

describe("matching machines that stand alike in the structure", () => {
    const samples = { status: [], crafting_progress: [], bonus_progress: [], products_finished: [], inputs: {}, outputs: {} };
    const held = { held_count: [], held_item: [], status: [] };
    const belts = [
        { id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "copper-plate", stack_size: 4 }] },
        { id: 2, type: "turbo-transport-belt", lanes: [{ ingredient: "automation-science-pack", stack_size: 4 }] },
    ];
    /** Two machines that each take from belt 1 and give to belt 2; machine `i` of the list stands at the place given */
    const unit = (places: { x: number; y: number }[]) => [1, 2].flatMap(id => [
        { id: 2 * id - 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id }, stack_size: 16, position: places[id - 1] },
        { id: 2 * id, source: { type: "machine", id }, sink: { type: "belt", id: 2 }, stack_size: 16, position: places[id - 1] },
    ]);
    const machinesAt = (places: { x: number; y: number }[]) => [1, 2].map(id => ({ id, recipe: "automation-science-pack", position: places[id - 1] }));

    test("the order that keeps the layout is taken, whatever the shift of the build", () => {
        const built = [{ x: 410, y: 0 }, { x: 410, y: 5 }];
        const recording = parseRecording({
            format: "clock-generator-recording", version: 1, start_game_tick: 0, sample_count: 0,
            config: { machines: machinesAt(built), inserters: unit(built), belts },
            machines: [1, 2].map(id => ({ id, name: "assembling-machine-3", recipe: "automation-science-pack", samples })),
            inserters: unit(built).map(inserter => ({ ...inserter, name: "stack-inserter", samples: held })),
        });
        // the config lists the machine that stands south first: in id order the build's machines would be matched crosswise
        const placed = [{ x: -3, y: 5 }, { x: -3, y: 0 }];
        const laid = { ...config, machines: machinesAt(placed).map(machine => ({ ...config.machines[0], ...machine })), inserters: unit(placed), belts } as unknown as Config;
        const match = matchRecordingToConfig(recording, laid);
        expect(match.machines.get(1)).toBe(2);
        expect(match.machines.get(2)).toBe(1);
        expect(match.inserters.get(2)).toBe(4);
        // without places the first order that matches every inserter is kept
        const bare = { ...laid, machines: laid.machines.map(({ position: _p, ...machine }) => machine) } as unknown as Config;
        expect(matchRecordingToConfig(recording, bare).machines.get(1)).toBe(1);
    });
});

describe("matching inserters that take from chests of different types into one machine", () => {
    // the ore voider's recycler cell: two inserters bring ore back from a car, four bring it in from infinity chests, all
    // into the recycler; in the config all six name iron ore, in the build only the four do
    const samples = { status: [], crafting_progress: [], bonus_progress: [], products_finished: [], inputs: {}, outputs: {} };
    const held = { held_count: [], held_item: [], status: [] };
    const recycler = { id: 1, recipe: "iron-ore-recycling" };
    const built_inserters = [
        { source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16 },
        { source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 16 },
        ...[2, 3, 4, 5].map(id => ({ source: { type: "chest", id }, sink: { type: "machine", id: 1 }, stack_size: 16, filters: ["iron-ore"] })),
    ];
    const recording = parseRecording({
        format: "clock-generator-recording", version: 1, start_game_tick: 0, sample_count: 0,
        config: { machines: [recycler], inserters: built_inserters, belts: [],
            chests: [{ type: "car", id: 1 }, ...[2, 3, 4, 5].map(id => ({ type: "infinity-chest", id }))] },
        machines: [{ ...recycler, name: "recycler", samples }],
        inserters: built_inserters.map((inserter, index) => ({ ...inserter, id: index + 1, name: "stack-inserter", samples: held })),
    });
    const voider = {
        target_output: { recipe: "iron-ore", items_per_second: 400, copies: 1, counts: "destroyed" },
        machines: [{ ...recycler, productivity: 0, crafting_speed: 16.875, prototype: "recycler", result_target: { type: "chest", id: 1 } }],
        inserters: [1, 2, 3, 4, 5, 6].map(id => ({ id, source: { type: "chest", id: id <= 2 ? 1 : 2 }, sink: { type: "machine", id: 1 }, stack_size: 16, filters: ["iron-ore"] })),
        belts: [],
        chests: [{ type: "car", id: 1 }, { type: "infinity-chest", id: 2, item_filter: [{ item_name: "iron-ore", request_count: 1000 }] }],
    } as unknown as Config;

    test("an inserter from the car is the config's inserter from the car, filters or not", () => {
        const match = matchRecordingToConfig(recording, voider);
        expect([1, 2].map(id => match.inserters.get(id)).sort()).toEqual([1, 2]);
        expect([3, 4, 5, 6].map(id => match.inserters.get(id)).sort()).toEqual([3, 4, 5, 6]);
    });

    test("chests the recording names no type of are any chest, as before", () => {
        const untyped = parseRecording({ ...JSON.parse(JSON.stringify(recording)), config: { ...recording.config, chests: undefined } });
        expect(matchRecordingToConfig(untyped, voider).inserters.size).toBe(6);
    });
});
