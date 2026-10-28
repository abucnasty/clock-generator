import { describe, expect, it } from "vitest";
import { Config } from "../../config/schema";
import type { InserterEdge } from "../../data-types/planner-facts";
import { toPlannerFacts } from "../facts/to-planner-facts";
import { exportedItemsOf } from "../export-delivery";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { validateConfig } from "../plan/validate-config";
import { belt, feasibilityOfConfig, infinityChest, inserter, lane } from "./feasibility-test-helpers";

/**
 * C6, an export belt: machine 1 makes the target, gears, into infinity chest 2; machine 2 makes iron sticks (2 a craft
 * from a plate), and inserter 4 alone fills export belt 3 with them, a hand of 12 every 10 ticks (pickup 1, two
 * rotations of 3, a drop of 12 / 4 = 3 stacks): 12 x 60 / 10 = 72 a second. Inserter 5 puts more sticks into infinity
 * chest 4, so the machine itself is not held back.
 */
const exporting = (consumed: number): Config => ({
    target_output: { recipe: "iron-gear-wheel", items_per_second: 10, copies: 1 },
    machines: [
        { id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1000 },
        { id: 2, recipe: "iron-stick", productivity: 0, crafting_speed: 1000 },
    ],
    belts: [belt(3, [lane("iron-stick", { consumption_per_second: consumed })], { strategy: "export" })],
    chests: [infinityChest(1, ["iron-plate"]), infinityChest(2, ["iron-gear-wheel"]), infinityChest(4, ["iron-stick"])],
    inserters: [
        inserter(1, { type: "chest", id: 1 }, { type: "machine", id: 1 }),
        inserter(2, { type: "machine", id: 1 }, { type: "chest", id: 2 }),
        inserter(3, { type: "chest", id: 1 }, { type: "machine", id: 2 }),
        inserter(4, { type: "machine", id: 2 }, { type: "belt", id: 3 }, { stack_size: 12 }),
        inserter(5, { type: "machine", id: 2 }, { type: "chest", id: 4 }),
    ],
} as Config);

describe("C6: an export belt gets at most what its fillers put onto it", () => {
    it("1 hand of 12 every 10 ticks puts 72 sticks a second onto belt 3, and its consumers take 72: it passes, exactly at the bound", () => {
        const { cut, issues } = feasibilityOfConfig(exporting(72));
        const exported = cut("C6 belt:3#iron-stick");
        expect([exported.need.toString(), exported.capacity!.toString()]).toEqual(["72", "72"]);
        expect(issues).toEqual([]);
    });

    it("consumers taking 73 sticks a second take more than the 72: refused", () => {
        const { rules, issues, texts } = feasibilityOfConfig(exporting(73));
        expect(rules).toEqual(["C6"]);
        expect(issues[0]).toMatchObject({ edges: ["inserter:4/iron-stick"], need: 73, capacity: 72 });
        expect(texts[0]).toMatchInlineSnapshot(`"Inserter 4 can put at most 72 a second of iron stick onto belt 3 (1 hand of 12 every 10 ticks), and the consumers outside the build take 73 a second off it. Lower the belt's consumption, or give it more inserters."`);
    });

    it("with a hand of 16 the planned swing of 12 ticks would put 16 x 60 / 12 = 80 sticks a second and refuse 85; the floor of "
        + "11 ticks puts 87.27 and does not", () => {
        const config = exporting(85);
        config.inserters[3] = { ...config.inserters[3], stack_size: 16 };
        const [filler] = toPlannerFacts(config).edges.filter((edge): edge is InserterEdge => edge.via === "inserter" && edge.entity === "inserter:4");
        expect([filler.hand.by_item, filler.planned.cycle, filler.floor.cycle]).toEqual([16, 12, 11]);
        expect(feasibilityOfConfig(config).issues).toEqual([]);
    });
});

/**
 * A belt an output inserter fills is the build's output, as `exportedItemsOf` reads it: its consumers are not judged.
 * Machine 1 (jellynut processing, crafting speed 5) makes jelly, the target, and jellynut seed; inserter 2 drops both
 * onto belt 2, whose seed lane's consumers take 10 a second. At 0.02 seed a craft that would be 500 crafts a second of
 * the machine's 5, but the engine never checks that export, so the pass does not either.
 */
describe("C6: an export an output inserter fills is not judged", () => {
    const byProduct = (): Config => ({
        target_output: { recipe: "jelly", items_per_second: 16, copies: 1 },
        machines: [{ id: 1, recipe: "jellynut-processing", productivity: 0, crafting_speed: 5 }],
        belts: [
            belt(1, [lane("jellynut")]),
            belt(2, [lane("jelly"), lane("jellynut-seed", { consumption_per_second: 10 })], { strategy: "export" }),
        ],
        inserters: [
            inserter(1, { type: "belt", id: 1 }, { type: "machine", id: 1 }),
            inserter(2, { type: "machine", id: 1 }, { type: "belt", id: 2 }, { filters: ["jelly", "jellynut-seed"] }),
        ],
    } as Config);

    it("the engine leaves the seed export out, and the pass has no cut for it: it passes", () => {
        const config = byProduct();
        expect(exportedItemsOf(createEntityRegistryFromConfig(config), new Set(["inserter:2"]))).toEqual([]);
        const { cuts, issues } = feasibilityOfConfig(config);
        expect(cuts.filter(cut => cut.rule === "C6")).toEqual([]);
        expect(issues).toEqual([]);
        expect(() => validateConfig(config)).not.toThrow();
    });
});
