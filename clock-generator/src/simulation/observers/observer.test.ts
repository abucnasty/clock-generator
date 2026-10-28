import { describe, expect, it } from "vitest";
import { MutableTickProvider } from "../../control-logic/current-tick-provider";
import { reasonId, reasonText } from "../../control-logic/mode/reason-table";
import { StateTransitionHistory } from "../../crafting/sequence/state-transition-history";
import { expandStateTransitionHistory } from "../../crafting/sequence/compact-history";
import { EntityRegistry, Machine, RecipeMetadata } from "../../entities";
import { MachineState } from "../../state";
import type { InserterHandContents, InserterState } from "../../state/inserter-state";
import { CraftingStatus, machineStatusOf } from "../status-codes";
import { CraftEventListener } from "./craft-event-listener";
import { FactorioStateTracker } from "./factorio-state-tracker";
import { HandChangeListener } from "./hand-change-listener";
import { EntityObserver, Observers, StatusChangeReason } from "./observer";
import { StateTransitionTracker } from "./state-transition-tracker";

/** A reason that counts how often it is asked */
function countedReason(text: string) {
    const asked = { count: 0 };
    const reason: StatusChangeReason<CraftingStatus> = { reasonId: () => { asked.count++; return reasonId(text); } };
    return { reason, asked };
}

describe("an entity's observers", () => {
    it("tell each event to the observers that take it, in the order they were added", () => {
        const observers = new Observers<CraftingStatus>();
        const told: string[] = [];
        const { reason } = countedReason("observers: a change");
        const both: EntityObserver<CraftingStatus> = { onStatusChange: (from, to) => told.push(`both ${from}>${to}`), onTick: () => told.push("both tick") };
        const changes: EntityObserver<CraftingStatus> = { onStatusChange: (from, to, of) => told.push(`changes ${reasonText(of.reasonId(from, to))}`) };
        const ticks: EntityObserver<CraftingStatus> = { onTick: () => told.push("ticks tick") };
        observers.add(ticks);
        observers.add(both);
        observers.add(changes);
        observers.tellStatusChange(CraftingStatus.ITEM_INGREDIENT_SHORTAGE, CraftingStatus.WORKING, reason);
        observers.tellTick();
        expect(told).toEqual([`both ${CraftingStatus.ITEM_INGREDIENT_SHORTAGE}>${CraftingStatus.WORKING}`, "changes observers: a change", "ticks tick", "both tick"]);
        expect(observers.list()).toEqual([ticks, both, changes]);
    });

    it("tell an observer taken off nothing more, and keep the others in their order", () => {
        const observers = new Observers<CraftingStatus>();
        const told: string[] = [];
        const of = (name: string): EntityObserver<CraftingStatus> => ({ onStatusChange: () => told.push(`${name} change`), onTick: () => told.push(`${name} tick`) });
        const [first, second, third] = [of("first"), of("second"), of("third")];
        [first, second, third].forEach(it => observers.add(it));
        observers.remove(new Set([second]));
        observers.tellStatusChange(CraftingStatus.WORKING, CraftingStatus.NO_FUEL, countedReason("observers: removed").reason);
        observers.tellTick();
        expect(told).toEqual(["first change", "third change", "first tick", "third tick"]);
        expect(observers.list()).toEqual([first, third]);
    });
});

