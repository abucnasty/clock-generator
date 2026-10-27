import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { OpenRange } from "../data-types";
import { quiet } from "./generate-blueprint-test-helpers";
import { judgeLongRun } from "./long-run";
import { runAsBuiltCheck } from "./trial";

const period = 40;
const windows = () => new Map([
    ["inserter:4", [OpenRange.from(2, 5)]],
    ["inserter:7", [OpenRange.from(2, 5)]],
]);

describe("long-run output through finite buffers", () => {
    let config: Config;
    let baseline: ReturnType<typeof runAsBuiltCheck>;

    beforeAll(async () => {
        const sample = await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_RECYCLER);
        // A straight mixed-input belt makes the upstream transfers uneven. The two final buffer takers still
        // deliver one hand apiece per clock; the engine must judge those takers, as its planner does.
        config = {
            ...sample,
            belts: [...sample.belts, { id: 4, type: "turbo-transport-belt", lanes: [
                { ingredient: "holmium-plate", stack_size: 4 },
                { ingredient: "superconductor", stack_size: 4 },
            ] }],
            chests: sample.chests!.filter(chest => chest.id !== 6),
            inserters: sample.inserters.map(inserter => inserter.id === 10 ? {
                ...inserter,
                source: { type: "belt", id: 4, pickup_layout: "side-straight", pickup_length: 1, near_lane: 1 },
            } : inserter),
        };
        baseline = runAsBuiltCheck(config, windows(), period, quiet, 1);
    });

    it("accepts regular final deliveries despite bursty transfers into the buffers", () => {
        const stock = baseline.stock!;
        const judged = (ids: string[]) => judgeLongRun(stock.inserters.filter(inserter => ids.includes(inserter.inserter_id))
            .map(inserter => inserter.held), stock.ticks, period, null, 32, 16);
        expect(judged(["inserter:5", "inserter:8"]).keeps_up).toBe(false);
        expect(judged(["inserter:4", "inserter:7"]).keeps_up).toBe(true);
        expect(baseline.check.holds).toBe(true);
        expect(baseline.check.actual_output_items).toBe(32);
    });

    it("rejects a final sink that fills after the first period, while the upstream buffers still accept packs", () => {
        const finite: Config = { ...config, chests: config.chests!.map(chest => chest.id === 4 ? {
            type: "buffer-chest", id: 4, storage_size: 5, item_filter: "electromagnetic-science-pack",
        } : chest) };
        const { check } = runAsBuiltCheck(finite, windows(), period, quiet, 1);
        expect(check.first_check_failed).toBeUndefined();
        expect(check.holds).toBe(false);
        expect(check.actual_output_items).toBeLessThan(32);
        expect(check.full_output_chests).toEqual(expect.arrayContaining([expect.objectContaining({ chest_id: 4 })]));
    });

    it("counts each final taker once when both output machines share its buffer", () => {
        const shared: Config = { ...config,
            chests: config.chests!.filter(chest => chest.id !== 5),
            inserters: config.inserters.map(inserter => ({ ...inserter,
                source: inserter.source.type === "chest" && inserter.source.id === 5 ? { type: "chest", id: 3 } : inserter.source,
                sink: inserter.sink.type === "chest" && inserter.sink.id === 5 ? { type: "chest", id: 3 } : inserter.sink,
            })),
        };
        const { check } = runAsBuiltCheck(shared, windows(), period, quiet, 1);
        expect(check.holds).toBe(true);
        expect(check.actual_output_items).toBe(32);
    });
});
