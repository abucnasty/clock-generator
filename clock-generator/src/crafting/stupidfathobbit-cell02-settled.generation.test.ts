import {describe, expect, it} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import {quiet} from "./generate-blueprint-test-helpers";
import {recordSimulationTimeline} from "./record-timeline";

describe("the real stupidfathobbit cell 02", () => {
    // the replay from the warm-up inventory is the build stalled for its first 42 ticks (every machine full, nothing moves); the
    // long run judges stock from index 960, after 240 warm-up ticks; replaying clock tick 1200 shows the inserters at work
    it("records a settled period from the tick the long run judges, not the stalled first one", async () => {
        const config = await loadConfigFromFile(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL02);
        const generated = generateClockAlternatives(config, {logger: quiet});
        const selected = generated.alternatives[generated.selected_index];
        const first_judged_tick = selected.result.stability_check.as_built?.first_judged_tick;
        expect(first_judged_tick).toBe(960);
        const judged_clock_tick = selected.result.stability_check.as_built?.clock_tick_at_first_judged;
        expect(judged_clock_tick).toBe(1200);
        const request = {config, mode: "clock" as const, period_ticks: selected.result.simulation_duration.ticks,
            terminal_swing_count: selected.result.used_terminal_swing_count, windows: selected.result.clock_windows,
            inserter_clocks: selected.result.unplanned_inserter_clocks ?? {}};
        const swings = (recording: ReturnType<typeof recordSimulationTimeline>) => recording.events
            .filter(event => event.entity_id === "inserter:13" && event.kind === "pickup").length;
        const cold = recordSimulationTimeline(request);
        const settled = recordSimulationTimeline({...request, settle_ticks: judged_clock_tick});
        expect(cold.ticks_before_recording).toBe(240);
        expect(settled.ticks_before_recording).toBe(1200);
        expect(settled.end_tick).toBe(24);
        expect(swings(cold)).toBe(0);
        expect(swings(settled)).toBeGreaterThan(0);
    }, 300_000);
});
