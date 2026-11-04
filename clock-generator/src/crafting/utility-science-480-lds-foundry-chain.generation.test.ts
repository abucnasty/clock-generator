import { describe, it, expect, beforeAll } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { generateClockAlternatives, type ClockAlternativesResult } from "./generate-blueprint";
import { alwaysOnReasonProblemsOf, quiet } from "./generate-blueprint-test-helpers";
import { clockIdentity } from "./clock-identity";
import { createHash } from "crypto";
import {readControls, RunControls, runHolds} from "../../tests/game/builds/clock-controls";
import { GENERATED_ALTERNATIVE } from "../../tests/game/builds/thaeln-cell09-clock-fixtures";

// Thaeln's cell 09 (REAL_THAELN_CELL09) at 480 a second: a coal inserter that moves 15/8 hands a cycle stretches every planned
// clock to eight cycles (1,344 ticks), and none of those holds. Windows made from the hands, rounded up where they are
// fractional, and from the order of the chain (src/crafting/candidates/grouped-hands.ts) hold in one cycle (168 ticks), so
// the selected clock needs no search. Targeted searches still run past it since #527. Before, the observed-windows search ran for about twenty minutes and found no clock that recovers.
describe("a clock for Thaeln's cell 09 from the hands and the order of the chain", () => {
    let result: ClockAlternativesResult;
    let config: Config;
    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.REAL_THAELN_CELL09);
        result = generateClockAlternatives(config, { logger: quiet });
    });

    it("names why every inserter and drill a clock leaves always on is", () => {
        expect(alwaysOnReasonProblemsOf(config, result)).toEqual([]);
    });

    it("Behavior: the explicit one-cycle plan holds 480 a second and recovers", () => {
        // Explicit plan, not selected_index: a future selector change must not masquerade as a behavior regression.
        const plan = result.alternatives.find(it => it.id === "planned-belt-slack")!;
        expect(plan, "the explicit behavior plan is offered").toBeDefined();
        expect(plan.verdict).toBe("stable");
        expect(plan.assessment.holds).toBe(true);
        expect(plan.result.simulation_duration.ticks).toBe(168);
        expect(plan.assessment.items_per_second).toBeCloseTo(480, 6);
        expect(plan.assessment.backpressure_loss?.survives).toBe(true);
    });

    it("Selection: the valid pick remains the clock named by its native control", () => {
        const { generation, native } = readControls<RunControls>("thaeln-cell09-clock-controls.json").cases["generated-one-copy"];
        const selected = result.alternatives[result.selected_index];
        expect(selected.verdict).toBe("stable");
        expect(selected.assessment.backpressure_loss?.survives).toBe(true);
        // Targeted searches now offer observed windows past a valid short plan, while the native-pinned pick stays.
        // If ranking chooses another valid plan, only this Selection contract needs a justified/native-tested repin.
        expect(result.alternatives.map(it => it.id)).toContain("derived");
        expect(result.skipped_searches).toEqual(["Uneven output swings", "Full-hand output swings"]);
        expect(result.why_not_stable).toBeNull();
        expect(selected.id).toBe(GENERATED_ALTERNATIVE);
        const exported = selected.result.subtick ?? selected.result;
        expect(createHash("sha256").update(JSON.stringify(clockIdentity(exported))).digest("hex"),
            "same windows and exported clock as the native control (its identity: no text or metadata)").toBe(generation!.clock_sha256);
        expect(selected.result.simulation_duration.ticks).toBe(generation!.period);
        expect({ id: selected.id, holds: selected.assessment.holds, rate: selected.assessment.items_per_second, supply: selected.belt?.kind ?? null })
            .toEqual(generation!.selection);
        expect(native.period).toBe(generation!.period);
        // the game holds the target over the baseline and is back at it after each loss
        expect(runHolds(native), native.result).toBe(true);
    });
});
