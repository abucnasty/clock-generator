import { beforeAll, describe, expect, it } from "vitest";
import { simulateClockOnly, generateClockForConfig, type BlueprintGenerationResult } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import type { StockRecording } from "./machine-stock";
import { quiet } from "./generate-blueprint-test-helpers";
import { EntityId } from "../entities";

// A check of the simulator against a recording starts it from the recording's first sample, hands included (`start_hands`):
// a hand held at that sample is held in the run's first tick, and is dropped or kept as the inserter's rules decide.
describe("a run that starts from a recording's first sample", () => {
    let config: Config;
    let result: BlueprintGenerationResult;
    let waiting: string;
    const run = (start: Parameters<typeof simulateClockOnly>[5]): StockRecording =>
        simulateClockOnly(config, result.clock_windows, result.simulation_duration.ticks, 1, quiet, { warmup_periods: 0, keep_output_buffers: true, ...start });
    const hand = (stock: StockRecording, id: string) => stock.inserters.find(it => it.inserter_id === id)!.held;

    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.LOW_DENSITY_STRUCTURE);
        result = generateClockForConfig(config, { logger: quiet });
        // an inserter that takes plastic bars out of the plastic machine, outside its window for the first ticks
        const candidates = config.inserters.map((inserter, index) => ({ inserter, id: EntityId.forInserter(inserter.id ?? index + 1).id }))
            .filter(({ inserter, id }) => inserter.source.type === "machine" && inserter.source.id === 3 && (result.clock_windows[id]?.[0]?.start ?? 0) > 10);
        expect(candidates.length).toBeGreaterThan(0);
        waiting = candidates[0].id;
    });

    it("holds the hand the recording shows in the first tick of the run", () => {
        const held = hand(run({ start_stock: {}, start_hands: { [waiting]: { item_name: "plastic-bar", quantity: 5 } } }), waiting);
        expect(held.slice(0, 4)).toEqual([5, 5, 5, 5]);
    });

    it("empties every hand without it, as a start from the machines alone does", () => {
        expect(hand(run({ start_stock: {} }), waiting).slice(0, 4)).toEqual([0, 0, 0, 0]);
    });

    it("leaves the inserters it does not name as the machines alone start them", () => {
        const seeded = run({ start_stock: {}, start_hands: { [waiting]: { item_name: "plastic-bar", quantity: 5 } } });
        const alone = run({ start_stock: {} });
        const others = (stock: StockRecording) => stock.inserters.filter(it => it.inserter_id !== waiting).map(it => it.held.slice(0, 20));
        expect(others(seeded)).toEqual(others(alone));
    });
});
