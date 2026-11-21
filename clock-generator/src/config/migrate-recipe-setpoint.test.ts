import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema";
import { outputItemOf, readRecipeSetpointAsItem } from "./migrate-recipe-setpoint";
import { setpointOutputOf } from "../data/setpoint-output";
import { renameRecipeToItem } from "./migrate-setpoint";

// the former field is `recipe`; the setpoint names its item as `item`
const build = (setpoint: { recipe?: string; item?: string; counts?: string }, ...recipes: string[]) =>
    ({ setpoint: { items_per_second: 1, copies: 1, ...setpoint }, machines: recipes.map((recipe, index) => ({ id: index + 1, recipe })), inserters: [] });
const itemOf = (value: unknown) => (value as { setpoint: { item: string } }).setpoint.item;
const KEYS = ["item", "recipe"] as const;

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
    it.each(KEYS)("is read as the main product of the recipe, where a machine of the build makes it, under `%s`", key => {
        const config = build({ [key]: "jellynut-processing", counts: "made" }, "jellynut-processing");
        expect(readRecipeSetpointAsItem(config)).toEqual(build({ item: "jelly", counts: "made" }, "jellynut-processing"));
        expect(itemOf(readRecipeSetpointAsItem(build({ [key]: "jellynut-processing" }, "jellynut-processing")))).toBe("jelly");
    });

    it.each(KEYS)("keeps the other keys of the config, in their order, and leaves the given config as it was, under `%s`", key => {
        const config = build({ [key]: "jellynut-processing" }, "jellynut-processing");
        const read = readRecipeSetpointAsItem(config) as Record<string, unknown>;
        expect(Object.keys(read)).toEqual(Object.keys(config));
        expect(Object.keys(read.setpoint as object)).toEqual(Object.keys(config.setpoint).map(name => name === "recipe" ? "item" : name));
        expect(Object.keys(config.setpoint)).toContain(key);
        expect((config.setpoint as unknown as Record<string, string>)[key]).toBe("jellynut-processing");
    });

    it("loads under `item` alone, and under `recipe` alone as `item` with no `recipe` left, where the name is already an item", () => {
        const only = (key: string) => build({ [key]: "iron-gear-wheel" }, "iron-gear-wheel");
        expect(readRecipeSetpointAsItem(only("item"))).toEqual(build({ item: "iron-gear-wheel" }, "iron-gear-wheel"));
        const renamed = readRecipeSetpointAsItem(only("recipe")) as { setpoint: Record<string, unknown> };
        expect(renamed).toEqual(build({ item: "iron-gear-wheel" }, "iron-gear-wheel"));
        expect("recipe" in renamed.setpoint).toBe(false);
    });

    it("takes `item` where both are given, and drops `recipe`", () => {
        const both = build({ recipe: "iron-gear-wheel", item: "jellynut-processing" }, "jellynut-processing");
        const read = readRecipeSetpointAsItem(both) as { setpoint: Record<string, unknown> };
        expect(read.setpoint.item).toBe("jelly");
        expect("recipe" in read.setpoint).toBe(false);
        const unresolved = readRecipeSetpointAsItem(build({ recipe: "iron-gear-wheel", item: "no-such-thing" }, "iron-gear-wheel")) as { setpoint: Record<string, unknown> };
        expect(unresolved.setpoint.item).toBe("no-such-thing");
        expect("recipe" in unresolved.setpoint).toBe(false);
    });

    it.each(KEYS)("stays as it is where a machine of the build makes the name: an item that is also the name of a recipe, under `%s`", key => {
        expect(outputItemOf("iron-ore-recycling")).toBe("iron-ore");
        const stays = (config: unknown, name: string, ...rest: string[]) => {
            const read = readRecipeSetpointAsItem(config);
            if (key === "item") expect(read).toBe(config);
            else expect(read).toEqual(build({ item: name }, ...rest));
        };
        for (const [name, recipe] of [["iron-bacteria", "iron-bacteria-cultivation"], ["iron-ore", "iron-ore-recycling"], ["iron-gear-wheel", "iron-gear-wheel"]] as const) {
            stays(build({ [key]: name }, recipe), name, recipe);
        }
        stays(build({ [key]: "iron-bacteria" }, "iron-bacteria", "iron-bacteria-cultivation"), "iron-bacteria", "iron-bacteria", "iron-bacteria-cultivation");
    });

    it.each(KEYS)("stays as typed where it is neither an item a machine makes nor a recipe whose main product one makes, under `%s`", key => {
        for (const [name, recipes] of [
            ["no-such-thing", ["jellynut-processing"]],
            ["jellynut-processing", ["iron-gear-wheel"]],
            ["jellynut-processing", []],
            ["sulfuric-acid", ["sulfuric-acid"]],
        ] as const) {
            const config = build({ [key]: name }, ...recipes);
            const read = readRecipeSetpointAsItem(config);
            if (key === "item") expect(read).toBe(config);
            else expect(read).toEqual(build({ item: name }, ...recipes));
        }
    });

    it("is never read as an item where the setpoint counts an item destroyed, and is renamed all the same", () => {
        const destroyed = build({ item: "jellynut-processing", counts: "destroyed" }, "jellynut-processing");
        expect(readRecipeSetpointAsItem(destroyed)).toBe(destroyed);
        const old = build({ recipe: "jellynut-processing", counts: "destroyed" }, "jellynut-processing");
        expect(readRecipeSetpointAsItem(old)).toEqual(destroyed);
    });

    it("is renamed where the config has no machines array, and read as it is otherwise", () => {
        expect(readRecipeSetpointAsItem({ setpoint: { recipe: "jelly" }, machines: "none" })).toEqual({ setpoint: { item: "jelly" }, machines: "none" });
        expect(readRecipeSetpointAsItem({ setpoint: { recipe: "jelly", items_per_second: 1 } })).toEqual({ setpoint: { item: "jelly", items_per_second: 1 } });
        const item = { setpoint: { item: "jelly" }, machines: "none" };
        expect(readRecipeSetpointAsItem(item)).toBe(item);
    });

    it("leaves a value that is not a config as it is", () => {
        for (const value of [undefined, null, 3, "config", [], {}, { setpoint: 2 }, { setpoint: [] }, { setpoint: { item: 2 }, machines: [] }, { setpoint: { item: "jelly" }, machines: "none" }]) {
            expect(readRecipeSetpointAsItem(value)).toBe(value);
        }
    });

    it("renames a recipe that is no string as it is, for the schema to refuse at `item`", () => {
        expect(readRecipeSetpointAsItem({ setpoint: { recipe: 2 }, machines: [] })).toEqual({ setpoint: { item: 2 }, machines: [] });
    });
});

describe("the rename of a setpoint's `recipe`", () => {
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
    const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "legacy", "recipe-setpoint.json"), "utf8")) as { setpoint: Record<string, unknown> };
    const withoutItem = () => { const { recipe: _recipe, ...kept } = legacy.setpoint; return { ...legacy, setpoint: kept }; };

    it("loads from `recipe` as the item of the recipe's main product, with no `recipe` left", () => {
        const parsed = ConfigSchema.parse(legacy);
        expect(parsed.setpoint.item).toBe("jelly");
        expect("recipe" in parsed.setpoint).toBe(false);
    });

    it("loads from `item` alike", () => {
        expect(ConfigSchema.parse({ ...legacy, setpoint: { ...withoutItem().setpoint, item: "jellynut-processing" } }).setpoint.item).toBe("jelly");
        expect(ConfigSchema.parse({ ...legacy, setpoint: { ...withoutItem().setpoint, item: "jelly" } }).setpoint.item).toBe("jelly");
    });

    it("is refused at `setpoint.item` where neither is given", () => {
        const result = ConfigSchema.safeParse(withoutItem());
        expect(result.success).toBe(false);
        expect(result.error?.issues.some(issue => issue.path.join(".") === "setpoint.item")).toBe(true);
    });
});
