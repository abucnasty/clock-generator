import { describe, expect, test } from "vitest";
import { InserterAnimationOverrideConfig } from "../../config/schema";
import { OpenRange, Duration } from "../../data-types";
import { Belt, EntityId, Inserter, InserterMetadata, InserterStackSize, Machine, RecipeMetadata } from "../../entities";
import { InserterAnimation } from "../../entities/inserter/inserter-animation";
import { InserterState, MachineState } from "../../state";
import { TransportBelt } from "../../simulation/archetypes/transport-belt";
import { factorioInserterState, FactorioInserterState } from "../../state/factorio-entity-state";
import { MutableTickProvider } from "../current-tick-provider";
import { AlwaysEnabledControl, EnableControl } from "../enable-control";
import { InserterStateMachine } from "./inserter-state-machine";

/** An inserter that fills a hand of 16 iron plates from a belt, 4 a tick, on a clock of 40 ticks enabled in 10 to 13 */
function run(is_game_clock: boolean) {
    const belt = Belt.fromConfig({ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }, { ingredient: "iron-plate", stack_size: 4 }] });
    const machine = Machine.createMachine(1, {
        crafting_speed: 1,
        productivity: 0,
        recipe: RecipeMetadata.fromRecipeName("iron-gear-wheel"),
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
        pickup_length: 1,
        belt_supply: "moving",
    };
    const inserter_state = InserterState.createIdle(inserter);
    const sink_state = MachineState.forMachine(machine);
    const tick_provider = MutableTickProvider.create(0);
    const state_machine = InserterStateMachine.create({
        inserter_state,
        source_state: TransportBelt.create(belt),
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

/**
 * Two stack inserters (hand 16) waiting at a gear assembler that holds `held` gears, each dropping onto a belt of its own,
 * with `in_hand` gears already in the hand of the first. Updated in the order of the list, first then second, as the
 * game serves the takers of one machine in one fixed order (InserterUpdates).
 */
function twoTakers(held: number, in_hand: number = 0) {
    const machine = Machine.createMachine(1, {
        crafting_speed: 1,
        productivity: 0,
        recipe: RecipeMetadata.fromRecipeName("iron-gear-wheel"),
    });
    const source_state = MachineState.forMachine(machine);
    source_state.inventoryState.setQuantity("iron-gear-wheel", held);
    const tick_provider = MutableTickProvider.create(5);
    const taker = (id: number) => {
        const belt = Belt.fromConfig({ id, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 4 }, { ingredient: "iron-gear-wheel", stack_size: 4 }] });
        const metadata = InserterMetadata.create("machine", "belt", InserterStackSize.SIZE_16, ["iron-gear-wheel"], {});
        const inserter: Inserter = {
            entity_id: EntityId.forInserter(id),
            metadata,
            animation: InserterAnimation.fromMetadata(metadata.animation),
            source: { entity_id: machine.entity_id, item_names: new Set(["iron-gear-wheel"]) },
            sink: { entity_id: belt.entity_id, item_names: new Set(["iron-gear-wheel"]) },
            filtered_items: new Set(["iron-gear-wheel"]),
        };
        const inserter_state = InserterState.createIdle(inserter);
        const state_machine = InserterStateMachine.create({
            inserter_state, source_state, sink_state: TransportBelt.create(belt), tick_provider, enable_control: AlwaysEnabledControl,
        });
        return { inserter_state, state_machine };
    };
    const takers = [taker(1), taker(2)];
    if (in_hand > 0) {
        takers[0].inserter_state.held_item = { item_name: "iron-gear-wheel", quantity: in_hand };
    }
    const tick = () => {
        takers.forEach(it => it.state_machine.executeForTick());
        tick_provider.setCurrentTick(tick_provider.getCurrentTick() + 1);
    };
    const hands = () => takers.map(it => it.inserter_state.held_item?.quantity ?? 0);
    return { source_state, tick, hands };
}

// Recorded in Factorio 2.1.21 on the supercapacitor plant of the scaffold of #100, two stack inserters taking from it:
// on 59 of the 62 ticks that show who was served first, the same one was; the plant held 20, both hands were empty and
// waiting, and in the next tick one hand held 16, the other 4 and the plant 0 (ticks 101 and 421 of the recording)
describe("inserters that take the product of one machine", () => {
    test("the first takes up to its hand and the next what is left, in the same tick", () => {
        const { source_state, tick, hands } = twoTakers(20);
        tick();
        expect(hands()).toEqual([16, 4]);
        expect(source_state.inventoryState.getQuantity("iron-gear-wheel")).toBe(0);
    });

    // Recorded on the pentapod egg biochambers of agricultural science (#90): on every tick with two takers waiting and
    // one served, it was the same one, whoever took last; in 10 of them it had taken the tick before as well
    test("the one that took last is served again while it has room, the next waits for what it leaves", () => {
        const { source_state, tick, hands } = twoTakers(3, 5);
        tick();
        expect(hands()).toEqual([8, 0]);
        source_state.inventoryState.setQuantity("iron-gear-wheel", 3);
        tick();
        expect(hands()).toEqual([11, 0]);
        expect(source_state.inventoryState.getQuantity("iron-gear-wheel")).toBe(0);
    });
});
