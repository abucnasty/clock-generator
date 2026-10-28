import { describe, expect, test, vi } from "vitest";
import { GameFixturePaths } from "../../../tests/game/helpers/fixture-paths";
import { InserterAnimationOverrideConfig } from "../../config/schema";
import { loadConfigFromFile } from "../../config/loader";
import { MutableTickProvider } from "../../control-logic/current-tick-provider";
import { AlwaysEnabledControl, EnableControl } from "../../control-logic/enable-control";
import { reasonText } from "../../control-logic/mode/reason-table";
import { SimulationContext } from "../../crafting/sequence/simulation-context";
import { OpenRange, Duration } from "../../data-types";
import { Belt, Chest, EntityId, Inserter, InserterMetadata, InserterStackSize, Machine, RecipeMetadata } from "../../entities";
import { InserterAnimation } from "../../entities/inserter/inserter-animation";
import { EntityState, InserterState, InserterStatus, MachineState } from "../../state";
import { factorioInserterState, FactorioInserterState } from "../../state/factorio-entity-state";
import { ContainerStorage } from "../components/container-storage";
import { HandScratch } from "../components/hand";
import { InserterPhase, inserterStatusOf } from "../status-codes";
import { runTick } from "../tick-phases";
import { World } from "../world";
import type { InserterObserver, StatusChangeReason } from "../observers/observer";
import { InserterArchetype } from "./inserter";
import { TransportBelt } from "./transport-belt";

const gearMachine = () => Machine.createMachine(1, {
    crafting_speed: 1,
    productivity: 0,
    recipe: RecipeMetadata.fromRecipeName("iron-gear-wheel"),
});

/** A stack inserter (hand 16) from `source` to `sink` carrying `item` */
function inserterOf(source: EntityState, sink: EntityState, item: string, id: number = 1): Inserter {
    const overrides: InserterAnimationOverrideConfig = {};
    const metadata = InserterMetadata.create(source.entity_id.type, sink.entity_id.type, InserterStackSize.SIZE_16, [item], overrides);
    const inserter: Inserter = {
        entity_id: EntityId.forInserter(id),
        metadata,
        animation: InserterAnimation.fromMetadata(metadata.animation),
        source: { entity_id: source.entity_id, item_names: new Set([item]) },
        sink: { entity_id: sink.entity_id, item_names: new Set([item]) },
        filtered_items: new Set([item]),
    };
    if (EntityId.isBelt(source.entity_id)) {
        inserter.pickup_length = 1;
        inserter.belt_supply = "moving";
    }
    return inserter;
}

/** Every change of phase an observer is told of: the tick, the phases, the reason's text, and what it sees then */
function watch(archetype: InserterArchetype, tick_provider: MutableTickProvider) {
    const changes: string[] = [];
    const state = archetype.inserter_state;
    archetype.observers.add({
        onStatusChange(from, to, reason) {
            changes.push(`${tick_provider.getCurrentTick()} ${inserterStatusOf(from)}->${inserterStatusOf(to)} "${reasonText(reason.reasonId(from, to))}"`
                + ` status=${state.status} phase=${inserterStatusOf(archetype.hand.phase)} waits=${state.waits_for_sink}`);
        },
    });
    return changes;
}

