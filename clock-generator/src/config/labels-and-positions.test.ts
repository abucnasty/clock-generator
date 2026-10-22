import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema";

// What a config keeps for labels and tools, which no engine decision reads: a machine's prototype and qualities, a
// buffer chest's prototype, and where inserters, drills, machines and chests stand (Sidecar 0.12.0 exports them)
describe("labels and positions in a config", () => {
    const base = {
        target_output: { recipe: "iron-plate", items_per_second: 1, copies: 1 },
        belts: [],
    };
    const at = { x: 3.5, y: -2.5 };

    it("are kept as the config gives them", () => {
        const parsed = ConfigSchema.parse({
            ...base,
            machines: [{ id: 1, recipe: "iron-plate", productivity: 0, crafting_speed: 1, type: "furnace",
                prototype: "electric-furnace", quality: "legendary", recipe_quality: "normal", position: at }],
            inserters: [{ source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 }, position: at, direction: 4 }],
            chests: [
                { type: "buffer-chest", id: 1, storage_size: 48, item_filter: "iron-ore", prototype: "steel-chest", position: at },
                { type: "infinity-chest", id: 2, position: at },
                { type: "car", id: 3, position: at },
                { type: "rocket-silo", id: 4, position: at },
            ],
            drills: { configs: [{ id: 1, type: "electric-mining-drill", mined_item_name: "iron-ore", speed_bonus: 0, productivity: 0,
                target: { type: "chest", id: 1 }, position: at, direction: 8 }] },
        });
        expect(parsed.machines[0]).toMatchObject({ prototype: "electric-furnace", quality: "legendary", recipe_quality: "normal", position: at });
        expect(parsed.inserters[0]).toMatchObject({ position: at, direction: 4 });
        expect(parsed.chests!.map(chest => (chest as { position?: unknown }).position)).toEqual([at, at, at, at]);
        expect(parsed.chests![0]).toMatchObject({ prototype: "steel-chest" });
        expect(parsed.drills!.configs[0]).toMatchObject({ position: at, direction: 8 });
    });

    it("are optional: a config without them loads as before", () => {
        const parsed = ConfigSchema.parse({ ...base, machines: [{ id: 1, recipe: "iron-plate", productivity: 0, crafting_speed: 1 }], inserters: [] });
        expect(parsed.machines[0]).not.toHaveProperty("prototype");
        expect(parsed.machines[0]).not.toHaveProperty("position");
    });

    it("refuse a direction the game does not have", () => {
        expect(ConfigSchema.safeParse({ ...base, machines: [],
            inserters: [{ source: { type: "chest", id: 1 }, sink: { type: "chest", id: 2 }, direction: 16 }] }).success).toBe(false);
    });
});
