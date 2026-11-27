import { describe, expect, it } from "vitest";
import { parseConfig } from "./loader";

const config = (chest: Record<string, unknown>) => JSON.stringify({
    setpoint: { item: "iron-plate", items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: "iron-plate", productivity: 0, crafting_speed: 1 }],
    inserters: [],
    belts: [],
    chests: [{ id: 1, ...chest }],
});

describe("a car, a tank, a cargo wagon or a rocket silo as a chest", () => {
    it("is taken, and a storage size on it is refused: its slots come from the game data", async () => {
        for (const type of ["car", "tank", "cargo-wagon", "rocket-silo"]) {
            await expect(parseConfig(config({ type }))).resolves.toBeDefined();
            await expect(parseConfig(config({ type, storage_size: 80 }))).rejects.toThrow(
                "Configuration check failed at 'chests[0].storage_size': `storage_size` is refused on a car, a tank, a cargo "
                + "wagon or a rocket silo: their slots come from the game data (a cargo wagon's by its `quality`)");
        }
    });
});
