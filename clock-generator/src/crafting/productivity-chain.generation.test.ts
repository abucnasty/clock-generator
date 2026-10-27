import { describe, it, expect, beforeAll } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { ConfigPaths } from "../config/config-paths";
import { generateClockAlternatives, type ClockAlternativesResult } from "./generate-blueprint";
import { alwaysOnReasonProblemsOf, quiet } from "./generate-blueprint-test-helpers";
import { clockIdentity } from "./clock-identity";
import { createHash } from "crypto";
import { readControls } from "../../tests/game/builds/clock-controls";
import { GENERATED_ALTERNATIVE } from "../../tests/game/builds/productivity-chain-clock-fixtures";

// The productivity module chain (REAL_OWNER_PRODUCTIVITY_CHAIN) at 80 modules a second over 6 copies: nine machines with chests
// between them, 1.3% of room in the whole chain. No clock observed from the plan holds. Windows made from the hands, rounded up where
// they are fractional, and from the order of the chain (src/crafting/candidates/grouped-hands.ts) hold in one cycle (72 ticks).
describe("a clock for the productivity module chain from the hands and the order of the chain", () => {
    let config: Config;
    let result: ClockAlternativesResult;
    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_PRODUCTIVITY_CHAIN);
        result = generateClockAlternatives(config, { logger: quiet });
    });

    it("names why every inserter and drill a clock leaves always on is", () => {
        expect(alwaysOnReasonProblemsOf(config, result)).toEqual([]);
    });

    it("selects a stable clock of one cycle at the target rate, and runs no search", () => {
        const selected = result.alternatives[result.selected_index];
        expect(selected.id).toBe(GENERATED_ALTERNATIVE);
        expect(selected.verdict).toBe("stable");
        expect(selected.result.simulation_duration.ticks).toBe(72);
        expect(selected.assessment.items_per_second).toBeCloseTo(80, 6);
        expect(selected.assessment.wake_ups_per_minute).toBeCloseTo(575.625, 2);
        expect(selected.assessment.backpressure_loss?.survives).toBe(true);
        expect(selected.assessment.backpressure_loss?.recovered_after_periods).toBe(7);
        expect(result.skipped_searches.length).toBeGreaterThan(0);
        expect(result.why_not_stable).toBeNull();
    });

    it("is the clock recorded in the game: the pin of the control names it", () => {
        const { generation, native } = readControls("productivity-chain-clock-controls.json").cases["generated-one-copy"];
        const selected = result.alternatives[result.selected_index];
        const exported = selected.result.subtick ?? selected.result;
        expect(createHash("sha256").update(JSON.stringify(clockIdentity(exported))).digest("hex"),
            "same windows and exported clock as the native control (its identity: no text or metadata)").toBe(generation!.clock_sha256);
        expect(selected.result.simulation_duration.ticks).toBe(generation!.period);
        expect({ id: selected.id, holds: selected.assessment.holds, rate: selected.assessment.items_per_second, supply: selected.belt?.kind ?? null })
            .toEqual(generation!.selection);
        expect(native.expected).toBe(generation!.expected);
        // the game holds the target in every baseline period and is back at it after each loss
        expect(native.baseline.length).toBeGreaterThanOrEqual(60);
        expect(native.baseline.every(items => items === native.expected)).toBe(true);
        for (const loss of native.recovery) {
            expect(Math.min(...loss.during)).toBeLessThan(native.expected);
            expect(loss.recovered[loss.recovered.length - 1]).toBe(native.expected);
        }
    });
});