/** An inserter that fills a hand of 16 iron plates from a belt, 4 a tick, on a clock of 40 ticks enabled in 10 to 13 */
function run(is_game_clock: boolean) {
    const belt = Belt.fromConfig({ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }, { ingredient: "iron-plate", stack_size: 4 }] });
    const machine = gearMachine();
    const source_state = TransportBelt.create(belt);
    const sink_state = MachineState.forMachine(machine);
    const inserter_state = InserterState.createIdle(inserterOf(source_state, sink_state, "iron-plate"));
    const tick_provider = MutableTickProvider.create(0);
    const archetype = InserterArchetype.create({
        inserter_state,
        source_state,
        sink_state,
        tick_provider,
        enable_control: EnableControl.clocked({
            periodDuration: Duration.ofTicks(40),
            enabledRanges: [OpenRange.from(10, 13)],
            tickProvider: tick_provider,
            is_game_clock,
        }),
    });
    const changes = watch(archetype, tick_provider);
    // what a tick observer sees: after the phase's step, before the Wakes
    const seen_enabled: boolean[] = [];
    archetype.observers.add({ onTick() { seen_enabled.push(inserter_state.enabled); } });
    const held: number[] = [];
    const shown: FactorioInserterState[] = [];
    for (let tick = 0; tick < 20; tick++) {
        tick_provider.setCurrentTick(tick);
        archetype.executeForTick();
        held.push(inserter_state.held_item?.quantity ?? 0);
        shown.push(factorioInserterState(inserter_state, sink_state));
    }
    const grabbed = held.map((quantity, tick) => quantity > (held[tick - 1] ?? 0)).flatMap((grew, tick) => grew ? [tick] : []);
    const not_disabled = shown.flatMap((state, tick) => state === FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR ? [] : [tick]);
    return { grabbed, not_disabled, shown, changes, seen_enabled };
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

    // same-tick rule 9: from its disabled phase straight into the pickup, by the idle rule's answer and its reason
    test("goes from its disabled phase straight into its pickup in the first tick of a window of the game, and through idle on a clock of the plan", () => {
        expect(run(true).changes.slice(0, 3)).toEqual([
            `0 IDLE->DISABLED "inserter disabled" status=DISABLED phase=IDLE waits=false`,
            `10 DISABLED->PICKUP "pickup from belt" status=PICKUP phase=DISABLED waits=false`,
            `14 PICKUP->SWING "Picked up full stack of iron-plate" status=SWING phase=PICKUP waits=false`,
        ]);
        expect(run(false).changes.slice(0, 3)).toEqual([
            `0 IDLE->DISABLED "inserter disabled" status=DISABLED phase=IDLE waits=false`,
            `10 DISABLED->IDLE "inserter enabled" status=IDLE phase=DISABLED waits=false`,
            `11 IDLE->PICKUP "pickup from belt" status=PICKUP phase=IDLE waits=false`,
        ]);
    });

    // the phase table's order: the tick observers after the phase's step, the Wakes after them
    test("tells its tick observers after its step and before its Wakes write whether it shows as enabled", () => {
        const { seen_enabled } = run(true);
        // shown enabled from tick 9 on, written at the end of tick 9: the observer of tick 9 still sees tick 8's
        expect(seen_enabled.slice(8, 14)).toEqual([false, false, true, true, true, true]);
    });
});

/**
 * Two stack inserters (hand 16) waiting at a gear assembler that holds `held` gears, each dropping onto a belt of its own,
 * with `in_hand` gears already in the hand of the first. Updated in the order of the list, first then second, as the
 * game serves the takers of one machine in one fixed order (InserterUpdates).
 */
