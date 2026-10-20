import fs from "fs";
import path from "path";
import {createHash} from "crypto";
import {expect, test} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {encodeBlueprintFile} from "../blueprints/serde";
import {overHoodClockCases, overHoodClockConfig} from "../../tests/game/builds/over-hood-clock-fixtures";

interface ExpectedClock {
    period: number;
    expected: number;
    verdict: string;
    selection: {id: string; holds: boolean; rate: number; supply: string};
    clock_sha256: string;
    /** The in-game recording of this selection; absent when the selection changed and has no recording yet */
    native_control?: string;
}
interface NativeClock {expected: number; baseline: number[]; recovery: {recovered: number[]}[]}
const directory = path.join(__dirname, "../../tests/game/builds");
const controls = JSON.parse(fs.readFileSync(path.join(directory, "over-hood-phase-generation-controls.json"), "utf8")) as Record<string, ExpectedClock>;
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

for (const family of ["different-items", "same-item"] as const) for (const variant of overHoodClockCases(family)) {
    test(`phase-checked default: ${variant.name}`, () => {
        const expected = controls[variant.name];
        const generated = generateClockAlternatives(overHoodClockConfig(variant), {logger: quiet});
        const selected = generated.alternatives[generated.selected_index];
        const result = selected.result;
        const period = result.subtick?.clock.period_ticks ?? result.simulation_duration.ticks;
        const exported = result.subtick ?? result;
        const clock = {blueprint: encodeBlueprintFile({blueprint: exported.blueprint}), schedule: exported.schedule};
        expect(createHash("sha256").update(JSON.stringify(clock)).digest("hex"), "same windows and exported clock as the native control")
            .toBe(expected.clock_sha256);
        expect(period).toBe(expected.period);
        expect(selected.verdict).toBe(expected.verdict);
        expect({id: selected.id, holds: selected.assessment.holds, rate: selected.assessment.items_per_second,
            supply: selected.belt?.kind}).toEqual(expected.selection);
        // a variant whose selection changed after the proof-based long run (its old pick is proven off its rate
        // every 16th period) has no recording of the new selection yet: re-record at least 32 periods in game
        if (expected.native_control === undefined) {
            return;
        }
        const native = (JSON.parse(fs.readFileSync(path.join(directory, expected.native_control), "utf8")) as Record<string, NativeClock>)[variant.name];
        expect(native.expected).toBe(expected.expected);
        // The native baseline judges the generator's own holds verdict for every recorded clock, not only the
        // stable ones: a clock rejected for recovery alone can hide a baseline it wrongly believes holds, as the
        // backed different-items picks did (96 moved in 4 of 63 recorded periods while holds stayed true). Only a
        // recording made under the selection's own supply speaks to its baseline.
        const recorded_supply = variant.backed ? "backed_up" : "moving";
        if (recorded_supply === expected.selection.supply && native.baseline.some(items => items !== native.expected)) {
            expect(selected.assessment.holds, "the native baseline misses the expected output: the generator has to see that itself").toBe(false);
        }
        if (selected.verdict === "stable") {
            expect(native.baseline.every(items => items === native.expected)).toBe(true);
            // The retained backed-up windows contain five periods; moving windows have at least eight.
            // Recovery is allowed to take time: mirrored turbo needs seven periods after the last loss.
            const heldPeriods = variant.backed ? 5 : 8;
            for (const loss of native.recovery) {
                expect(loss.recovered.length).toBeGreaterThanOrEqual(heldPeriods);
                expect(loss.recovered.slice(-heldPeriods).every(items => items === native.expected)).toBe(true);
            }
        }
    });
}
