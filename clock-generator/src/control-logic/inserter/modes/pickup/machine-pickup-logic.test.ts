import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../../../config/config-paths";
import { loadConfigFromFile } from "../../../../config/loader";
import { SimulationContext } from "../../../../crafting/sequence/simulation-context";
import { EntityState, InserterStatus, MachineState } from "../../../../state";
import { InserterMode } from "../inserter-mode";
import { InserterPickupMode } from "./pickup-mode";

/**
 * An inserter of the chemical science sample that takes from a machine, entering its pickup with the machine's products
 * there: from the disabled mode (its window opened) or from another, its decider at `decider_build_order` in the order
 * the clock's deciders are built. The output inserter of an engine assembler puts into a science assembler (inserter 9).
 */
async function takeAsItEnters(from: InserterStatus, decider_build_order?: number, source_marked: number | null = null) {
    const context = SimulationContext.fromConfig(await loadConfigFromFile(ConfigPaths.CHEMICAL_SCIENCE_SHARED_FOUNDRY));
    const state = context.inserters.find(inserter => inserter.entity_id.number === 9)!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
    if (!EntityState.isMachine(source)) throw new Error("expected a machine source");
    source.inventoryState.setQuantity(source.machine.output.item_name, 16);
    source.windowOpeningTakeDecider = source_marked;
    const mode = InserterPickupMode.create({
        inserterState: state, sourceState: source,
        sinkState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id),
        tick_provider: context.tick_provider,
        decider_build_order,
    });
    mode.onEnter({ status: from } as InserterMode);
    mode.executeForTick();
    return source;
}

describe("a take from a machine in the first tick of a window", () => {
    // an inserter whose window opens in that tick too goes by the order of the two deciders (#268)
    it("marks the machine with where the taker's decider stands in the order they are built", async () => {
        const source: MachineState = await takeAsItEnters(InserterStatus.DISABLED, 3);
        expect(source.windowOpeningTakeDecider).toBe(3);
    });

    it("keeps the last built of the deciders whose inserters took so", async () => {
        expect((await takeAsItEnters(InserterStatus.DISABLED, 3, 5)).windowOpeningTakeDecider).toBe(5);
        expect((await takeAsItEnters(InserterStatus.DISABLED, 5, 3)).windowOpeningTakeDecider).toBe(5);
    });

    it("marks it with -1 where the taker's decider is not known", async () => {
        const source: MachineState = await takeAsItEnters(InserterStatus.DISABLED);
        expect(source.windowOpeningTakeDecider).toBe(-1);
    });

    it("is not marked when the pickup did not start from the disabled mode", async () => {
        const source: MachineState = await takeAsItEnters(InserterStatus.IDLE, 3);
        expect(source.windowOpeningTakeDecider).toBe(null);
    });
});
