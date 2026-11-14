import { describe, it, expect } from "vitest";
import { clockBeltLabel } from "./generate-blueprint";

// GOALS.md: a clock that only works when its inserters pick up from a backed-up belt, and a clock that also
// works when the items on the belt are moving
describe("clockBeltLabel", () => {
    it("names a moving belt", () => {
        expect(clockBeltLabel({ kind: "moving" })).toBe("moving");
    });

    it("names a backed-up belt, and nothing when no clocked inserter picks up from a belt", () => {
        expect(clockBeltLabel({ kind: "backed_up" })).toBe("backed-up");
        expect(clockBeltLabel(null)).toBe("");
    });
});
