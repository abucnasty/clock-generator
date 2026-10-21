import fs from "fs";
import path from "path";
import {createHash} from "crypto";
import {expect, test} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {encodeBlueprintFile} from "../blueprints/serde";
import {blockedOutputClockCases, blockedOutputClockConfig} from "../../tests/game/builds/blocked-output-clock-fixtures";

interface ExpectedClock {
    period: number;
    expected: number;
    verdict: string;
    selection: {id: string; holds: boolean; rate: number; supply: string | null};
    clock_sha256: string;
    /** The in-game recording of this selection */
    native_control: string;
}
interface NativeClock {expected: number; baseline: number[]; recovery: {during: number[]; recovered: number[]}[]}
const directory = path.join(__dirname, "../../tests/game/builds");
const controls = JSON.parse(fs.readFileSync(path.join(directory, "blocked-output-clock-generation-controls.json"), "utf8")) as Record<string, ExpectedClock>;
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

for (const variant of blockedOutputClockCases()) {
    test(`blocked output default: ${variant.name}`, () => {
        const expected = controls[variant.name];
        const generated = generateClockAlternatives(blockedOutputClockConfig(variant), {logger: quiet});
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
            supply: selected.belt?.kind ?? null}).toEqual(expected.selection);
        const native = (JSON.parse(fs.readFileSync(path.join(directory, expected.native_control), "utf8")) as Record<string, NativeClock>)[variant.name];
        expect(native.expected).toBe(expected.expected);
        // The simulator holds the output inserter from the tick its belt stops taking the product; the game first fills
        // the belt behind the drop, so output stops some periods into the block. Neither changes what follows: the game
        // drops nothing before the release, and is back at the expected output in every period after it.
        expect(native.baseline.every(items => items === native.expected)).toBe(selected.assessment.holds);
        for (const loss of native.recovery) {
            expect(loss.during).toContain(0);
            expect(loss.recovered.length).toBeGreaterThanOrEqual(30);
            expect(loss.recovered.every(items => items === native.expected)).toBe(selected.verdict === "stable");
        }
    });
}
