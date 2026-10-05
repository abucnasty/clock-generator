import { ItemName } from "../../../data";
import { MachineType } from "../machine-metadata";

export interface Fuel {
    readonly item_name: ItemName;
    /** Energy released by burning one item, in MJ. */
    readonly fuel_value_mj: number;
}

/** A machine energy source that burns fuel items while crafting. */
export interface BurnerEnergySource {
    /** Energy usage while crafting at 100% energy consumption, in kW. */
    readonly energy_usage_kw: number;
    /** Fuels the machine accepts. The first one is the default. */
    readonly fuels: readonly Fuel[];
}

export const NUTRIENTS: Fuel = { item_name: "nutrients", fuel_value_mj: 2 };

/** Machine types that burn fuel, and what they burn. */
const BURNER_ENERGY_SOURCES: Partial<Record<MachineType, BurnerEnergySource>> = {
    [MachineType.BIOCHAMBER]: {
        energy_usage_kw: 500,
        fuels: [NUTRIENTS],
    },
};

function forMachineType(type: MachineType): BurnerEnergySource | undefined {
    return BURNER_ENERGY_SOURCES[type];
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
    forMachineType,
    selectFuel,
};
