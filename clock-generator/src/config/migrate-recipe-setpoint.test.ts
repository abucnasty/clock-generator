import { describe, expect, it } from "vitest";
import { mainProductOf, outputItemOf, readRecipeSetpointAsItem } from "./migrate-recipe-setpoint";

const build = (setpoint: { recipe: string; counts?: string }, ...recipes: string[]) =>
    ({ setpoint: { items_per_second: 1, copies: 1, ...setpoint }, machines: recipes.map((recipe, index) => ({ id: index + 1, recipe })), inserters: [] });
const recipeOf = (value: unknown) => (value as { setpoint: { recipe: string } }).setpoint.recipe;

describe("the main product of a recipe", () => {
    it("is the result with the largest expected amount per craft", () => {
        expect(mainProductOf("jellynut-processing")).toBe("jelly");
        expect(mainProductOf("iron-gear-wheel")).toBe("iron-gear-wheel");
    });

    it("is the item the game data names as the main product, where it names one: never the byproduct", () => {
        for (const bacteria of ["iron-bacteria", "copper-bacteria"]) {
            expect(mainProductOf(bacteria)).toBe(bacteria);
            // a machine on the recipe counts its largest result, which is the byproduct
            expect(outputItemOf(bacteria)).toBe("spoilage");
        }
    });

    it("is null for a name that is no recipe, and for a recipe that makes no item", () => {
        expect(mainProductOf("iron-ore-not-a-recipe")).toBeNull();
        expect(mainProductOf("sulfuric-acid")).toBeNull();
    });
});

describe("a setpoint named by a recipe", () => {
    it("is read as the main product of the recipe, where a machine of the build makes it", () => {
        const config = build({ recipe: "jellynut-processing", counts: "made" }, "jellynut-processing");
        expect(readRecipeSetpointAsItem(config)).toEqual(build({ recipe: "jelly", counts: "made" }, "jellynut-processing"));
        expect(recipeOf(readRecipeSetpointAsItem(build({ recipe: "jellynut-processing" }, "jellynut-processing")))).toBe("jelly");
    });

    it("keeps the other keys of the config, in their order, and leaves the given config as it was", () => {
        const config = build({ recipe: "jellynut-processing" }, "jellynut-processing");
        const read = readRecipeSetpointAsItem(config) as Record<string, unknown>;
        expect(Object.keys(read)).toEqual(Object.keys(config));
        expect(Object.keys(read.setpoint as object)).toEqual(Object.keys(config.setpoint));
        expect(config.setpoint.recipe).toBe("jellynut-processing");
    });

    it("stays as it is where a machine of the build makes the name: an item that is also the name of a recipe", () => {
        expect(mainProductOf("iron-ore-recycling")).toBe("iron-ore");
        for (const [name, recipe] of [["iron-bacteria", "iron-bacteria-cultivation"], ["iron-ore", "iron-ore-recycling"], ["iron-gear-wheel", "iron-gear-wheel"]] as const) {
            const config = build({ recipe: name }, recipe);
            expect(readRecipeSetpointAsItem(config)).toBe(config);
        }
        const bacteria = build({ recipe: "iron-bacteria" }, "iron-bacteria", "iron-bacteria-cultivation");
        expect(readRecipeSetpointAsItem(bacteria)).toBe(bacteria);
        // a machine on the recipe of that name makes the bacteria only as a byproduct: the setpoint is never read as the byproduct
        for (const name of ["iron-bacteria", "copper-bacteria"]) {
            const byproduct = build({ recipe: name }, name);
            expect(readRecipeSetpointAsItem(byproduct)).toBe(byproduct);
        }
    });

    it("stays as typed where it is neither an item a machine makes nor a recipe whose main product one makes", () => {
        for (const config of [
            build({ recipe: "no-such-thing" }, "jellynut-processing"),
            build({ recipe: "jellynut-processing" }, "iron-gear-wheel"),
            build({ recipe: "jellynut-processing" }),
            build({ recipe: "sulfuric-acid" }, "sulfuric-acid"),
        ]) {
            expect(readRecipeSetpointAsItem(config)).toBe(config);
        }
    });

    it("is never read as an item where the setpoint counts an item destroyed", () => {
        const config = build({ recipe: "jellynut-processing", counts: "destroyed" }, "jellynut-processing");
        expect(readRecipeSetpointAsItem(config)).toBe(config);
    });

    it("leaves a value that is not a config as it is", () => {
        for (const value of [undefined, null, 3, "config", [], {}, { setpoint: 2 }, { setpoint: { recipe: 2 }, machines: [] }, { setpoint: { recipe: "jelly" }, machines: "none" }]) {
            expect(readRecipeSetpointAsItem(value)).toBe(value);
        }
    });
});
