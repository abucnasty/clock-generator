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
