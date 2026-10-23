import path from "path";
import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "./loader";
import { migrateChestType } from "./migrate-chest-type";

describe("a chest without a type", () => {
    it("is read from the legacy fixture as a buffer chest", async () => {
        const config = await loadConfigFromFile(path.join(__dirname, "fixtures/legacy/chest-without-type.json"));
        expect(config.chests).toEqual([{ type: "buffer-chest", id: 1, storage_size: 1, item_filter: "plastic-bar" }]);
    });

    it("leaves a chest with a type, and anything that is not a chest, as it is", () => {
        for (const value of [null, 3, "chest", [{ id: 1 }], { type: "car", id: 1 }]) {
            expect(migrateChestType(value)).toBe(value);
        }
    });
});
