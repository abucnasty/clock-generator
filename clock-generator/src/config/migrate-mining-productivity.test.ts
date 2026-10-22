import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema";
import {
    MINING_PRODUCTIVITY_LEVEL_AND_PRODUCTIVITY_ERROR,
    MINING_PRODUCTIVITY_LEVEL_ERROR,
    migrateMiningProductivityLevel,
} from "./migrate-mining-productivity";

const drill = (extra: object = {}) => ({ id: 1, type: "big-mining-drill", mined_item_name: "iron-ore", speed_bonus: 5,
    target: { type: "chest", id: 1 }, ...extra });
const config = (drills: unknown) => ({ target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0 }], belts: [], inserters: [],
    chests: [{ type: "car", id: 1 }], drills });

describe("the former mining productivity level", () => {
    // the game gives 10% a level researched: the harness save's research (mining productivity 3 at level 8000, with 1
    // and 2 done) is 7,999 levels, +79,990%, which a sidecar before 0.12.0's per-drill export gave as the level
    it.each([
        [0, 0],
        [7, 70],
        [7999, 79990],
    ])("level %i becomes each drill's productivity of %i%%", (level, productivity) => {
        const parsed = ConfigSchema.parse(config({ mining_productivity_level: level, configs: [drill(), drill({ id: 2 })] }));
        expect(parsed.drills).toEqual({ configs: [drill({ productivity }), drill({ id: 2, productivity })] });
    });

    it("is refused with a drill's own productivity", () => {
        const result = ConfigSchema.safeParse(config({ mining_productivity_level: 7, configs: [drill({ productivity: 70 })] }));
        expect(result.success).toBe(false);
        expect(result.error?.issues).toContainEqual(expect.objectContaining({ path: ["drills", "mining_productivity_level"],
            message: MINING_PRODUCTIVITY_LEVEL_AND_PRODUCTIVITY_ERROR }));
    });

    it.each([[-1], [2.5], ["7"]])("is refused when it is not a whole number of levels: %s", level => {
        const result = ConfigSchema.safeParse(config({ mining_productivity_level: level, configs: [drill()] }));
        expect(result.success).toBe(false);
        expect(result.error?.issues).toContainEqual(expect.objectContaining({ path: ["drills", "mining_productivity_level"],
            message: MINING_PRODUCTIVITY_LEVEL_ERROR }));
    });

    it("goes from drills without configs, and leaves drills without it as they are", () => {
        expect(migrateMiningProductivityLevel({ mining_productivity_level: 3 })).toEqual({});
        const current = { configs: [drill({ productivity: 12 })] };
        expect(migrateMiningProductivityLevel(current)).toBe(current);
        expect(migrateMiningProductivityLevel([drill()])).toEqual([drill()]);
    });
});

describe("a drill's productivity", () => {
    it("is required", () => {
        const result = ConfigSchema.safeParse(config({ configs: [drill()] }));
        expect(result.success).toBe(false);
        expect(result.error?.issues).toContainEqual(expect.objectContaining({ path: ["drills", "configs", 0, "productivity"] }));
    });

    it("is the drill's own, in percent, not capped", () => {
        const parsed = ConfigSchema.parse(config({ configs: [drill({ productivity: 82 }), drill({ id: 2, productivity: 490 })] }));
        expect(parsed.drills?.configs.map(it => it.productivity)).toEqual([82, 490]);
    });
});
