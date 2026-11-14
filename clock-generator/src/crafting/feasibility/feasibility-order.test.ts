import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { TestConfigPaths } from "../../../tests/configs/paths";
import { describeFeasibilityIssue, FeasibilityError, InserterCoverageError } from "../../config/errors";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import { generateClockForConfig, validateConfig } from "../generate-blueprint";
import { computeMachineTargetRates } from "../machine-target-rates";
import { assertFeasible } from "./assert-feasible";
import { withTarget } from "./feasibility-test-helpers";

/** The three places a config is checked before any simulation: generation, validation and the at-target preview */
const CALL_SITES: [string, (config: Config) => unknown][] = [
    ["generation (recordedBuildOf)", config => generateClockForConfig(config)],
    ["validateConfig", config => validateConfig(config)],
    ["computeMachineTargetRates", config => computeMachineTargetRates(config)],
];

describe("the feasibility pass runs after the coverage check (D10)", async () => {
    // the refusal sample misses an inserter for its iron plates; at 1,000 accumulators a second its machine is far too slow too
    const uncovered = withTarget(await loadConfigFromFile(TestConfigPaths.BAD_ACCUMULATOR_CONFIG) as Config, 1000);
    // flying robot frames at 1,600 a second: covered, and its machine makes at most 3.44 crafts of 2 frames a second
    const over = withTarget(await loadConfigFromFile(ConfigPaths.FLYING_ROBOT_FRAME_80) as Config, 1600);

    it.each(CALL_SITES)("%s: a coverage gap and an over-target rate get the coverage error", (_site, run) => {
        expect(() => run(uncovered)).toThrow(InserterCoverageError);
    });

    it.each(CALL_SITES)("%s: an over-target rate alone gets the feasibility error", (_site, run) => {
        expect(() => run(over)).toThrow(FeasibilityError);
    });

    it("a refused config is refused with the same issues every time it is asked (once per config object)", () => {
        const first = (() => { try { assertFeasible(over); } catch (error) { return error as FeasibilityError; } })();
        const second = (() => { try { assertFeasible(over); } catch (error) { return error as FeasibilityError; } })();
        expect(first).toBeInstanceOf(FeasibilityError);
        expect(second!.issues).toEqual(first!.issues);
        expect(second!.message).toBe(first!.message);
    });
});

describe("a refusal hands over its opening and each problem as the message is made of them", async () => {
    const over = withTarget(await loadConfigFromFile(ConfigPaths.FLYING_ROBOT_FRAME_80) as Config, 1600);
    const refusal = (() => { try { assertFeasible(over); } catch (error) { return error as FeasibilityError; } })()!;

    it("lists one text per issue, each the issue's own description", () => {
        expect(refusal.problems).toEqual(refusal.issues.map(describeFeasibilityIssue));
        expect(refusal.problems.length).toBeGreaterThan(0);
    });

    it("makes the message of the opening and the problems, with no change to its words", () => {
        expect(refusal.message).toBe(`${refusal.opening} ${refusal.problems.join(" ")}`);
        expect(refusal.opening).toMatch(/^No clock can hold this build's setpoint.*:$/);
    });

    it("says that every figure is for one copy when the build has copies", () => {
        const shared = new FeasibilityError(refusal.issues, { items_per_second: 1600, copies: 24 });
        expect(shared.opening).toBe(`No clock can hold this build's setpoint of 1600 a second over 24 copies (every figure here is for one copy):`);
        expect(shared.message).toBe(`${shared.opening} ${refusal.problems.join(" ")}`);
        expect(new FeasibilityError(refusal.issues, { items_per_second: 1600, copies: 1 }).opening).toBe(`No clock can hold this build's setpoint:`);
        expect(new FeasibilityError(refusal.issues).opening).toBe(`No clock can hold this build's setpoint:`);
    });
});
