import { FactorioDataService } from "../../data";
import * as Game from "../../data/generated/prototype-types";
import { burnerFuelOf } from "../machine/machine";
import { BurnerEnergySource } from "../machine/fuel/energy-source";
import { FuelSlot } from "../machine/fuel/fuel-slot";
import { FuelConsumption } from "../machine/traits/fuel-consumption";

const SI_PREFIX: Readonly<Record<string, number>> = { "": 1, k: 1e3, M: 1e6, G: 1e9, T: 1e12 };

/** Energy as the game data writes it ("500kW", "2MJ", "1.21GJ"), in watts or joules; an unreadable text is refused */
export function energyValue(text: string, unit: "W" | "J"): number {
    const match = /^(\d+(?:\.\d+)?)([kMGT]?)([WJ])$/.exec(text);
    if (match === null || match[3] !== unit) {
        throw new Error(`${text} is no energy in ${unit} of the game data`);
    }
    return Number(match[1]) * SI_PREFIX[match[2]];
}

/** The burner of a prototype as the data gives it, each field at the spec's default where the data names none */
export interface BurnerTrait {
    readonly fuel_categories: readonly string[];
    readonly effectivity: number;
    readonly fuel_inventory_size: number;
    /** The items of the data that burn in it (of one of its fuel categories), in the data's order, the default first */
    readonly fuels: readonly { readonly item: string; readonly fuel_value_mj: number }[];
}

/** What a machine burns of its fuel while crafting, as fuel-consumption.ts and fuel-slot.ts work it out */
export interface BurnedFuel {
    readonly item: string;
    readonly fuel_value_mj: number;
    readonly per_craft: number;
    readonly per_second: number;
    readonly per_tick: number;
    /** The fuel slot's automated insertion limit: 5, or more for a machine that burns fast */
    readonly slot_limit: number;
    readonly energy_per_craft_mj: number;
}

export interface EnergyTrait {
    /** The energy source's type; null for a machine whose prototype the data does not hold */
    readonly source: Game.EnergySource["type"] | null;
    readonly energy_usage_kw: number | null;
    /** The energy consumption effect in percent, as configured (speed modules raise it, efficiency modules lower it) */
    readonly energy_bonus: number;
    readonly burner: BurnerTrait | null;
    /**
     * Whether the simulator models this burner's fuel today: only a machine under the biochamber rule (a burner on the
     * nutrients fuel category, machine-rule.ts) burns fuel; the stone and steel furnaces, the captive biter spawner and
     * the burner mining drill run without any (a kept quirk)
     */
    readonly fuel_modelled: boolean;
    /** What it burns, where its fuel is modelled */
    readonly fuel: BurnedFuel | null;
}

/** A prototype's burner, with the items of the data that burn in it */
function burnerOf(source: Game.BurnerEnergySource): BurnerTrait {
    // the spec's defaults: a burner burns chemical fuel at full effectivity
    const fuel_categories = source.fuel_categories ?? ["chemical"];
    const fuels = Object.entries(FactorioDataService.getAllItemPrototypeFields())
        .filter(([, fields]) => fields.fuel_value !== undefined && (fields.fuel_categories ?? []).some(category => fuel_categories.includes(category)))
        .map(([item, fields]) => ({ item, fuel_value_mj: energyValue(fields.fuel_value!, "J") / 1e6 }));
    return { fuel_categories, effectivity: source.effectivity ?? 1, fuel_inventory_size: source.fuel_inventory_size, fuels };
}

/** A burner energy source from the data: the prototype's energy usage, burning the items of its fuel categories */
function burnerEnergySourceOf(energy_usage_kw: number, burner: BurnerTrait): BurnerEnergySource {
    return { energy_usage_kw, fuels: burner.fuels.map(fuel => ({ item_name: fuel.item, fuel_value_mj: fuel.fuel_value_mj })) };
}

function burnedFuelOf(consumption: FuelConsumption, slot: FuelSlot): BurnedFuel {
    return {
        item: slot.fuel.item_name,
        fuel_value_mj: slot.fuel.fuel_value_mj,
        per_craft: consumption.amount_per_craft,
        per_second: consumption.rate_per_second,
        per_tick: consumption.rate_per_tick,
        slot_limit: slot.automated_insertion_limit,
        energy_per_craft_mj: slot.energy_per_craft_mj,
    };
}

/** What a prototype runs on, from its `energy_source` by the source's type and its `energy_usage` */
function energyOf(prototype: { energy_source: Game.EnergySource; energy_usage: string } | null, energy_bonus: number) {
    const burner = prototype?.energy_source.type === "burner" ? burnerOf(prototype.energy_source) : null;
    return {
        source: prototype?.energy_source.type ?? null,
        energy_usage_kw: prototype === null ? null : energyValue(prototype.energy_usage, "W") / 1000,
        energy_bonus,
        burner,
    };
}

/**
 * A machine's energy, and where its fuel is modelled (`fuel_modelled`, from today's rule) what it burns of the fuel the
 * config names, else of its first: the source from the data, the burn by the functions the machine uses (machine.ts)
 */
export function machineEnergy(
    prototype: { energy_source: Game.EnergySource; energy_usage: string } | null,
    config: { fuel?: string; energy_consumption_bonus?: number; crafting_speed: number },
    energy_required: number,
    fuel_modelled: boolean,
): EnergyTrait {
    const energy = energyOf(prototype, config.energy_consumption_bonus ?? 0);
    if (!fuel_modelled || energy.burner === null || energy.energy_usage_kw === null) {
        return { ...energy, fuel_modelled: false, fuel: null };
    }
    const source = burnerEnergySourceOf(energy.energy_usage_kw, energy.burner);
    const [consumption, slot] = burnerFuelOf(source, config.fuel, config.crafting_speed, energy_required, config.energy_consumption_bonus);
    return { ...energy, fuel_modelled: true, fuel: burnedFuelOf(consumption, slot) };
}

/** A drill's energy: its source and usage from the data; no drill's fuel is modelled */
export function drillEnergy(prototype: { energy_source: Game.EnergySource; energy_usage: string }): EnergyTrait {
    return { ...energyOf(prototype, 0), fuel_modelled: false, fuel: null };
}
