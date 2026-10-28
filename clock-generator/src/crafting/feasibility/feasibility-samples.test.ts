import { describe, expect, it } from "vitest";
import { blockedOutputClockCases, blockedOutputClockConfig } from "../../../tests/game/builds/blocked-output-clock-fixtures";
import { containerClockCases, containerClockConfig } from "../../../tests/game/builds/container-clock-fixtures";
import { frontClockConfig, frontEntranceClockCases, frontExitClockCases } from "../../../tests/game/builds/front-clock-fixtures";
import { overHoodClockCases, overHoodClockConfig } from "../../../tests/game/builds/over-hood-clock-fixtures";
import { pickupClockConfig, pickupClockSpeedCases } from "../../../tests/game/builds/pickup-clock-speed-coverage";
import { ConfigPaths, ExpectedRefusals } from "../../config/config-paths";
import { describeFeasibilityIssue, InserterCoverageError } from "../../config/errors";
import { assertInserterCoverage } from "../../config/inserter-coverage-validator";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import { toPlannerFacts } from "../facts/to-planner-facts";
import { plannerGraphOf } from "../graph/build-graph";
import { feasibilityOf } from "./assert-feasible";
import { refuses } from "./checks";

/** The issues of a config and its tightest cut: the most a cut is asked for over what it carries */
function feasibilityOfConfig(config: Config) {
    const facts = toPlannerFacts(config);
    const { cuts, issues } = feasibilityOf(facts, plannerGraphOf(facts));
    const bounded = cuts.filter(cut => cut.capacity !== null && cut.capacity.getNumerator > 0);
    const tightest = bounded.reduce<typeof bounded[number] | null>((most, cut) => most === null
        || cut.need.multiply(most.capacity!).subtract(most.need.multiply(cut.capacity!)).getNumerator > 0 ? cut : most, null);
    return { cuts, issues, tightest };
}

const texts = (issues: readonly Parameters<typeof describeFeasibilityIssue>[0][]) => issues.map(describeFeasibilityIssue);

/**
 * Every sample passes (P3 section 5): the base selection of every blast job met its target, but processing units with
 * a belt export (headroom 1.028), and a sound check cannot refuse a build a simulated clock carried. The refusal sample is
 * refused by the coverage check before the feasibility pass runs.
 */
describe("every sample passes the feasibility pass", () => {
    const samples = Object.entries(ConfigPaths).filter(([key]) => !(key in ExpectedRefusals));
    it.each(samples)("%s", async (_key, file) => {
        const { issues } = feasibilityOfConfig(await loadConfigFromFile(file) as Config);
        expect(texts(issues)).toEqual([]);
    });

    it.each(Object.keys(ExpectedRefusals))("%s is refused by the coverage check first", async key => {
        const config = await loadConfigFromFile(ConfigPaths[key as keyof typeof ConfigPaths]) as Config;
        expect(() => assertInserterCoverage(config)).toThrow(InserterCoverageError);
    });
});

/**
 * The samples whose tightest cut sits exactly at its bound: exact fractions and floors, not planned figures, keep them.
 * - Rocket fuel with jelly stack 15: inserters 6-9 bring 4 x 15 x 60 / 8 = 450 jelly a second; at 30 a craft that is
 *   15 crafts a second, and 60 rocket fuel a second at 4 a craft needs 15.
 * - Biochamber fuel: 3 nutrients a second at 6 a craft needs 0.5 crafts a second, its machine's 0.5.
 * - Low density structure: 240 a second dropped onto one turbo belt, whose two sides carry 120 each.
 */
describe("the samples at exactly their bound pass", () => {
    it.each([
        ["GLEBA_ROCKET_FUEL_JELLY_STACK_15", "C1 machine:rocket-fuel-from-jelly", 15, 15],
        ["BIOCHAMBER_FUEL", "C1 machine:nutrients-from-yumako-mash", 0.5, 0.5],
        ["LOW_DENSITY_STRUCTURE", "C3 low-density-structure", 240, 240],
    ] as const)("%s: %s, %d against %d", async (key, name, need, capacity) => {
        const { issues, tightest } = feasibilityOfConfig(await loadConfigFromFile(ConfigPaths[key]) as Config);
        expect(issues).toEqual([]);
        expect(tightest!.name).toBe(name);
        expect([tightest!.need.toDecimal(), tightest!.capacity!.toDecimal()]).toEqual([need, capacity]);
        expect(tightest!.need.subtract(tightest!.capacity!).getNumerator).toBe(0);
        expect(refuses(tightest!)).toBe(false);
    });
});

/**
 * The synthetic jobs of the blast (scripts/blast/blast.blastrun.ts, groups pickup, overhood, front, blocked and
 * containers), built as the blast builds them: every base selection met its target, so the pass must pass each. A
 * failure names a floor above what the simulator achieved.
 */
describe("every synthetic blast fixture passes the feasibility pass", () => {
    const jobs: [string, () => Config | Promise<Config>][] = [
        ...(["electromagnetic", "same-item"] as const).flatMap(family => pickupClockSpeedCases(family)
            .map((variant): [string, () => Promise<Config>] => [`pickup ${variant.name}`, () => pickupClockConfig(variant)])),
        ...(["different-items", "same-item"] as const).flatMap(family => overHoodClockCases(family)
            .map((variant): [string, () => Config] => [`overhood ${variant.name}`, () => overHoodClockConfig(variant)])),
        ...[...frontEntranceClockCases("different-items"), ...frontEntranceClockCases("same-item"), ...frontExitClockCases(true), ...frontExitClockCases(false)]
            .map((variant): [string, () => Config | Promise<Config>] => [`front ${variant.name}`, () => frontClockConfig(variant)]),
        ...blockedOutputClockCases().map((variant): [string, () => Config] => [`blocked ${variant.name}`, () => blockedOutputClockConfig(variant)]),
        ...containerClockCases().map((variant): [string, () => Config] => [`containers ${variant.name}`, () => containerClockConfig(variant)]),
    ];

    it("has every synthetic job of the blast: 48 pickup, 32 over-hood, 48 front, 16 blocked and 6 container configs", () => {
        const count = (group: string) => jobs.filter(([name]) => name.startsWith(`${group} `)).length;
        expect(["pickup", "overhood", "front", "blocked", "containers"].map(count)).toEqual([48, 32, 48, 16, 6]);
    });

    it.each(jobs)("%s", async (_name, configOf) => {
        const { issues } = feasibilityOfConfig(await configOf());
        expect(texts(issues)).toEqual([]);
    });
});
