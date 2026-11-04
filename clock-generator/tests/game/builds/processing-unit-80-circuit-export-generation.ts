import {createHash} from "crypto";
import {beforeAll, describe, expect, it} from "vitest";
import type {Config} from "../../../src/config";
import {generateClockAlternatives, type ClockAlternative, type ClockAlternativesResult} from "../../../src/crafting/generate-blueprint";
import {clockIdentity} from "../../../src/crafting/clock-identity";
import {loadConfigFromFile} from "../../../src/config/loader";
import {ConfigPaths} from "../../../src/config/config-paths";
import {alwaysOnReasonProblemsOf, quiet} from "../../../src/crafting/generate-blueprint-test-helpers";
import {readControls} from "./clock-controls";
import {GENERATED_ALTERNATIVE, STUPIDFATHOBBIT_CELL02_CASES, StupidfathobbitCell02ClockCase} from "./stupidfathobbit-cell02-clock-fixtures";

// This is an explicit strategy to verify, independently of the strategy selected by the current ranking.
const BEHAVIOR_PLAN = "planned-belt-slack";

/** Shared generation setup; Behavior and Selection have separate assertions and failure meanings. */
export function cell02ClockTests(which: (variant: StupidfathobbitCell02ClockCase) => boolean,
    /** More claims on the selected clock of each variant, from the generation the variant already made */
    selectedClaims?: (selected: ClockAlternative, config: Config) => void) {
    describe.each(STUPIDFATHOBBIT_CELL02_CASES.filter(which))("$name", ({name, backed}) => {
        let config: Config;
        let generated: ClockAlternativesResult;
        beforeAll(async () => {
            const loaded = await loadConfigFromFile(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL02);
            config = backed ? {...loaded, overrides: {...loaded.overrides, backed_up_belts: true}} : loaded;
            generated = generateClockAlternatives(config, {logger: quiet});
        // Keep the existing generation bound; sharing the result does not relax it.
        }, 300_000);

        it("Behavior: the explicit one-cycle plan holds 80 a second and recovers", () => {
            const plan = generated.alternatives.find(it => it.id === BEHAVIOR_PLAN)!;
            expect(plan, "the explicit behavior plan is offered, independently of the selector").toBeDefined();
            expect(plan.verdict).toBe("stable");
            expect(plan.assessment.holds).toBe(true);
            expect(plan.assessment.items_per_second).toBeCloseTo(80, 6);
            expect(plan.assessment.backpressure_loss?.survives).toBe(true);
            expect(plan.result.simulation_duration.ticks).toBe(24);
            expect(plan.result.stability_check.as_built).toMatchObject({holds: true, actual_output_items: 32});
            expect(plan.belt).toEqual(backed ? {kind: "backed_up"} : {kind: "moving", slack_ticks: [4]});
        });

        it("Selection: the valid current pick is the native-pinned clock", () => {
            const selected = generated.alternatives[generated.selected_index];
            // Identity is the ranking contract, not a production assertion about the explicit Behavior plan above.
            // A changed pick needs a reason and native verification before this pin moves.
            expect(selected.verdict).toBe("stable");
            expect(selected.assessment.holds).toBe(true);
            expect(selected.assessment.backpressure_loss?.survives).toBe(true);
            expect(selected.id).toBe(GENERATED_ALTERNATIVE);
            expect(generated.why_not_stable).toBeNull();
            expect(alwaysOnReasonProblemsOf(config, generated)).toEqual([]);
            // The 12 inserters with no window are the ones whose hands take all 24 ticks of this selected period.
            expect(selected.result.always_on_reasons).toEqual(Object.fromEntries([3, 4, 5, 6, 7, 8, 13, 14, 15, 18, 19, 20]
                .map(number => [`inserter:${number}`, {kind: "busy", period_ticks: 24}])));
            const exported = selected.result.subtick ?? selected.result;
            const pin = readControls("stupidfathobbit-cell02-clock-controls.json").cases[name].generation!;
            expect(createHash("sha256").update(JSON.stringify(clockIdentity(exported))).digest("hex"),
                "same windows and exported clock as the native control (its identity: no text or metadata)").toBe(pin.clock_sha256);
            expect({id: selected.id, holds: selected.assessment.holds, rate: selected.assessment.items_per_second, supply: selected.belt?.kind ?? null}).toEqual(pin.selection);
            expect(selected.result.simulation_duration.ticks).toBe(pin.period);
            selectedClaims?.(selected, config);
        });
    });
}
