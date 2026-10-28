import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { Config, ConfigSchema } from "../../config/schema";
import { belt, feasibilityOfConfig, infinityChest, inserter, lane } from "./feasibility-test-helpers";

/**
 * S1, a result with no way out, on the scrap silo: recycler 1 places its twelve results into rocket silo 14, whose
 * rocket part recipe takes processing units and low density structure. At another quality than its recipe's (the
 * sample's "uncommon") every result goes into the rocket inventory, which inserters 1-12 empty; at normal quality those
 * two go into the silo's input slots, which nothing empties.
 */
describe("S1: a result with no way out stops its machine for good", async () => {
    const sample = await loadConfigFromFile(ConfigPaths.RECYCLING_SCRAP_SILO) as Config;
    const atNormal = (): Config => {
        const config = structuredClone(sample);
        config.chests = config.chests!.map(chest => chest.id === 14 ? { ...chest, recipe_quality: "normal" } : chest) as Config["chests"];
        return config;
    };

    it("at uncommon quality every result goes out: it passes", () => {
        expect(feasibilityOfConfig(sample).issues).toEqual([]);
    });

    it("at normal quality processing units and low density structure fill the input slots: refused, the two results each", () => {
        const { rules, issues, texts } = feasibilityOfConfig(atNormal());
        expect(rules).toEqual(["S1", "S1"]);
        expect(issues.map(issue => issue.nodes)).toEqual([
            ["machine:1", "chest:14#input:processing-unit"], ["machine:1", "chest:14#input:low-density-structure"],
        ]);
        expect(texts).toMatchInlineSnapshot(`
          [
            "Machine 1 places processing unit into the input slots of rocket silo 14, and nothing takes it out: once they are full, the machine stops for good.",
            "Machine 1 places low density structure into the input slots of rocket silo 14, and nothing takes it out: once they are full, the machine stops for good.",
          ]
        `);
    });

    it("agrees with the schema's silo trap: the same machine, the same silo, the same two results", () => {
        const parsed = ConfigSchema.safeParse(atNormal());
        expect(parsed.success).toBe(false);
        expect(parsed.error!.issues.map(issue => issue.message)).toEqual([
            expect.stringContaining("Machine 1 places processing-unit and low-density-structure into rocket silo 14"),
        ]);
        const trapped = feasibilityOfConfig(atNormal()).issues.map(issue => issue.terms.rule === "S1" ? [issue.terms.machine, issue.terms.into?.container] : []);
        expect(trapped).toEqual([[1, 14], [1, 14]]);
    });

    /**
     * Machine 2 makes iron sticks the target does not need, and inserter 4 puts them into a buffer chest nothing empties:
     * it stops for good once the chest is full, and the target's gears never need it.
     */
    it("a trapped result of a machine the target does not need: it passes", () => {
        const config = {
            target_output: { recipe: "iron-gear-wheel", items_per_second: 10, copies: 1 },
            machines: [
                { id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1000 },
                { id: 2, recipe: "iron-stick", productivity: 0, crafting_speed: 1000 },
            ],
            belts: [belt(1, [lane("iron-plate")])],
            chests: [infinityChest(2, ["iron-gear-wheel"]), { id: 3, type: "buffer-chest", storage_size: 1, item_filter: "iron-stick" }],
            inserters: [
                inserter(1, { type: "belt", id: 1 }, { type: "machine", id: 1 }),
                inserter(2, { type: "machine", id: 1 }, { type: "chest", id: 2 }),
                inserter(3, { type: "belt", id: 1 }, { type: "machine", id: 2 }),
                inserter(4, { type: "machine", id: 2 }, { type: "chest", id: 3 }),
            ],
        } as Config;
        expect(feasibilityOfConfig(config).issues).toEqual([]);
    });

    /**
     * Machines 1 and 2 make gears at 2 crafts a second each (crafting speed 1, half a second a craft); machine 1's go into
     * infinity chest 2, the target. Inserter 4 puts machine 2's into buffer chest 3, and inserter 5 moves them on into
     * buffer chest 4, which nothing empties: machine 2 stops for good once chest 4 is full, and machine 1 alone crafts 2
     * of the 3 a second that 3 gears a second need.
     */
    const chained = (more: Config["inserters"] = []): Config => ({
        target_output: { recipe: "iron-gear-wheel", items_per_second: 3, copies: 1 },
        machines: [
            { id: 1, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1 },
            { id: 2, recipe: "iron-gear-wheel", productivity: 0, crafting_speed: 1 },
        ],
        belts: [belt(1, [lane("iron-plate")])],
        chests: [
            infinityChest(2, ["iron-gear-wheel"]),
            { id: 3, type: "buffer-chest", storage_size: 1, item_filter: "iron-gear-wheel" },
            { id: 4, type: "buffer-chest", storage_size: 1, item_filter: "iron-gear-wheel" },
        ],
        inserters: [
            inserter(1, { type: "belt", id: 1 }, { type: "machine", id: 1 }),
            inserter(2, { type: "machine", id: 1 }, { type: "chest", id: 2 }),
            inserter(3, { type: "belt", id: 1 }, { type: "machine", id: 2 }),
            inserter(4, { type: "machine", id: 2 }, { type: "chest", id: 3 }),
            inserter(5, { type: "chest", id: 3 }, { type: "chest", id: 4 }),
            ...more,
        ],
    } as Config);

    it("through a chain of chests: names the chest it stops in, chest 4, not chest 3, which inserter 5 empties", () => {
        const { rules, issues, texts } = feasibilityOfConfig(chained());
        expect(rules).toEqual(["S1"]);
        expect(issues[0].nodes).toEqual(["machine:2", "chest:3#iron-gear-wheel", "chest:4#iron-gear-wheel"]);
        expect(texts[0]).toMatchInlineSnapshot(`"Inserter 4 puts iron gear wheel from machine 2 into chest 3, inserter 5 moves it on into chest 4, and nothing takes it out of there: once chest 4 is full, the machine stops for good. The other machine 1 of the recipe crafts at most 2 a second, and the target needs 3."`);
    });

    it("round a loop of chests (inserter 6 moves the gears back into chest 3): both chests, and nothing else takes them out", () => {
        const { rules, texts } = feasibilityOfConfig(chained([inserter(6, { type: "chest", id: 4 }, { type: "chest", id: 3 })]));
        expect(rules).toEqual(["S1"]);
        expect(texts[0]).toMatchInlineSnapshot(`"Inserter 4 puts iron gear wheel from machine 2 into chest 3, inserters 5 and 6 move it round between chests 3 and 4, and nothing else takes it out: once they are full, the machine stops for good. The other machine 1 of the recipe crafts at most 2 a second, and the target needs 3."`);
    });

    it("at 2 gears a second machine 1 alone is enough: it passes, machine 2 may stay idle", () => {
        const config = chained();
        config.target_output.items_per_second = 2;
        expect(feasibilityOfConfig(config).issues).toEqual([]);
    });
});
