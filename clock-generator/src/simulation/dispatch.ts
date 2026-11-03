/**
 * How a tick picks the inserters it updates and their order.
 *
 * "configured-order" (the default): every inserter is updated every tick, takers before feeders, the takers of one
 * machine in the context's taker order (`inserterUpdateOrder`).
 *
 * "activation-order" (the new dispatch, off by default): the game's update list as observed in Factorio 2.1.24. An
 * inserter that becomes active goes to the front of the list; one that goes to sleep or is disabled by its control
 * leaves it, and the others keep their order; when it is woken or enabled again it rejoins at the front. A tick updates
 * the list from the front. Two points are not established by observation and are named options here:
 * - `woken_in_walk`: whether an inserter woken while the tick walks the list is updated in that tick
 *   ("same-tick", after the members still to come) or first in the next tick ("next-tick", the default);
 * - `leaves`: whether an inserter leaves the list after the update that finds it has to wait ("after-update", the
 *   default) or after one more update that still finds it waiting ("next-update").
 */
export type WokenInWalk = "next-tick" | "same-tick";
export type LeavesList = "after-update" | "next-update";

export interface ActivationOrderDispatch {
    readonly kind: "activation-order";
    readonly woken_in_walk: WokenInWalk;
    readonly leaves: LeavesList;
}

export type InserterDispatch = "configured-order" | ActivationOrderDispatch;

export const ACTIVATION_ORDER: ActivationOrderDispatch = {kind: "activation-order", woken_in_walk: "next-tick", leaves: "after-update"};

/**
 * The dispatch a new simulation uses: "configured-order" unless the environment variable CLOCK_NEW_DISPATCH turns the
 * new dispatch on: "1" for its defaults, or a comma-separated list of option values ("same-tick", "next-update").
 * Read once; a browser has no environment and keeps the default.
 */
export function inserterDispatchOf(setting: string | undefined): InserterDispatch {
    if (setting === undefined || setting === "" || setting === "0") return "configured-order";
    const values = setting.split(",").map(it => it.trim());
    const known = ["1", "next-tick", "same-tick", "after-update", "next-update"];
    const unknown = values.filter(it => !known.includes(it));
    if (unknown.length > 0) throw new Error(`CLOCK_NEW_DISPATCH: unknown value ${unknown.join(", ")}`);
    return {
        kind: "activation-order",
        woken_in_walk: values.includes("same-tick") ? "same-tick" : "next-tick",
        leaves: values.includes("next-update") ? "next-update" : "after-update",
    };
}

const environment: string | undefined = typeof process !== "undefined" ? process.env?.CLOCK_NEW_DISPATCH : undefined;

export const DEFAULT_INSERTER_DISPATCH: InserterDispatch = inserterDispatchOf(environment);
