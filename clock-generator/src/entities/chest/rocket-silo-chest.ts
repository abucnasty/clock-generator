import { ChestType } from "../../common/entity-types";
import { RocketSiloConfig } from "../../config/schema";
import { EnrichedRecipe, FactorioDataService, ItemName, RocketSiloPrototype } from "../../data";
import { EntityId } from "../entity-id";
import { AutomatedInsertionLimit } from "../machine/input/automated-insertion-limit";
import { OverloadMultiplier } from "../machine/traits/overload-multiplier";
import { Chest } from "./chest";

/**
 * A rocket silo taken as a chest (phase 1 of roadmap milestone M2). Its rocket inventory takes any item as far as the
 * rocket lifts its weight, and gives items to an inserter; its input slots take its fixed recipe's ingredients up to the
 * automated insertion limit of that recipe at its crafting speed, and give nothing. No craft is run. The recipe and the
 * lift weight are its prototype's, the one its type names; the ingredients are read from that recipe.
 */
export class RocketSiloChest implements Chest {
    public static fromConfig = fromConfig;
    public readonly chest_type = ChestType.ROCKET_SILO;

    constructor(
        public readonly entity_id: EntityId,
        public readonly prototype: RocketSiloPrototype,
        public readonly recipe: EnrichedRecipe,
        public readonly recipe_quality: string,
        public readonly crafting_speed: number,
        public readonly productivity: number,
        /** The automated insertion limit of each ingredient, empty when the ingredients go into the rocket inventory */
        public readonly input_limits: ReadonlyMap<ItemName, AutomatedInsertionLimit>,
        public readonly contents: readonly { item: ItemName; count: number }[],
        public readonly items_put_in: readonly ItemName[],
    ) { }

    /** Whether the item goes into the input slots */
    public toInput(item: ItemName): boolean {
        return this.input_limits.has(item);
    }

    /** The most of the item the rocket lifts, or for an ingredient the input slot's stack */
    public getCapacity(item?: ItemName): number {
        const capacity = (name: ItemName) => this.toInput(name)
            ? FactorioDataService.findItemOrThrow(name).stack_size
            : Math.floor(this.prototype.lift_weight / FactorioDataService.itemWeightOrThrow(name));
        if (item !== undefined) {
            return capacity(item);
        }
        return Math.max(0, ...this.getItemFilters().map(capacity));
    }

    /** The items it can give: those of its contents and of the build's inserters that go into the rocket inventory */
    public getItemFilters(): ItemName[] {
        return Array.from(new Set([...this.contents.map(content => content.item), ...this.items_put_in]))
            .filter(item => !this.toInput(item));
    }

    public acceptsItem(item: ItemName): boolean {
        return FactorioDataService.hasItem(item);
    }

    public toString(): string {
        return `RocketSilo(${this.entity_id.id}, ${this.recipe.name} of ${this.recipe_quality} quality)`;
    }
}

function fromConfig(config: RocketSiloConfig, items_put_in: readonly ItemName[] = []): RocketSiloChest {
    const prototype = FactorioDataService.findRocketSiloOrThrow(config.type);
    const recipe = FactorioDataService.findRecipeOrThrow(prototype.fixed_recipe);
    const recipe_quality = config.recipe_quality ?? "normal";
    const crafting_speed = config.crafting_speed ?? prototype.crafting_speed;
    const overload = OverloadMultiplier.fromCraftingSpeed(crafting_speed, recipe.energy_required);
    // the build's items are all of normal quality (level 0): they are the recipe's ingredients only for a recipe of that
    // quality; for another the game puts them into the rocket inventory
    const same_quality = FactorioDataService.findQualityOrThrow(recipe_quality).level === 0;
    const input_limits = new Map<ItemName, AutomatedInsertionLimit>(same_quality
        ? recipe.ingredients.map(ingredient => [ingredient.name, AutomatedInsertionLimit.fromIngredient(ingredient, overload)])
        : []);
    for (const content of config.contents ?? []) {
        FactorioDataService.findItemOrThrow(content.item);
    }
    return new RocketSiloChest(EntityId.forChest(config.id), prototype, recipe, recipe_quality, crafting_speed,
        config.productivity ?? 0, input_limits, config.contents ?? [], items_put_in);
}
