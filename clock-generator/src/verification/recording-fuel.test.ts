import { describe, expect, it } from "vitest";
import { parseRecording } from "./recording";
import { machineStatuses } from "./recording-history";

const recording = (machine_samples: object) => ({
    format: "clock-generator-recording",
    version: 1,
    start_game_tick: 0,
    sample_count: 4,
    config: { inserters: [], belts: [] },
    inserters: [],
    machines: [{
        id: 1, name: "biochamber", recipe: "nutrients-from-yumako-mash",
        samples: {
            status: [[0, "working"], [2, "no_fuel"]],
            crafting_progress: [0, 0.5, 0.5, 0.5],
            bonus_progress: [0, 0, 0, 0],
            products_finished: [0, 0, 0, 0],
            inputs: { "yumako-mash": [4, 0, 0, 4] },
            outputs: { nutrients: [0, 0, 0, 0] },
            ...machine_samples,
        },
    }],
});

describe("recordings of burner machines", () => {
    it("carries the fuel slot and what is being burned", () => {
        const parsed = parseRecording(recording({
            fuel: { nutrients: [2, 2, 1, 0] },
            burning_remaining: [2, 1.5, 1, 0],
            currently_burning: [[0, "nutrients"], [3, ""]],
        }));
        const samples = parsed.machines[0].samples;
        expect(samples.fuel).toEqual({ nutrients: [2, 2, 1, 0] });
        expect(samples.burning_remaining).toEqual([2, 1.5, 1, 0]);
        expect(samples.currently_burning).toEqual([[0, "nutrients"], [3, ""]]);
    });

    it("still reads recordings without fuel samples", () => {
        const parsed = parseRecording(recording({}));
        expect(parsed.machines[0].samples.fuel).toBeUndefined();
    });

    it("counts a machine out of fuel as waiting, like the simulator", () => {
        const parsed = parseRecording(recording({}));
        expect(machineStatuses(parsed.machines[0], 4)).toEqual(["WORKING", "WORKING", "INGREDIENT_SHORTAGE", "INGREDIENT_SHORTAGE"]);
    });
});
