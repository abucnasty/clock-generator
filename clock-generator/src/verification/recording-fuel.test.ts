import { describe, expect, it } from "vitest";
import { parseRecording } from "./recording";
import { expandChangeList } from "./recording";
import { FactorioMachineState, MachineStatus } from "../state";
import { factorioMachineState } from "../state/factorio-entity-state";

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

    it("names a machine out of fuel as the game does, so a recording compares directly", () => {
        const parsed = parseRecording(recording({}));
        expect(expandChangeList(parsed.machines[0].samples.status, 4, "none")).toEqual(["working", "working", "no_fuel", "no_fuel"]);
        expect(factorioMachineState({ status: MachineStatus.NO_FUEL } as never)).toBe(FactorioMachineState.NO_FUEL);
    });
});
