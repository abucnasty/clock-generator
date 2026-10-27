import {createHash} from "crypto";
import {expect, it} from "vitest";
import {generateClockAlternatives} from "../../../src/crafting/generate-blueprint";
import {clockIdentity} from "../../../src/crafting/clock-identity";
import {loadConfigFromFile} from "../../../src/config/loader";
import {ConfigPaths} from "../../../src/config/config-paths";
import {alwaysOnReasonProblemsOf, quiet} from "../../../src/crafting/generate-blueprint-test-helpers";
import {readControls} from "./clock-controls";
import {GENERATED_ALTERNATIVE, STUPIDFATHOBBIT_CELL02_CASES, StupidfathobbitCell02ClockCase} from "./stupidfathobbit-cell02-clock-fixtures";

/** The generation tests of the clock the generator selects for the real stupidfathobbit cell 02, in the cases `which` picks, each pinned beside its native control */
export function cell02SelectionTests(which: (variant: StupidfathobbitCell02ClockCase) => boolean) {
    it.each(STUPIDFATHOBBIT_CELL02_CASES.filter(which))("selects a stable clock of one cycle at 80 a second, $name", async ({name, backed}) => {
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
}
