import { beforeAll, describe, expect, it } from "vitest";
import { Config } from "../../../../config";
import { ConfigPaths } from "../../../../config/config-paths";
import { loadConfigFromFile } from "../../../../config/loader";
import { SimulationContext } from "../../../../crafting/sequence/simulation-context";
import { EntityState } from "../../../../state";
import { InserterPickupMode } from "./pickup-mode";

let sample: Config;
beforeAll(async () => { sample = await loadConfigFromFile(ConfigPaths.IRON_GEARS_MOVING_SAME_ITEM); });

function pickup(config: Config) {
    const context = SimulationContext.fromConfig(config);
    const state = context.inserters.find(inserter => inserter.entity_id.number === 2)!.inserter_state;
    const source = context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
    if (!EntityState.isBelt(source)) throw new Error("expected a belt source");
    const mode = InserterPickupMode.create({
        inserterState: state, sourceState: source,
        sinkState: context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id),
        tick_provider: context.tick_provider,
    });
    return { state, source, lanes: source.pickup_lanes.get(state.entity_id.id)!, take(tick: number) {
        context.tick_provider.setCurrentTick(tick);
        const before = state.held_item?.quantity ?? 0;
        mode.executeForTick();
        return (state.held_item?.quantity ?? 0) - before;
    } };
}
const copy = () => structuredClone(sample);

describe("physical belt lane fallback", () => {
    for (const near of [1, 2] as const) for (const type of ["turbo-transport-belt", "express-transport-belt"] as const) {
        it(`fills an underground hand in four consecutive grabs: ${type}, near lane ${near}`, () => {
            const config = copy();
            config.belts[0].type = type;
            config.inserters[1].source = { type: "belt", id: 1, near_lane: near, pickup_length: 0.5 };
            const input = pickup(config);
            expect(input.state.inserter.near_lane).toBe(near);
            expect([0, 1, 2, 3].map(input.take)).toEqual([4, 4, 4, 4]);
            expect(input.state.held_item?.quantity).toBe(16);
            // The other lane supplied a grab: its holes are part of the persistent pickup state too.
            expect(input.lanes[2 - near].stateKey(3)).toContain(":0");
        });
    }

    it("uses the preferred lane's stack size, then caps a fallback grab at the remaining hand capacity", () => {
        const config = copy();
        config.belts[0].lanes[1]!.stack_size = 2;
        config.inserters[1].source = { type: "belt", id: 1, near_lane: 2, pickup_length: 0.5 };
        config.inserters[1].stack_size = 7;
        const input = pickup(config);
        expect([0, 1, 2].map(input.take)).toEqual([2, 2, 3]);
        expect(input.state.held_item).toEqual({ item_name: "iron-plate", quantity: 7 });
    });

    it("does not take a different item from the far lane while filling the current hand", () => {
        const config = copy();
        config.belts[0].lanes[1]!.ingredient = "copper-plate";
        const input = pickup(config);
        expect([0, 1, 2, 3].map(input.take)).toEqual([4, 4, 0, 4]);
        expect(input.state.held_item?.item_name).toBe("iron-plate");
    });

    it("retains the first-lane convention when the nearest physical lane was not supplied", () => {
        const config = copy();
        config.inserters[1].source = { type: "belt", id: 1, pickup_length: 0.5 };
        config.belts[0].lanes[0].stack_size = 2;
        expect(pickup(config).take(0)).toBe(2);
    });

    it("does not use fallback for a second grab in the same tick", () => {
        const input = pickup(copy());
        expect(input.take(0)).toBe(4);
        expect(input.take(0)).toBe(0);
        expect(input.take(1)).toBe(4);
    });

    it("keeps the always-full assumption without geometry and for explicitly backed-up supply", () => {
        for (const backedUp of [false, true]) {
            const config = copy();
            if (backedUp) config.overrides = { non_moving_belts: true };
            else config.inserters[1].source = { type: "belt", id: 1, near_lane: 1 };
            const input = pickup(config);
            expect(input.source.pickup_lanes.size).toBe(0);
            expect([0, 1, 2, 3].map(input.take)).toEqual([4, 4, 4, 4]);
        }
    });
});