function twoTakers(held: number, in_hand: number = 0) {
    const machine = gearMachine();
    const source_state = MachineState.forMachine(machine);
    source_state.inventoryState.setQuantity("iron-gear-wheel", held);
    const tick_provider = MutableTickProvider.create(5);
    const taker = (id: number) => {
        const belt = Belt.fromConfig({ id, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 4 }, { ingredient: "iron-gear-wheel", stack_size: 4 }] });
        const sink_state = TransportBelt.create(belt);
        const inserter_state = InserterState.createIdle(inserterOf(source_state, sink_state, "iron-gear-wheel", id));
        const inserter = InserterArchetype.create({
            inserter_state, source_state, sink_state, tick_provider, enable_control: AlwaysEnabledControl,
        });
        return { inserter_state, inserter };
    };
    const takers = [taker(1), taker(2)];
    if (in_hand > 0) {
        takers[0].inserter_state.held_item = { item_name: "iron-gear-wheel", quantity: in_hand };
    }
    const tick = () => {
        takers.forEach(it => it.inserter.executeForTick());
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

/** A stack inserter that takes gears from an assembler holding `held` into a buffer chest, under `enable_control` */
function gearsToChest(held: number, enable_control: EnableControl = AlwaysEnabledControl) {
    const source_state = MachineState.forMachine(gearMachine());
    source_state.inventoryState.setQuantity("iron-gear-wheel", held);
    const sink_state = ContainerStorage.forChest(Chest.fromConfig({ type: "buffer-chest", id: 2, storage_size: 1, item_filter: "iron-gear-wheel" }));
    const inserter_state = InserterState.createIdle(inserterOf(source_state, sink_state, "iron-gear-wheel"));
    const tick_provider = MutableTickProvider.create(0);
    const archetype = InserterArchetype.create({ inserter_state, source_state, sink_state, tick_provider, enable_control });
    const changes = watch(archetype, tick_provider);
    const tick = () => {
        tick_provider.incrementTick();
        archetype.executeForTick();
    };
    return { archetype, source_state, sink_state, inserter_state, tick_provider, changes, tick };
}

describe("an inserter's changes of phase", () => {
    // same-tick rule 17: the status written first (the Hand's own write, before any observer), then the observers,
    // then the exit and enter steps
    test("tell the observers after the status is written and before the exit and enter steps, with the reason's text", () => {
        const { tick, changes, archetype } = gearsToChest(100);
        const swing_ticks = archetype.inserter_state.inserter.animation.rotation.ticks;
        for (let index = 0; index < 2 * swing_ticks + 4; index++) tick();
        expect(changes.slice(0, 5)).toEqual([
            `1 IDLE->PICKUP "machine has 100 of iron-gear-wheel to pickup" status=PICKUP phase=IDLE waits=false`,
            `2 PICKUP->SWING "Picked up full stack of iron-gear-wheel" status=SWING phase=PICKUP waits=false`,
            `${2 + swing_ticks} SWING->DROP "swing to sink duration elapsed" status=DROP phase=SWING waits=false`,
            `${3 + swing_ticks} DROP->SWING "all items dropped" status=SWING phase=DROP waits=false`,
            // same-tick rule 8: the swing back that ends asks the idle rule in the same tick, and starts the pickup
            `${3 + 2 * swing_ticks} SWING->PICKUP "machine has 84 of iron-gear-wheel to pickup" status=PICKUP phase=SWING waits=false`,
        ]);
    });

    // same-tick rule 8, the other way: the idle rule's disabled phase is not taken from the end of a swing
    test("end a swing back in the idle phase when the idle rule would disable the inserter, which it then does in the next tick", () => {
        let enabled = true;
        const { tick, changes, archetype } = gearsToChest(100, EnableControl.lambda(() => enabled));
        const swing_ticks = archetype.inserter_state.inserter.animation.rotation.ticks;
        for (let index = 0; index < swing_ticks + 3; index++) tick();
        enabled = false;
        for (let index = 0; index < swing_ticks + 1; index++) tick();
        expect(changes.slice(-2)).toEqual([
            `${3 + 2 * swing_ticks} SWING->IDLE "swing to source duration elapsed" status=IDLE phase=SWING waits=false`,
            `${4 + 2 * swing_ticks} IDLE->DISABLED "inserter disabled" status=DISABLED phase=IDLE waits=false`,
        ]);
    });

    // same-tick rule 10: the belt's port decides its first grab's timing from the wait flag, which the enter step clears after
    test("enter the pickup from a wait in the idle phase with the wait flag read before it is cleared", () => {
        const belt = Belt.fromConfig({ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }, { ingredient: "iron-plate", stack_size: 4 }] });
        const source_state = TransportBelt.create(belt);
        const sink_state = MachineState.forMachine(gearMachine());
        const inserter_state = InserterState.createIdle(inserterOf(source_state, sink_state, "iron-plate"));
        const tick_provider = MutableTickProvider.create(0);
        const archetype = InserterArchetype.create({ inserter_state, source_state, sink_state, tick_provider, enable_control: AlwaysEnabledControl });
        const changes = watch(archetype, tick_provider);
        const limit = sink_state.machine.inputs.getOrThrow("iron-plate").automated_insertion_limit.quantity;
        sink_state.inventoryState.setQuantity("iron-plate", limit);
        archetype.phaseRule();
        expect([archetype.hand.phase, inserter_state.waits_for_sink]).toEqual([InserterPhase.IDLE, true]);
        sink_state.inventoryState.setQuantity("iron-plate", 0);
        tick_provider.incrementTick();
        archetype.phaseRule();
        expect(changes).toEqual([`1 IDLE->PICKUP "pickup from belt" status=PICKUP phase=IDLE waits=true`]);
        // the port read the flag (a tick to decide before the first stack), then the flag was cleared
        expect([archetype.hand.scratch.belt_grab_decided, inserter_state.waits_for_sink]).toEqual([false, false]);
    });

    // same-tick rule 11: the status and the phase part until the next change, as the mode machine's current mode and
    // the status field did
    test("leave the phase as it is when a pickup from a machine finds nothing, which sets the status idle with no event", () => {
        const { archetype, source_state, inserter_state, changes, tick_provider } = gearsToChest(16);
        tick_provider.incrementTick();
        archetype.phaseRule();
        source_state.inventoryState.setQuantity("iron-gear-wheel", 0);
        archetype.phaseStep();
        expect([archetype.hand.phase, inserter_state.status, changes.length]).toEqual([InserterPhase.PICKUP, InserterStatus.IDLE, 1]);
        // both in the key: the phase first in the Hand's, the status as written after its rules' and ports' fields
        const [phase, , , , , , , status] = archetype.hand.key(1).split(";");
        expect([phase, status]).toEqual([`${InserterPhase.PICKUP}`, InserterStatus.IDLE]);
        // the pickup rule runs on, and the status stays idle while the hand fills, until the next change
        source_state.inventoryState.setQuantity("iron-gear-wheel", 16);
        tick_provider.incrementTick();
        archetype.executeForTick();
        expect([inserter_state.held_item?.quantity, inserter_state.status, changes.length]).toEqual([16, InserterStatus.IDLE, 1]);
        tick_provider.incrementTick();
        archetype.executeForTick();
        expect(changes[1]).toBe(`3 PICKUP->SWING "Picked up full stack of iron-gear-wheel" status=SWING phase=PICKUP waits=false`);
    });

    // P4 section 8: no reason's text is made in a tick unless an observer that records it asks for it
    test("make no reason's number themselves: the Hand answers it to an observer that asks, during the change", () => {
        const source_state = MachineState.forMachine(gearMachine());
        source_state.inventoryState.setQuantity("iron-gear-wheel", 100);
        const sink_state = ContainerStorage.forChest(Chest.fromConfig({ type: "buffer-chest", id: 2, storage_size: 1, item_filter: "iron-gear-wheel" }));
        const inserter_state = InserterState.createIdle(inserterOf(source_state, sink_state, "iron-gear-wheel"));
        const tick_provider = MutableTickProvider.create(0);
        const archetype = InserterArchetype.create({ inserter_state, source_state, sink_state, tick_provider, enable_control: AlwaysEnabledControl });
        const reason = vi.spyOn(archetype.hand, "reasonId");
        // told of the change, it does not ask
        const silent: InserterObserver = { onStatusChange: vi.fn() };
        archetype.observers.add(silent);
        tick_provider.incrementTick();
        archetype.executeForTick();
        expect([inserter_state.status, reason.mock.calls.length]).toEqual([InserterStatus.PICKUP, 0]);
        expect(silent.onStatusChange).toHaveBeenCalledWith(InserterPhase.IDLE, InserterPhase.PICKUP, archetype.hand);
        // one that records the reason asks during the change
        const texts: string[] = [];
        const asking: InserterObserver = { onStatusChange: (from, to, of: StatusChangeReason<InserterPhase>) => texts.push(reasonText(of.reasonId(from, to))) };
        archetype.observers.add(asking);
        tick_provider.incrementTick();
        archetype.executeForTick();
        expect([inserter_state.status, reason.mock.calls.length]).toEqual([InserterStatus.SWING, 1]);
        expect(texts).toEqual(["Picked up full stack of iron-gear-wheel"]);
        archetype.observers.remove(new Set([silent, asking]));
        expect(archetype.observers.list()).toEqual([]);
    });
});

