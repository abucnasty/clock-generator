import { describe, expect, it } from "vitest";
import { parseConfig } from "./loader";

const config = (chest: Record<string, unknown>, machine_type?: string) => JSON.stringify({
    target_output: { recipe: "iron-plate", items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: "iron-plate", productivity: 0, crafting_speed: 1, ...(machine_type ? { type: machine_type } : {}) }],
    inserters: [],
    belts: [],
    chests: [{ id: 1, ...chest }],
});

const buffer = { type: "buffer-chest", storage_size: 80, item_filter: "iron-plate" };

describe("a config naming an entity the generator does not support yet", () => {
    it("is refused with the reason and the roadmap milestone, not the list of types it takes", async () => {
        await expect(parseConfig(config(buffer, "rocket-silo"))).rejects.toThrow(
            "Configuration validation failed at 'machines[0].type': \"rocket-silo\" is not supported yet: a rocket silo as a machine, "
            + "crafting rocket parts and launching, comes with phase 2 of roadmap milestone M2 (containers); a rocket silo is "
            + "taken as a chest: list it under `chests` with type \"rocket-silo\"");
        await expect(parseConfig(config(buffer, "lab"))).rejects.toThrow(
            "\"lab\" is not supported yet: labs are not modelled: they consume no recipe");
    });

    it("still lists what it takes for a type it has never heard of", async () => {
        await expect(parseConfig(config(buffer, "something"))).rejects.toThrow("expected one of \"machine\"|\"furnace\"|\"biochamber\"");
    });
});

describe("a car, a tank, a cargo wagon or a rocket silo as a chest", () => {
    it("is taken, and a storage size on it is refused: its slots come from the game data", async () => {
        for (const type of ["car", "tank", "cargo-wagon", "rocket-silo"]) {
            await expect(parseConfig(config({ type }))).resolves.toBeDefined();
            await expect(parseConfig(config({ type, storage_size: 80 }))).rejects.toThrow(
                "Configuration validation failed at 'chests[0].storage_size': `storage_size` is refused on a car, a tank, a cargo "
                + "wagon or a rocket silo: their slots come from the game data (a cargo wagon's by its `quality`)");
        }
    });
});
