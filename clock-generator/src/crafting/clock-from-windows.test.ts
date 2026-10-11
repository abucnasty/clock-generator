import { beforeAll, describe, expect, it } from "vitest";
import { clockFromWindows, type BlueprintGenerationResult, type SerializableClockWindows } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

/** "26-47 74-95" as windows */
const windows = (text: string) => text.split(" ").map(range => {
    const [start, end] = range.split("-").map(Number);
    return { start, end };
});

// One copy of the advanced circuit build of issue 98: two foundries cast copper cable for two electromagnetic plants
// (inserters 3 and 7), a cryogenic plant makes plastic for both (4 and 6) from coal off a belt (5), electronic
// circuits come off a belt (1 and 8) and the advanced circuits leave on one (2 and 9). 240 a second over 3 copies,
// on a clock of 528 ticks: 11 crafting cycles of 48 with 2 output swings in each.
//
// The windows are those of the clock its reporter tightened by hand from the one version 0.5.0 made. Recorded on the
// scaffold in Factorio 2.1.21 on 2026-10-10: 704 advanced circuits in each of 68 periods under both, at 355 wake-ups
// a minute under this one and 464 under the generated one.
describe("a clock built from windows that are given", () => {
    const PERIOD = 528;
    const electronic_circuits = windows("1-6 33-54 76-85 129-150 172-182 268-289 316-337 364-385 417-437 460-470");
    const copper_cable = windows("26-47 74-95 122-143 170-191 218-239 266-287 314-335 362-383 410-431 458-479 506-519");
    const plastic = windows("29-42 77-90 125-133 173-178 269-282 317-330 365-378 413-426 461-466");
    // two short windows in every crafting cycle, so that the output inserter only ever takes what has piled up
    const advanced_circuits = Array.from({ length: 11 }, (_, cycle) => [
        { start: cycle * 48, end: cycle * 48 + 11 },
        { start: cycle * 48 + 23, end: cycle * 48 + 26 },
    ]).flat();
    const tightened: SerializableClockWindows = {
        "inserter:1": electronic_circuits, "inserter:8": electronic_circuits,
        "inserter:3": copper_cable, "inserter:7": copper_cable,
        "inserter:4": plastic, "inserter:6": plastic,
        // one hand a window: an inserter finishes the swing it has started after it is switched off
        "inserter:5": windows("79-84 175-180 327-332 423-428"),
        "inserter:2": advanced_circuits, "inserter:9": advanced_circuits,
    };

    let config: Config;
    let result: BlueprintGenerationResult;

    beforeAll(async () => {
        const sample = await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT);
        config = { ...sample, overrides: { ...sample.overrides, terminal_swing_count: 2 } };
        result = clockFromWindows(config, tightened, PERIOD, quiet);
    });

    it("builds the windows as they are", () => {
        expect(result.simulation_duration.ticks).toBe(PERIOD);
        expect(result.clock_windows).toEqual(tightened);
        expect(result.belt_pickup_slack_ticks).toEqual({});
    });

    it("checks the clock as the generator checks its own: it holds 240 a second from every start", () => {
        const as_built = result.stability_check.as_built!;
        expect(as_built.is_stable).toBe(true);
        expect(as_built.actual_output_items).toBe(704);
        expect(result.stability_check.expected_output_items).toBe(704);
        expect(as_built.start_phases_checked).toBeGreaterThan(1);
    });

    // The clock settles into one of two states by where it starts: 354.5 wake-ups a minute from 7 of 12 starts and
    // 395.5 from the other 5, the generator's own among them. The game shows 354.6: it was in the first, and a run of
    // the simulator from the state the game was recorded in holds what the game held for all 36,400 ticks. On the
    // clock version 0.5.0 made the simulator counts 757 where the game shows 464, mostly on the output inserters.
    it("counts the wake-ups of the clock", () => {
        expect(result.stability_check.as_built!.wake_ups!.wake_ups_per_minute).toBeCloseTo(395.5, 1);
    });

    it("refuses windows of another period than the config is planned on", () => {
        expect(() => clockFromWindows(config, tightened, 792, quiet)).toThrow(/of a clock of 792 ticks, and the config is planned on one of 528/);
    });
});
