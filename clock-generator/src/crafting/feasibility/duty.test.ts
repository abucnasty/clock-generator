import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { FeasibilityError } from "../../config/errors";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
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
    it("processing units with a belt export: machine 4 (electronic circuit) is asked 102 crafts a second of the 13111/125 = 104.888 "
        + "its speed makes (102 asked of 104.9 crafts a 24-tick cycle), a duty of 12750/13111 = 97.25%", async () => {
        const duties = feasibilityOfConfig(await sampleOf("PROCESSING_UNITS_BELT_EXPORT")).duties;
        const circuit = duties.find(it => it.group === "machine:electronic-circuit")!;
        expect(circuit.machines).toEqual([4]);
        expect([circuit.crafts_needed.toString(), circuit.crafts_capacity.toString(), circuit.duty.toString()]).toEqual(["102", "13111/125", "12750/13111"]);
        expect(circuit.duty.toDecimal()).toBeCloseTo(0.9725, 4);
        // one duty for each group that must craft; none above 1
        expect(duties.map(it => it.group)).toEqual([
            "machine:casting-iron", "machine:processing-unit", "machine:advanced-circuit",
            "machine:electronic-circuit", "machine:copper-cable", "machine:casting-copper",
        ]);
        expect(duties.every(it => it.duty.toDecimal() < 1)).toBe(true);
    });

    it("biochamber fuel: its one machine is asked 1/2 a craft a second of the 1/2 it makes, a duty of exactly 1, and the build still passes", async () => {
        const config = await sampleOf("BIOCHAMBER_FUEL");
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
    it("rocket fuel with jelly stack 15 at 61 a second is refused by C1 alone, as before, and records its duty", async () => {
        const over = withTarget(await sampleOf("GLEBA_ROCKET_FUEL_JELLY_STACK_15"), 61);
        const { rules, duties } = feasibilityOfConfig(over);
        expect(rules).toEqual(["C1"]);
        expect(duties.map(it => it.group)).toContain("machine:rocket-fuel-from-jelly");
        expect(() => assertFeasible(over)).toThrow(FeasibilityError);
    });

    it("a sample at a duty near 1 is not refused for it", async () => {
        const config = await sampleOf("PROCESSING_UNITS_BELT_EXPORT");
        expect(() => assertFeasible(config)).not.toThrow();
    });
});
