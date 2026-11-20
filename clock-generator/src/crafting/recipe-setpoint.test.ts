import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/loader";
import { maxSwingsOfPreparedBuild } from "./plan/unclocked-run";
import { PrepareStep } from "./runner/steps/prepare-step";
import { SimulationContext } from "./sequence/simulation-context";
import { targetItemOf } from "./sequence/cycle/target-ends";

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

/**
 * One biochamber on jellynut-processing with an inserter for each of its two ingredients (the jellynut and the nutrients
 * that fuel it), one that puts the jelly on a belt and one that puts the seed it also makes on another
 */
function jellynutBuild(setpoint_recipe: string, counts?: "made" | "destroyed"): string {
    const supply = (id: number, ingredient: string) => ({ id, type: "transport-belt", flow_direction: 0,
        lanes: [{ ingredient, stack_size: 1, lane_end: { kind: "unknown" } }, { ingredient, stack_size: 1, lane_end: { kind: "unknown" } }] });
    return JSON.stringify({
        setpoint: { recipe: setpoint_recipe, items_per_second: 1, copies: 1, ...(counts === undefined ? {} : { counts }) },
        machines: [{ id: 1, recipe: "jellynut-processing", productivity: 0, crafting_speed: 2, prototype: "biochamber" }],
        inserters: [
            { id: 1, source: { type: "belt", id: 3, pickup_length: 1 }, sink: { type: "machine", id: 1 }, stack_size: 1 },
            { id: 2, source: { type: "belt", id: 4, pickup_length: 1 }, sink: { type: "machine", id: 1 }, stack_size: 1 },
            { id: 3, source: { type: "machine", id: 1 }, sink: { type: "belt", id: 1 }, stack_size: 1, filters: ["jelly"] },
            { id: 4, source: { type: "machine", id: 1 }, sink: { type: "belt", id: 2 }, stack_size: 1, filters: ["jellynut-seed"] },
        ],
        belts: [
            { id: 1, type: "transport-belt", lanes: [{ ingredient: "jelly", stack_size: 1 }, { ingredient: "jelly", stack_size: 1 }] },
            { id: 2, type: "transport-belt", lanes: [{ ingredient: "jellynut-seed", stack_size: 1 }] },
            supply(3, "jellynut"),
            supply(4, "nutrients"),
        ],
        chests: [],
    });
}

describe("a setpoint named by a recipe", () => {
    it("finds the machines that make the recipe's main product", async () => {
        const config = await parseConfig(jellynutBuild("jellynut-processing"));
        const context = SimulationContext.fromConfig(config);
        new PrepareStep(context).execute();
        expect(() => maxSwingsOfPreparedBuild(config, context, quiet, false)).not.toThrow();
        expect(targetItemOf(config.setpoint).item).toBe("jelly");
    });

    it("finds the same machines as a setpoint named by the item", async () => {
        const config = await parseConfig(jellynutBuild("jelly"));
        const context = SimulationContext.fromConfig(config);
        new PrepareStep(context).execute();
        expect(() => maxSwingsOfPreparedBuild(config, context, quiet, false)).not.toThrow();
        expect(targetItemOf(config.setpoint).item).toBe("jelly");
    });
});
