import fs from "node:fs";
import path from "node:path";
import {expect, test} from "vitest";
import "../../data/factorio-data-file";
import {GameFixturePaths} from "../../../tests/game/helpers/fixture-paths";
import {EntityId, Inserter, InserterMetadata, InserterStackSize, Machine, RecipeMetadata, SlotContainer} from "../../entities";
import {InserterAnimation} from "../../entities/inserter/inserter-animation";
import {InserterState, MachineState} from "../../state";
import {InserterArchetype} from "../archetypes/inserter";
import {MutableTickProvider} from "../current-tick-provider";
import {SlotStorage} from "./slot-storage";

interface Row {tick: number; hand: {held: number; disabled: boolean}}

test("Mechanics: RI6 real pickup stays carried across full-destination clock edges", () => {
    const native = JSON.parse(fs.readFileSync(path.join(GameFixturePaths.CIRCUIT_EVALUATION, "visible-window.json"), "utf8")) as {
        rows: Row[]; interventions: {tick: number; inserted: number}[];
    };
    const source = MachineState.forMachine(Machine.createMachine(1, {crafting_speed: 1.25, productivity: 0, recipe: RecipeMetadata.fromRecipeName("copper-cable")}));
    source.inventoryState.setQuantity("copper-cable", 32);
    const sink = SlotStorage.forChest(new SlotContainer(EntityId.forChest(2), "car", "normal", Array(48).fill(null), [], ["copper-cable", "iron-plate"]));
    const metadata = InserterMetadata.create("machine", "chest", InserterStackSize.SIZE_16, ["copper-cable"], {});
    const inserter: Inserter = {entity_id: EntityId.forInserter(3), metadata, animation: InserterAnimation.fromMetadata(metadata.animation),
        source: {entity_id: source.entity_id, item_names: new Set(["copper-cable"])},
        sink: {entity_id: sink.entity_id, item_names: new Set(["copper-cable"])}, filtered_items: new Set(["copper-cable"])};
    const state = InserterState.createIdle(inserter);
    const tick = new MutableTickProvider();
    let enabled = true;
    const archetype = InserterArchetype.create({inserter_state: state, source_state: source, sink_state: sink, tick_provider: tick,
        enable_control: {is_game_clock: true, isEnabled: () => enabled}});
    const quantities: number[] = [];
    for (const row of native.rows) {
        tick.setCurrentTick(row.tick);
        // Supply the measured circuit-enabled stream, not native hand outcomes or scheduler membership.
        // This tests carry/drop physics only; generic circuit evaluation and exact phase timing are separate observations.
        enabled = !row.hand.disabled;
        archetype.executeForTick();
        quantities.push(state.held_item?.quantity ?? 0);
        if (row.tick === native.interventions[0].tick) sink.insert("iron-plate", native.interventions[0].inserted);
    }
    expect(state.items_picked_up).toBe(16); // pickup is derived, never injected into the hand
    expect(state.items_dropped).toBe(0);
    expect(source.inventoryState.getQuantity("copper-cable")).toBe(16);
    expect(sink.getCurrentQuantity("iron-plate")).toBe(4800);
    expect(quantities).toEqual(native.rows.map(row => row.hand.held));
    expect(new Set(native.rows.map(row => row.hand.disabled))).toEqual(new Set([true, false]));
});
