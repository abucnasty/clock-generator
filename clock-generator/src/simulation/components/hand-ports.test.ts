import { describe, expect, it } from "vitest";
import "../../data/factorio-data-file";
import { GameFixturePaths } from "../../../tests/game/helpers/fixture-paths";
import { AssertionError } from "../../common/assert";
import { BeltStrategy } from "../../common/entity-types";
import { loadConfigFromFile } from "../../config/loader";
import { AlwaysEnabledControl } from "../../control-logic";
import { MutableTickProvider } from "../../control-logic/current-tick-provider";
import { cloneSimulationContextWithInterceptors, SimulationContext } from "../../crafting/sequence/simulation-context";
import { ItemName } from "../../data";
import { Chest, EntityId, Inserter, InserterMetadata, InserterStackSize, Machine, RecipeMetadata } from "../../entities";
import { BeltSpeed } from "../../entities/belt";
import { InserterAnimation } from "../../entities/inserter/inserter-animation";
import { EntityState, InserterState, InserterStatus, InventoryState, MachineState } from "../../state";
import { InserterArchetype } from "../archetypes/inserter";
import { TransportBelt } from "../archetypes/transport-belt";
import { InserterPhase } from "../status-codes";
import { runTick } from "../tick-phases";
import { World } from "../world";
import { BeltHandDrop } from "./belt-hand-drop";
import { BeltHandPickup } from "./belt-hand-pickup";
import { ContainerHandDrop } from "./container-hand-drop";
import { ContainerHandPickup, MixedContainerHandPickup } from "./container-hand-pickup";
import { ContainerStorage } from "./container-storage";
import { CarriedItems, dropFromHand, HandScratch, takeIntoHand } from "./hand";
import { bindHandPorts } from "./hand-ports";
import { MachineHandDrop } from "./machine-hand-drop";
import { MachineHandPickup } from "./machine-hand-pickup";

const gears = () => MachineState.forMachine(Machine.createMachine(1, {
    crafting_speed: 1,
    productivity: 0,
    recipe: RecipeMetadata.fromRecipeName("iron-gear-wheel"),
}));
const belt = () => TransportBelt.create({ entity_id: EntityId.forBelt(1), belt_speed: BeltSpeed.TURBO_TRANSPORT_BELT,
    strategy: BeltStrategy.NORMAL, lanes: [{ ingredient_name: "iron-plate", stack_size: 4 }] });
const infinity = () => ContainerStorage.forChest(Chest.fromConfig({ type: "infinity-chest", id: 1,
    item_filter: [{ item_name: "iron-plate", request_count: 100 }] }));
const buffer = () => ContainerStorage.forChest(Chest.fromConfig({ type: "buffer-chest", id: 2, storage_size: 1, item_filter: "iron-plate" }));
const car = (items: ItemName[]) => ContainerStorage.forChest(Chest.fromConfig({ type: "car", id: 3 }, items));

/** A stack inserter's state from `source` to `sink` carrying `items`, built by hand as the transition tests build theirs */
function handOf(source: EntityState, sink: EntityState, items: ItemName[], stack_size: InserterStackSize = InserterStackSize.SIZE_16): InserterState {
    const metadata = InserterMetadata.create(source.entity_id.type, sink.entity_id.type, stack_size, items, {});
    const inserter: Inserter = {
        entity_id: EntityId.forInserter(1),
        metadata,
        animation: InserterAnimation.fromMetadata(metadata.animation),
        source: { entity_id: source.entity_id, item_names: new Set(items) },
        sink: { entity_id: sink.entity_id, item_names: new Set(items) },
        filtered_items: new Set(items),
    };
    if (EntityId.isBelt(source.entity_id)) {
        inserter.pickup_length = 1;
        inserter.belt_supply = "backed_up";
    }
    return InserterState.createIdle(inserter);
}

function bind(state: InserterState, source: EntityState, sink: EntityState) {
    return bindHandPorts({ inserterState: state, sourceState: source, sinkState: sink, tick_provider: new MutableTickProvider() });
}

