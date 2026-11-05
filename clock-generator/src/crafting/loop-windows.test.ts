import { describe, it, expect } from "vitest";
import { LOOP_WINDOW_CHECK_TICKS, rankingWindowCount, anyFeederCarriesFuel, hasPlannedWindowsNotHands } from "./generate-blueprint";
import type { Inserter } from "../entities";

// the rules of the windows of the inserters out of a loop (agricultural science, agricultural-science-loop-windows.generation.test.ts),
// as they are, with no build generated
describe("loop windows", () => {
    it("verifies the clock with the windows out of the loop over a longer run than the standard check: at least 72,000 ticks", () => {
        expect(LOOP_WINDOW_CHECK_TICKS).toBeGreaterThanOrEqual(72_000);
    });

    describe("the pieces of the rule for the inserters out of a loop", () => {
        const inserter = (id: number, source: string, sink: string, filtered: string[] = []) => ({
            entity_id: { id: `inserter:${id}` },
            source: { entity_id: { id: source, type: source.split(":")[0] } },
            sink: { entity_id: { id: sink, type: sink.split(":")[0] } },
            filtered_items: new Set(filtered),
        }) as unknown as Inserter;

        it("counts the windows of the inserters out of a loop as they are without their windows when it ranks", () => {
            const windows = { "inserter:1": [{ start: 0, end: 1 }], "inserter:9": [1, 2, 3, 4, 5].map(it => ({ start: it, end: it })) } as never;
            expect(rankingWindowCount(6, windows, undefined)).toBe(6);
            expect(rankingWindowCount(6, windows, { inserter_ids: ["inserter:9"], window_count_without_loop_windows: 0 })).toBe(1);
            expect(rankingWindowCount(6, windows, { inserter_ids: ["inserter:9"], window_count_without_loop_windows: 2 })).toBe(3);
        });

        it("leaves every inserter out of the loop into a machine alone when any of them can carry its fuel", () => {
            const eggs = inserter(1, "machine:3", "machine:5", ["pentapod-egg"]);
            const nutrients = inserter(2, "machine:3", "machine:5", ["nutrients", "pentapod-egg"]);
            expect(anyFeederCarriesFuel([eggs], "nutrients")).toBe(false);
            expect(anyFeederCarriesFuel([eggs, nutrients], "nutrients")).toBe(true);
            expect(anyFeederCarriesFuel([nutrients], undefined)).toBe(false);
        });

        it("skips an inserter whose windows are the plan's only in a build with always-enabled inserters", () => {
            expect(hasPlannedWindowsNotHands(new Set(["inserter:9"]), "inserter:3")).toBe(true);
            expect(hasPlannedWindowsNotHands(new Set(["inserter:9"]), "inserter:9")).toBe(false);
            expect(hasPlannedWindowsNotHands(new Set(), "inserter:3")).toBe(false);
        });
    });
});
