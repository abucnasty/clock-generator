import { describe, expect, it } from "vitest";
import { Mode } from "./mode";
import { Transition } from "./mode-transition";
import { reasonId, reasonText } from "./reason-table";

const mode = { status: "IDLE" } as unknown as Mode;

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

    it("is what a transition records its reason by", () => {
        const first = new Transition(mode, ["reason", "table", "transition"].join(" "));
        const second = new Transition(mode, "reason table transition");
        expect(second.reason_id).toBe(first.reason_id);
        expect(second.reason).toBe("reason table transition");
        expect(reasonText(first.reason_id)).toBe(first.reason);
    });
});
