import { FactorioData, Ingredient, InserterPrototype, InserterResearch, Item, ItemName, MiningDrillSpec, QualitySpec, Recipe, Resource, ResourceName } from "./factorio-data-types";
import { MiningDrillType } from "../entities/drill/mining-drill";
import assert from "../common/assert";

export type EnrichedIngredient = Ingredient & {
    item: Item;
}

export interface EnrichedRecipe extends Recipe {
    /** The item ingredients; the fluids are in `fluid_ingredients` */
    ingredients: EnrichedIngredient[];
    /** The item results; the fluids are in `fluid_results` */
    results: EnrichedIngredient[];
    /** The fluid ingredients, as the game data lists them: not simulated, kept to say so */
    fluid_ingredients: Ingredient[];
    /** The fluid results, as the game data lists them: not simulated, kept to refuse a fluid-only recipe by name */
    fluid_results: Ingredient[];
}

export class FactorioDataService {

    private static factorio_data: FactorioData | null = null;
    private static initialized: boolean = false;
    private static default_source: (() => FactorioData) | null = null;

    /**
     * Initialize the service with Factorio data.
     * In Node.js, importing `factorio-data-file` makes this happen on first use.
     * In browser, call this with fetched data before using the service.
     */
    public static initialize(data: FactorioData): void {
        this.factorio_data = data;
        this.initialized = true;
    }

    /**
     * Where the data comes from when it is used before `initialize`: `factorio-data-file` sets the file in resources/.
     */
    public static setDefaultSource(source: () => FactorioData): void {
        this.default_source = source;
    }

    /**
     * Check if the service has been initialized with data.
     */
    public static isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Whether the data can be read: initialized, or with a default source to read it from on first use, as in Node once
     * `factorio-data-file` is imported. In the browser, where the data is fetched, it is the same as `isInitialized`.
     */
    public static isAvailable(): boolean {
        return this.initialized || this.default_source !== null;
    }

    /**
     * Get the Factorio data, initializing from the default source if there is one.
     */
    private static getData(): FactorioData {
        if (!this.factorio_data) {
            if (!this.default_source) {
                throw new Error(
                    "FactorioDataService not initialized. Call FactorioDataService.initialize(data) with fetched data before use."
                );
            }
            this.factorio_data = this.default_source();
            this.initialized = true;
        }
        return this.factorio_data;
    }

    /** Whether the game has an item of that name (a module, tool, ammo or capsule counts as an item) */
    public static hasItem(itemName: string): boolean {
        return Object.prototype.hasOwnProperty.call(this.getData().item, itemName);
    }

    // ============ Recipe Listing Methods ============

    /**
     * Get all recipe names available in the data.
     */
    public static getAllRecipeNames(): string[] {
        return Object.keys(this.getData().recipe);
    }

    /**
     * Get all recipes available in the data.
     */
    public static getAllRecipes(): Recipe[] {
        return Object.values(this.getData().recipe);
    }

    /**
     * Search recipes by name (case-insensitive partial match).
     */
    public static searchRecipes(query: string): Recipe[] {
        const lowerQuery = query.toLowerCase();
        return this.getAllRecipes().filter(recipe =>
            recipe.name.toLowerCase().includes(lowerQuery)
        );
    }

    /**
     * Get all item names available in the data (from all item categories).
     */
    public static getAllItemNames(): string[] {
        const data = this.getData();
        return [
            ...Object.keys(data.item)
        ];
    }

    /**
     * Get all resource names available in the data.
     */
    public static getAllResourceNames(): string[] {
        return Object.keys(this.getData().resource);
    }

    public static readonly DEFAULT_ENERGY_REQUIRED = 0.5

    public static findRecipeOrThrow(recipeName: string): EnrichedRecipe {
        const recipe = this.getData().recipe[recipeName]

        if (!recipe) {
            throw new Error(`Recipe ${recipeName} was not found`)
        }

        const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : []
        // a recipe without results is an empty Lua table in the dump, which is {} in JSON
        const results = Array.isArray(recipe.results) ? recipe.results : []

        const enriched_ingredients: EnrichedIngredient[] = ingredients
            .filter(it => it.type != "fluid")
            .map(ingredient => {
                const item = this.findItemOrThrow(ingredient.name);
                return {
                    ...ingredient,
                    item: item,
                }
            })

        const enriched_results: EnrichedIngredient[] = results
            .filter(it => it.type != "fluid")
            .map(result => {
                const item = this.findItemOrThrow(result.name);
                return {
                    ...result,
                    item: item,
                }
            })

        return {
            ...recipe,
            ingredients: enriched_ingredients,
            results: enriched_results,
            fluid_ingredients: ingredients.filter(it => it.type == "fluid"),
            fluid_results: results.filter(it => it.type == "fluid"),
            energy_required: recipe.energy_required ?? this.DEFAULT_ENERGY_REQUIRED,
        }
    }

    public static findItemOrThrow(itemName: ItemName): Item {
        const data = this.getData();
        const item = data.item[itemName] 

        if(!item) {
            throw new Error(`Item ${itemName} was not found`);
        }

        const result = { ...item };

        result.name = itemName;
        return result;
    }

    public static getMiningDrillSpec(type: MiningDrillType): MiningDrillSpec {
        const spec = this.getData()["mining-drill"][type];
        assert(spec, `Mining drill spec for type ${type} was not found`);
        return spec;
    }

    /** The inserter prototype of that name; an unknown name is refused (own keys only: "constructor" is no inserter) */
    public static findInserterOrThrow(name: string): InserterPrototype {
        const inserters = this.getData().inserter;
        if (!Object.prototype.hasOwnProperty.call(inserters, name)) {
            throw new Error(`${name} is not an inserter of the game data`);
        }
        return inserters[name];
    }

    /** The quality of that name; an unknown name is refused */
    public static findQualityOrThrow(name: string): QualitySpec {
        const qualities = this.getData().quality;
        if (!Object.prototype.hasOwnProperty.call(qualities, name)) {
            throw new Error(`${name} is not a quality of the game data`);
        }
        return qualities[name];
    }

    /** What all the technologies together add to the hand of an inserter */
    public static inserterResearch(): InserterResearch {
        return this.getData().inserter_research;
    }

    public static getResourceOrThrow(itemName: ResourceName): Resource {
        const resource = this.getData()["resource"][itemName];
        assert(resource, `Resource ${itemName} was not found`);
        return resource;
    }

}