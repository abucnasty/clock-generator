import { describe, expect, test } from "vitest";
import { ConfigSchema } from "../config/schema";
import { SimulationContext } from "../crafting/sequence/simulation-context";
import { EntityId } from "../entities";
import type { EntityState } from "../state";
import { factorioInserterState } from "../state/factorio-entity-state";
import type { SingleItemStorage } from "./components/single-item-storage";
import type { EnableControl } from "./controls/enable-control";
import { runTick } from "./tick-phases";
import { World } from "./world";

/**
 * A legendary stack inserter of hand 16 takes iron plates from a full, standing turbo belt into a steel chest of 48
 * slots, on the production tick order, against what Factorio 2.1 shows tick by tick: the hand, the chest's level and the
 * inserter's state. Row r is the state after r calls of runTick. The inserter is switched on from tick 132 on, so it is
 * shown enabled one row before. Where room is made in the chest, 16 plates are taken out of it after the RELIEF sample.
 */

const ROWS = 256;
const IRON = "iron-plate";
/** The row after whose sample 16 plates are taken out of the chest */
const RELIEF = 192;

/** A control of the game's clock, answering from the tick alone: acting in tick t when on(t) */
function clock(context: SimulationContext, on: (tick: number) => boolean): EnableControl {
    const at = (ticks: number) => on(context.tick_provider.getCurrentTick() + ticks);
    return { isEnabled: () => at(0), isEnabledIn: at, is_game_clock: true };
}

/** Open from `from` on */
function window(from: number): (tick: number) => boolean {
    return tick => tick >= from;
}

/** A full, standing lane of iron plates in stacks of 4, ending at a dead end */
const LANE = { ingredient: IRON, stack_size: 4, lane_end: { kind: "dead_end" } };

function beltToChest() {
    return ConfigSchema.parse({
        setpoint: { item: IRON, items_per_second: 1, copies: 1 },
        machines: [],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [LANE, LANE] }],
        inserters: [{ id: 1, source: { type: "belt", id: 1, near_lane: 1, pickup_length: 1, pickup_layout: "side-straight" },
            sink: { type: "chest", id: 1 }, prototype: "stack-inserter", quality: "legendary", stack_size: 16, filters: [IRON] }],
        chests: [{ id: 1, type: "buffer-chest", storage_size: 48, item_filter: IRON, prototype: "steel-chest" }],
    });
}

interface Row { held: number; chest: number; status: string }

/** Runs rows 0 to 255 from a chest that holds `seed`, with 16 plates taken out after RELIEF when `relief` */
function run(seed: number, relief: boolean): Row[] {
    const context = SimulationContext.fromConfig(beltToChest());
    const chest = context.state_registry.getStateByEntityIdOrThrow(EntityId.forChest(1)) as unknown as SingleItemStorage;
    chest.inventoryState.setQuantity(IRON, seed);
    context.useControls({ inserter: () => clock(context, window(132)) });
    const world = World.of(context);
    const arm = context.inserters.find(it => it.entity_id.number === 1)!;
    const scheduling = context.inserterScheduling()!;
    const rows: Row[] = [];
    const sample = () => {
        const state = arm.inserter_state;
        rows.push({
            held: state.held_item?.quantity ?? 0,
            chest: chest.getCurrentQuantity(),
            status: factorioInserterState(state, chest as unknown as EntityState, scheduling.listingOf(arm)),
        });
    };
    sample();
    for (let row = 1; row < ROWS; row++) {
        runTick(world, null);
        sample();
        if (relief && row === RELIEF) chest.inventoryState.setQuantity(IRON, chest.getCurrentQuantity() - 16);
    }
    expect(chest.getCapacity()).toBe(4800);
    return rows;
}

/** [first row, last row, held, chest, status]: what the game shows in every row of the span */
type Span = readonly [number, number, number, number, string];

function expectSpans(rows: Row[], spans: readonly Span[]): void {
    const actual: Row[] = [];
    const expected: Row[] = [];
    for (const [from, to, held, chest, status] of spans) {
        for (let row = from; row <= to; row++) {
            actual.push({ ...rows[row], row } as Row);
            expected.push({ held, chest, status, row } as Row);
        }
    }
    expect(actual).toEqual(expected);
}

const WORKING = "working";
const NO_SPACE = "waiting_for_space_in_destination";
const NO_ITEMS = "waiting_for_source_items";

describe("a belt pickup into a steel chest of 48 slots, against the game", () => {
    test("an empty chest: the first 11 hands fill in 4 rows and drop 16 each, 11 rows apart", () => {
        const spans: Span[] = [[131, 131, 0, 0, NO_ITEMS]];
        for (let hand = 0; hand < 11; hand++) {
            const start = 132 + 11 * hand, level = 16 * hand;
            spans.push(
                [start, start, 4, level, WORKING],
                [start + 1, start + 1, 8, level, WORKING],
                [start + 2, start + 2, 12, level, WORKING],
                [start + 3, start + 6, 16, level, WORKING],
            );
            // the drop: the hand is empty and the chest 16 up, until the next hand starts
            spans.push([start + 7, hand < 10 ? start + 10 : start + 7, 0, level + 16, WORKING]);
        }
        expectSpans(run(0, false), spans);
    });

    test("a full chest: the hand waits empty, fills once room is made, drops 16 and waits again", () => {
        expectSpans(run(4800, true), [
            [131, 192, 0, 4800, NO_SPACE],
            // to the bracket of the relief: the room is made between the two samples, not in a known tick
            [193, 193, 4, 4784, WORKING],
            [194, 194, 8, 4784, WORKING],
            [195, 195, 12, 4784, WORKING],
            [196, 199, 16, 4784, WORKING],
            [200, 255, 0, 4800, NO_SPACE],
        ]);
    });

    test("a chest with room for 8: the hand inserts 8 and holds 8 until room is made", () => {
        expectSpans(run(4792, true), [
            [131, 131, 0, 4792, NO_ITEMS],
            [132, 132, 4, 4792, WORKING],
            [133, 133, 8, 4792, WORKING],
            [134, 134, 12, 4792, WORKING],
            [135, 138, 16, 4792, WORKING],
            [139, 192, 8, 4800, NO_SPACE],
            // to the bracket of the relief: the 8 go in once room is made between the two samples
            [193, 196, 0, 4792, WORKING],
            [197, 197, 4, 4792, WORKING],
            [198, 198, 8, 4792, WORKING],
            [199, 199, 12, 4792, WORKING],
            [200, 203, 16, 4792, WORKING],
            [204, 204, 8, 4800, NO_SPACE],
        ]);
    });
});
