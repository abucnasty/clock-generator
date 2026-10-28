import { GameFixturePaths } from "../../tests/game/helpers/fixture-paths";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { Config } from "../config";
import { simulateRecording } from "../verification/simulated-recording";
import { outputPerPeriod, recipesMaking } from "../harness/recording-output";
import { SimulationContext } from "./sequence/simulation-context";
import { AlwaysEnabledControl } from "../control-logic";
import { EntityState } from "../state";

const SAMPLE = GameFixturePaths.DIFFERENT_ITEMS_CONFIG;
// The old default from 0.17.0: measured at 480–528 instead of 528 per period on both moving underground endpoints.
const OLD_WINDOWS = {
    "inserter:1": Array.from({ length: 11 }, (_, k) => ({ start: 1 + 96 * k, end: 37 + 96 * k })),
    "inserter:2": [[13, 51], [109, 147], [217, 244], [301, 339], [346, 362], [409, 425], [434, 461],
        [521, 548], [609, 636], [697, 724], [793, 820], [889, 916], [985, 1012]].map(([start, end]) => ({ start, end })),
};
let config: Config;
beforeAll(async () => { config = await loadConfigFromFile(SAMPLE); });

function outputCounts(config: Config): Set<number> {
    const recording = simulateRecording(config, OLD_WINDOWS, 1056, 36_960);
    return new Set(outputPerPeriod(recording, recipesMaking(config, config.target_output.recipe)).slice(-20).map(p => p.items));
}

describe("moving pickup affects the verdict of the old default clock", () => {
    it("keeps pickup holes when the runner replaces inserter controls", () => {
        const context = SimulationContext.fromConfig(config);
        const source = context.state_registry.getAllStates().find(state => EntityState.isBelt(state) && [...state.lanes[0].pickupIds()].length > 0)!;
        expect(EntityState.isBelt(source)).toBe(true);
        if (!EntityState.isBelt(source)) throw new Error("no input lane");
        const id = [...source.lanes[0].pickupIds()][0];
        const lane = source.pickupsOf(id)![0];
        lane.take(0, 4);
        lane.take(1, 4);
        context.useControls({ inserter: () => AlwaysEnabledControl });
        expect(source.pickupsOf(id)![0]).toBe(lane);
        expect(lane.take(2, 4)).toBe(0);
    });

    it("finds missed output hands when reachable input stacks replace the infinite pickup supply", () => {
        const counts = outputCounts(config);
        expect(Math.min(...counts)).toBeLessThan(528);
        expect(counts.has(528)).toBe(true);
    });

    it("retains the recorded backed-up behavior when the config says its input belts are backed up", () => {
        expect(outputCounts({ ...config, overrides: { ...config.overrides, backed_up_belts: true } })).toEqual(new Set([528]));
    });

    it("uses straight-belt timing for omitted geometry, including direct unparsed engine inputs", () => {
        const omitted = { ...config, inserters: config.inserters.map(inserter => {
            if (inserter.source.type !== "belt") return inserter;
            const { pickup_length: _length, pickup_layout: _layout, ...source } = inserter.source;
            void _length;
            return { ...inserter, source };
        }) };
        const straight: Config = { ...omitted, inserters: omitted.inserters.map(inserter => inserter.source.type === "belt"
            ? { ...inserter, source: { ...inserter.source, pickup_length: 1, pickup_layout: "side-straight" } } : inserter) };
        expect(outputCounts(omitted)).toEqual(outputCounts(straight));
        const input = SimulationContext.fromConfig(omitted).inserters.find(i => i.inserter_state.inserter.source.entity_id.type === "belt")!;
        expect(input.inserter_state.inserter.pickup_length).toBe(1);
        expect(input.inserter_state.inserter.belt_supply).toBe("moving");
    });
});
