import { FactorioDataService } from "../../data";
import { CraftingMachinePrototype } from "../../data/factorio-data-types";
import * as Game from "../../data/generated/prototype-types";
import { BurnerEnergySource } from "../machine/fuel/energy-source";
import { FuelSlot } from "../machine/fuel/fuel-slot";
import { FuelConsumption, MIN_ENERGY_CONSUMPTION_BONUS_PERCENT } from "../machine/traits/fuel-consumption";
import { TICKS_PER_SECOND } from "../../data-types";

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
     * Whether the machine burns fuel items from a fuel slot: every crafting machine on a burner energy source does (the
     * stone and steel furnaces, the captive biter spawner, the biochamber). A mining drill never does: its fuel is
     * assumed supplied (see drillEnergy)
     */
    readonly fuel_modelled: boolean;
    /** What it burns, where its fuel is modelled */
    readonly fuel: BurnedFuel | null;
}

/** A burner of the game data has one answer: the registry builds its machines on every trial, so it is worked out once */
const burners = new WeakMap<Game.BurnerEnergySource, BurnerTrait>();

/** A prototype's burner, with the items of the data that burn in it */
function burnerOf(source: Game.BurnerEnergySource): BurnerTrait {
    let burner = burners.get(source);
    if (burner === undefined) {
        // the spec's defaults: a burner burns chemical fuel at full effectivity
        const fuel_categories = source.fuel_categories ?? ["chemical"];
        const fuels = Object.entries(FactorioDataService.getAllItemPrototypeFields())
            .filter(([, fields]) => fields.fuel_value !== undefined && (fields.fuel_categories ?? []).some(category => fuel_categories.includes(category)))
            .map(([item, fields]) => ({ item, fuel_value_mj: energyValue(fields.fuel_value!, "J") / 1e6 }));
        burner = { fuel_categories, effectivity: source.effectivity ?? 1, fuel_inventory_size: source.fuel_inventory_size, fuels };
        burners.set(source, burner);
    }
    return burner;
}

/** A burner energy source from the data: the prototype's energy usage and effectivity, burning the items of its fuel categories */
function burnerEnergySourceOf(energy_usage_kw: number, burner: BurnerTrait): BurnerEnergySource {
    return {
        energy_usage_kw,
        effectivity: burner.effectivity,
        fuels: burner.fuels.map(fuel => ({ item_name: fuel.item, fuel_value_mj: fuel.fuel_value_mj })),
    };
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

/** What a burner machine burns of its fuel (the one named, else the source's first) over a craft and a second, and its fuel slot */
export function burnerFuelOf(
    source: BurnerEnergySource,
    fuel_name: string | undefined,
    crafting_speed: number,
    energy_required: number,
    energy_consumption_bonus: number | undefined,
): [FuelConsumption, FuelSlot] {
    const fuel = BurnerEnergySource.selectFuel(source, fuel_name);
    const consumption = FuelConsumption.fromCraftingSpeed(
        source,
        fuel,
        crafting_speed,
        energy_required,
        energy_consumption_bonus ?? 0,
    );
    return [consumption, FuelSlot.create(fuel, consumption)];
}

/**
 * The burner a machine of the prototype burns its fuel from: the prototype's energy usage and effectivity and the items
 * of its burner's fuel categories, from the data; undefined for a machine on any other energy source and for one whose
 * prototype the data does not hold. No name, class or fuel category decides it: every burner is fuelled.
 */
export function modelledBurnerOf(prototype: CraftingMachinePrototype | null): BurnerEnergySource | undefined {
    if (prototype === null || prototype.energy_source.type !== "burner") {
        return undefined;
    }
    return burnerEnergySourceOf(energyValue(prototype.energy_usage, "W") / 1000, burnerOf(prototype.energy_source));
}

/**
 * A machine's energy, and for a burner (`fuel_modelled`) what it burns of the fuel the config names, else of its first: the source from the data, the burn by fuel-consumption.ts and fuel-slot.ts. The
 * machine (machine.ts) reads its fuel from here.
 */
export function machineEnergy(
    prototype: CraftingMachinePrototype | null,
    config: { fuel?: string; energy_consumption_bonus?: number; crafting_speed: number },
    energy_required: number,
): EnergyTrait {
    const energy = energyOf(prototype, config.energy_consumption_bonus ?? 0);
    const source = modelledBurnerOf(prototype);
    if (source === undefined) {
        return { ...energy, fuel_modelled: false, fuel: null };
    }
    const [consumption, slot] = burnerFuelOf(source, config.fuel, config.crafting_speed, energy_required, config.energy_consumption_bonus);
    return { ...energy, fuel_modelled: true, fuel: burnedFuelOf(consumption, slot) };
}

/**
 * A drill's energy: its source and usage from the data. A burner drill has an energy buffer, but no fuel slot: nothing
 * in a build feeds a drill, so its fuel is assumed supplied without limit (SuppliedBurnerEnergy).
 */
export function drillEnergy(prototype: { energy_source: Game.EnergySource; energy_usage: string }): EnergyTrait {
    return { ...energyOf(prototype, 0), fuel_modelled: false, fuel: null };
}

/**
 * The energy a burner draws in a tick of work, in MJ of fuel: the usage with the energy consumption bonus (clamped at
 * -80%) over the effectivity; null for any other energy source. A tick of work takes this much from the buffer,
 * whatever the crafting speed, productivity or what is made (recorded: tests/game/mechanics/fuel).
 */
export function burnerEnergyPerTick(energy: Pick<EnergyTrait, "energy_usage_kw" | "energy_bonus" | "burner">): number | null {
    if (energy.burner === null || energy.energy_usage_kw === null) {
        return null;
    }
    const bonus = Math.max(energy.energy_bonus, MIN_ENERGY_CONSUMPTION_BONUS_PERCENT);
    return energy.energy_usage_kw * (100 + bonus) / 100 / energy.burner.effectivity / 1000 / TICKS_PER_SECOND.toDecimal();
}
