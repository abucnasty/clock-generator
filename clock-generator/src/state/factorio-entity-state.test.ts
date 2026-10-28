import { describe, expect, test } from "vitest";
import { mock } from "vitest-mock-extended";
import { InserterAnimationOverrideConfig } from "../config/schema";
import { EntityId, Inserter, InserterMetadata, InserterStackSize, Machine, RecipeMetadata } from "../entities";
import { InserterAnimation } from "../entities/inserter/inserter-animation";
import { TransportBelt } from "../simulation/archetypes/transport-belt";
import { EntityState } from "./entity-state";
import { factorioInserterState, FactorioInserterState } from "./factorio-entity-state";
import { InserterStatus } from "./entity-status";
import { InserterState } from "./inserter-state";
import { MachineState } from "./machine-state";

function machineState(recipe: string): MachineState {
    return MachineState.forMachine(Machine.createMachine(-1, {
        crafting_speed: 1,
        productivity: 0,
        recipe: RecipeMetadata.fromRecipeName(recipe),
    }));
}

function inserterState(source: EntityId, sink: EntityId, item: string): InserterState {
    const overrides: InserterAnimationOverrideConfig = {};
    const metadata = InserterMetadata.create(source.type, sink.type, InserterStackSize.SIZE_16, [item], overrides);
    const inserter: Inserter = {
        entity_id: EntityId.forInserter(-1),
        metadata,
        animation: InserterAnimation.fromMetadata(metadata.animation),
        source: { entity_id: source, item_names: new Set([item]) },
        sink: { entity_id: sink, item_names: new Set([item]) },
        filtered_items: new Set([item]),
    };
    return InserterState.createIdle(inserter);
}

/** Fills an ingredient of the machine up to its insertion limit */
function fillToLimit(state: MachineState, item: string): void {
    const limit = state.machine.inputs.getOrThrow(item).automated_insertion_limit.quantity;
    state.inventoryState.addQuantity(item, limit - state.inventoryState.getQuantity(item));
}

describe("MachineState.takesNothing", () => {
    test("a machine below an insertion limit takes something", () => {
        expect(MachineState.takesNothing(machineState("iron-gear-wheel"))).toBe(false);
    });

    test("with every ingredient at its insertion limit it takes nothing", () => {
        const state = machineState("iron-gear-wheel");
        fillToLimit(state, "iron-plate");
        expect(MachineState.takesNothing(state)).toBe(true);
    });

    test("with one of two ingredients at its limit it still takes the other", () => {
        const state = machineState("electronic-circuit");
        fillToLimit(state, "iron-plate");
        expect(MachineState.takesNothing(state)).toBe(false);
        fillToLimit(state, "copper-cable");
        expect(MachineState.takesNothing(state)).toBe(true);
    });

    test("with its output at the block it takes nothing, whatever its ingredients hold", () => {
        const state = machineState("iron-gear-wheel");
        const block = state.machine.output.outputBlock;
        state.inventoryState.addQuantity(block.item_name, block.ingredients_blocked_at);
        expect(MachineState.takesNothing(state)).toBe(true);
    });
});

describe("factorioInserterState", () => {
    const belt = EntityId.forBelt(-1);

    /** An inserter that brings iron plates from a belt to a machine that also takes copper cable */
    function beltToMachine(): { inserter: InserterState; sink: MachineState } {
        const sink = machineState("electronic-circuit");
        return { inserter: inserterState(belt, sink.entity_id, "iron-plate"), sink };
    }

    function takeNothing(sink: MachineState): void {
        fillToLimit(sink, "iron-plate");
        fillToLimit(sink, "copper-cable");
    }

    test("an inserter its clock switched off is disabled, also while it finishes its swing", () => {
        const { inserter, sink } = beltToMachine();
        inserter.enabled = false;
        inserter.status = InserterStatus.SWING;
        inserter.held_item = { item_name: "iron-plate", quantity: 16 };
        expect(factorioInserterState(inserter, sink)).toBe(FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR);
    });

    test("an empty hand waits for source items while its sink takes anything, also when not its own item", () => {
        const { inserter, sink } = beltToMachine();
        fillToLimit(sink, "iron-plate");
        expect(factorioInserterState(inserter, sink)).toBe(FactorioInserterState.WAITING_FOR_SOURCE_ITEMS);
    });

    test("an empty hand waits for space in the destination once its sink takes nothing from anyone", () => {
        const { inserter, sink } = beltToMachine();
        takeNothing(sink);
        expect(factorioInserterState(inserter, sink)).toBe(FactorioInserterState.WAITING_FOR_SPACE_IN_DESTINATION);
    });

    test("an empty hand on its way back is working while the sink takes something, and waits for space once it takes nothing", () => {
        const { inserter, sink } = beltToMachine();
        inserter.status = InserterStatus.SWING;
        expect(factorioInserterState(inserter, sink)).toBe(FactorioInserterState.WORKING);
        takeNothing(sink);
        expect(factorioInserterState(inserter, sink)).toBe(FactorioInserterState.WAITING_FOR_SPACE_IN_DESTINATION);
    });

    test("a partly filled hand waits for more items, and for space once its sink takes nothing", () => {
        const { inserter, sink } = beltToMachine();
        inserter.held_item = { item_name: "iron-plate", quantity: 4 };
        expect(factorioInserterState(inserter, sink)).toBe(FactorioInserterState.WAITING_FOR_MORE_ITEMS);
        takeNothing(sink);
        expect(factorioInserterState(inserter, sink)).toBe(FactorioInserterState.WAITING_FOR_SPACE_IN_DESTINATION);
    });

    test("a full hand in flight is working, also towards a sink that takes nothing any more", () => {
        const { inserter, sink } = beltToMachine();
        inserter.status = InserterStatus.SWING;
        inserter.held_item = { item_name: "iron-plate", quantity: 16 };
        takeNothing(sink);
        expect(factorioInserterState(inserter, sink)).toBe(FactorioInserterState.WORKING);
    });

    test("a hand going onto a belt a stack at a time waits for space between the stacks", () => {
        const source = machineState("iron-gear-wheel");
        const sink: EntityState = mock<TransportBelt>({ entity_id: belt });
        const inserter = inserterState(source.entity_id, belt, "iron-gear-wheel");
        inserter.status = InserterStatus.DROP_OFF;
        inserter.held_item = { item_name: "iron-gear-wheel", quantity: 16 };
        expect(factorioInserterState(inserter, sink)).toBe(FactorioInserterState.WORKING);
        inserter.held_item = { item_name: "iron-gear-wheel", quantity: 8 };
        expect(factorioInserterState(inserter, sink)).toBe(FactorioInserterState.WAITING_FOR_SPACE_IN_DESTINATION);
        // the last stack has left the hand: an empty hand over a belt, which always takes
        inserter.held_item = null;
        expect(factorioInserterState(inserter, sink)).toBe(FactorioInserterState.WORKING);
    });
});
