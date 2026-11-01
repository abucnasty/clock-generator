import fs from "node:fs";
import path from "node:path";
import {expect, test} from "vitest";
import "../../data/factorio-data-file";
import {GameFixturePaths} from "../../../tests/game/helpers/fixture-paths";
import {EntityId, Inserter, InserterMetadata, InserterStackSize, Machine, RecipeMetadata, SlotContainer} from "../../entities";
import {InserterAnimation} from "../../entities/inserter/inserter-animation";
import {InserterState, MachineState} from "../../state";
import {SlotStorage} from "./slot-storage";
import {bindHandPorts} from "./hand-ports";

interface Slot {slot: number; name: string; count: number}
interface Cell {cell: number; state: string; many: boolean; destination_input: Slot[]; destination_output: Slot[]}
interface Event {probe_tick: number; role: string; event: string; owner?: string; slot?: number; source_slot?: number; returned_bool?: boolean}
const fixture = JSON.parse(fs.readFileSync(path.join(GameFixturePaths.SOURCE_SEARCH, "observations.json"), "utf8")) as {
    initial: Cell[]; interventions: {stocks?: {cell: number; slots: Slot[]}[]}[]; events: Event[]; observer_isFull_calls_excluded_each: number;
};

test.each(fixture.initial)("Mechanics: native RI4 cell $cell $state / many=$many predicts pickup from supplied inventories", cell => {
    const stocks = fixture.interventions.find(i => i.stocks)!.stocks!.find(s => s.cell === cell.cell)!.slots;
    const chest = new SlotContainer(EntityId.forChest(1), "car", "normal", Array(48).fill(null),
        stocks.map(s => ({slot: s.slot, item: s.name, count: s.count})), ["iron-gear-wheel"]);
    const source = SlotStorage.forChest(chest);
    const sink = MachineState.forMachine(Machine.createMachine(2, {crafting_speed: 1.25, productivity: 0, recipe: RecipeMetadata.fromRecipeName("engine-unit")}));
    for (const s of [...Object.values(cell.destination_input), ...Object.values(cell.destination_output)]) sink.inventoryState.setQuantity(s.name, s.count);
    const metadata = InserterMetadata.create("chest", "machine", InserterStackSize.SIZE_16, ["iron-gear-wheel"], {});
    const inserter: Inserter = {entity_id: EntityId.forInserter(3), metadata, animation: InserterAnimation.fromMetadata(metadata.animation),
        source: {entity_id: source.entity_id, item_names: new Set(["iron-gear-wheel"])},
        sink: {entity_id: sink.entity_id, item_names: new Set(["iron-gear-wheel"])}, filtered_items: new Set(["iron-gear-wheel"])};
    const state = InserterState.createIdle(inserter);
    const ports = bindHandPorts({inserterState: state, sourceState: source, sinkState: sink});
    // Inventories and a pickup opportunity are supplied; quantity and source depletion are simulator-derived.
    // This does not replay supplied native outcomes as the simulation's own result or model native call counts.
    ports.pickup.pickup();
    const accepted = cell.state === "accepting";
    expect(state.held_item?.quantity ?? 0).toBe(accepted ? 16 : 0);
    expect(source.getCurrentQuantity("iron-gear-wheel")).toBe(accepted ? 32 : 48);
    if (accepted && cell.many) expect(source.inventoryState.slots.slice(32).every(s => s.count === 0)).toBe(true);
    const owned = fixture.events.filter(e => e.probe_tick === 4 && (e.owner === `hand_${cell.cell}` || e.role === `hand_${cell.cell}`));
    const slots = owned.filter(e => e.event === "source_slot");
    const checks = owned.filter(e => e.event === "AssemblingMachine::canInsert");
    expect(slots).toHaveLength(cell.state === "output-overloaded" ? 0 : cell.many ? accepted ? 16 : 48 : 1);
    expect(checks).toHaveLength(cell.state === "output-overloaded" ? 0 : cell.many && accepted ? 16 : 1);
    expect(checks.every(e => e.returned_bool === accepted)).toBe(true);
    expect(fixture.observer_isFull_calls_excluded_each).toBe(106);
    if (accepted) {
        ports.drop.drop(); // independently deliver the first hand into the otherwise inert engine assembler
        expect(sink.inventoryState.getQuantity("iron-gear-wheel")).toBe(16);
        ports.pickup.pickup();
        expect(state.held_item).toBeNull();
        expect(source.getCurrentQuantity("iron-gear-wheel")).toBe(32);
        const later = fixture.events.filter(e => e.probe_tick === 12 && (e.owner === `hand_${cell.cell}` || e.role === `hand_${cell.cell}`));
        expect(later.filter(e => e.event === "source_slot")).toHaveLength(cell.many ? 32 : 1);
        expect(later.filter(e => e.event === "AssemblingMachine::canInsert").map(e => e.returned_bool)).toEqual([false]);
    }
});
