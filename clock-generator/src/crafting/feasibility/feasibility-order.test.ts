import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { TestConfigPaths } from "../../../tests/configs/paths";
import { describeFeasibilityIssue, FeasibilityError, InserterCoverageError } from "../../config/errors";
import { loadConfigFromFile } from "../../config/loader";
import { Config, ConfigSchema } from "../../config/schema";
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

describe("an S2 refusal of a recycler placing both its results into a wagon", () => {
    const config = ConfigSchema.parse({
        setpoint: { item: "electronic-circuit", items_per_second: 0.1, copies: 1 },
        machines: [{ id: 1, recipe: "processing-unit-recycling", prototype: "recycler", crafting_speed: 1,
            productivity: 0, result_target: { type: "chest", id: 14 } }],
        belts: [],
        chests: [
            { id: 11, type: "infinity-chest", item_filter: [{ item_name: "processing-unit", request_count: 100 }], remove_unfiltered_items: true },
            { id: 14, type: "cargo-wagon" },
            { id: 15, type: "infinity-chest", item_filter: [], remove_unfiltered_items: true },
        ],
        inserters: [
            { id: 2, source: { type: "chest", id: 11 }, sink: { type: "machine", id: 1 }, prototype: "stack-inserter" },
            { id: 7, source: { type: "chest", id: 14 }, sink: { type: "chest", id: 15 }, prototype: "stack-inserter",
                filters: ["electronic-circuit", "advanced-circuit"] },
        ],
    });
    const says = (where: string) => `Inserter 7 takes electronic circuit and advanced circuit out of ${where}. `
        + "An inserter that holds part of a hand of one of them takes only more of that one, so the others pile up in "
        + `${where}, and once it is full the one it waits for cannot come in: the build stops for good. Give each result an `
        + "inserter of its own. An inserter whose filters the clock sets by signal would not wait; such a clock is not planned yet.";

    function refusalOf(run: (config: Config) => unknown, build = config) {
        try {
            run(build);
        } catch (error) {
            if (error instanceof FeasibilityError) return error;
            throw error;
        }
        throw new Error("Expected a feasibility refusal");
    }

    it.each(CALL_SITES)("%s: describes the wagon and preserves the ordered issue", (_site, run) => {
        const refusal = refusalOf(run);
        expect(refusal.issues).toEqual([{
            rule: "S2", nodes: ["machine:1", "chest:14"], edges: ["inserter:7/electronic-circuit", "inserter:7/advanced-circuit"],
            need: null, capacity: null,
            terms: { rule: "S2", inserter: 7, items: ["electronic circuit", "advanced circuit"], target: { type: "chest", number: 14 } },
        }]);
        expect(refusal.name).toBe("FeasibilityError");
        expect(refusal.opening).toBe("No clock can hold this build's setpoint:");
        expect(refusal.problems).toEqual([says("the cargo wagon")]);
        expect(refusal.message).toBe(`${refusal.opening} ${says("the cargo wagon")}`);
    });

    it("adds a row number when a peer reads alike", () => {
        const peer: Config = { ...config, chests: [...config.chests!, { id: 16, type: "cargo-wagon" }] };
        const refusal = refusalOf(validateConfig, peer);
        expect(refusal.issues).toEqual(refusalOf(validateConfig).issues);
        expect(refusal.problems).toEqual([says("the cargo wagon (cargo wagon 14)")]);
    });

    it("keeps the numbered fallback when the formatter has only the existing issue", () => {
        const { issues } = refusalOf(validateConfig);
        expect(describeFeasibilityIssue(issues[0])).toBe(says("chest 14"));
        expect(new FeasibilityError(issues, config.setpoint).problems).toEqual([says("chest 14")]);
    });
});
