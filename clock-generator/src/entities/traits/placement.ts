import { FactorioDataService } from "../../data";
import * as Game from "../../data/generated/prototype-types";
import { Chest } from "../chest/chest";
import { directMachineStop } from "../drill/mining-drill-ext";
import { InputLimitsTrait } from "./input-limits";

/** Where a result a placer places lands in its target */
export interface PlacementResult {
    readonly item: string;
    /**
     * "ingredients" of a machine that takes it, "input-slots" of a silo whose fixed recipe takes it, "storage" of another
     * container that accepts it; null where the target takes none (it stays in the placer)
     */
    readonly lands_in: "ingredients" | "storage" | "input-slots" | null;
    /** Into a machine: the stop it fills the ingredient to, the larger of the item's stack and the limit, + 64; null elsewhere */
    readonly into_machine_stop: number | null;
}

/** A machine that places its results itself (a recycler) or a drill: it puts what it makes into the target at its result spot */
export interface PlacementTrait {
    readonly mechanism: "result-placement" | "mining-drop";
    /** Where it places, from its centre in tiles (the prototype's `vector_to_place_result`) */
    readonly vector_to_place_result: readonly [number, number];
    /** The machine or container it places into; null for a placer without one, which keeps its results in its output */
    readonly target: string | null;
    readonly per_result: readonly PlacementResult[];
    /** Into a container it places as far as the container has room */
    readonly into_container: "room";
    /** When in a tick it places: a drill before it mines; a machine before it crafts and again after */
    readonly phase: "before-mining" | "before-and-after-craft";
    /** Whether it starts no craft while a stack of any result waits in its output (a machine that places its results) */
    readonly stops_while_stack_waits: boolean;
}

/** What a placement target takes, by its traits: a machine's input limits, or the chest it is */
export type PlacementTarget = { kind: "machine"; input_limits: InputLimitsTrait } | { kind: "chest"; chest: Chest };

export function vectorOf(vector: Game.Vector): [number, number] {
    return Array.isArray(vector) ? [vector[0], vector[1]] : [vector.x, vector.y];
}

/** Where a placed result lands in the target, and the stop into a machine (directMachineStop, as a placer and a drill fill one) */
function resultOf(item: string, target: PlacementTarget | null): PlacementResult {
    if (target === null) {
        return { item, lands_in: null, into_machine_stop: null };
    }
    if (target.kind === "machine") {
        const ingredient = target.input_limits.limits.find(limit => limit.kind === "ingredient" && limit.item === item);
        return ingredient === undefined ? { item, lands_in: null, into_machine_stop: null }
            : { item, lands_in: "ingredients", into_machine_stop: directMachineStop(FactorioDataService.findItemOrThrow(item).stack_size, ingredient.limit) };
    }
    const chest = target.chest;
    if (Chest.isRocketSilo(chest) && chest.toInput(item)) {
        return { item, lands_in: "input-slots", into_machine_stop: null };
    }
    return { item, lands_in: chest.acceptsItem(item) ? "storage" : null, into_machine_stop: null };
}

/** A machine that places its results itself, by its prototype's `vector_to_place_result` (machine-rule.ts) */
export function machinePlacement(vector: Game.Vector, target_id: string | null, target: PlacementTarget | null, results: readonly string[]): PlacementTrait {
    return {
        mechanism: "result-placement",
        vector_to_place_result: vectorOf(vector),
        target: target_id,
        per_result: results.map(item => resultOf(item, target)),
        into_container: "room",
        phase: "before-and-after-craft",
        stops_while_stack_waits: true,
    };
}

/** A drill dropping what it mines into its target */
export function drillPlacement(vector: Game.Vector, target_id: string, target: PlacementTarget | null, item: string): PlacementTrait {
    return {
        mechanism: "mining-drop",
        vector_to_place_result: vectorOf(vector),
        target: target_id,
        per_result: [resultOf(item, target)],
        into_container: "room",
        phase: "before-mining",
        stops_while_stack_waits: false,
    };
}
