import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { SimulationContext } from "../../crafting/sequence/simulation-context";
import { handSizeFor } from "../../entities";
import { EntityState, InserterStatus, MachineState } from "../../state";
import { InserterPhase } from "../status-codes";
import { bindHandPorts } from "./hand-ports";
import { MachineHandPickup } from "./machine-hand-pickup";

/**
 * The output inserter of an engine assembler of the chemical science sample, which puts into a science assembler
 * (inserter 9), its hand bound to the engine assembler's pickup port as its archetype binds it, the decider of its
 * clock of the game at `decider_build_order` in the order the clock's deciders are built
 */
async function engineTaker(decider_build_order?: number) {
    const context = SimulationContext.fromConfig(await loadConfigFromFile(ConfigPaths.CHEMICAL_SCIENCE_SHARED_FOUNDRY));
    const state = context.inserters.find(inserter => inserter.entity_id.number === 9)!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
    if (!EntityState.isMachine(source)) throw new Error("expected a machine source");
    const { pickup } = bindHandPorts({
        inserterState: state, sourceState: source,
        sinkState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id),
        tick_provider: context.tick_provider,
        decider_build_order,
    });
    return { state, source, pickup };
}

/** The taker enters its pickup with the machine's products there, from `from`, and takes in one tick */
async function takeAsItEnters(from: InserterPhase, decider_build_order?: number, source_marked: number | null = null) {
    const { source, pickup } = await engineTaker(decider_build_order);
    source.inventoryState.setQuantity(source.machine.output.item_name, 16);
    source.wakes.windowOpeningTakeDecider = source_marked;
    pickup.enter(from);
    pickup.pickup();
    return source;
}

describe("a take from a machine in the first tick of a window", () => {
    // an inserter whose window opens in that tick too goes by the order of the two deciders (#268)
    it("marks the machine with where the taker's decider stands in the order they are built", async () => {
        const source: MachineState = await takeAsItEnters(InserterPhase.DISABLED, 3);
        expect(source.wakes.windowOpeningTakeDecider).toBe(3);
    });

    it("keeps the last built of the deciders whose inserters took so", async () => {
        expect((await takeAsItEnters(InserterPhase.DISABLED, 3, 5)).wakes.windowOpeningTakeDecider).toBe(5);
        expect((await takeAsItEnters(InserterPhase.DISABLED, 5, 3)).wakes.windowOpeningTakeDecider).toBe(5);
    });

    it("marks it with -1 where the taker's decider is not known", async () => {
        const source: MachineState = await takeAsItEnters(InserterPhase.DISABLED);
        expect(source.wakes.windowOpeningTakeDecider).toBe(-1);
    });

    it("is not marked when the pickup did not start from the disabled phase", async () => {
        const source: MachineState = await takeAsItEnters(InserterPhase.IDLE, 3);
        expect(source.wakes.windowOpeningTakeDecider).toBe(null);
    });

    it("is not marked by a take in a later tick of the pickup", async () => {
        const { source, pickup } = await engineTaker(3);
        pickup.enter(InserterPhase.DISABLED);
        pickup.pickup();
        source.inventoryState.setQuantity(source.machine.output.item_name, 1);
        pickup.pickup();
        expect(source.wakes.windowOpeningTakeDecider).toBe(null);
    });
});

describe("the pickup port of a machine's output, as a hand reaches it", () => {
    it("is the machine archetype's, bound by the hand's ports", async () => {
        const { pickup } = await engineTaker();
        expect(pickup).toBeInstanceOf(MachineHandPickup);
    });

    // same-tick rule 11: the status is set to idle with no event, the Hand's own phase stays as it was
    it("sets the inserter idle itself when the machine has nothing for the hand, and counts no tick of its pickup", async () => {
        const { state, pickup } = await engineTaker();
        state.status = InserterStatus.PICKUP;
        pickup.enter(InserterPhase.IDLE);
        pickup.pickup();
        expect(state.status).toBe(InserterStatus.IDLE);
        expect(pickup.key()).toBe("0");
    });

    it("takes up to the hand, fills a hand that holds some in place, and keys the ticks it found something", async () => {
        const { state, source, pickup } = await engineTaker();
        const item = source.machine.output.item_name;
        const hand_size = handSizeFor(state.inserter, item);
        source.inventoryState.setQuantity(item, 3);
        pickup.enter(InserterPhase.IDLE);
        pickup.pickup();
        const hand = state.held_item;
        expect(hand).toEqual({ item_name: item, quantity: 3 });
        source.inventoryState.setQuantity(item, 100);
        pickup.pickup();
        expect(state.held_item).toBe(hand);
        expect(state.held_item!.quantity).toBe(hand_size);
        expect(state.items_picked_up).toBe(hand_size);
        expect(state.inventoryState.getQuantity(item)).toBe(hand_size);
        expect(source.inventoryState.getQuantity(item)).toBe(100 - (hand_size - 3));
        expect(pickup.key()).toBe("2");
        // the enter step starts the count again
        pickup.enter(InserterPhase.SWING);
        expect(pickup.key()).toBe("0");
    });
});
