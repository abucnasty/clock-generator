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

/** The values of a setting, none for the setting that leaves the new dispatch off */
function valuesOf(setting: string | undefined): string[] {
    if (setting === undefined || setting === "" || setting === "0") return [];
    const values = setting.split(",").map(it => it.trim());
    const known = ["1", "next-tick", "same-tick", "after-update", "next-update", "configured-order", "kept-lists"];
    const unknown = values.filter(it => !known.includes(it));
    if (unknown.length > 0) throw new Error(`CLOCK_NEW_DISPATCH: unknown value ${unknown.join(", ")}`);
    return values;
}

/**
 * The dispatch a new simulation uses: "configured-order" unless the environment variable CLOCK_NEW_DISPATCH turns the
 * new dispatch on: "1" for its defaults, or a comma-separated list of option values ("same-tick", "next-update").
 * "configured-order,kept-lists" keeps the old dispatch with the new dispatch's wake-up rule (`keptListsOf`), to count
 * clocks of the old dispatch the new way. Read once; a browser has no environment and keeps the default.
 */
export function inserterDispatchOf(setting: string | undefined): InserterDispatch {
    const values = valuesOf(setting);
    if (values.length === 0 || values.includes("configured-order")) return "configured-order";
    return {
        kind: "activation-order",
        woken_in_walk: values.includes("same-tick") ? "same-tick" : "next-tick",
        leaves: values.includes("next-update") ? "next-update" : "after-update",
    };
}

/**
 * Whether the setting counts wake-ups by the rule "kept-lists" (crafting/wake-ups.ts, `WakeRule`): wherever it turns the
 * new dispatch on, and on the old dispatch with "configured-order,kept-lists"
 */
export function keptListsOf(setting: string | undefined): boolean {
    const values = valuesOf(setting);
    return values.length > 0 && (!values.includes("configured-order") || values.includes("kept-lists"));
}

const environment: string | undefined = typeof process !== "undefined" ? process.env?.CLOCK_NEW_DISPATCH : undefined;

export const DEFAULT_INSERTER_DISPATCH: InserterDispatch = inserterDispatchOf(environment);

/** Whether the wake-up rule of a new count is "kept-lists" (`keptListsOf` of the environment) */
export const DEFAULT_KEPT_LISTS: boolean = keptListsOf(environment);
