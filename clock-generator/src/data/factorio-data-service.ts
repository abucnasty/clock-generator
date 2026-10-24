import { ContainerPrototype, CraftingMachinePrototype, FactorioData, Ingredient, InserterPrototype, InserterResearch, Item, ItemName, MiningDrillSpec, QualityName, QualitySpec, Recipe, Resource, ResourceName, RocketSiloPrototype } from "./factorio-data-types";
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

    /** The recipe of that name as the data holds it; null when there is none (own keys only) */
    public static findRecipe(recipeName: string): Recipe | null {
        const recipes = this.getData().recipe;
        return Object.prototype.hasOwnProperty.call(recipes, recipeName) ? recipes[recipeName] : null;
    }

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

    /** The ticks an item takes to spoil, as the game data has them; null for an item that does not spoil or that the data does not have */
    public static itemSpoilTicks(itemName: ItemName): number | null {
        const spoil_ticks = this.getData().item[itemName]?.spoil_ticks;
        return typeof spoil_ticks === "number" && spoil_ticks > 0 ? spoil_ticks : null;
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

    /** The container prototype of that name (a car, a tank, a cargo wagon); an unknown name is refused */
    public static findContainerOrThrow(name: string): ContainerPrototype {
        const containers = this.getData().container;
        if (!Object.prototype.hasOwnProperty.call(containers, name)) {
            throw new Error(`${name} is not a container of the game data`);
        }
        return containers[name];
    }

    /**
     * The slots of a container of that prototype and quality: its inventory size, times the quality's cargo wagon
     * multiplier where the prototype lets quality change it (exact at every quality of 2.1.21: 40, 50, 60, 70, 100)
     */
    public static containerSlots(name: string, quality: QualityName): number {
        const container = this.findContainerOrThrow(name);
        this.findQualityOrThrow(quality);
        if (!container.quality_affects_inventory_size) {
            return container.inventory_size;
        }
        const multiplier = this.getData().quality_inventory[quality]?.cargo_wagon_inventory_size_multiplier ?? 1;
        return Math.floor(container.inventory_size * multiplier);
    }

    /** The rocket silo prototype of that name; an unknown name is refused */
    public static findRocketSiloOrThrow(name: string): RocketSiloPrototype {
        const silos = this.getData().rocket_silo;
        if (!Object.prototype.hasOwnProperty.call(silos, name)) {
            throw new Error(`${name} is not a rocket silo of the game data`);
        }
        return silos[name];
    }

    /** The crafting machine prototype of that name (an assembling machine or a furnace); null when the data has none */
    public static findCraftingMachine(name: string): CraftingMachinePrototype | null {
        const machines = this.getData().crafting_machine ?? {};
        return Object.prototype.hasOwnProperty.call(machines, name) ? machines[name] : null;
    }

    /**
     * The game's English name of an item, fluid or entity id ("Iron plate", "Cargo wagon"); for an id the data does not
     * name, the id with its first letter upper case and its dashes as spaces
     */
    public static itemDisplayName(id: string): string {
        const names = this.getData().names?.item ?? {};
        return Object.prototype.hasOwnProperty.call(names, id) ? names[id] : displayNameOfId(id);
    }

    /** The game's English name of a recipe id, else of the item of that id, else as `itemDisplayName` makes it */
    public static recipeDisplayName(id: string): string {
        const names = this.getData().names?.recipe ?? {};
        return Object.prototype.hasOwnProperty.call(names, id) ? names[id] : this.itemDisplayName(id);
    }

    /** Every crafting machine prototype of the data, in its order */
    public static getAllCraftingMachines(): CraftingMachinePrototype[] {
        return Object.values(this.getData().crafting_machine ?? {});
    }

    /** An item's weight as the game holds it; an item without one is refused */
    public static itemWeightOrThrow(item: ItemName): number {
        const weights = this.getData().item_weight;
        if (!Object.prototype.hasOwnProperty.call(weights, item)) {
            throw new Error(`Item ${item} has no weight in the game data`);
        }
        return weights[item];
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

/** "iron-plate" as "Iron plate": the name of an id the data does not name */
function displayNameOfId(id: string): string {
    const words = id.replace(/-/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}
