import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { FeasibilityError } from "../../config/errors";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import { TestConfigPaths } from "../../../tests/configs/paths";
import { withJellyHandsOf15 } from "../../../tests/configs/rocket-fuel-hands";
import { assertFeasible } from "./assert-feasible";
import { feasibilityOfConfig, withTarget } from "./feasibility-test-helpers";

const sampleOf = async (key: keyof typeof ConfigPaths) => await loadConfigFromFile(ConfigPaths[key]) as Config;

/** A sample's utilizations as [group, machines, crafts needed, crafts capacity, utilization] in exact fractions */
const utilizationsOf = (config: Config) => feasibilityOfConfig(config).utilizations
    .map(it => [it.group, it.machines, it.crafts_needed.toString(), it.crafts_capacity.toString(), it.utilization.toString()]);

/**
 * The utilization of a machine group (utilization.ts) is recorded only: the crafts it must make a second over the crafts its machines
 * make at their speed.
 */
describe("the utilization of a machine group", () => {
    it("biochamber fuel: its one machine is asked 1/2 a craft a second of the 1/2 it makes, a utilization of exactly 1, and the build still passes", async () => {
        const config = await loadConfigFromFile(TestConfigPaths.BIOCHAMBER_FUEL) as Config;
        expect(utilizationsOf(config)).toEqual([["machine:nutrients-from-yumako-mash", [1], "1/2", "1/2", "1"]]);
        expect(feasibilityOfConfig(config).issues).toEqual([]);
        expect(() => assertFeasible(config)).not.toThrow();
    });

    it("electric furnace: machine 2 (steel casting) is asked 25 crafts a second of the 925/16 = 57.8 its speed makes, a utilization of 16/37 = 43%, well below 1", async () => {
        const utilizations = utilizationsOf(await sampleOf("ELECTRIC_FURNACE_20"));
        expect(utilizations).toContainEqual(["machine:casting-steel", [2], "25", "925/16", "16/37"]);
    });
});

/** The utilization decides nothing: what is refused is what C1 to C7 and the traps refuse, with or without it */
describe("the utilization does not change what is refused", () => {
    it("rocket fuel with its jelly inserters at a hand of 15 at 61 a second is refused by C1 alone, as before, and records its utilization", async () => {
        const over = withTarget(withJellyHandsOf15(await sampleOf("ROCKET_FUEL_60")), 61);
        const { rules, utilizations } = feasibilityOfConfig(over);
        expect(rules).toEqual(["C1"]);
        expect(utilizations.map(it => it.group)).toContain("machine:rocket-fuel-from-jelly");
        expect(() => assertFeasible(over)).toThrow(FeasibilityError);
    });
});
