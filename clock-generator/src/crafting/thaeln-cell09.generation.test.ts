import { describe, it, expect, beforeAll } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { generateClockAlternatives, type ClockAlternativesResult } from "./generate-blueprint";
import { quiet } from "./generate-blueprint-test-helpers";

// Thaeln's cell 09 (REAL_THAELN_CELL09) at 480 a second: a coal inserter that moves 15/8 hands a cycle stretches every planned
// clock to eight cycles (1,344 ticks), and none of those holds. Windows made from the hands, rounded up where they are
// fractional, and from the order of the chain (src/crafting/candidates/grouped-hands.ts) hold in one cycle (168 ticks), so
// no search is needed. Before, the observed-windows search ran for about twenty minutes and found no clock that recovers.
describe("a clock for Thaeln's cell 09 from the hands and the order of the chain", () => {
    let result: ClockAlternativesResult;
    beforeAll(async () => {
        const config = await loadConfigFromFile(ConfigPaths.REAL_THAELN_CELL09);
        result = generateClockAlternatives(config, { logger: quiet });
    });

    it("selects a stable clock of one cycle at the target rate, and runs no search", () => {
        const selected = result.alternatives[result.selected_index];
        expect(selected.verdict).toBe("stable");
        expect(selected.result.simulation_duration.ticks).toBe(168);
        expect(selected.assessment.items_per_second).toBeCloseTo(480, 6);
        expect(selected.assessment.backpressure_loss?.survives).toBe(true);
        expect(result.alternatives.map(it => it.id)).not.toContain("derived");
        expect(result.alternatives.map(it => it.id)).not.toContain("derived-lean-coal");
        expect(result.skipped_searches.length).toBeGreaterThan(0);
        expect(result.why_not_stable).toBeNull();
    });
});
