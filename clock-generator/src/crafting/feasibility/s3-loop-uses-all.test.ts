import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import type { MachineNode, PlannerFacts } from "../../data-types/planner-facts";
import { toPlannerFacts } from "../facts/to-planner-facts";
import { feasibilityOfFacts } from "./feasibility-test-helpers";

/**
 * S3, a loop that uses up all it makes, on agricultural science: machines 3 and 4 (pentapod eggs) feed each other an
 * egg a craft and give the science machine 50 / 2.5 = 20 eggs a second. Their facts make 3.5 eggs a craft; here the
 * yield is set by hand, as no recipe of the game gives back exactly what it takes.
 */
describe("S3: a loop that uses up all it makes meets no target", async () => {
    const facts = toPlannerFacts(await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE) as Config);
    const eggsMade = (per_craft: number): PlannerFacts => {
        const copy = structuredClone(facts) as { -readonly [K in keyof PlannerFacts]: PlannerFacts[K] };
        copy.nodes = copy.nodes.map(node => node.kind === "machine" && node.production.recipe_or_resource === "pentapod-egg"
            ? { ...node, yield: { ...node.yield, results: node.yield.results.map(result => ({ ...result, expected_per_craft: per_craft })) } } as MachineNode
            : node);
        return copy;
    };

    it("3.5 eggs a craft, 1 back into the loop: 20 eggs a second at a net 2.5 a craft is 8 crafts a second of the two machines' 8.6", () => {
        const { cut, issues } = feasibilityOfFacts(facts);
        expect(cut("C1 machine:pentapod-egg").need.toString()).toBe("8");
        expect(issues).toEqual([]);
    });

    it("a craft gives 1 and takes 1: refused", () => {
        const { rules, issues, texts } = feasibilityOfFacts(eggsMade(1));
        expect(rules).toEqual(["S3"]);
        expect(issues[0].nodes).toEqual(["machine:3", "machine:4"]);
        expect(texts[0]).toMatchInlineSnapshot(`"Machines 3 and 4 use up all the pentapod egg they make (a craft gives 1 and takes 1): no amount of crafting meets the target."`);
    });

    it("a craft gives 0.5 and takes 1: refused, it uses up more than it makes", () => {
        const { rules, texts } = feasibilityOfFacts(eggsMade(0.5));
        expect(rules).toEqual(["S3"]);
        expect(texts[0]).toMatchInlineSnapshot(`"Machines 3 and 4 use up more pentapod egg than they make (a craft gives 0.5 and takes 1): no amount of crafting meets the target."`);
    });

    it("a craft gives 1.5 and takes 1: the loop is solved, 20 / 0.5 = 40 crafts a second, which its 8.6 cannot make (C1)", () => {
        const { cut, rules } = feasibilityOfFacts(eggsMade(1.5));
        expect(cut("C1 machine:pentapod-egg").need.toString()).toBe("40");
        expect(rules).toEqual(["C1"]);
    });
});
