import { expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { OpenRange } from "../data-types";
import { quiet } from "./generate-blueprint-test-helpers";
import * as trial from "./trial";

// Metallurgic science 45, the time-study clock at 3 output swings (1280/3 ticks, its counter 1,280 ticks, 960 items).
// A start shift's check observes one counter after a warm-up of 10 window cycles and holds it to 960 (`firstClockSpan`).
// Started 35 ticks into its window cycle, the build is still settling there: window cycles 10, 11 and 12 are each one
// hand (16) short, and from window cycle 13 on every counter moves 960. So the check fails the clock on its start-up,
// 912 of 960, where the run settles to its output. In the game it holds from that start (Factorio 2.1.24, clock primed to
// counter 105 and 1175: every counter cycle after the first third moved 960); there it settled sooner, by the second
// counter cycle at the latest.
const WINDOWS: Record<string, string> = {
    "inserter:1": "27-46.66666666666667,51-70.66666666666667,75-94.66666666666667,105-124.66666666666667,129-148.66666666666666,198-217.66666666666666,222-241.66666666666666,246-265.6666666666667,275-294.6666666666667,299-318.6666666666667,323-342.6666666666667,381-400.6666666666667",
    "inserter:2": "19-78.66666666666666,97-140.66666666666666,190-249.66666666666666,267-321.6666666666667,361-396.6666666666667",
    "inserter:3": "2-36.666666666666664,88-104.66666666666667,173-205.66666666666666,258-282.6666666666667,344-368.6666666666667",
    "inserter:4": "27-49.66666666666667,51-73.66666666666667,75-97.66666666666667,105-127.66666666666667,129-151.66666666666666,198-220.66666666666666,222-244.66666666666666,246-268.6666666666667,275-297.6666666666667,299-321.6666666666667,323-403.6666666666667",
    "inserter:5": "27-49.66666666666667,51-73.66666666666667,75-97.66666666666667,105-127.66666666666667,129-151.66666666666666,198-220.66666666666666,222-244.66666666666666,246-268.6666666666667,275-297.6666666666667,299-321.6666666666667,323-403.6666666666667",
    "inserter:6": "32-54.66666666666667,77-99.66666666666667,110-132.66666666666666,200-222.66666666666666,227-249.66666666666666,277-299.6666666666667,304-326.6666666666667,383-405.6666666666667",
    "inserter:7": "0-172.66666666666669,199-346.6666666666667,362-406.6666666666667,426-426.33333333333337",
    "inserter:8": "19-145.66666666666666,190-305.6666666666667,312-331.6666666666667,361-388.6666666666667",
};

it("a start shift's counter is observed while the build is still settling, not where it settles", async () => {
    const config = await loadConfigFromFile(ConfigPaths.METALLURGIC_SCIENCE_45);
    const windows = new Map(Object.entries(WINDOWS).map(([id, ranges]) => [id, ranges.split(",").map(range => {
        const [start, end] = range.split("-").map(Number);
        return OpenRange.from(start, end);
    })] as const));
    const counter = (main_clock_shift: number, warmup_window_cycles: number) => trial.runClockOnBuild(config, windows, 1280 / 3, quiet, {
        main_clock_shift, warmup_window_cycles, simulate_window_cycles: 3, observation_ticks: 1280, counter_runs_through: true, factorio_states: false,
    }).stability_check.actual_output_items;
    expect([10, 13, 40].map(warmup => counter(0, warmup))).toEqual([960, 960, 960]);
    expect([10, 11, 12, 13, 16, 40].map(warmup => counter(35, warmup))).toEqual([912, 928, 944, 960, 960, 960]);
}, 120_000);
