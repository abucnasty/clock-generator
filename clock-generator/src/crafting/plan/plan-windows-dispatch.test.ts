import {describe, expect, test, vi} from "vitest";
import type {Config} from "../../config";
import {ConfigPaths} from "../../config/config-paths";
import {loadConfigFromFile} from "../../config/loader";
import {ACTIVATION_ORDER, InserterDispatch} from "../../simulation/dispatch";
import {SimulationContext} from "../sequence/simulation-context";
import {planRun} from "./plan-run";

/** The windows the planning run reads off a build, every run of it made under `dispatch` */
function plannedWindows(config: Config, dispatch: InserterDispatch): Record<string, string[]> {
    const fromConfig = SimulationContext.fromConfig.bind(SimulationContext);
    const spy = vi.spyOn(SimulationContext, "fromConfig").mockImplementation(config => {
        const context = fromConfig(config);
        context.inserter_dispatch = dispatch;
        return context;
    });
    try {
        const windows = planRun(config).unslacked_windows;
        return Object.fromEntries([...windows].sort(([a], [b]) => a.localeCompare(b))
            .map(([id, ranges]) => [id, ranges.map(range => `${range.start_inclusive}-${range.end_inclusive}`)]));
    } finally {
        spy.mockRestore();
    }
}

/**
 * The order the game updates inserters in (the new dispatch) moves no planned window by itself. A belt-fed hand that
 * waited at its machine's output block takes its first stack a tick after another inserter took the products down
 * under both dispatches, and its window opens at the take under both (utility science: 37 and 6923 within the period,
 * not 38); a control swap at the plan's start puts the hands on the list without waking them, so the belt hand asleep
 * at its full assembler takes its first stack when it does under the configured order (automation science).
 */
describe("planned windows under both dispatches", () => {
    test.each([["utility science", ConfigPaths.UTILITY_SCIENCE], ["automation science", ConfigPaths.AUTOMATION_SCIENCE]])("%s", async (_, path) => {
        const config = await loadConfigFromFile(path);
        expect(plannedWindows(config, ACTIVATION_ORDER)).toEqual(plannedWindows(config, "configured-order"));
    });
});
