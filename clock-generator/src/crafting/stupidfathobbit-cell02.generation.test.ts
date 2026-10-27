import {createHash} from "crypto";
import {describe, expect, it} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {clockIdentity} from "./clock-identity";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import {alwaysOnReasonProblemsOf, quiet} from "./generate-blueprint-test-helpers";
import {recordSimulationTimeline} from "./record-timeline";
import {readControls} from "../../tests/game/builds/clock-controls";
import {GENERATED_ALTERNATIVE, STUPIDFATHOBBIT_CELL02_CASES} from "../../tests/game/builds/stupidfathobbit-cell02-clock-fixtures";

// A real cell (#189) on its scaffold, at 80 processing units a second. Before windows were left out for the inserters whose hands
// take the whole cycle, no clock the generator made held the target (the best, 3 output swings, made 65.19 a second). The hands in
// groups (src/crafting/candidates/grouped-hands.ts) give a clock of one cycle, 24 ticks, that holds and recovers. The selection is
// pinned as it is, so a change to what the generator makes of it shows
describe("the real stupidfathobbit cell 02", () => {
    it.each(STUPIDFATHOBBIT_CELL02_CASES)("selects a stable clock of one cycle at 80 a second, $name", async ({name, backed}) => {
        const loaded = await loadConfigFromFile(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL02);
        const config = backed ? {...loaded, overrides: {...loaded.overrides, backed_up_belts: true}} : loaded;
        const generated = generateClockAlternatives(config, {logger: quiet});
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe(GENERATED_ALTERNATIVE);
        expect(selected.verdict).toBe("stable");
        expect(selected.assessment.holds).toBe(true);
        expect(selected.assessment.items_per_second).toBeCloseTo(80, 6);
        expect(selected.assessment.backpressure_loss?.survives).toBe(true);
        expect(selected.result.simulation_duration.ticks).toBe(24);
        expect(selected.result.stability_check.as_built).toMatchObject({holds: true, actual_output_items: 32});
        expect(selected.belt).toEqual(backed ? {kind: "backed_up"} : {kind: "moving", slack_ticks: [4]});
        expect(generated.why_not_stable).toBeNull();
        expect(alwaysOnReasonProblemsOf(config, generated)).toEqual([]);
        // the 12 inserters with no window are the ones whose hands take all 24 ticks of the period
        expect(selected.result.always_on_reasons).toEqual(Object.fromEntries([3, 4, 5, 6, 7, 8, 13, 14, 15, 18, 19, 20]
            .map(number => [`inserter:${number}`, {kind: "busy", period_ticks: 24}])));
        const exported = selected.result.subtick ?? selected.result;
        const pin = readControls("stupidfathobbit-cell02-clock-controls.json").cases[name].generation!;
        expect(createHash("sha256").update(JSON.stringify(clockIdentity(exported))).digest("hex"),
            "same windows and exported clock as the native control (its identity: no text or metadata)").toBe(pin.clock_sha256);
        expect({id: selected.id, holds: selected.assessment.holds, rate: selected.assessment.items_per_second, supply: selected.belt?.kind ?? null}).toEqual(pin.selection);
        expect(selected.result.simulation_duration.ticks).toBe(pin.period);
    // about 30 s on a desktop and up to 3.7 times that on a CI runner; the limit is a guard against a slower generation
    }, 300_000);

    // the replay from the warm-up inventory is the build stalled for its first 42 ticks (every machine full, nothing moves); the
    // long run judges it from tick 960, and a replay of the period from there shows the 12 inserters at work
    it("records a settled period from the tick the long run judges, not the stalled first one", async () => {
        const config = await loadConfigFromFile(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL02);
        const generated = generateClockAlternatives(config, {logger: quiet});
        const selected = generated.alternatives[generated.selected_index];
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
        expect(swings(cold)).toBe(0);
        expect(swings(settled)).toBeGreaterThan(0);
    }, 300_000);

    it("exports the circuits on belt 2 at 40 a second a lane", async () => {
        const config = await loadConfigFromFile(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL02);
        const belt = config.belts.find(it => it.id === 2)!;
        expect(belt.strategy).toBe("export");
        expect(belt.lanes.map(lane => [lane.ingredient, "consumption_per_second" in lane ? lane.consumption_per_second : undefined]))
            .toEqual([["electronic-circuit", 40], ["electronic-circuit", 40]]);
    });
});
