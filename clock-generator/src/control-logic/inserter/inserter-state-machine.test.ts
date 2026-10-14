import { describe, expect, test } from "vitest";
import { InserterAnimationOverrideConfig } from "../../config/schema";
import { OpenRange, Duration } from "../../data-types";
import { Belt, EntityId, Inserter, InserterMetadata, InserterStackSize, Machine, MachineType, RecipeMetadata } from "../../entities";
import { InserterAnimation } from "../../entities/inserter/inserter-animation";
import { BeltState, InserterState, MachineState } from "../../state";
import { factorioInserterState, FactorioInserterState } from "../../state/factorio-entity-state";
import { MutableTickProvider } from "../current-tick-provider";
import { EnableControl } from "../enable-control";
import { InserterStateMachine } from "./inserter-state-machine";

/** An inserter that fills a hand of 16 iron plates from a belt, 4 a tick, on a clock of 40 ticks enabled in 10 to 13 */
function run(is_game_clock: boolean) {
    const belt = Belt.fromConfig({ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }, { ingredient: "iron-plate", stack_size: 4 }] });
    const machine = Machine.createMachine(1, {
        crafting_speed: 1,
        productivity: 0,
        recipe: RecipeMetadata.fromRecipeName("iron-gear-wheel"),
        type: MachineType.MACHINE,
    });
    const overrides: InserterAnimationOverrideConfig = {};
    const metadata = InserterMetadata.create("belt", "machine", InserterStackSize.SIZE_16, ["iron-plate"], overrides);
    const inserter: Inserter = {
        entity_id: EntityId.forInserter(1),
        metadata,
        animation: InserterAnimation.fromMetadata(metadata.animation),
        source: { entity_id: belt.entity_id, item_names: new Set(["iron-plate"]) },
        sink: { entity_id: machine.entity_id, item_names: new Set(["iron-plate"]) },
        filtered_items: new Set(["iron-plate"]),
    };
    const inserter_state = InserterState.createIdle(inserter);
    const sink_state = MachineState.forMachine(machine);
    const tick_provider = MutableTickProvider.create(0);
    const state_machine = InserterStateMachine.create({
        inserter_state,
        source_state: BeltState.create(belt),
        sink_state,
        tick_provider,
        enable_control: EnableControl.clocked({
            periodDuration: Duration.ofTicks(40),
            enabledRanges: [OpenRange.from(10, 13)],
            tickProvider: tick_provider,
            is_game_clock,
        }),
    });
    const held: number[] = [];
    const shown: FactorioInserterState[] = [];
    for (let tick = 0; tick < 20; tick++) {
        tick_provider.setCurrentTick(tick);
        state_machine.executeForTick();
        held.push(inserter_state.held_item?.quantity ?? 0);
        shown.push(factorioInserterState(inserter_state, sink_state));
    }
    const grabbed = held.map((quantity, tick) => quantity > (held[tick - 1] ?? 0)).flatMap((grew, tick) => grew ? [tick] : []);
    const not_disabled = shown.flatMap((state, tick) => state === FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR ? [] : [tick]);
    return { grabbed, not_disabled, shown };
}

describe("an inserter on a clock", () => {
    // Recorded in Factorio 2.1.21: a hand never grows in the first tick an inserter shows as enabled, and it does in
    // the first tick it shows as disabled
    test("acts in every tick of a window of the game, the first one included, and shows as enabled a tick ahead", () => {
        const { grabbed, not_disabled, shown } = run(true);
        expect(grabbed).toEqual([10, 11, 12, 13]);
        expect(not_disabled).toEqual([9, 10, 11, 12]);
        // it waits in the tick before it can act
        expect(shown[9]).toBe(FactorioInserterState.WAITING_FOR_SOURCE_ITEMS);
    });

    test("wakes in the first tick of a window of the plan and acts from the next", () => {
        const { grabbed, not_disabled } = run(false);
        expect(grabbed).toEqual([11, 12, 13]);
        expect(not_disabled).toEqual([10, 11, 12]);
    });
});
