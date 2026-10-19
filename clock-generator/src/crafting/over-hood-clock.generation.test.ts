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
    native_control: string;
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
        const native = (JSON.parse(fs.readFileSync(path.join(directory, expected.native_control), "utf8")) as Record<string, NativeClock>)[variant.name];
        expect(native.expected).toBe(expected.expected);
        if (selected.verdict === "stable") {
            expect(native.baseline.every(items => items === native.expected)).toBe(true);
            // Recovery is allowed to take time. Eight untouched final periods witness settled output;
            // the mirrored turbo replacement needs seven periods, rather than the probe's initial six.
            for (const loss of native.recovery) {
                expect(loss.recovered.length).toBeGreaterThanOrEqual(8);
                expect(loss.recovered.slice(-8).every(items => items === native.expected)).toBe(true);
            }
        }
    });
}
