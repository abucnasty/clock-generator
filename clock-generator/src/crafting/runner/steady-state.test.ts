import { GameFixturePaths } from "../../../tests/game/helpers/fixture-paths";
import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { SimulationContext } from "../sequence";
import { InserterDropMode, InserterPickupMode } from "../../control-logic/inserter/modes";

/**
 * The fields holding a plain value in what the simulation keeps, by owner (an entity's state by its type, a mode, an
 * evaluator, a hand's port or its scratch record by its class; a mode's status names it). A field added to one of them
 * goes into its owner's state key when it drives the simulation, and in any case into this list. A machine's state
 * holds components only: its Crafting and its Wakes pin their own fields (simulation/components/crafting.test.ts), as
 * Energy, Yield and Placement do; its archetype holds none (CraftingMachineArchetype is walked and must stay out of
 * this list).
 */
const PLAIN_FIELDS: Record<string, string[]> = {
    // `tick` and the counts of items are left out of its key
    inserter: ["status", "tick", "held_item", "items_picked_up", "items_dropped", "waits_for_sink", "enabled"],
    DrillState: ["status"],
    // what a hand's ports keep between ticks: the pickup ticks of a machine or a container, a belt's decision tick and
    // the drop ticks of a machine or a container are in the pickup and drop modes' keys; what marks a take in the first
    // tick of a window counts only within that tick (`window_opened`, `ticks_in_pickup`)
    HandScratch: ["pickup_ticks", "window_opened", "ticks_in_pickup", "belt_grab_decided", "drop_ticks"],
    // where on the lane the hand puts its stacks down, and whether at a spot of the config, the same in every tick
    BeltHandDrop: ["at_spot", "spot_ticks"],
    // how the inserter reaches over the belt and its nearest lane, the same in every tick; belt position is in the
    // source state
    BeltHandPickup: ["layout", "near_lane"],
    // the order of its decider is the build's, the same in every tick
    MachineHandPickup: ["decider_build_order"],
    IdleModeTransitionEvaluator: ["saw_sink_blocked", "window_opens"],
    InserterSwingModeTransitionEvaluator: ["entered_tick", "from"],
    // whether it swings a part hand at its source (a machine that places its results itself), the same in every tick
    PickupModeTransitionEvaluator: ["swings_part_hands"],
};

function plainFields(value: object, skip: string[] = []): string[] {
    return Object.entries(value)
        .filter(([key, field]) => !skip.includes(key) && (field === null || (typeof field !== "object" && typeof field !== "function")))
        .map(([key]) => key);
}

describe("simulationStateKey", () => {
    it("knows every field with a plain value of the states, modes, evaluators and hands' ports", async () => {
        const fields: Record<string, string[]> = {};
        const add = (owner: string, owner_fields: string[]) => {
            if (owner_fields.length > 0) {
                fields[owner] = owner_fields;
            }
        };
        // between them, every kind of entity
        for (const path of [ConfigPaths.ELECTRIC_FURNACE, ConfigPaths.LOW_DENSITY_STRUCTURE, GameFixturePaths.SAME_ITEM_CONFIG]) {
            const context = SimulationContext.fromConfig(await loadConfigFromFile(path));
            for (const state of context.state_registry.getAllStates()) {
                add(state.constructor === Object ? state.entity_id.type : state.constructor.name, plainFields(state));
            }
            // a machine has no modes: its archetype keys its status alone (crafting-machine.test.ts) and holds references
            // only (its result target null for none), so a plain field added to it shows up here; a drill has no modes
            // either: its Mining pins its own fields (simulation/components/mining.test.ts)
            for (const machine of context.machines) {
                add(machine.constructor.name, plainFields(machine, ["result_target"]));
            }
            for (const state_machine of [...context.inserters]) {
                for (const [mode, evaluator] of (state_machine as unknown as { graph: Map<object, object> }).graph) {
                    add(mode.constructor.name, plainFields(mode, ["status"]));
                    if (mode instanceof InserterPickupMode || mode instanceof InserterDropMode) {
                        add(mode.port.constructor.name, plainFields(mode.port));
                        const scratch = (mode.port as unknown as { scratch?: object }).scratch;
                        if (scratch !== undefined) {
                            add(scratch.constructor.name, plainFields(scratch));
                        }
                    }
                    add(evaluator.constructor.name, plainFields(evaluator));
                }
            }
        }
        expect(fields).toEqual(PLAIN_FIELDS);
    });
});
