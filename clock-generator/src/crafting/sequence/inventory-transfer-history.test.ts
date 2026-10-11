import { beforeAll, describe, expect, it } from "vitest";
import { fraction } from "fractionability";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { FactorioDataService } from "../../data";
import { OpenRange } from "../../data-types";
import { Entity, EntityId } from "../../entities";
import { EntityTransferCountMap } from "./cycle/swing-counts";
import { InventoryTransfer } from "./inventory-transfer";
import { InventoryTransferHistory } from "./inventory-transfer-history";
import { SimulationContext } from "./simulation-context";

beforeAll(() => {
    FactorioDataService.findRecipeOrThrow("iron-gear-wheel");
});

describe("trimEndsToAvoidBackSwingWakeLists", () => {
    // a jelly inserter of the rocket fuel build, between two machines: a window ends when its hand is dropped
    const jellyInserter = async () => {
        const config = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
        const registry = SimulationContext.fromConfig(config).entity_registry;
        const inserter = registry.getAll().filter(Entity.isInserter)
            .find(it => EntityId.isMachine(it.source.entity_id) && EntityId.isMachine(it.sink.entity_id))!;
        const plan = EntityTransferCountMap.fromEntries([[inserter.entity_id, {
            entity: inserter,
            item_transfers: [{ item_name: "jelly", transfer_count: fraction(4) }],
            total_transfer_count: fraction(4),
            stack_size: 16,
        }]]);
        const trim = (transfers: InventoryTransfer[], period_ticks?: number) => InventoryTransferHistory
            .trimEndsToAvoidBackSwingWakeLists(new InventoryTransferHistory(new Map([[inserter.entity_id, transfers]])), registry, plan, period_ticks)
            .get(inserter.entity_id)!
            .map(transfer => [transfer.tick_range.start_inclusive, transfer.tick_range.end_inclusive, transfer.amount]);
        return { trim, back_swing_ticks: inserter.animation.rotation.ticks };
    };

    it("ends a window where the hand is dropped, before the swing back", async () => {
        const { trim, back_swing_ticks } = await jellyInserter();
        expect(trim([{ item_name: "jelly", tick_range: OpenRange.from(10, 18), amount: 16 }], 64))
            .toEqual([[10, 18 - back_swing_ticks, 16]]);
    });

    it("gives a hand that was in flight when the run started a window for its pickup at the end of the period", async () => {
        const { trim, back_swing_ticks } = await jellyInserter();
        // picked up 6 ticks before the run and back at tick 2 of it; the run starts at tick 1 here
        const in_flight: InventoryTransfer = { item_name: "jelly", tick_range: OpenRange.from(1, 50), amount: 120, pickup_tick_before_run: -6 };
        expect(trim([in_flight], 64)).toEqual([
            [1, 50 - back_swing_ticks, 120],
            // 58 is tick -6 a period later, and the window runs up to where the one from tick 1 takes over
            [58, 64, 0],
        ]);
    });

    it("keeps the pickup window of a hand that was dropped before the run started", async () => {
        const { trim, back_swing_ticks } = await jellyInserter();
        // only the swing back is inside the run, which leaves nothing of it once its end is trimmed
        const in_flight: InventoryTransfer = { item_name: "jelly", tick_range: OpenRange.from(1, 2), amount: 16, pickup_tick_before_run: -6 };
        const windows = trim([in_flight], 64);
        expect(windows).toHaveLength(1);
        expect(windows[0][0]).toBe(58);
        expect(windows[0][1]).toBe(Math.max(58, 2 - back_swing_ticks + 64));
    });

    it("leaves a hand in flight alone when the period is not known", async () => {
        const { trim, back_swing_ticks } = await jellyInserter();
        const in_flight: InventoryTransfer = { item_name: "jelly", tick_range: OpenRange.from(1, 50), amount: 120, pickup_tick_before_run: -6 };
        expect(trim([in_flight])).toEqual([[1, 50 - back_swing_ticks, 120]]);
    });
});

describe("mergeOverlappingRanges and correctNegativeOffsets", () => {
    const id = EntityId.forInserter(1);
    const history = (transfers: InventoryTransfer[]) => new InventoryTransferHistory(new Map([[id, transfers]]));

    it("carry the pickup of a hand in flight through to the merged, shifted window", () => {
        const merged = InventoryTransferHistory.mergeOverlappingRanges(history([
            { item_name: "jelly", tick_range: OpenRange.from(0, 1), amount: 15, pickup_tick_before_run: -7 },
            { item_name: "jelly", tick_range: OpenRange.from(1, 9), amount: 15 },
        ]));
        expect(merged.get(id)).toEqual([{ item_name: "jelly", tick_range: OpenRange.from(0, 9), amount: 30, pickup_tick_before_run: -7 }]);

        // the earliest tick is moved to 1, and the pickup before the run with it
        const shifted = InventoryTransferHistory.correctNegativeOffsets(merged).get(id)!;
        expect(shifted[0].tick_range).toEqual(OpenRange.from(1, 10));
        expect(shifted[0].pickup_tick_before_run).toBe(-6);
    });
});

describe("removeDuplicateEntities", () => {
    it("remembers which entities were merged into the one that is kept", () => {
        const window = (): InventoryTransfer[] => [{ item_name: "jelly", tick_range: OpenRange.from(1, 9), amount: 15 }];
        const [first, second, other] = [EntityId.forInserter(6), EntityId.forInserter(7), EntityId.forInserter(3)];
        const deduplicated = InventoryTransferHistory.removeDuplicateEntities(new InventoryTransferHistory(new Map([
            [first, window()],
            [second, window()],
            [other, [{ item_name: "jellynut", tick_range: OpenRange.from(20, 30), amount: 16 }]],
        ])));
        expect(Array.from(deduplicated.keys()).map(entity_id => entity_id.id)).toEqual([first.id, other.id]);
        expect(deduplicated.merged_entities.get(first.id)?.map(entity_id => entity_id.id)).toEqual([second.id]);
    });
});