describe("a hand's ports", () => {
    it("are the source's pickup port and the sink's drop port, each by its archetype", () => {
        const cases: { source: EntityState; sink: EntityState; pickup: object; drop: object }[] = [
            { source: belt(), sink: gears(), pickup: BeltHandPickup, drop: MachineHandDrop },
            { source: gears(), sink: buffer(), pickup: MachineHandPickup, drop: ContainerHandDrop },
            { source: infinity(), sink: gears(), pickup: ContainerHandPickup, drop: MachineHandDrop },
            { source: car(["iron-plate"]), sink: gears(), pickup: MixedContainerHandPickup, drop: MachineHandDrop },
            { source: gears(), sink: belt(), pickup: MachineHandPickup, drop: BeltHandDrop },
        ];
        for (const { source, sink, pickup, drop } of cases) {
            const ports = bind(handOf(source, sink, ["iron-plate"]), source, sink);
            expect(ports.pickup).toBeInstanceOf(pickup);
            expect(ports.drop).toBeInstanceOf(drop);
        }
    });

    it("refuse a source or a sink no archetype has a port for, the source first", () => {
        const other = { entity_id: EntityId.forDrill(9), inventoryState: InventoryState.empty() };
        const state = handOf(gears(), gears(), []);
        expect(() => bind(state, other, other)).toThrow("Unsupported inserter pickup source: drill");
        expect(() => bind(state, gears(), other)).toThrow("Unsupported inserter drop sink: drill");
    });

    // the pickup's and the drop's parts of the Hand's key, as each logic keyed itself when it was built (P4 3.4)
    it("start with a fresh scratch record, keyed as the pickup and the drop were", () => {
        const keys = (source: EntityState, sink: EntityState) => {
            const ports = bind(handOf(source, sink, ["iron-plate"]), source, sink);
            return [ports.pickup.key(), ports.drop.key()];
        };
        expect(keys(belt(), gears())).toEqual(["true", "0"]);
        expect(keys(gears(), buffer())).toEqual(["0", "0"]);
        expect(keys(infinity(), gears())).toEqual(["0", "0"]);
        expect(keys(gears(), belt())).toEqual(["0", ""]);
    });

    // same-tick rule 12
    it("start a fresh scratch record when the inserter's control is swapped mid-pickup, keeping the hand, the arm and the lane slots", async () => {
        const context = SimulationContext.fromConfig(await loadConfigFromFile(GameFixturePaths.DIFFERENT_ITEMS_CONFIG));
        const pickupPort = (inserter: InserterArchetype) => inserter.hand.pickup;
        const scratchOf = (inserter: InserterArchetype) => inserter.hand.scratch;
        const index = context.inserters.findIndex(it => EntityId.isBelt(it.inserter_state.inserter.source.entity_id));
        const inserter = context.inserters[index];
        const state = inserter.inserter_state;
        const world = World.of(context);
        for (let tick = 0; tick < 600 && !(state.status === InserterStatus.PICKUP && state.held_item !== null); tick++) {
            runTick(world, null);
        }
        expect([state.status, state.held_item === null]).toEqual([InserterStatus.PICKUP, false]);
        const source = context.state_registry.getStateByEntityIdOrThrow(state.inserter.source.entity_id);
        if (!EntityState.isBelt(source)) throw new Error("not a belt-fed inserter");
        const old_scratch = scratchOf(inserter);
        // the port's scratch is the Hand's
        expect((pickupPort(inserter) as unknown as { scratch: HandScratch }).scratch).toBe(old_scratch);
        // what a pickup and a drop under way would have counted, and the rules kept, so that the fresh record shows
        Object.assign(old_scratch, { pickup_ticks: 3, window_opened: true, ticks_in_pickup: 4, belt_grab_decided: false, drop_ticks: 5,
            saw_sink_blocked: true, window_opens: true, swing_entered_tick: 7, swing_from: InserterPhase.PICKUP });
        const hand = state.held_item;
        const arm = state.pickup_arm;
        const pickups = source.pickupsOf(state.entity_id.id)!;
        const slots = source.lanes.map(lane => lane.pickupOf(state.entity_id.id));
        expect(arm).toBeDefined();

        const swapped = cloneSimulationContextWithInterceptors(context, { inserter: () => AlwaysEnabledControl }).inserters[index];

        expect(swapped).not.toBe(inserter);
        expect(swapped.inserter_state).toBe(state);
        const scratch = scratchOf(swapped);
        expect(scratch).not.toBe(old_scratch);
        expect(scratch).toEqual(new HandScratch());
        expect([scratch.pickup_ticks, scratch.window_opened, scratch.ticks_in_pickup, scratch.belt_grab_decided, scratch.drop_ticks])
            .toEqual([0, false, 0, true, 0]);
        expect([scratch.saw_sink_blocked, scratch.window_opens, scratch.swing_entered_tick, scratch.swing_from]).toEqual([false, false, null, null]);
        // the new inserter starts idle while the status as written is kept
        expect(swapped.hand.phase).toBe(InserterPhase.IDLE);
        expect(state.status).toBe(InserterStatus.PICKUP);
        expect(state.held_item).toBe(hand);
        expect(state.pickup_arm).toBe(arm);
        expect((pickupPort(swapped) as unknown as { arm?: object }).arm).toBe(arm);
        source.pickupsOf(state.entity_id.id)!.forEach((stock, lane) => expect(stock).toBe(pickups[lane]));
        source.lanes.forEach((lane, lane_index) => expect(lane.pickupOf(state.entity_id.id)).toBe(slots[lane_index]));
        (pickupPort(swapped) as unknown as { pickups: object[] }).pickups.forEach((slot, lane_index) => expect(slot).toBe(slots[lane_index]));
    });
});

