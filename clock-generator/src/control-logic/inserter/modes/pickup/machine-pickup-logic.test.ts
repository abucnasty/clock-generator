import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../../../config/config-paths";
import { loadConfigFromFile } from "../../../../config/loader";
import { SimulationContext } from "../../../../crafting/sequence/simulation-context";
import { EntityState, InserterStatus, MachineState } from "../../../../state";
import { InserterMode } from "../inserter-mode";
import { InserterPickupMode } from "./pickup-mode";

/**
 * An inserter of the chemical science sample that takes from a machine, entering its pickup with the machine's products
 * there: from the disabled mode (its window opened) or from another. The output inserter of a science assembler puts
 * onto a belt (config inserter 1), the output inserter of an engine assembler into a science assembler (inserter 9).
 */
async function takeAsItEnters(config_id: number, from: InserterStatus) {
    const context = SimulationContext.fromConfig(await loadConfigFromFile(ConfigPaths.CHEMICAL_SCIENCE_SHARED_FOUNDRY));
    const state = context.inserters.find(inserter => inserter.entity_id.number === config_id)!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
    if (!EntityState.isMachine(source)) throw new Error("expected a machine source");
    source.inventoryState.setQuantity(source.machine.output.item_name, 16);
    const mode = InserterPickupMode.create({
        inserterState: state, sourceState: source,
        sinkState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id),
        tick_provider: context.tick_provider,
    });
    mode.onEnter({ status: from } as InserterMode);
    mode.executeForTick();
    return source;
}

describe("a take from a machine in the first tick of a window", () => {
    // a belt-fed inserter whose window opens in that tick goes by where the taker puts what it took (roadmap M2)
    it("is marked as into an inventory when the taker puts the products into a machine", async () => {
        const source: MachineState = await takeAsItEnters(9, InserterStatus.DISABLED);
        expect(source.productsTakenAsWindowOpened).toBe(true);
        expect(source.productsTakenAsWindowOpenedIntoAnInventory).toBe(true);
    });

    it("is not marked as into an inventory when the taker puts the products onto a belt", async () => {
        const source: MachineState = await takeAsItEnters(1, InserterStatus.DISABLED);
        expect(source.productsTakenAsWindowOpened).toBe(true);
        expect(source.productsTakenAsWindowOpenedIntoAnInventory).toBe(false);
    });

    it("is not marked at all when the pickup did not start from the disabled mode", async () => {
        const source: MachineState = await takeAsItEnters(9, InserterStatus.IDLE);
        expect(source.productsTakenAsWindowOpened).toBe(false);
        expect(source.productsTakenAsWindowOpenedIntoAnInventory).toBe(false);
    });
});
