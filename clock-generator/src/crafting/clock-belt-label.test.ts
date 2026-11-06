import { describe, it, expect } from "vitest";
import { clockBeltLabel } from "./generate-blueprint";

// GOALS.md: a clock that only works when its inserters pick up from a backed-up belt, and a clock that also
// works when the items on the belt are moving
describe("clockBeltLabel", () => {
    it("names a moving belt with the ticks of belt pickup slack", () => {
        expect(clockBeltLabel({ kind: "moving", slack_ticks: [4] })).toBe("moving (+4 ticks)");
        expect(clockBeltLabel({ kind: "moving", slack_ticks: [1] })).toBe("moving (+1 tick)");
        expect(clockBeltLabel({ kind: "moving", slack_ticks: [2, 4] })).toBe("moving (+2–4 ticks)");
    });

    it("names a moving belt whose windows hold the slack after their last pickup already as one with the slack added", () => {
        expect(clockBeltLabel({ kind: "moving", slack_ticks: [4], inside: true })).toBe("moving (+4 ticks)");
    });

    it("names a backed-up belt, and nothing when no clocked inserter picks up from a belt", () => {
        expect(clockBeltLabel({ kind: "backed_up" })).toBe("backed-up");
        expect(clockBeltLabel(null)).toBe("");
    });
});
