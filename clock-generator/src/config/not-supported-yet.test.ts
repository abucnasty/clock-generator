import { describe, expect, it } from "vitest";
import { parseConfig } from "./loader";

const config = (chest_type: string, machine_type?: string) => JSON.stringify({
    target_output: { recipe: "iron-plate", items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: "iron-plate", productivity: 0, crafting_speed: 1, ...(machine_type ? { type: machine_type } : {}) }],
    inserters: [],
    belts: [],
    chests: [{ type: chest_type, id: 1, storage_size: 80, item_filter: "iron-plate" }],
});

describe("a config naming an entity the generator does not support yet", () => {
    it("is refused with the reason and the roadmap milestone, not the list of types it takes", async () => {
        await expect(parseConfig(config("car"))).rejects.toThrow(
            "Configuration validation failed at 'chests[0].type': \"car\" is not supported yet: a car as a chest comes with roadmap milestone M2 (containers)");
        await expect(parseConfig(config("buffer-chest", "recycler"))).rejects.toThrow(
            "\"recycler\" is not supported yet: recyclers come with roadmap milestone M3 (recyclers and quality tiers)");
    });

    it("still lists what it takes for a type it has never heard of", async () => {
        await expect(parseConfig(config("buffer-chest", "something"))).rejects.toThrow("expected one of \"machine\"|\"furnace\"|\"biochamber\"");
    });
});
