import { describe, expect, it } from "vitest";
import { migrateChestType } from "./migrate-chest-type";

describe("a chest without a type", () => {
    it("leaves a chest with a type, and anything that is not a chest, as it is", () => {
        for (const value of [null, 3, "chest", [{ id: 1 }], { type: "car", id: 1 }]) {
            expect(migrateChestType(value)).toBe(value);
        }
    });
});
