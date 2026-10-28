import { ItemName } from "../../../data";

export interface Fuel {
    readonly item_name: ItemName;
    /** Energy released by burning one item, in MJ. */
    readonly fuel_value_mj: number;
}

/**
 * A machine energy source that burns fuel items while it works, from the game data: the prototype's `energy_usage` and
 * the items of its burner's fuel categories (entities/traits/energy.ts builds it).
 */
export interface BurnerEnergySource {
    /** Energy usage while crafting at 100% energy consumption, in kW. */
    readonly energy_usage_kw: number;
    /** Share of the fuel's energy the burner turns into work: 1 on every burner of 2.1.21. */
    readonly effectivity: number;
    /** Fuels the machine accepts. The first one is the default. */
    readonly fuels: readonly Fuel[];
}

/** The fuel to burn: the requested one if the source accepts it, else the source's default. */
function selectFuel(source: BurnerEnergySource, item_name?: ItemName): Fuel {
    if (item_name === undefined) {
        return source.fuels[0];
    }
    const fuel = source.fuels.find(f => f.item_name === item_name);
    if (!fuel) {
        const accepted = source.fuels.map(f => f.item_name).join(", ");
        throw new Error(`Unsupported fuel ${item_name}; accepted fuels: ${accepted}`);
    }
    return fuel;
}

export const BurnerEnergySource = {
    selectFuel,
};