describe("the drop port of a container, as a hand reaches it", () => {
    it("takes as many as it has room for, the rest staying in the hand, and keys every tick of the drop", () => {
        const chest = buffer();
        const state = handOf(infinity(), chest, ["iron-plate"]);
        const { drop, scratch } = bind(state, infinity(), chest);
        takeIntoHand(state, scratch, "iron-plate", 12);
        chest.insert("iron-plate", 95);
        drop.enter();
        drop.drop();
        expect(state.held_item).toEqual({ item_name: "iron-plate", quantity: 7 });
        expect(chest.getCurrentQuantity("iron-plate")).toBe(100);
        expect(drop.acceptsHand()).toBe(false);
        drop.drop();
        expect(state.held_item?.quantity).toBe(7);
        expect(drop.key()).toBe("2");
        chest.take("iron-plate", 10);
        expect(drop.acceptsHand()).toBe(true);
        drop.drop();
        expect(state.held_item).toBeNull();
        expect(state.items_dropped).toBe(12);
        drop.enter();
        expect(drop.key()).toBe("0");
        // a container never stops a hand filling at its source
        expect([drop.takesAt(0), drop.takes("iron-plate")]).toEqual([true, true]);
    });
});

describe("the drop port of a machine, as a hand reaches it", () => {
    it("takes the whole hand in one tick, with no limit check (a known quirk, kept)", () => {
        const machine = gears();
        const state = handOf(infinity(), machine, ["iron-plate"]);
        const { drop, scratch } = bind(state, infinity(), machine);
        const limit = machine.machine.inputs.getOrThrow("iron-plate").automated_insertion_limit.quantity;
        takeIntoHand(state, scratch, "iron-plate", limit + 50);
        drop.enter();
        drop.drop();
        expect(machine.inventoryState.getQuantity("iron-plate")).toBe(limit + 50);
        expect(state.held_item).toBeNull();
        expect(drop.key()).toBe("1");
        expect(() => drop.drop()).toThrow(new AssertionError("inserter:1 Held item should not be null when dropping off to machine"));
    });

    it("refuses an item it carries while the machine is at the item's limit or its output block, by the slot bound at build", () => {
        const machine = gears();
        const state = handOf(infinity(), machine, ["iron-plate"]);
        const { drop } = bind(state, infinity(), machine);
        expect([drop.acceptsHand(), drop.takesAt(0), drop.takes("iron-plate")]).toEqual([true, true, true]);
        machine.inventoryState.setQuantity("iron-plate", machine.machine.inputs.getOrThrow("iron-plate").automated_insertion_limit.quantity);
        expect([drop.acceptsHand(), drop.takesAt(0), drop.takes("iron-plate")]).toEqual([false, false, false]);
        machine.inventoryState.setQuantity("iron-plate", 0);
        machine.inventoryState.setQuantity("iron-gear-wheel", machine.machine.output.outputBlock.ingredients_blocked_at);
        expect([drop.acceptsHand(), drop.takesAt(0), drop.takes("iron-plate")]).toEqual([false, false, false]);
        // an item the hand does not carry, by the Ingress itself: one the machine never takes is always refused
        expect(drop.takes("coal")).toBe(false);
    });
});

describe("the drop port of a belt, as a hand reaches it", () => {
    it("takes whatever a hand brings and keeps nothing for the key", () => {
        const output = belt();
        const { drop } = bind(handOf(gears(), output, ["iron-plate"]), gears(), output);
        expect([drop.acceptsHand(), drop.takesAt(0), drop.takes("iron-plate"), drop.key()]).toEqual([true, true, true, ""]);
    });
});

