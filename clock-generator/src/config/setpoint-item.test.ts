import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema";
import { outputItemOf, readRecipeSetpointAsItem, renameRecipeToItem } from "./setpoint-item";
import { setpointOutputOf } from "../data/setpoint-output";

const build = (setpoint: { item?: string; counts?: string }, ...recipes: string[]) =>
    ({ setpoint: { items_per_second: 1, copies: 1, ...setpoint }, machines: recipes.map((recipe, index) => ({ id: index + 1, recipe })), inserters: [] });
const itemOf = (value: unknown) => (value as { setpoint: { item: string } }).setpoint.item;

describe("the output a machine on a recipe counts", () => {
    it("is the result with the largest expected amount per craft", () => {
        expect(outputItemOf("jellynut-processing")).toBe("jelly");
        expect(outputItemOf("iron-gear-wheel")).toBe("iron-gear-wheel");
    });

    it("is the byproduct of the two bacteria recipes, which the setpoint's rule preselects", () => {
        for (const bacteria of ["iron-bacteria", "copper-bacteria"]) {
            expect(outputItemOf(bacteria)).toBe("spoilage");
            expect(setpointOutputOf(bacteria)).toMatchObject({ item: "spoilage" });
        }
    });

    it("is null for a name that is no recipe, and for a recipe that makes no item", () => {
        expect(outputItemOf("iron-ore-not-a-recipe")).toBeNull();
        expect(outputItemOf("sulfuric-acid")).toBeNull();
    });
});

describe("a setpoint named by a recipe", () => {
    it("retains an explicit fractional rate when identifying the output item", () => {
        const original = build({ item: "jellynut-processing" }, "jellynut-processing");
        const config = { ...original, setpoint: { ...original.setpoint, items_per_second: { numerator: 16, denominator: 7 } } };
        expect(readRecipeSetpointAsItem(config)).toMatchObject({ setpoint: { item: "jelly", items_per_second: config.setpoint.items_per_second } });
    });
    it("is read as the main product of the recipe, where a machine of the build makes it", () => {
        const config = build({ item: "jellynut-processing", counts: "made" }, "jellynut-processing");
        expect(readRecipeSetpointAsItem(config)).toEqual(build({ item: "jelly", counts: "made" }, "jellynut-processing"));
        expect(itemOf(readRecipeSetpointAsItem(build({ item: "jellynut-processing" }, "jellynut-processing")))).toBe("jelly");
    });

    it("keeps the other keys of the config, in their order, and leaves the given config as it was", () => {
        const config = build({ item: "jellynut-processing" }, "jellynut-processing");
        const read = readRecipeSetpointAsItem(config) as Record<string, unknown>;
        expect(Object.keys(read)).toEqual(Object.keys(config));
        expect(Object.keys(read.setpoint as object)).toEqual(Object.keys(config.setpoint));
        expect(config.setpoint.item).toBe("jellynut-processing");
    });

    it("loads under `item` as it is, where the name is already an item", () => {
        expect(readRecipeSetpointAsItem(build({ item: "iron-gear-wheel" }, "iron-gear-wheel"))).toEqual(build({ item: "iron-gear-wheel" }, "iron-gear-wheel"));
    });

    it("stays as it is where a machine of the build makes the name: an item that is also the name of a recipe", () => {
        expect(outputItemOf("iron-ore-recycling")).toBe("iron-ore");
        const stays = (config: unknown) => expect(readRecipeSetpointAsItem(config)).toBe(config);
        for (const [name, recipe] of [["iron-bacteria", "iron-bacteria-cultivation"], ["iron-ore", "iron-ore-recycling"], ["iron-gear-wheel", "iron-gear-wheel"]] as const) {
            stays(build({ item: name }, recipe));
        }
        stays(build({ item: "iron-bacteria" }, "iron-bacteria", "iron-bacteria-cultivation"));
    });

    it("stays as typed where it is neither an item a machine makes nor a recipe whose main product one makes", () => {
        for (const [name, recipes] of [
            ["no-such-thing", ["jellynut-processing"]],
            ["jellynut-processing", ["iron-gear-wheel"]],
            ["jellynut-processing", []],
            ["sulfuric-acid", ["sulfuric-acid"]],
        ] as const) {
            const config = build({ item: name }, ...recipes);
            expect(readRecipeSetpointAsItem(config)).toBe(config);
        }
    });

    it("is never read as an item where the setpoint counts an item destroyed", () => {
        const destroyed = build({ item: "jellynut-processing", counts: "destroyed" }, "jellynut-processing");
        expect(readRecipeSetpointAsItem(destroyed)).toBe(destroyed);
    });

    it("leaves a value that is not a config as it is", () => {
        for (const value of [undefined, null, 3, "config", [], {}, { setpoint: 2 }, { setpoint: [] }, { setpoint: { item: 2 }, machines: [] }, { setpoint: { item: "jelly" }, machines: "none" }]) {
            expect(readRecipeSetpointAsItem(value)).toBe(value);
        }
    });
});

describe("the rename of the `recipe` of a suggested target's setpoint", () => {
    it("puts `item` at the place of `recipe`", () => {
        const renamed = renameRecipeToItem({ items_per_second: 1, recipe: "iron-plate", copies: 2, counts: "made" });
        expect(renamed).toEqual({ items_per_second: 1, item: "iron-plate", copies: 2, counts: "made" });
        expect(Object.keys(renamed as object)).toEqual(["items_per_second", "item", "copies", "counts"]);
    });

    it("keeps `item` where both are given, at the place of `item`, and drops `recipe`", () => {
        const renamed = renameRecipeToItem({ recipe: "iron-gear-wheel", items_per_second: 1, item: "iron-plate" });
        expect(renamed).toEqual({ items_per_second: 1, item: "iron-plate" });
        expect(Object.keys(renamed as object)).toEqual(["items_per_second", "item"]);
    });

    it("leaves what holds no `recipe` as it is, and resolves no name", () => {
        for (const value of [undefined, null, 3, "setpoint", [], {}, { item: "jellynut-processing" }]) expect(renameRecipeToItem(value)).toBe(value);
        expect(renameRecipeToItem({ recipe: "jellynut-processing" })).toEqual({ item: "jellynut-processing" });
    });
});

describe("a config's setpoint, as the schema loads it", () => {
    const config = {
        setpoint: { items_per_second: 1, copies: 1 } as Record<string, unknown>,
        machines: [{ id: 1, recipe: "jellynut-processing", productivity: 0, crafting_speed: 2, prototype: "biochamber" }],
        inserters: [],
        belts: [],
    };

    it("loads from `item` as the item of the recipe's main product", () => {
        expect(ConfigSchema.parse({ ...config, setpoint: { ...config.setpoint, item: "jellynut-processing" } }).setpoint.item).toBe("jelly");
        expect(ConfigSchema.parse({ ...config, setpoint: { ...config.setpoint, item: "jelly" } }).setpoint.item).toBe("jelly");
    });

    it("is refused at `setpoint.item` where none is given", () => {
        const result = ConfigSchema.safeParse(config);
        expect(result.success).toBe(false);
        expect(result.error?.issues.some(issue => issue.path.join(".") === "setpoint.item")).toBe(true);
    });
});
