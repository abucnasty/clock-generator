import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config";
import * as supply from "../config/outside-supply";
import { generateClockAlternatives, planClockAlternatives, runClockAlternativeTask, runCoordinatedSourcesTask } from "./alternatives";
import { buildFeeders, verdictWithCopies, withBuildFeeders } from "./copies-verdict";
import { quiet } from "./generate-blueprint-test-helpers";
import type { LaneFeeders } from "./shared-lane-model";

/** What the clock search's steps below saw of the build's feeders */
const seen = vi.hoisted(() => ({ stripped: [] as unknown[], judged: [] as unknown[], tried: [] as unknown[], stop: false }));
const STOPPED = "the search stopped where it left out the outside supply";

// the strip of the outside supply, where every entry of the clock search starts: what the feeders are there, then a stop
vi.mock("../config/outside-supply", async importOriginal => {
    const actual = await importOriginal<typeof import("../config/outside-supply")>();
    const { buildFeeders: feeders } = await import("./copies-verdict");
    return {
        ...actual,
        withoutOutsideSupply: <C extends Config>(config: C): C => {
            if (seen.stop) {
                seen.stripped.push(feeders());
                throw new Error(STOPPED);
            }
            return actual.withoutOutsideSupply(config);
        },
    };
});
// the checks with the copies, as the generation's verdict makes them: what feeders they are given, and nothing run
vi.mock("./shared-lane-verdict", async importOriginal => {
    const actual = await importOriginal<typeof import("./shared-lane-verdict")>();
    return {
        ...actual,
        judgeSharedLanes: (...args: Parameters<typeof actual.judgeSharedLanes>) => {
            seen.judged.push(args[4]?.feeders);
            return { losses: [], fast_check_passes: true, simulated: false, longer_run: false, lanes: ["1/1", "1/2"] };
        },
    };
});
vi.mock("./shared-lane-trial", async importOriginal => {
    const actual = await importOriginal<typeof import("./shared-lane-trial")>();
    return {
        ...actual,
        copiesDisturbanceTrial: (...args: Parameters<typeof actual.copiesDisturbanceTrial>) => {
            seen.tried.push(args[5]);
            return null;
        },
    };
});

const lanesOf = (feeders: unknown) => [...(feeders as LaneFeeders | undefined)?.keys() ?? []].sort();

describe("the clock search of a build that states its feeders (#737)", () => {
    let sample: Config;
    beforeAll(async () => {
        sample = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
    });
    beforeEach(() => {
        seen.stripped.length = seen.judged.length = seen.tried.length = 0;
        seen.stop = false;
    });

    it("keeps the given build's feeders from every entry on, where it clocks the build without its outside supply", () => {
        seen.stop = true;
        const none = {} as never;
        expect(() => generateClockAlternatives(sample, { logger: quiet })).toThrow(STOPPED);
        expect(() => planClockAlternatives(sample, { logger: quiet })).toThrow(STOPPED);
        expect(() => runClockAlternativeTask(sample, none, "task", { logger: quiet })).toThrow(STOPPED);
        expect(() => runCoordinatedSourcesTask(sample, none, { logger: quiet })).toThrow(STOPPED);
        expect(seen.stripped.map(lanesOf)).toEqual([["1/1", "1/2"], ["1/1", "1/2"], ["1/1", "1/2"], ["1/1", "1/2"]]);
        expect(buildFeeders()).toBeUndefined();
    });

    it("judges a clock with the copies, and tries it on them, on lanes the feeders put the items on", () => {
        const clocked = supply.withoutOutsideSupply(sample);
        const clock = { config: clocked, windows: { "inserter:1": [{ start: 1, end: 24 }], "inserter:2": [{ start: 0, end: 3 }] }, window_cycle_ticks: 72, expected_output_items: 64 };
        withBuildFeeders(sample, () => verdictWithCopies(clock, () => true, true, "fed", quiet));
        expect(seen.judged.map(lanesOf)).toEqual([["1/1", "1/2"]]);
        expect(seen.tried.map(lanesOf)).toEqual([["1/1", "1/2"]]);
        // outside a generation of the build, the same clock is judged on the flow at the lanes' capacity
        verdictWithCopies(clock, () => true, true, "bare", quiet);
        expect(seen.judged.slice(1)).toEqual([undefined]);
    });
});
