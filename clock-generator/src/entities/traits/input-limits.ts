import { RocketSiloChest } from "../chest/rocket-silo-chest";
import { MachineInput } from "../machine/input/machine-input";
import { OverloadMultiplier } from "../machine/traits/overload-multiplier";
import { BurnedFuel } from "./energy";

/** How far an inserter tops an input up: it drops no hand at or above the limit; a hand goes in whole, so stock may end above it */
export interface InputLimit {
    readonly item: string;
    readonly limit: number;
    readonly kind: "ingredient" | "fuel" | "silo-input";
}

export interface InputLimitsTrait {
    readonly overload_multiplier: number;
    readonly limits: readonly InputLimit[];
}

/**
 * A machine's limits, an input an inserter fills each (Machine.getInsertableInputs): each ingredient's, then the fuel
 * slot's of a machine whose fuel is modelled. A fuel that is also an ingredient (nutrients into a biochamber that makes
 * eggs or breeds fish) is one input at the ingredient's limit, which fills the fuel slot along the way: it has no row of
 * its own here, and its slot's limit stays in `energy.fuel.slot_limit`.
 */
export function machineInputLimits(overload_multiplier: OverloadMultiplier, inputs: readonly MachineInput[], fuel: BurnedFuel | null): InputLimitsTrait {
    const limits: InputLimit[] = inputs.map(input => ({
        item: input.item_name,
        limit: input.automated_insertion_limit.quantity,
        kind: "ingredient",
    }));
    if (fuel !== null && !limits.some(limit => limit.item === fuel.item)) {
        limits.push({ item: fuel.item, limit: fuel.slot_limit, kind: "fuel" });
    }
    return { overload_multiplier: overload_multiplier.overload_multiplier, limits };
}

/**
 * A rocket silo's input slots: its fixed recipe's ingredients at its crafting speed (rocket-silo-chest.ts); none when the
 * recipe's quality puts the build's items into the rocket inventory
 */
export function siloInputLimits(silo: RocketSiloChest): InputLimitsTrait {
    return {
        overload_multiplier: silo.overload_multiplier.overload_multiplier,
        limits: Array.from(silo.input_limits.values(), limit => ({ item: limit.item, limit: limit.quantity, kind: "silo-input" as const })),
    };
}
