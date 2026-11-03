import {describe, expect, it, vi} from "vitest";
import {loadConfigFromFile} from "../../config/loader";
import {ConfigPaths} from "../../config/config-paths";
import {SimulationContext} from "../sequence/simulation-context";
import {quiet} from "../generate-blueprint-test-helpers";
import {planRun} from "./plan-run";

// every simulation of this file under the new dispatch (activation-order), as with CLOCK_NEW_DISPATCH=1
vi.mock("../../simulation/dispatch", async importOriginal => {
    const actual = await importOriginal<typeof import("../../simulation/dispatch")>();
    return {...actual, DEFAULT_INSERTER_DISPATCH: actual.ACTIVATION_ORDER};
});

async function plannedWindowsOf(path: string): Promise<Record<string, string[]>> {
    const config = await loadConfigFromFile(path);
    return Object.fromEntries([...planRun(config, {logger: quiet}).unslacked_windows]
        .map(([id, ranges]) => [id, ranges.map(range => `${range.start_inclusive}-${range.end_inclusive}`)]));
}

describe("the planning run under the new dispatch", () => {
    it("runs every other simulation under the new dispatch", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        expect(SimulationContext.fromConfig(config).inserter_dispatch).toMatchObject({kind: "activation-order"});
    });

    // The windows the configured order plans. Under the update list the plan's start (the controls swapped between two
    // ticks) woke the belt hand asleep on its full machine, which took its first items a tick early and set the crafts a
    // tick earlier against the period: 1-18 and 2-20, 38-55.
    it("plans automation science as under the configured order", async () => {
        expect(await plannedWindowsOf(ConfigPaths.AUTOMATION_SCIENCE)).toEqual({
            "inserter:1": ["1-19"],
            "inserter:2": ["2-21", "38-56"],
        });
    });

    // Under the update list the belt hands that wait for room slept through the tick the output hand made it and
    // started their pickup with their first items, a tick later than when updated every tick: 38-46 and 38-57.
    it("plans utility science as under the configured order", async () => {
        expect(await plannedWindowsOf(ConfigPaths.UTILITY_SCIENCE)).toEqual({
            "inserter:3": ["1-49", "169-193", "337-385", "505-529"],
            "inserter:1": ["37-46", "181-190", "373-382", "517-526"],
            "inserter:2": ["37-57", "181-201", "373-393", "517-537"],
        });
    });
});
