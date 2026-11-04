/**
 * How a tick picks the inserters it updates and their order: the game's update list as observed in Factorio 2.1.24. An
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

/** The dispatch with its two open points chosen */
export type InserterDispatch = ActivationOrderDispatch;

/** The dispatch every simulation uses unless a test chooses its open points otherwise */
export const ACTIVATION_ORDER: ActivationOrderDispatch = {kind: "activation-order", woken_in_walk: "next-tick", leaves: "after-update"};