// one key for the inserter, its components' in a fixed order (P4 3.4): what its hand has carried (its Storage), its Hand
// (phase, what its rules and ports keep, then what it owns of the inserter's state: status as written, wait flag, hand,
// arm), its Wakes (whether it shows enabled). Every field of its components, in the key or out of it, is pinned with
// every component's, and each is changed in turn there (crafting/runner/steady-state.test.ts).
describe("an inserter's state key", () => {
    test("keys what it has carried, its Hand and whether it shows enabled, from a belt into a machine and from a machine onto a belt", () => {
        const belt = TransportBelt.create(Belt.fromConfig({ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }, { ingredient: "iron-plate", stack_size: 4 }] }));
        const machine = MachineState.forMachine(gearMachine());
        const tick_provider = MutableTickProvider.create(0);
        const of = (source: EntityState, sink: EntityState, item: string) => InserterArchetype.create({
            inserter_state: InserterState.createIdle(inserterOf(source, sink, item)), source_state: source, sink_state: sink, tick_provider,
            enable_control: AlwaysEnabledControl,
        });
        // the drop port of a machine keys its ticks, the pickup port of a belt its decision
        expect(of(belt, machine, "iron-plate").stateKey(0)).toBe(`[]|${InserterPhase.IDLE};false;false;null;null;0;true;IDLE;false;null;|true`);
        // the drop port of a belt keys nothing, the pickup port of a machine its ticks
        expect(of(machine, TransportBelt.create(Belt.fromConfig({ id: 2, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 4 }, { ingredient: "iron-gear-wheel", stack_size: 4 }] })), "iron-gear-wheel")
            .stateKey(0)).toBe(`[]|${InserterPhase.IDLE};false;false;null;null;;0;IDLE;false;null;|true`);
    });

    test("keys a swing by its ticks relative to the tick asked and the phase it came from, a pickup's and a drop's ticks by their ports", () => {
        const { archetype, tick } = gearsToChest(100);
        tick();
        tick();
        const hand = `{"item_name":"iron-gear-wheel","quantity":16}`;
        expect(archetype.stateKey(5)).toBe(`[["iron-gear-wheel",16]]|${InserterPhase.SWING};false;false;-3;${InserterPhase.PICKUP};0;1;SWING;false;${hand};|true`);
        expect(archetype.stateKey(2)).toBe(`[["iron-gear-wheel",16]]|${InserterPhase.SWING};false;false;0;${InserterPhase.PICKUP};0;1;SWING;false;${hand};|true`);
        expect(archetype.stateKey(5)).toBe(`${JSON.stringify([["iron-gear-wheel", 16]])}|${archetype.hand.key(5)}|${archetype.wakes.key()}`);
    });
});

