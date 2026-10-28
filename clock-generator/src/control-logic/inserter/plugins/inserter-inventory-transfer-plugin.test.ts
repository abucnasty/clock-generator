import { describe, expect, it } from "vitest";
import { InventoryTransferHistory } from "../../../crafting/sequence/inventory-transfer-history";
import { EntityId } from "../../../entities";
import { InserterState } from "../../../state";
import { InserterPhase } from "../../../simulation/status-codes";
import { MutableTickProvider } from "../../current-tick-provider";
import { InserterInventoryHistoryPlugin } from "./inserter-inventory-transfer-plugin";

/** An inserter that takes `item` in its pickup, swings and drops, driven through the changes of phase its Hand makes */
function setUp() {
    const ticks = MutableTickProvider.create(1000);
    const state = { held_item: null } as unknown as InserterState;
    const id = { id: "inserter" } as unknown as EntityId;
    (state as { entity_id: EntityId }).entity_id = id;
    const history = new InventoryTransferHistory();
    const plugin = new InserterInventoryHistoryPlugin(ticks, state, history);
    const step = (tick: number, from: InserterPhase, to: InserterPhase, held: { item_name: string; quantity: number } | null) => {
        ticks.setCurrentTick(tick);
        (state as { held_item: unknown }).held_item = held;
        plugin.onStatusChange(from, to);
    };
    return { history, id, step, ticks };
}

describe("the inserter transfer history plugin", () => {
    it("records a swing that ends in a change other than the drop-off, from its pickup to that change", () => {
        const { history, id, step } = setUp();
        history.recording = true;
        step(10, InserterPhase.IDLE, InserterPhase.PICKUP, null);
        step(12, InserterPhase.PICKUP, InserterPhase.SWING, { item_name: "iron-plate", quantity: 2 });
        step(20, InserterPhase.SWING, InserterPhase.IDLE, { item_name: "iron-plate", quantity: 2 });
        expect(history.get(id)).toEqual([{ item_name: "iron-plate", tick_range: expect.objectContaining({ start_inclusive: 10, end_inclusive: 20 }), amount: 2, pickup_tick_before_run: undefined }]);
    });

    it("records nothing while the history is not recording, and keeps track of the pickup for a transfer that ends in the run", () => {
        const { history, id, step } = setUp();
        history.recording = false;
        // a whole transfer in the warm-up leaves nothing
        step(10, InserterPhase.IDLE, InserterPhase.PICKUP, null);
        step(12, InserterPhase.PICKUP, InserterPhase.SWING, { item_name: "iron-plate", quantity: 2 });
        step(20, InserterPhase.SWING, InserterPhase.IDLE, { item_name: "iron-plate", quantity: 2 });
        expect(history.get(id)).toBeUndefined();
        // one that picks up in the warm-up and ends in the run is recorded from the run's first tick, with its pickup before it
        step(30, InserterPhase.IDLE, InserterPhase.PICKUP, null);
        step(32, InserterPhase.PICKUP, InserterPhase.SWING, { item_name: "copper-plate", quantity: 3 });
        history.recording = true;
        history.ticks_before_run = 33;
        step(2, InserterPhase.SWING, InserterPhase.IDLE, { item_name: "copper-plate", quantity: 3 });
        expect(history.get(id)).toEqual([{
            item_name: "copper-plate", tick_range: expect.objectContaining({ start_inclusive: 0, end_inclusive: 2 }), amount: 3, pickup_tick_before_run: 30 - 33,
        }]);
    });

    it("takes the pickup of the transfer that ends, not the one the same change starts", () => {
        const { history, id, step } = setUp();
        history.recording = true;
        step(10, InserterPhase.IDLE, InserterPhase.PICKUP, null);
        step(12, InserterPhase.PICKUP, InserterPhase.SWING, { item_name: "iron-plate", quantity: 1 });
        // the swing ends straight in the next pickup
        step(20, InserterPhase.SWING, InserterPhase.PICKUP, { item_name: "iron-plate", quantity: 1 });
        step(22, InserterPhase.PICKUP, InserterPhase.SWING, { item_name: "copper-plate", quantity: 4 });
        step(30, InserterPhase.SWING, InserterPhase.IDLE, { item_name: "copper-plate", quantity: 4 });
        expect(history.get(id)!.map(it => [it.item_name, it.tick_range.start_inclusive, it.tick_range.end_inclusive, it.amount]))
            .toEqual([["iron-plate", 10, 20, 1], ["copper-plate", 20, 30, 4]]);
    });
});
