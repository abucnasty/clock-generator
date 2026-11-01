import {describe, expect, it} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import {quiet} from "./generate-blueprint-test-helpers";
import {recordSimulationTimeline} from "./record-timeline";

describe("the real stupidfathobbit cell 02", () => {
    // Cost selects shared windows now. Its early replay already makes 3 pickups on inserter 13, unlike the previous
    // clock's stalled first replay; the settled replay must still start where the long run actually judges the clock.
    it("records a settled period from the tick the long run judges on the cheaper shared clock", async () => {
        const config = await loadConfigFromFile(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL02);
        const generated = generateClockAlternatives(config, {logger: quiet});
        const selected = generated.alternatives[generated.selected_index];
        const previous = generated.alternatives.find(alternative => alternative.id === "planned-belt-slack")!;
        expect(previous.verdict).toBe("stable");
        expect(selected.id).toBe("planned-belt-slack-shared");
        expect(selected.ranking.cost!.ns_per_tick).toBeLessThan(previous.ranking.cost!.ns_per_tick);
        const first_judged_tick = selected.result.stability_check.as_built?.first_judged_tick;
        expect(first_judged_tick).toBe(960);
        const request = {config, mode: "clock" as const, period_ticks: selected.result.simulation_duration.ticks,
            terminal_swing_count: selected.result.used_terminal_swing_count, windows: selected.result.clock_windows,
            inserter_clocks: selected.result.unplanned_inserter_clocks ?? {}};
        const swings = (recording: ReturnType<typeof recordSimulationTimeline>) => recording.events
            .filter(event => event.entity_id === "inserter:13" && event.kind === "pickup").length;
        const cold = recordSimulationTimeline(request);
        const settled = recordSimulationTimeline({...request, settle_periods: first_judged_tick! / request.period_ticks});
        expect(cold.ticks_before_recording).toBe(240);
        expect(settled.ticks_before_recording).toBe(960);
        expect(settled.end_tick).toBe(24);
        expect(swings(cold)).toBe(3);
        expect(swings(settled)).toBeGreaterThan(0);
    }, 300_000);
});
