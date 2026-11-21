import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import "./factorio-data-file";
import type { Ingredient } from "./factorio-data-types";
import { FactorioDataService } from "./factorio-data-service";
import { RecipeMetadata } from "../entities/machine/recipe/recipe-metadata";
import { setpointOutputOf } from "./setpoint-output";

type RawResult = { type: string; name: string; amount: number; main_product?: string } & Record<string, unknown>;
type RawRecipe = { name: string; main_product?: unknown; ingredients?: RawResult[]; results?: RawResult[] };
const raw: Record<string, RawRecipe> = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../resources/data-filtered.json"), "utf-8")).recipe;
const names = Object.keys(raw);
const itemResultsOf = (recipe: RawRecipe) => (Array.isArray(recipe.results) ? recipe.results : []).filter(result => result.type === "item");
/** Whether `main_product` names one of the recipe's item results (an empty string, and a fluid, do not) */
const hasMainProduct = (recipe: RawRecipe) => typeof recipe.main_product === "string" && itemResultsOf(recipe).some(result => result.name === recipe.main_product);

describe("the fields of a result that the data holds", () => {
    // red until `Ingredient` types them
    it("are typed on Ingredient", () => {
        const result = { type: "item", name: "jellynut-seed", amount: 1, independent_probability: 0.02, shared_probability: { min: 0, max: 0.4 }, ignored_by_stats: 1 } satisfies Ingredient;
        expect(result.ignored_by_stats).toBe(1);
    });

    it("are what the rule reads: the seed's own roll, the shared roll of uranium, a chunk left out of the stats, the main product", () => {
        expect(raw["jellynut-processing"].results?.find(result => result.name === "jellynut-seed")?.independent_probability).toBe(0.02);
        const uranium = raw["uranium-processing"].results!;
        const shared = (name: string) => uranium.find(result => result.name === name)!.shared_probability as { min: number; max: number };
        expect(shared("uranium-235").min).toBe(0);
        expect(shared("uranium-235").max).toBeCloseTo(0.007, 12);
        expect(shared("uranium-238").min).toBeCloseTo(0.007, 12);
        expect(shared("uranium-238").max).toBe(1);
        expect(raw["metallic-asteroid-reprocessing"].results?.find(result => result.name === "metallic-asteroid-chunk")?.ignored_by_stats).toBe(1);
        expect(raw["kovarex-enrichment-process"].main_product).toBe("");
        expect(raw["iron-bacteria"].main_product).toBe("iron-bacteria");
        expect(raw["copper-bacteria"].main_product).toBe("copper-bacteria");
    });
});

