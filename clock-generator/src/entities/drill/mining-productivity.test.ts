import { describe, test, expect } from "vitest"
import { MiningProductivity } from "./mining-productivity"

describe("MiningProductivity", () => {
    // the game gives 10% a level researched: the harness save's research (mining productivity 3 at level 8000, with 1
    // and 2 done) is 7,999 levels, +79,990%, and the sidecar exports 7999 for it
    test.each([
        [0, 0, 0],
        [7, 70, 0.7],
        [7999, 79990, 799.9],
    ])("level %i gives %i%%", (level, value, normalized) => {
        const mining_prod = MiningProductivity.fromLevel(level)
        expect(mining_prod.productivity.value).toBe(value)
        expect(mining_prod.productivity.normalized).toBe(normalized)
    });
});
