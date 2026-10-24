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

describe("a result's chance in the 2.1 data", () => {
    it("reads a shared probability as the width of the result's slice, so uranium processing keeps its expected amounts", async () => {
        // 2.0 said probability 0.007 and 0.993; 2.1 says shared_probability {0, 0.007} and {0.007, 1}
        const { RecipeMetadata } = await import("../entities/machine/recipe/recipe-metadata");
        const uranium = RecipeMetadata.fromRecipeName("uranium-processing");
        expect(uranium.output.name).toBe("uranium-238");
        const { expectedAmount } = await import("../entities/machine/recipe/recipe-metadata");
        const expected = Object.fromEntries(uranium.outputs.map(it => [it.name, expectedAmount(it)]));
        expect(expected["uranium-235"]).toBeCloseTo(0.007, 9);
        expect(expected["uranium-238"]).toBeCloseTo(0.993, 9);
    });

    it("reads an independent probability as the 2.0 probability", async () => {
        const { RecipeMetadata, expectedAmount } = await import("../entities/machine/recipe/recipe-metadata");
        const seed = RecipeMetadata.fromRecipeName("jellynut-processing").outputs.find(it => it.name === "jellynut-seed")!;
        expect(expectedAmount(seed)).toBeCloseTo(0.02, 9);
    });

    it("gives a car and a tank 80 slots at every quality, and a cargo wagon 40 to 100 by its quality", () => {
        // measured in the game: get_inventory_size of each prototype at each quality, and built cars and tanks
        for (const quality of ["normal", "uncommon", "rare", "epic", "legendary"]) {
            expect(FactorioDataService.containerSlots("car", quality)).toBe(80);
            expect(FactorioDataService.containerSlots("tank", quality)).toBe(80);
        }
        expect(["normal", "uncommon", "rare", "epic", "legendary"].map(quality => FactorioDataService.containerSlots("cargo-wagon", quality)))
            .toEqual([40, 50, 60, 70, 100]);
        expect(() => FactorioDataService.containerSlots("wooden-chest", "normal")).toThrow("wooden-chest is not a container of the game data");
    });

    it("has the rocket silo fixed to its rocket part recipe, and every item's weight as the game holds it", () => {
        expect(FactorioDataService.findRocketSiloOrThrow("rocket-silo")).toEqual({
            name: "rocket-silo", fixed_recipe: "rocket-part", crafting_speed: 1, module_slots: 4, lift_weight: 1_000_000,
        });
        expect(FactorioDataService.findRecipeOrThrow("rocket-part").ingredients.map(it => [it.name, it.amount]))
            .toEqual([["processing-unit", 1], ["low-density-structure", 1], ["rocket-fuel", 1]]);
        // the game keeps weights in 1/65536 parts: a processing unit weighs 1,000,000 / 300 so held
        expect(FactorioDataService.itemWeightOrThrow("processing-unit")).toBe(218453333 / 65536);
        expect(FactorioDataService.itemWeightOrThrow("iron-plate")).toBe(1000);
        expect(FactorioDataService.itemWeightOrThrow("rocket-fuel")).toBe(10000);
    });

    it("has the ticks an item takes to spoil, for the items that spoil only", () => {
        expect(FactorioDataService.itemSpoilTicks("iron-bacteria")).toBe(3600);
        expect(FactorioDataService.itemSpoilTicks("nutrients")).toBe(18000);
        expect(FactorioDataService.itemSpoilTicks("pentapod-egg")).toBe(54000);
        expect(FactorioDataService.itemSpoilTicks("agricultural-science-pack")).toBe(216000);
        expect(FactorioDataService.itemSpoilTicks("bioflux")).toBe(432000);
        expect(FactorioDataService.itemSpoilTicks("iron-plate")).toBeNull();
        expect(FactorioDataService.itemSpoilTicks("spoilage")).toBeNull();
    });
});
