import { describe, expect, it } from "vitest";
import { TRUE_START_KNOWN_MISSES, trueStartStandingOf, worseStanding } from "./true-start-standing";

const machine = (machine_name: string, recipe: string, delta: number, productivity_bonus: number) => ({ machine_name, recipe, delta, productivity_bonus });

describe("trueStartStandingOf", () => {
    it("is checked on the recorded recipes and machines inside the recorded delta and productivity", () => {
        expect(trueStartStandingOf(machine("electromagnetic-plant", "advanced-circuit", 0.278, 1.75))).toBe("checked");
        expect(trueStartStandingOf(machine("foundry", "casting-low-density-structure", 0.286, 3))).toBe("checked");
        expect(trueStartStandingOf(machine("cryogenic-plant", "plastic-bar", 1.025, 3))).toBe("checked");
    });

    it("is not checked outside the recorded range, on other machines and on recipes never recorded", () => {
        expect(trueStartStandingOf(machine("electromagnetic-plant", "advanced-circuit", 0.5, 1.75))).toBe("not checked");
        expect(trueStartStandingOf(machine("electromagnetic-plant", "advanced-circuit", 0.278, 0))).toBe("not checked");
        expect(trueStartStandingOf(machine("assembling-machine-3", "advanced-circuit", 0.278, 1))).toBe("not checked");
        expect(trueStartStandingOf(machine("cryogenic-plant", "plastic-bar", 1.5, 3))).toBe("not checked");
        expect(trueStartStandingOf(machine("electromagnetic-plant", "processing-unit", 0.3, 3))).toBe("not checked");
    });

    it("is a known miss on a plastic plant near delta 2 and on every biochamber", () => {
        expect(trueStartStandingOf(machine("cryogenic-plant", "plastic-bar", 1.958, 3))).toBe("known miss");
        expect(trueStartStandingOf(machine("biochamber", "pentapod-egg", 0.072, 1.5))).toBe("known miss");
        expect(TRUE_START_KNOWN_MISSES).toHaveLength(2);
    });
});

describe("worseStanding", () => {
    it("takes a known miss over not checked over checked, and ignores a machine without a standing", () => {
        expect(worseStanding("checked", "not checked")).toBe("not checked");
        expect(worseStanding("known miss", "not checked")).toBe("known miss");
        expect(worseStanding(null, "checked")).toBe("checked");
        expect(worseStanding(null, null)).toBeNull();
    });
});
