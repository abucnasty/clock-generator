import { MiningDrillConfig } from "../../config";
import { MiningDrillType } from "../../common/entity-types";
import { FactorioDataService, Item, MiningDrillSpec, Resource } from "../../data";
import { Entity } from "../entity";
import { EntityId } from "../entity-id";
import { CraftingRate } from "../machine/traits";
import { MiningProductivity } from "./mining-productivity";
import { fraction } from "../../data-types/fraction";
import { Percentage } from "../../data-types";
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
    productivity: Percentage,
    id: number,
    type: MiningDrillType,
    resource: Resource,
    crafting_rate: CraftingRate,
    production_rate: ProductionRate,
    sink_id: EntityId
}): MiningDrill {
    return {
        productivity: args.productivity,
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

/** A drill's mining speed: its prototype's, with its speed bonus */
export function drillMiningSpeed(spec: MiningDrillSpec, speed_bonus: number): number {
    return spec.mining_speed + spec.mining_speed * speed_bonus
}

/** A drill's rate on a resource: a craft is an item, mined in the resource's mining time at the drill's mining speed */
export function drillCraftingRate(
    spec: MiningDrillSpec,
    resource: Resource,
    speed_bonus: number
): CraftingRate {

    const crafting_speed = drillMiningSpeed(spec, speed_bonus)
    const energy_required = resource.minable.mining_time
    // drills always mine 1 item per craft
    const amount_per_craft = fraction(1)

    return CraftingRate.fromCraftingSpeed(
        amount_per_craft,
        crafting_speed,
        energy_required
    )
}


/** A drill as its config gives it, with its own productivity (`config.productivity`, in percent) */
function createFromConfig(config: MiningDrillConfig): MiningDrill {

    const resource: Resource = FactorioDataService.getResourceOrThrow(config.mined_item_name)

    const spec = FactorioDataService.getMiningDrillSpec(config.type)

    const crafting_rate = drillCraftingRate(
        spec,
        resource,
        config.speed_bonus,
    )

    const productivity = new Percentage(config.productivity)
    const production_rate = ProductionRate.fromCraftingRate(resource.minable.result, crafting_rate, productivity)

    return create({
        productivity,
        id: config.id,
        type: config.type,
        resource: resource,
        crafting_rate: crafting_rate,
        production_rate: production_rate,
        sink_id: config.target.type === "chest" ? EntityId.forChest(config.target.id) : EntityId.forMachine(config.target.id)
    })
}

export const MiningDrill = {
    fromConfig: createFromConfig
}