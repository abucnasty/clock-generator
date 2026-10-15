import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import "./factorio-data-file";
import { FactorioDataService } from "./factorio-data-service";

/** The game data in resources/ is the 2.1.21 dump: what 2.1 renamed and reworked reads as the generator expects */
describe("the game data of Factorio 2.1.21", () => {
    it("names the game it came from", () => {
        const version = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../resources/data-version.json"), "utf-8"));
        expect(version.factorio_version).toBe("2.1.21");
        expect(version.build).toBe(87673);
    });

    it("loads the ore melting recipes 2.1 renamed, whose only product is a fluid", () => {
        // 2.1.21 changelog: "molten-iron" into "iron-ore-melting"; "molten-copper" into "copper-ore-melting"
        for (const [name, fluid] of [["iron-ore-melting", "molten-iron"], ["copper-ore-melting", "molten-copper"]] as const) {
            const recipe = FactorioDataService.findRecipeOrThrow(name);
            expect(recipe.results).toEqual([]);
            expect(recipe.fluid_results.map(it => it.name)).toEqual([fluid]);
            expect(recipe.ingredients.map(it => it.name)).toEqual([`${fluid.replace("molten-", "")}-ore`, "calcite"]);
            expect(recipe.categories).toEqual(["metallurgy"]);
        }
        expect(() => FactorioDataService.findRecipeOrThrow("molten-iron")).toThrow("Recipe molten-iron was not found");
    });

    it("gives every recipe a list of crafting categories, several where 2.1 reworked them", () => {
        expect(FactorioDataService.findRecipeOrThrow("advanced-circuit").categories).toEqual(["crafting", "electromagnetics"]);
        expect(FactorioDataService.findRecipeOrThrow("nutrients-from-bioflux").categories).toEqual(["organic"]);
        // a recipe the dump gives no category is made in the game's default
        expect(FactorioDataService.getAllRecipes().every(recipe => Array.isArray(recipe.categories) && recipe.categories.length > 0)).toBe(true);
    });

    it("keeps a casting recipe's fluid ingredient beside its item results", () => {
        const casting = FactorioDataService.findRecipeOrThrow("casting-iron");
        expect(casting.ingredients).toEqual([]);
        expect(casting.fluid_ingredients.map(it => it.name)).toEqual(["molten-iron"]);
        expect(casting.results.map(it => it.name)).toEqual(["iron-plate"]);
    });
});
