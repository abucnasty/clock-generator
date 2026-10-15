import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { SimulationContext } from "../sequence";

/**
 * The fields holding a plain value in what the simulation keeps, by owner (an entity's state by its type, a mode or
 * an evaluator by its class; a mode's status names it). A field added to one of them goes into the owner's state key
 * when it drives the simulation, and in any case into this list.
 */
const PLAIN_FIELDS: Record<string, string[]> = {
    // the running totals are left out of its key
    MachineState: ["craftCount", "status", "totalCrafted", "pendingOutput", "productsFinished", "craftsStarted", "outputBlockedAfterLastTick", "finishedCraftInLastTick", "productsTakenAsWindowOpened"],
    // `tick` and the counts of items are left out of its key
    inserter: ["status", "tick", "held_item", "items_picked_up", "items_dropped", "waits_for_sink", "enabled"],
    drill: ["status"],
    InserterDropMode: ["current_tick"],
    // what marks a take in the first tick of a window counts only within that tick
    InserterPickupMode: ["current_tick", "belt_grab_decided", "window_opened", "ticks_in_pickup"],
    IdleModeTransitionEvaluator: ["saw_sink_blocked", "window_opens"],
    InserterSwingModeTransitionEvaluator: ["entered_tick", "from"],
};

function plainFields(value: object, skip: string[] = []): string[] {
    return Object.entries(value)
        .filter(([key, field]) => !skip.includes(key) && (field === null || typeof field !== "object"))
        .map(([key]) => key);
}

describe("simulationStateKey", () => {
    it("knows every field with a plain value of the states, modes and evaluators", async () => {
        const fields: Record<string, string[]> = {};
        const add = (owner: string, owner_fields: string[]) => {
            if (owner_fields.length > 0) {
                fields[owner] = owner_fields;
            }
        };
        // between them, every kind of entity
        for (const path of [ConfigPaths.ELECTRIC_FURNACE, ConfigPaths.LOW_DENSITY_STRUCTURE]) {
            const context = SimulationContext.fromConfig(await loadConfigFromFile(path));
            for (const state of context.state_registry.getAllStates()) {
                add(state.constructor === Object ? state.entity_id.type : state.constructor.name, plainFields(state));
            }
            for (const state_machine of [...context.machines, ...context.inserters, ...context.drills]) {
                for (const [mode, evaluator] of (state_machine as unknown as { graph: Map<object, object> }).graph) {
                    add(mode.constructor.name, plainFields(mode, ["status"]));
                    add(evaluator.constructor.name, plainFields(evaluator));
                }
            }
        }
        expect(fields).toEqual(PLAIN_FIELDS);
    });
});
