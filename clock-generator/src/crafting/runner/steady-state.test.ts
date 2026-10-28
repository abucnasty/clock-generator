import { GameFixturePaths } from "../../../tests/game/helpers/fixture-paths";
import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { SimulationContext } from "../sequence";

/**
 * The fields holding a plain value in what the simulation keeps, by owner (an entity's state by its type; an inserter's
 * archetype, its Hand, the Hand's scratch record, its ports, its Control and its Wakes by their classes). A field added
 * to one of them goes into its owner's state key when it drives the simulation, and in any case into this list. A
 * machine's state holds components only: its Crafting and its Wakes pin their own fields
 * (simulation/components/crafting.test.ts), as Energy, Yield and Placement do; its archetype holds none
 * (CraftingMachineArchetype is walked and must stay out of this list), and neither do an inserter's archetype and its
 * Wakes (InserterArchetype, InserterWakes).
 */
const PLAIN_FIELDS: Record<string, string[]> = {
    // `tick` and the counts of items are left out of its key
    inserter: ["status", "tick", "held_item", "items_picked_up", "items_dropped", "waits_for_sink", "enabled"],
    DrillState: ["status"],
    // what a hand's ports and rules keep between ticks: the pickup ticks of a machine or a container, a belt's decision
    // tick and the drop ticks of a machine or a container are in the ports' keys, the idle rule's two flags and the
    // swing's start in the Hand's (Hand.key); what marks a take in the first tick of a window counts only within that
    // tick (`window_opened`, `ticks_in_pickup`); a rule's reason is read at the change it gives, in the same call
    // (`reason`, `reason_item`, `reason_quantity`); the record of the hand last emptied holds nothing (`spare_hand`)
    HandScratch: ["pickup_ticks", "window_opened", "ticks_in_pickup", "belt_grab_decided", "drop_ticks", "saw_sink_blocked",
        "window_opens", "swing_entered_tick", "swing_from", "reason", "reason_item", "reason_quantity", "spare_hand"],
    // its phase is in its key (Hand.key); what binds it is the same in every tick (its sink machine's Wakes and Ingress
    // are references, null for another sink, and left out here)
    Hand: ["phase", "from_belt", "swings_part_hands", "swing_ticks"],
    // what kind of control it is, the same in every tick
    Control: ["is_game_clock", "looks_ahead", "decider_build_order"],
    // where on the lane the hand puts its stacks down, and whether at a spot of the config, the same in every tick
    BeltHandDrop: ["at_spot", "spot_ticks"],
    // how the inserter reaches over the belt and its nearest lane, the same in every tick; belt position is in the
    // source state
    BeltHandPickup: ["layout", "near_lane"],
    // a machine's pickup port holds none: the order of its decider is read from the hand's Control
};

function plainFields(value: object, skip: string[] = []): string[] {
    return Object.entries(value)
        .filter(([key, field]) => !skip.includes(key) && (field === null || (typeof field !== "object" && typeof field !== "function")))
        .map(([key]) => key);
}

describe("simulationStateKey", () => {
    it("knows every field with a plain value of the states, the inserters' Hands, their scratch records, ports and controls", async () => {
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
            // an inserter's archetype holds references only, and so do its Wakes; its Hand, the scratch, the two ports
            // and the Control pin their plain fields here
            for (const inserter of context.inserters) {
                add(inserter.constructor.name, plainFields(inserter));
                add(inserter.wakes.constructor.name, plainFields(inserter.wakes));
                add(inserter.hand.constructor.name, plainFields(inserter.hand, ["sink_wakes", "sink_ingress"]));
                add(inserter.hand.scratch.constructor.name, plainFields(inserter.hand.scratch));
                add(inserter.hand.pickup.constructor.name, plainFields(inserter.hand.pickup));
                add(inserter.hand.drop.constructor.name, plainFields(inserter.hand.drop));
                add(inserter.control.constructor.name, plainFields(inserter.control));
            }
        }
        expect(fields).toEqual(PLAIN_FIELDS);
    });
});
