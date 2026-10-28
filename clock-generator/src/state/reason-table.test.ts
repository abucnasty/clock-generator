import { describe, expect, it } from "vitest";
import { reasonId, reasonText } from "./reason-table";

describe("the reason table", () => {
    it("gives equal texts one number, and the text back for it", () => {
        const text = `machine has ${12} of iron-plate to pickup`;
        const again = ["machine has", "12", "of iron-plate to pickup"].join(" ");
        expect(reasonId(again)).toBe(reasonId(text));
        expect(reasonText(reasonId(text))).toBe(text);
    });

    it("gives different texts different numbers", () => {
        expect(reasonId("reason table: one")).not.toBe(reasonId("reason table: two"));
    });

    it("knows no number it did not give", () => {
        expect(() => reasonText(reasonId("reason table: last") + 1)).toThrow();
    });

    // what a change of an inserter's phase records its reason by: simulation/archetypes/inserter.test.ts
});
