import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import { OpenRange } from "../../data-types";
import { sharedLaneShortened } from "./shared-lane-guard";

const windows = (entries: Record<string, [number, number][]>) =>
    new Map(Object.entries(entries).map(([id, ranges]) => [id, ranges.map(([start, end]) => OpenRange.from(start, end))]));
const copiesOf = (config: Config, copies: number): Config => ({ ...config, setpoint: { ...config.setpoint, copies } });

describe("windows by arithmetic on a belt the copies share", () => {
    // INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK: three copies take 3 x 53.33 = 160 ore a second from each ore belt (inserters
    // 1 and 2 from belt 1, 3 and 4 from belt 4), of 240; the circuits, 3 x 80 = 240 of 240 from belt 2 (inserter 8)
    const planned = windows({ "inserter:1": [[1, 16]], "inserter:2": [[1, 16]], "inserter:8": [[1, 47]] });
    const made = windows({ "inserter:1": [[23, 24], [47, 48]], "inserter:2": [[23, 24], [47, 48]], "inserter:8": [[0, 11]] });

    it("keeps the planning run's windows where the copies take from a belt with room to spare and the arithmetic shortens its takers", async () => {
        const config = await loadConfigFromFile(ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK);
        expect(sharedLaneShortened(config, made, planned)).toBe(
            "the 3 copies take 160.00 a second from belt 1, of 240.00, and inserter:1, inserter:2 would be open for less than the unclocked run has them");
    });

    it("leaves a belt the copies take every item of, and a build of one copy", async () => {
        const config = await loadConfigFromFile(ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK);
        const circuits_only = windows({ "inserter:1": [[1, 16]], "inserter:2": [[1, 16]], "inserter:8": [[0, 11]] });
        expect(sharedLaneShortened(config, circuits_only, planned)).toBeNull();
        expect(sharedLaneShortened(copiesOf(config, 1), made, planned)).toBeNull();
    });

    it("leaves a belt whose lanes end in a dead end to the shared-lane model, and keeps one whose end is unknown", async () => {
        const config = await loadConfigFromFile(ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK);
        const ended = (kind: "dead_end" | "unknown"): Config => ({ ...config, belts: config.belts.map(belt => belt.id !== 1 ? belt
            : { ...belt, lanes: belt.lanes.map(lane => ({ ...lane, lane_end: { kind } })) as typeof belt.lanes }) });
        expect(sharedLaneShortened(ended("dead_end"), made, planned)).toBeNull();
        expect(sharedLaneShortened(ended("unknown"), made, planned)).toBe(
            "the 3 copies take 160.00 a second from belt 1, of 240.00, and inserter:1, inserter:2 would be open for less than the unclocked run has them");
    });

    it("leaves takers the arithmetic opens for as long as the planning run", async () => {
        const config = await loadConfigFromFile(ConfigPaths.INSERTER_CRAFTING_240_SHARED_SIGNAL_CLOCK);
        const as_long = windows({ "inserter:1": [[23, 30], [47, 54]], "inserter:2": [[23, 30], [47, 54]] });
        expect(sharedLaneShortened(config, as_long, planned)).toBeNull();
    });

    // LOGISTIC_SCIENCE_240: 11 copies take 120 inserters and 120 transport belts a second from the two lanes of belt 2, all
    // they carry; the arithmetic opens inserter 1 for 13 ticks where the planning run has 20. At 200 a second they leave room
    it("leaves a build whose copies take everything their shared belt carries, not one whose copies leave room", async () => {
        const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240);
        expect(sharedLaneShortened(config, windows({ "inserter:1": [[1, 13]] }), windows({ "inserter:1": [[26, 45]] }))).toBeNull();
        const slower = { ...config, setpoint: { ...config.setpoint, items_per_second: 200 } };
        expect(sharedLaneShortened(slower, windows({ "inserter:1": [[1, 13]] }), windows({ "inserter:1": [[26, 45]] })))
            .toBe("the 11 copies take 200.00 a second from belt 2, of 240.00, and inserter:1 would be open for less than the unclocked run has them");
    });
});
