import {describe, expect, test, vi} from "vitest";
import type {Config} from "../../config";
import {ConfigPaths} from "../../config/config-paths";
import {loadConfigFromFile} from "../../config/loader";
import {ACTIVATION_ORDER, InserterDispatch} from "../../simulation/dispatch";
import {SimulationContext} from "../sequence/simulation-context";
import {generateClockForConfig} from "../generate-clock";
import {planRun} from "./plan-run";

/** What `make` returns with every run it makes under `dispatch` */
function underDispatch<T>(dispatch: InserterDispatch, make: () => T): T {
    const fromConfig = SimulationContext.fromConfig.bind(SimulationContext);
    const spy = vi.spyOn(SimulationContext, "fromConfig").mockImplementation(config => {
        const context = fromConfig(config);
        context.inserter_dispatch = dispatch;
        return context;
    });
    try {
        return make();
    } finally {
        spy.mockRestore();
    }
}

/** The windows the planning run reads off a build, every run of it made under `dispatch` */
function plannedWindows(config: Config, dispatch: InserterDispatch): Record<string, string[]> {
    const windows = underDispatch(dispatch, () => planRun(config).unslacked_windows);
    return Object.fromEntries([...windows].sort(([a], [b]) => a.localeCompare(b))
        .map(([id, ranges]) => [id, ranges.map(range => `${range.start_inclusive}-${range.end_inclusive}`)]));
}

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

/**
 * One electromagnetic plant fed from a backed-up turbo belt by one inserter and emptied onto a belt by another, at
 * 30 a second, with 3 output hands a cycle (the build of the turbo pickup and front-exit samples).
 */
const ELECTROMAGNETIC_TURBO_BACKED: Config = {
    target_output: { recipe: "electromagnetic-science-pack", items_per_second: 30, copies: 1 },
    machines: [{ id: 1, recipe: "electromagnetic-science-pack", productivity: 175, crafting_speed: 109.475, prototype: "electromagnetic-plant" }],
    inserters: [
        { id: 1, source: { type: "machine", id: 1 }, sink: { type: "belt", id: 1 }, stack_size: 16 },
        { id: 2, source: { type: "belt", id: 2, near_lane: 1, pickup_length: 1, pickup_layout: "side-straight" }, sink: { type: "machine", id: 1 }, stack_size: 16 },
    ],
    belts: [
        { id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "electromagnetic-science-pack", stack_size: 4 }, { ingredient: "", stack_size: 4 }] },
        { id: 2, type: "turbo-transport-belt", lanes: [{ ingredient: "accumulator", stack_size: 4 }, { ingredient: "supercapacitor", stack_size: 4 }] },
    ],
    chests: [],
    overrides: { backed_up_belts: true, terminal_swing_count: 3 },
} as Config;

/**
 * The windows planned under the order the game updates inserters in, which are those the planning run had read under the
 * configured order before it. A belt-fed hand that waited at its machine's output block takes its first stack a tick after
 * another inserter took the products down, and its window opens at the take (utility science: 37 and 6923 within the
 * period, not 38); a control swap at the plan's start puts the hands on the list without waking them, so the belt hand
 * asleep at its full assembler takes its first stack when it did under the configured order (automation science).
 */
describe("planned windows", () => {
    test.each([
        ["utility science", ConfigPaths.UTILITY_SCIENCE, {
            "inserter:1": ["37-46", "181-190", "373-382", "517-526"],
            "inserter:2": ["37-57", "181-201", "373-393", "517-537"],
            "inserter:3": ["1-49", "169-193", "337-385", "505-529"],
        }],
        ["automation science", ConfigPaths.AUTOMATION_SCIENCE, { "inserter:1": ["60-90"], "inserter:2": ["1-54"] }],
    ])("%s", async (_, path, windows) => {
        expect(plannedWindows(await loadConfigFromFile(path), ACTIVATION_ORDER)).toEqual(windows);
    });
});

/**
 * Under the new dispatch, where the plan's clock fails as built because a window opens at the take that freed its hand
 * (the clock reaches that window without the block and the hand acts a tick early, one output hand short over the long
 * run), the clock of the same plan with the pickup counted from its entry is made instead, and it holds.
 */
test("a clock whose window from the take fails is made with the pickup from its entry", () => {
    const made = underDispatch(ACTIVATION_ORDER, () => generateClockForConfig(ELECTROMAGNETIC_TURBO_BACKED,
        { logger: quiet, verify_as_built: true, belt_pickup_slack: "always" }));
    expect(made.stability_check.as_built?.holds).toBe(true);
    expect(made.clock_windows["inserter:2"]?.map(range => `${range.start}-${range.end}`)).toContain("314-333");
});
