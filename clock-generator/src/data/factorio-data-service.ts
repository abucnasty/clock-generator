import { FactorioData, Ingredient, Item, ItemName, MiningDrillSpec, Recipe, Resource, ResourceName } from "./factorio-data-types";
import { MiningDrillType } from "../entities/drill/mining-drill";
import assert from "../common/assert";

export type EnrichedIngredient = Ingredient & {
    item: Item;
}

export interface EnrichedRecipe extends Recipe {
    ingredients: EnrichedIngredient[];
    results: EnrichedIngredient[];
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

        const enriched_ingredients: EnrichedIngredient[] = ingredients
            .filter(it => it.type != "fluid")
            .map(ingredient => {
                const item = this.findItemOrThrow(ingredient.name);
                return {
                    ...ingredient,
                    item: item,
                }
            })

        const enriched_results: EnrichedIngredient[] = recipe.results
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

    public static getResourceOrThrow(itemName: ResourceName): Resource {
        const resource = this.getData()["resource"][itemName];
        assert(resource, `Resource ${itemName} was not found`);
        return resource;
    }

}