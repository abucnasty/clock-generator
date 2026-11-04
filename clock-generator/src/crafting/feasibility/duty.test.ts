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

/** A sample's duties as [group, machines, crafts needed, crafts capacity, duty] in exact fractions */
const dutiesOf = (config: Config) => feasibilityOfConfig(config).duties
    .map(it => [it.group, it.machines, it.crafts_needed.toString(), it.crafts_capacity.toString(), it.duty.toString()]);

/**
 * The duty of a machine group (duty.ts) is recorded only: the crafts it must make a second over the crafts its machines
 * make at their speed.
 */
describe("the duty of a machine group", () => {
    it("biochamber fuel: its one machine is asked 1/2 a craft a second of the 1/2 it makes, a duty of exactly 1, and the build still passes", async () => {
        const config = await loadConfigFromFile(TestConfigPaths.BIOCHAMBER_FUEL) as Config;
        expect(dutiesOf(config)).toEqual([["machine:nutrients-from-yumako-mash", [1], "1/2", "1/2", "1"]]);
        expect(feasibilityOfConfig(config).issues).toEqual([]);
        expect(() => assertFeasible(config)).not.toThrow();
    });

    it("electric furnace: machine 2 (steel casting) is asked 25 crafts a second of the 925/16 = 57.8 its speed makes, a duty of 16/37 = 43%, well below 1", async () => {
        const duties = dutiesOf(await sampleOf("ELECTRIC_FURNACE"));
        expect(duties).toContainEqual(["machine:casting-steel", [2], "25", "925/16", "16/37"]);
    });
});

/** The duty decides nothing: what is refused is what C1 to C7 and the traps refuse, with or without it */
describe("the duty does not change what is refused", () => {
    it("rocket fuel with its jelly inserters at a hand of 15 at 61 a second is refused by C1 alone, as before, and records its duty", async () => {
        const over = withTarget(withJellyHandsOf15(await sampleOf("GLEBA_ROCKET_FUEL")), 61);
        const { rules, duties } = feasibilityOfConfig(over);
        expect(rules).toEqual(["C1"]);
        expect(duties.map(it => it.group)).toContain("machine:rocket-fuel-from-jelly");
        expect(() => assertFeasible(over)).toThrow(FeasibilityError);
    });
});
