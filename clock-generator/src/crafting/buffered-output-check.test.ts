import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { FeasibilityError } from "../config/errors";
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

    // machine 4's packs end in chest 4 (inserter 8 puts them into chest 5, inserter 7 moves them on into chest 4), which
    // nothing empties once it is a buffer of 5. At 120 a second over 5 copies, 24 a copy, machine 1 alone crafts enough
    // (8.73 crafts a second of its 8.96), so the build is not refused, and the long-run check finds chest 4 full
    const finite = (): Config => ({ ...config, chests: config.chests!.map(chest => chest.id === 4 ? {
        type: "buffer-chest", id: 4, storage_size: 5, item_filter: "electromagnetic-science-pack",
    } : chest) });

    it("rejects a final sink that fills after the first period, while the upstream buffers still accept packs", () => {
        const half: Config = { ...finite(), target_output: { ...config.target_output, items_per_second: 120 } };
        const { check } = runAsBuiltCheck(half, windows(), period, quiet, 1);
        expect(check.first_check_failed).toBeUndefined();
        expect(check.holds).toBe(false);
        // the same windows deliver 32 a period where chest 4 is the sample's: the full chest cuts that
        expect(check.actual_output_items).toBeLessThan(baseline.check.actual_output_items);
        expect(check.full_output_chests).toEqual(expect.arrayContaining([expect.objectContaining({ chest_id: 4 })]));
    });

    // at the sample's 240 a second, 48 a copy, the target needs machine 4: the feasibility pass refuses it before any
    // simulation, as machine 1 alone crafts 8.96 of the 17.45 a second
    it("refuses the same final sink before any simulation where the target needs the machine that fills it", () => {
        expect(() => runAsBuiltCheck(finite(), windows(), period, quiet, 1)).toThrow(FeasibilityError);
        expect(() => runAsBuiltCheck(finite(), windows(), period, quiet, 1)).toThrow("Inserter 8 puts electromagnetic science pack from "
            + "machine 4 into chest 5, inserter 7 moves it on into chest 4, and nothing takes it out of there: once chest 4 is full, the "
            + "machine stops for good.");
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
