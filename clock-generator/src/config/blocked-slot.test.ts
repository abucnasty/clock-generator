import { describe, expect, it } from "vitest";
import { ChestConfigSchema } from "./schema";

describe("a blocked slot in the config", () => {
    it("is refused with an item as well, or as blocked: false", () => {
        expect(() => ChestConfigSchema.parse({ type: "car", id: 1, slot_filters: [{ slot: 1, item: "coal", blocked: true }] })).toThrow();
        expect(() => ChestConfigSchema.parse({ type: "car", id: 1, slot_filters: [{ slot: 1, blocked: false }] })).toThrow();
        expect(() => ChestConfigSchema.parse({ type: "car", id: 1, slot_filters: [{ slot: 1 }] })).toThrow();
    });
});
