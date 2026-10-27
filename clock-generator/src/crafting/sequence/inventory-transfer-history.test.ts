import { beforeAll, describe, expect, it } from "vitest";
import { fraction } from "../../data-types/fraction";
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

describe("mergeOverlappingRanges groups the transfers of each item into windows", () => {
    // the grouping this replaced: every merged window filters all the transfers of its item for the ones that overlap it
    const filteringMerge = (original: ReadonlyMap<EntityId, InventoryTransfer[]>, overlap_threshold = 1) => {
        const result = new Map<EntityId, InventoryTransfer[]>();
        original.forEach((ranges, entity_id) => {
            const by_item = new Map<string, InventoryTransfer[]>();
            ranges.forEach(it => by_item.set(it.item_name, (by_item.get(it.item_name) ?? []).concat(it)));
            by_item.forEach((item_ranges, item_name) => {
                const windows = OpenRange.reduceRanges(item_ranges.map(it => it.tick_range), overlap_threshold).map(window => {
                    const merged = item_ranges.filter(it => window.overlaps(it.tick_range));
                    const before_run = merged.map(it => it.pickup_tick_before_run).filter(tick => tick !== undefined);
                    return {
                        item_name,
                        tick_range: window,
                        amount: merged.reduce((sum, it) => sum + it.amount, 0),
                        pickup_tick_before_run: before_run.length > 0 ? Math.min(...before_run) : undefined,
                    };
                });
                result.set(entity_id, (result.get(entity_id) ?? []).concat(windows));
            });
        });
        return result;
    };

    const first = EntityId.forInserter(1);
    const second = EntityId.forInserter(2);
    const transfer = (item_name: string, start: number, end: number, amount: number, pickup_tick_before_run?: number): InventoryTransfer =>
        ({ item_name, tick_range: OpenRange.from(start, end), amount, ...(pickup_tick_before_run === undefined ? {} : { pickup_tick_before_run }) });
    const merge = (transfers: InventoryTransfer[], overlap_threshold?: number) =>
        InventoryTransferHistory.mergeOverlappingRanges(new InventoryTransferHistory(new Map([[first, transfers]])), overlap_threshold).get(first);
    const windows = (transfers: InventoryTransfer[] | undefined) => transfers?.map(it => [it.item_name, it.tick_range.start_inclusive, it.tick_range.end_inclusive, it.amount]);

    it("leaves an empty history, an entity with no transfers and a single transfer as they are", () => {
        expect(InventoryTransferHistory.mergeOverlappingRanges(new InventoryTransferHistory()).size).toBe(0);
        expect(merge([])).toBeUndefined();
        expect(windows(merge([transfer("iron-plate", 5, 9, 16)]))).toEqual([["iron-plate", 5, 9, 16]]);
    });

    it("joins transfers that overlap, in any order, and adds their amounts", () => {
        const transfers = [transfer("iron-plate", 10, 20, 3), transfer("iron-plate", 0, 12, 5), transfer("iron-plate", 18, 30, 7)];
        expect(windows(merge(transfers))).toEqual([["iron-plate", 0, 30, 15]]);
        expect(windows(merge(transfers.slice().reverse()))).toEqual([["iron-plate", 0, 30, 15]]);
    });

    it("joins transfers that touch (the next tick) unless the threshold says apart, and keeps ones with a gap", () => {
        const transfers = [transfer("iron-plate", 0, 5, 1), transfer("iron-plate", 6, 10, 2), transfer("iron-plate", 12, 15, 4)];
        expect(windows(merge(transfers))).toEqual([["iron-plate", 0, 10, 3], ["iron-plate", 12, 15, 4]]);
        expect(windows(merge(transfers, 0))).toEqual([["iron-plate", 0, 5, 1], ["iron-plate", 6, 10, 2], ["iron-plate", 12, 15, 4]]);
        expect(windows(merge(transfers, 2))).toEqual([["iron-plate", 0, 15, 7]]);
    });

    it("joins a transfer that lies inside another and one that shares its first tick", () => {
        const transfers = [transfer("iron-plate", 0, 40, 10), transfer("iron-plate", 5, 8, 1), transfer("iron-plate", 0, 3, 2), transfer("iron-plate", 40, 40, 4), transfer("iron-plate", 60, 60, 8)];
        expect(windows(merge(transfers))).toEqual([["iron-plate", 0, 40, 17], ["iron-plate", 60, 60, 8]]);
    });

    it("keeps the items of one entity apart, whose windows overlap each other, and the entities apart", () => {
        const history = new InventoryTransferHistory(new Map([
            [first, [transfer("iron-plate", 0, 10, 1), transfer("copper-plate", 5, 15, 2), transfer("iron-plate", 8, 20, 4), transfer("copper-plate", 40, 50, 8)]],
            [second, [transfer("iron-plate", 0, 10, 16)]],
        ]));
        const merged = InventoryTransferHistory.mergeOverlappingRanges(history);
        expect(windows(merged.get(first))).toEqual([["iron-plate", 0, 20, 5], ["copper-plate", 5, 15, 2], ["copper-plate", 40, 50, 8]]);
        expect(windows(merged.get(second))).toEqual([["iron-plate", 0, 10, 16]]);
    });

    it("takes the earliest pickup before the run of the transfers in a window, and none for a window without one", () => {
        const merged = merge([
            transfer("jelly", 1, 5, 15, -3), transfer("jelly", 4, 9, 15, -8), transfer("jelly", 9, 12, 15),
            transfer("jelly", 30, 40, 16),
            transfer("jelly", 50, 60, 16, -1),
        ])!;
        expect(merged.map(it => [it.amount, it.pickup_tick_before_run])).toEqual([[45, -8], [16, undefined], [16, -1]]);
    });

    it("gives the same windows, amounts and pickups as the grouping it replaced, on histories of many transfers", () => {
        let state = 12345;
        const random = (below: number) => {
            state = (state * 1103515245 + 12345) % 2147483648;
            return state % below;
        };
        const items = ["iron-plate", "copper-plate", "plastic-bar"];
        for (const threshold of [0, 1, 3]) {
            for (let round = 0; round < 20; round++) {
                const original = new Map<EntityId, InventoryTransfer[]>();
                for (const entity of [first, second]) {
                    original.set(entity, Array.from({ length: 1 + random(400) }, () => {
                        const start = random(2000);
                        return transfer(items[random(items.length)], start, start + random(30), random(5) * 8, random(4) === 0 ? -random(50) : undefined);
                    }));
                }
                const expected = filteringMerge(original, threshold);
                const merged = InventoryTransferHistory.mergeOverlappingRanges(new InventoryTransferHistory(original), threshold);
                expect(Array.from(merged.keys())).toEqual(Array.from(expected.keys()));
                for (const [entity_id, expected_windows] of expected) {
                    expect(merged.get(entity_id)).toEqual(expected_windows);
                }
            }
        }
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