describe("a control swap", () => {
    // same-tick rule 12
    test("keeps the inserter and puts it on the new control: at idle with its scratch set back, its status and observers kept", async () => {
        const context = SimulationContext.fromConfig(await loadConfigFromFile(GameFixturePaths.DIFFERENT_ITEMS_CONFIG));
        const observer: InserterObserver = { onStatusChange: vi.fn(), onTick: vi.fn() };
        context.inserters.forEach(it => it.observers.add(observer));
        const inserter = context.inserters[0];
        const { hand, control, wakes } = inserter;
        const scratch = hand.scratch;
        hand.phase = InserterPhase.SWING;
        inserter.inserter_state.status = InserterStatus.SWING;
        Object.assign(scratch, { swing_entered_tick: 7, swing_from: InserterPhase.PICKUP });
        const next: EnableControl = { isEnabled: () => false, is_game_clock: true, decider_build_order: 4 };

        context.useControls({ inserter: () => next });

        expect(context.inserters[0]).toBe(inserter);
        expect(inserter.hand).toBe(hand);
        expect(inserter.control).toBe(control);
        expect(inserter.wakes).toBe(wakes);
        expect(hand.scratch).toBe(scratch);
        expect(hand.phase).toBe(InserterPhase.IDLE);
        expect(inserter.inserter_state.status).toBe(InserterStatus.SWING);
        expect(scratch).toEqual(new HandScratch());
        expect([control.enabled(), control.is_game_clock, control.looks_ahead, control.decider_build_order]).toEqual([false, true, false, 4]);
        expect(inserter.observers.list()).toEqual([observer]);
        expect(observer.onStatusChange).not.toHaveBeenCalled();
        inserter.executeForTick();
        // on the new control it goes from idle to its disabled phase, and its observers are told
        expect(observer.onStatusChange).toHaveBeenCalledWith(InserterPhase.IDLE, InserterPhase.DISABLED, hand);
        expect(observer.onTick).toHaveBeenCalledTimes(1);
    });

    test("leaves each inserter as one built anew over its state on the same control: the same phase, scratch and key", async () => {
        const context = SimulationContext.fromConfig(await loadConfigFromFile(GameFixturePaths.DIFFERENT_ITEMS_CONFIG));
        const world = World.of(context);
        const anewOf = (inserter: InserterArchetype, enable_control: EnableControl) => {
            const state = inserter.inserter_state;
            return InserterArchetype.create({
                inserter_state: state, tick_provider: context.tick_provider, enable_control,
                source_state: context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id),
                sink_state: context.state_registry.getStateByEntityIdOrThrow(state.inserter.sink.entity_id),
            });
        };
        const next: EnableControl = { ...AlwaysEnabledControl, is_game_clock: true, decider_build_order: 2 };
        for (let tick = 0; tick < 300; tick++) {
            runTick(world, null);
        }
        const tick = context.tick_provider.getCurrentTick();
        // hands under way: what a swap sets back differs from a new inserter's before it
        expect(context.inserters.some(it => it.stateKey(tick) !== anewOf(it, next).stateKey(tick))).toBe(true);

        context.useControls({ inserter: () => next });

        for (const inserter of context.inserters) {
            const anew = anewOf(inserter, next);
            expect(inserter.stateKey(tick)).toBe(anew.stateKey(tick));
            expect(inserter.hand.phase).toBe(anew.hand.phase);
            expect(inserter.hand.scratch).toEqual(anew.hand.scratch);
            expect(inserter.hand.pickup.key()).toBe(anew.hand.pickup.key());
            expect(inserter.hand.drop.key()).toBe(anew.hand.drop.key());
            expect(inserter.control).toEqual(anew.control);
        }
    });
});