describe("the output a setpoint counts for a recipe", () => {
    const outputOf = (recipe: string) => setpointOutputOf(recipe);

    it("is chosen among the item results of a recipe with several, the largest expected amount preselected", () => {
        expect(outputOf("jellynut-processing")).toEqual({ kind: "output", item: "jelly", choices: ["jellynut-seed", "jelly"] });
        expect(outputOf("advanced-metallic-asteroid-crushing")).toEqual({ kind: "output", item: "iron-ore", choices: ["iron-ore", "copper-ore"] });
        expect(outputOf("uranium-processing")).toMatchObject({ kind: "output", item: "uranium-238" });
        expect(outputOf("yumako-processing")).toMatchObject({ kind: "output", item: "yumako-mash" });
    });

    it("is the one result of a recipe with one, a recipe that returns its own ingredient included", () => {
        expect(outputOf("iron-gear-wheel")).toEqual({ kind: "output", item: "iron-gear-wheel", choices: ["iron-gear-wheel"] });
        expect(outputOf("iron-bacteria-cultivation")).toEqual({ kind: "output", item: "iron-bacteria", choices: ["iron-bacteria"] });
    });

    it("is the one choosable result where the others are a chunk returned or the recipe's own ingredient", () => {
        expect(outputOf("metallic-asteroid-crushing")).toEqual({ kind: "output", item: "iron-ore", choices: ["iron-ore"] });
        expect(outputOf("carbonic-asteroid-crushing")).toEqual({ kind: "output", item: "carbon", choices: ["carbon"] });
        expect(outputOf("oxide-asteroid-crushing")).toEqual({ kind: "output", item: "ice", choices: ["ice"] });
    });

    it("is chosen between the bacterium and spoilage for the two bacteria recipes, spoilage preselected (the engine counts it)", () => {
        expect(outputOf("iron-bacteria")).toEqual({ kind: "output", item: "spoilage", choices: ["iron-bacteria", "spoilage"] });
        expect(outputOf("copper-bacteria")).toEqual({ kind: "output", item: "spoilage", choices: ["copper-bacteria", "spoilage"] });
    });

    it("is what the engine counts, with nothing to choose, for the three asteroid reprocessings and the kovarex process", () => {
        for (const [recipe, item] of [["metallic-asteroid-reprocessing", "metallic-asteroid-chunk"], ["carbonic-asteroid-reprocessing", "carbonic-asteroid-chunk"],
            ["oxide-asteroid-reprocessing", "oxide-asteroid-chunk"], ["kovarex-enrichment-process", "uranium-235"]] as const) {
            expect(outputOf(recipe)).toEqual({ kind: "output", item, choices: [] });
            expect(RecipeMetadata.fromRecipeName(recipe).output.name).toBe(item);
        }
    });

    it("is none for a recipe with no item result, a name no recipe has gives null", () => {
        expect(outputOf("sulfuric-acid")).toEqual({ kind: "none" });
        expect(outputOf("iron-ore-melting")).toEqual({ kind: "none" });
        expect(outputOf("no-such-recipe")).toBeNull();
    });

    it("holds the counts of the recipes in the game data", () => {
        const withItem = names.filter(name => itemResultsOf(raw[name]).length > 0);
        const without = names.filter(name => itemResultsOf(raw[name]).length === 0);
        expect(withItem).toHaveLength(629);
        expect(without).toHaveLength(33);
        for (const name of without) expect(outputOf(name)).toEqual({ kind: "none" });
        // 22 make a fluid only, 11 have no results at all
        expect(without.filter(name => Array.isArray(raw[name].results) && raw[name].results!.length > 0)).toHaveLength(22);

        const several = withItem.filter(name => itemResultsOf(raw[name]).length > 1 && !hasMainProduct(raw[name]));
        expect(several).toHaveLength(212);
        const choices = (name: string) => { const output = outputOf(name); return output?.kind === "output" ? output.choices.length : -1; };
        const choice = several.filter(name => choices(name) > 1);
        const one = several.filter(name => choices(name) === 1);
        const nothing = several.filter(name => choices(name) === 0);
        expect([choice.length, one.length, nothing.length]).toEqual([205, 3, 4]);
        expect(one.sort()).toEqual(["carbonic-asteroid-crushing", "metallic-asteroid-crushing", "oxide-asteroid-crushing"]);
        expect(nothing.sort()).toEqual(["carbonic-asteroid-reprocessing", "kovarex-enrichment-process", "metallic-asteroid-reprocessing", "oxide-asteroid-reprocessing"]);
        // and with the two bacteria recipes, 207 offer a choice
        expect(withItem.filter(name => choices(name) > 1)).toHaveLength(207);
        expect(withItem.filter(name => hasMainProduct(raw[name]) && itemResultsOf(raw[name]).length > 1).sort()).toEqual(["copper-bacteria", "iron-bacteria"]);
    });

    it("is the item the engine counts, for every recipe with an item result", () => {
        // for the bacteria recipes the engine counts spoilage there, and the rule preselects it
        for (const name of names.filter(name => itemResultsOf(raw[name]).length > 0)) {
            const output = setpointOutputOf(name);
            expect(output, name).toMatchObject({ kind: "output", item: RecipeMetadata.fromRecipeName(name).output.name });
        }
    });

    it("lists every choice among the recipe's item results, never a result the data leaves out of the stats", () => {
        for (const name of names) {
            const output = setpointOutputOf(name);
            if (output?.kind !== "output") continue;
            const recipe = FactorioDataService.findRecipeOrThrow(name);
            for (const item of output.choices) expect(recipe.results.some(result => result.name === item), `${name} ${item}`).toBe(true);
            if (output.choices.length > 0) expect(output.choices).toContain(output.item);
            if (recipe.results.length > 1 && output.choices.length > 0) {
                for (const item of output.choices) expect(recipe.results.find(result => result.name === item)?.ignored_by_stats ?? 0, `${name} ${item}`).toBe(0);
            }
        }
    });
});