describe("the pickup port of a container, as a hand reaches it", () => {
    // same-tick rule 11
    it("sets the inserter idle itself when the container has nothing for the hand, and counts no tick of its pickup", () => {
        const source = car(["iron-plate"]);
        const state = handOf(source, gears(), ["iron-plate"]);
        const { pickup } = bind(state, source, gears());
        state.status = InserterStatus.PICKUP;
        pickup.enter(InserterPhase.IDLE);
        pickup.pickup();
        expect(state.status).toBe(InserterStatus.IDLE);
        expect(pickup.key()).toBe("0");
    });

    it("gives from a container of mixed items the item of its last slot, a partly filled hand only more of its item", () => {
        const source = car(["iron-plate", "copper-plate"]);
        source.insert("iron-plate", 10);
        source.insert("copper-plate", 10);
        const sink = car(["iron-plate", "copper-plate"]);
        const state = handOf(source, sink, ["iron-plate", "copper-plate"]);
        const { pickup } = bind(state, source, sink);
        pickup.enter(InserterPhase.IDLE);
        pickup.pickup();
        expect(state.held_item).toEqual({ item_name: "copper-plate", quantity: 10 });
        // copper gone: iron is there, but not for a hand of copper
        pickup.pickup();
        expect(state.held_item).toEqual({ item_name: "copper-plate", quantity: 10 });
        expect(source.getCurrentQuantity("iron-plate")).toBe(10);
        expect(pickup.key()).toBe("2");
    });
});

describe("the items a hand carries", () => {
    it("are bound in the hand's order with the hand of each, and let any item through when there are none", () => {
        const state = handOf(gears(), gears(), ["iron-gear-wheel", "iron-plate"], InserterStackSize.SIZE_12);
        const items = new CarriedItems(state.inserter);
        expect(items.names).toEqual(["iron-gear-wheel", "iron-plate"]);
        expect([items.indexOf("iron-plate"), items.indexOf("coal")]).toEqual([1, -1]);
        expect([items.handSizeOf("iron-plate"), items.handSizeOf("coal")]).toEqual([12, 12]);
        expect([items.lets("iron-plate"), items.lets("coal")]).toEqual([true, false]);
        expect(new CarriedItems(handOf(gears(), gears(), []).inserter).lets("coal")).toBe(true);
    });
});

describe("a hand", () => {
    it("fills in place, counts what it picks up and drops, and is empty once its last items are dropped", () => {
        const state = handOf(gears(), gears(), ["iron-gear-wheel"]);
        const scratch = new HandScratch();
        takeIntoHand(state, scratch, "iron-gear-wheel", 3);
        const hand = state.held_item;
        takeIntoHand(state, scratch, "iron-gear-wheel", 5);
        expect(state.held_item).toBe(hand);
        expect(hand).toEqual({ item_name: "iron-gear-wheel", quantity: 8 });
        expect([state.items_picked_up, state.inventoryState.getQuantity("iron-gear-wheel")]).toEqual([8, 8]);
        dropFromHand(state, scratch, 6);
        expect(state.held_item).toEqual({ item_name: "iron-gear-wheel", quantity: 2 });
        dropFromHand(state, scratch, 4);
        expect(state.held_item).toBeNull();
        expect([state.items_dropped, state.inventoryState.getQuantity("iron-gear-wheel")]).toEqual([8, 0]);
        expect(() => dropFromHand(state, scratch, 1)).toThrow(new AssertionError("inserter:1 Held item should not be null when dropping off"));
    });

    // a new hand makes no record of its own after the first (P4 section 8), and its key's text is a new record's
    it("fills the record of the hand last emptied when it starts again, with its fields in the order of a new one", () => {
        const state = handOf(gears(), gears(), ["iron-gear-wheel", "iron-plate"]);
        const scratch = new HandScratch();
        takeIntoHand(state, scratch, "iron-gear-wheel", 4);
        const first = state.held_item;
        dropFromHand(state, scratch, 4);
        expect([state.held_item, scratch.spare_hand]).toEqual([null, first]);
        takeIntoHand(state, scratch, "iron-plate", 2);
        expect(state.held_item).toBe(first);
        expect(scratch.spare_hand).toBeNull();
        expect(JSON.stringify(state.held_item)).toBe(JSON.stringify({ item_name: "iron-plate", quantity: 2 }));
        expect([state.items_picked_up, state.items_dropped]).toEqual([6, 4]);
    });
});
