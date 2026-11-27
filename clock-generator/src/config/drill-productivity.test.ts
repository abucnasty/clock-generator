import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema";

const drill = (extra: object = {}) => ({ id: 1, type: "big-mining-drill", mined_item_name: "iron-ore", speed_bonus: 5,
    target: { type: "chest", id: 1 }, ...extra });
const config = (drills: unknown) => ({ setpoint: { item: "iron-gear-wheel", items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0 }], belts: [], inserters: [],
    chests: [{ type: "car", id: 1 }], drills });

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
