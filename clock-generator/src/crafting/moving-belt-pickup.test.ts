import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { Config } from "../config";
import { simulateRecording } from "../verification/simulated-recording";
import { outputPerPeriod, recipesMaking } from "../harness/recording-output";
import { SimulationContext } from "./sequence/simulation-context";
import { cloneSimulationContextWithInterceptors } from "./sequence/simulation-context";
import { AlwaysEnabledControl } from "../control-logic";
import { EntityState } from "../state";

const SAMPLE = path.resolve(__dirname, "../../resources/config-samples/science/electromagnetic-science/belted-moving/config.json");
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
        const source = context.state_registry.getAllStates().find(state => EntityState.isBelt(state) && state.pickup_lanes.size > 0)!;
        expect(EntityState.isBelt(source)).toBe(true);
        if (!EntityState.isBelt(source)) throw new Error("no input lane");
        const lane = [...source.pickup_lanes.values()][0][0];
        lane.take(0, 4);
        lane.take(1, 4);
        cloneSimulationContextWithInterceptors(context, { inserter: () => AlwaysEnabledControl });
        expect([...source.pickup_lanes.values()][0][0]).toBe(lane);
        expect(lane.take(2, 4)).toBe(0);
    });

    it("finds missed output hands when reachable input stacks replace the infinite pickup supply", () => {
        const counts = outputCounts(config);
        expect(Math.min(...counts)).toBeLessThan(528);
        expect(counts.has(528)).toBe(true);
    });

    it("retains the recorded backed-up behavior when the config says its input belts do not move", () => {
        expect(outputCounts({ ...config, overrides: { ...config.overrides, non_moving_belts: true } })).toEqual(new Set([528]));
    });

    it("does not silently invent pickup geometry for legacy configs", () => {
        const legacy = { ...config, inserters: config.inserters.map(inserter => {
            if (inserter.source.type !== "belt") return inserter;
            const { pickup_length: _length, ...source } = inserter.source;
            void _length;
            return { ...inserter, source };
        }) };
        expect(outputCounts(legacy)).toEqual(new Set([528]));
        expect(SimulationContext.fromConfig(legacy).inserters.every(i => i.inserter_state.inserter.pickup_length === undefined)).toBe(true);
    });
});
