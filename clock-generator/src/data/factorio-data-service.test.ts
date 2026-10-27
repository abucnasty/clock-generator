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

describe("an item's name in a sentence", () => {
    it("is the game's name with its first letter lower case", () => {
        expect(FactorioDataService.itemNameInSentence("military-science-pack")).toBe("military science pack");
        expect(FactorioDataService.itemNameInSentence("tungsten-ore")).toBe("tungsten ore");
        expect(FactorioDataService.itemNameInSentence("power-armor-mk2")).toBe("power armor MK2");
    });

    it("is the id as words for an id the data does not name", () => {
        expect(FactorioDataService.itemNameInSentence("not-an-item")).toBe("not an item");
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

    it("reads a recycling recipe's extra count fraction as the chance of one item, and its variance as a Bernoulli's", async () => {
        // measured on the recycler (2.1.21): a gear gives an iron plate at 0.4978 over 47,992 crafts; an electronic
        // circuit an iron plate at 0.2527 and a copper cable at 0.7487 over 19,196; iron ore itself back at 0.2511
        const { RecipeMetadata, expectedAmount, amountVariance } = await import("../entities/machine/recipe/recipe-metadata");
        const gear = RecipeMetadata.fromRecipeName("iron-gear-wheel-recycling");
        expect(gear.outputs.map(it => [it.name, expectedAmount(it)])).toEqual([["iron-plate", 0.5]]);
        expect(amountVariance(gear.output)).toBeCloseTo(0.25, 12);
        const circuit = RecipeMetadata.fromRecipeName("electronic-circuit-recycling");
        expect(circuit.output.name).toBe("copper-cable");
        expect(Object.fromEntries(circuit.outputs.map(it => [it.name, expectedAmount(it)]))).toEqual({ "copper-cable": 0.75, "iron-plate": 0.25 });
        expect(amountVariance(circuit.output)).toBeCloseTo(0.1875, 12);
        const ore = RecipeMetadata.fromRecipeName("iron-ore-recycling");
        expect(expectedAmount(ore.output)).toBe(0.25);
        expect(amountVariance(ore.output)).toBeCloseTo(0.1875, 12);
        // a result that always comes in its amount has none
        expect(amountVariance(RecipeMetadata.fromRecipeName("iron-gear-wheel").output)).toBe(0);
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
