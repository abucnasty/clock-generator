import fs from "node:fs";
import path from "node:path";
import {expect, test} from "vitest";
import {GameFixturePaths} from "../../tests/game/helpers/fixture-paths";
import {ContainerStorage} from "./components/container-storage";
import {InserterScheduling} from "./inserter-scheduling";
import {partialCells} from "./inserter-scheduling.fixture";
import type {SchedulingEvent} from "./active-scheduler";

interface NativePartial {
    visible: {tick: number; hands: number[]; source_output: number[]; finished: number[]; sink_cable: number[]}[];
    events: {probe_tick: number; event: string; role: string}[];
}


test("Mechanics: production source transfers derive RI5 partial sleep, activation and top-up outcomes", () => {
    const native: NativePartial = JSON.parse(fs.readFileSync(path.join(GameFixturePaths.PARTIAL_HAND_NOTIFICATIONS,
        "observations.json"), "utf8"));
    const context = partialCells();
    const events: (SchedulingEvent & {tick: number})[] = [];
    const schedule = new InserterScheduling(context, context.inserters,
        event => events.push({...event, tick: context.tick_provider.getCurrentTick()}));
    const sources = context.machines.map(it => it.machine_state);
    sources.forEach((source, i) => source.inventoryState.addQuantity("copper-cable", [0, 8, 16][i]));
    const update = () => {
        schedule.beginUpdates();
        for (let hand = schedule.nextUpdate(); hand !== null; hand = schedule.nextUpdate()) {
            hand.executeForTick();
            schedule.completeUpdate(hand);
        }
        for (const machine of context.machines) machine.executeForTick();
        schedule.finishControls();
        schedule.endUpdates();
    };
    // Real setup pickups establish empty/8/16 carry and membership before the mapped native window.
    // No native scheduling state/outcome is supplied to the implementation.
    update();
    expect(context.inserters.map(it => it.inserter_state.held_item?.quantity ?? 0)).toEqual([0, 8, 16]);
    events.length = 0;
    const visible = [];
    for (let tick = 1; tick <= 24; tick++) {
        context.tick_provider.setCurrentTick(tick);
        visible.push({tick,
            hands: context.inserters.map(it => it.inserter_state.held_item?.quantity ?? 0),
            source_output: sources.map(it => it.output.getCurrentQuantity("copper-cable")),
            finished: sources.map(it => it.productsFinished),
            sink_cable: context.state_registry.getAllStates().filter(ContainerStorage.is)
                .map(it => it.getCurrentQuantity("copper-cable")),
        });
        if (tick === 8) sources.forEach(source => {
            source.inventoryState.addQuantity("copper-plate", 1);
            source.craftingProgress.progress = 0.99;
        });
        if (tick === 14) sources.forEach(source => source.output.insert("copper-cable", 8));
        update();
    }
    expect(visible).toEqual(native.visible);
    // Independent sources have differing native intervention/subscriber traversal orders. Compare each
    // object's actual sequence, without claiming this registration order reproduces a global native list.
    for (const inserter of context.inserters) {
        const role = `hand_${inserter.entity_id.number}`;
        expect(events.filter(it => it.entity === inserter.entity_id.id && it.tick <= 20)
            .map(it => [it.tick, it.event]))
            .toEqual(native.events.filter(it => it.role === role).map(it => [it.probe_tick, it.event]));
    }
});