describe("the state transition tracker", () => {
    const tracked = () => {
        const registry = new EntityRegistry();
        const machine = Machine.createMachine(1, { crafting_speed: 1, productivity: 0, recipe: RecipeMetadata.fromRecipeName("iron-gear-wheel") });
        registry.add(machine);
        const history = new StateTransitionHistory();
        const ticks = MutableTickProvider.create(0);
        const tracker = new StateTransitionTracker(ticks, history.recorderFor(machine.entity_id, "machine"), machineStatusOf);
        const read = () => expandStateTransitionHistory(history.seal(registry, 100)).entities.flatMap(it => it.transitions)
            .map(it => [it.tick, it.from_status, it.to_status, it.reason]);
        return { history, ticks, tracker, read };
    };

    // P4 section 8: a reason's text (a template's built anew) is made only where it is recorded
    it("asks for no reason while its history does not record, as in a run's prepare step and warm-ups", () => {
        const { history, ticks, tracker, read } = tracked();
        const { reason, asked } = countedReason("tracker: not recorded");
        history.recording = false;
        ticks.setCurrentTick(5);
        tracker.onStatusChange(CraftingStatus.ITEM_INGREDIENT_SHORTAGE, CraftingStatus.WORKING, reason);
        expect(asked.count).toBe(0);
        expect(read()).toEqual([]);
    });

    it("records each change with its tick, the statuses as the histories name them and the reason it asks for", () => {
        const { ticks, tracker, read } = tracked();
        const { reason, asked } = countedReason("tracker: recorded");
        ticks.setCurrentTick(7);
        tracker.onStatusChange(CraftingStatus.WORKING, CraftingStatus.FULL_OUTPUT, reason);
        expect(asked.count).toBe(1);
        expect(read()).toEqual([[7, "WORKING", "OUTPUT_FULL", "tracker: recorded"]]);
    });
});

describe("the Factorio state tracker", () => {
    it("records the state the entity shows each tick it changes, and nothing in the ticks between", () => {
        const ticks = MutableTickProvider.create(0);
        const recorded: [number, string][] = [];
        const shown = ["working", "working", "no_power", "no_power", "working"];
        let tick = 0;
        const tracker = new FactorioStateTracker(ticks, () => shown[tick], { recordFactorioState: (at, state) => recorded.push([at, state]) });
        for (; tick < shown.length; tick++) {
            ticks.setCurrentTick(tick);
            tracker.onTick();
        }
        expect(recorded).toEqual([[0, "working"], [2, "no_power"], [4, "working"]]);
    });
});

describe("the hand change listener", () => {
    it("tells of each tick the hand's item or quantity changes, the hand filled in place included", () => {
        const state = { held_item: null as InserterHandContents | null };
        const seen: (string | null)[] = [];
        const listener = new HandChangeListener(state as unknown as InserterState, current => seen.push(current === null ? null : `${current.item_name}=${current.quantity}`));
        const hand = { item_name: "iron-plate", quantity: 4 };
        const ticks: (() => void)[] = [
            () => { },
            () => { state.held_item = hand; },
            () => { },
            // the hand is filled in place: the same record, more in it
            () => { hand.quantity = 8; },
            () => { state.held_item = null; },
        ];
        for (const tick of ticks) {
            tick();
            listener.onTick();
        }
        expect(seen).toEqual(["iron-plate=4", "iron-plate=8", null]);
    });
});

describe("the craft event listener", () => {
    it("tells of each tick crafts finish in, with the crafts before and the ticks since it started working or last told", () => {
        const machine_state = MachineState.forMachine(Machine.createMachine(1, { crafting_speed: 1, productivity: 0, recipe: RecipeMetadata.fromRecipeName("iron-gear-wheel") }));
        const ticks = MutableTickProvider.create(0);
        const told: [number, number, number, number][] = [];
        const listener = new CraftEventListener(machine_state, ticks, event => told.push([event.craft_index, event.craft_ticks.start_inclusive, event.craft_ticks.end_inclusive, event.state.craftCount]));
        const at = (tick: number, craft_count: number) => {
            ticks.setCurrentTick(tick);
            machine_state.craftCount = craft_count;
            listener.onTick();
        };
        ticks.setCurrentTick(3);
        listener.onStatusChange(CraftingStatus.ITEM_INGREDIENT_SHORTAGE, CraftingStatus.WORKING);
        at(4, 0);
        at(10, 1);
        at(11, 1);
        at(17, 3);
        // a change to a status other than WORKING leaves the tick it counts from
        listener.onStatusChange(CraftingStatus.WORKING, CraftingStatus.FULL_OUTPUT);
        at(20, 4);
        expect(told).toEqual([[0, 3, 10, 1], [1, 10, 17, 3], [3, 17, 20, 4]]);
    });
});
