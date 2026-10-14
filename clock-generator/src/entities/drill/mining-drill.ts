import { MiningDrillConfig } from "../../config";
import { MiningDrillType } from "../../common/entity-types";
import { FactorioDataService, Item, MiningDrillSpec, Resource } from "../../data";
import { Entity } from "../entity";
import { EntityId } from "../entity-id";
import { CraftingRate } from "../machine/traits";
import { MiningProductivity } from "./mining-productivity";
import { fraction } from "fractionability";
import { ProductionRate } from "../machine";

// Re-export for backwards compatibility
export { MiningDrillType } from "../../common/entity-types";

export interface MiningDrillMetadata {
    type: MiningDrillType;
}

interface MiningDrillOutput {
    item: Item;
    resource: Resource;
    production_rate: ProductionRate;
    crafting_rate: CraftingRate;
    sink_id: EntityId
}

export interface MiningDrill extends Entity, MiningProductivity, MiningDrillOutput {
    meta: MiningDrillMetadata
}

function create(args: {
    productivity: MiningProductivity,
    id: number,
    type: MiningDrillType,
    resource: Resource,
    crafting_rate: CraftingRate,
    production_rate: ProductionRate,
    sink_id: EntityId
}): MiningDrill {
    return {
        productivity: args.productivity.productivity,
        entity_id: EntityId.forDrill(args.id),
        meta: {
            type: args.type,
        },
        resource: args.resource,
        item: FactorioDataService.findItemOrThrow(args.resource.minable.result),
        crafting_rate: args.crafting_rate,
        production_rate: args.production_rate,
        sink_id: args.sink_id
    }
}

function createCraftingRate(
    spec: MiningDrillSpec,
    resource: Resource,
    speed_bonus: number
): CraftingRate {

    const crafting_speed = spec.mining_speed + spec.mining_speed * speed_bonus
    const energy_required = resource.minable.mining_time
    // drills always mine 1 item per craft
    const amount_per_craft = fraction(1)

    return CraftingRate.fromCraftingSpeed(
        amount_per_craft,
        crafting_speed,
        energy_required
    )
}


function createFromConfig(mining_prod: MiningProductivity, config: MiningDrillConfig): MiningDrill {

    const resource: Resource = FactorioDataService.getResourceOrThrow(config.mined_item_name)

    const spec = FactorioDataService.getMiningDrillSpec(config.type)

    const crafting_rate = createCraftingRate(
        spec,
        resource,
        config.speed_bonus,
    )

    const production_rate = ProductionRate.fromCraftingRate(resource.minable.result, crafting_rate, mining_prod.productivity)

    return create({
        productivity: mining_prod,
        id: config.id,
        type: config.type,
        resource: resource,
        crafting_rate: crafting_rate,
        production_rate: production_rate,
        sink_id: EntityId.forMachine(config.target.id)
    })
}

export const MiningDrill = {
    fromConfig: createFromConfig
}