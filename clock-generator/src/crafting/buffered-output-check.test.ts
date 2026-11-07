import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { FeasibilityError } from "../config/errors";
import { OpenRange } from "../data-types";
import { quiet } from "./generate-blueprint-test-helpers";
import { judgeLongRun } from "./long-run";
import { runAsBuiltCheck } from "./trial";

const window_cycle_ticks = 40;
const windows = () => new Map([
    ["inserter:2", [OpenRange.from(2, 5)]],
    ["inserter:1", [OpenRange.from(2, 5)]],
]);

describe("long-run output through finite buffers", () => {
    let config: Config;
    let baseline: ReturnType<typeof runAsBuiltCheck>;

    beforeAll(async () => {
        const sample = await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED);
        // A straight mixed-input belt makes the upstream transfers uneven. The two final buffer takers still
        // deliver one hand apiece per clock; the engine must judge those takers, as its planner does. (The sample's
        // pickup of the holmium and superconductor belt is on a bend: here it is straight.)
        config = {
            ...sample,
            overrides: { ...sample.overrides, terminal_swing_count: 1, lcm: 1 },
            inserters: sample.inserters.map(inserter => inserter.id === 11 ? {
                ...inserter,
                source: { type: "belt", id: 4, pickup_layout: "side-straight", pickup_length: 1, near_lane: 1 },
            } : inserter),
        };
        baseline = runAsBuiltCheck(config, windows(), window_cycle_ticks, quiet, 1);
    });

    it("accepts regular final deliveries despite bursty transfers into the buffers", () => {
        // inserter 4 moves the packs into its buffer on a clock of its own, one window of 8 ticks in 40, so they arrive in
        // bursts; inserter 3, the other transfer, is left free. The final takers, 2 and 1, deliver regularly. (Judged as the
        // takers are, the two transfers into the buffers kept up here too; on the cut-out cell this test came from they did
        // not, and that contrast is no longer asserted.)
        const bursty = runAsBuiltCheck(config, new Map([...windows(), ["inserter:4", [OpenRange.from(4, 12)]]]), window_cycle_ticks, quiet, 1);
        const stock = bursty.stock!;
        const judged = (ids: string[]) => judgeLongRun(stock.inserters.filter(inserter => ids.includes(inserter.inserter_id))
            .map(inserter => inserter.held), stock.ticks, window_cycle_ticks, null, 32, 16);
        expect(judged(["inserter:2", "inserter:1"]).keeps_up).toBe(true);
        expect(bursty.check.holds).toBe(true);
        expect(bursty.check.actual_output_items).toBe(32);
    });

    // machine 2's packs end in chest 1 (inserter 3 puts them into chest 3, inserter 1 moves them on into chest 1), which
    // nothing empties once it is a buffer of 5. At 120 a second over 5 copies, 24 a copy, machine 1 alone crafts enough
    // (8.73 crafts a second of its 8.96), so the build is not refused, and the long-run check finds chest 1 full
    const finite = (): Config => ({ ...config, chests: config.chests!.map(chest => chest.id === 1 ? {
        type: "buffer-chest", id: 1, storage_size: 5, item_filter: "electromagnetic-science-pack",
    } : chest) });

    it("rejects a final sink that fills after the first period, while the upstream buffers still accept packs", () => {
        const half: Config = { ...finite(), setpoint: { ...config.setpoint, items_per_second: 120 } };
        const { check } = runAsBuiltCheck(half, windows(), window_cycle_ticks, quiet, 1);
        expect(check.first_check_failed).toBeUndefined();
        expect(check.holds).toBe(false);
        // the same windows deliver 32 a period where chest 1 is the sample's: the full chest cuts that
        expect(check.actual_output_items).toBeLessThan(baseline.check.actual_output_items);
        expect(check.full_output_chests).toEqual(expect.arrayContaining([expect.objectContaining({ chest_id: 1 })]));
    });

    // at the sample's 240 a second, 48 a copy, the target needs machine 2: the feasibility pass refuses it before any
    // simulation, as machine 1 alone crafts 8.96 of the 17.45 a second
    it("refuses the same final sink before any simulation where the target needs the machine that fills it", () => {
        expect(() => runAsBuiltCheck(finite(), windows(), window_cycle_ticks, quiet, 1)).toThrow(FeasibilityError);
        expect(() => runAsBuiltCheck(finite(), windows(), window_cycle_ticks, quiet, 1)).toThrow("Inserter 3 puts electromagnetic science pack from "
            + "machine 2 into chest 3, inserter 1 moves it on into chest 1, and nothing takes it out of there: once chest 1 is full, the "
            + "machine stops for good.");
    });

    it("counts each final taker once when both output machines share its buffer", () => {
        const shared: Config = { ...config,
            chests: config.chests!.filter(chest => chest.id !== 3),
            inserters: config.inserters.map(inserter => ({ ...inserter,
                source: inserter.source.type === "chest" && inserter.source.id === 3 ? { type: "chest", id: 4 } : inserter.source,
                sink: inserter.sink.type === "chest" && inserter.sink.id === 3 ? { type: "chest", id: 4 } : inserter.sink,
            })),
        };
        const { check } = runAsBuiltCheck(shared, windows(), window_cycle_ticks, quiet, 1);
        expect(check.holds).toBe(true);
        expect(check.actual_output_items).toBe(32);
    });
});
