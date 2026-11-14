import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { generateClockAlternatives } from "./generate-blueprint";
import { isNotChecked } from "./shared-lane-verdict";

/** A logger that keeps the warnings that the lanes the copies share could not be checked */
function unchecked(): { warnings: string[]; logger: { log(): void; warn(message: string): void; error(): void; debug(): void } } {
    const warnings: string[] = [];
    return { warnings, logger: { log() { }, warn(message) { if (message.includes("could not be checked")) warnings.push(message); }, error() { }, debug() { } } };
}

// LOGISTIC_SCIENCE_240 with a copy_offset of 0: the copies would stand on one another, and the check cannot lay them out
describe("a build whose shared lanes cannot be checked", () => {
    it("has every clock that holds carry a loss that says why, and none of them stable", async () => {
        const config = await loadConfigFromFile(ConfigPaths.LOGISTIC_SCIENCE_240);
        const { warnings, logger } = unchecked();
        const generated = generateClockAlternatives({ ...config, setpoint: { ...config.setpoint, copy_offset: { x: 0, y: 0 } } }, { logger });
        expect(warnings.length).toBeGreaterThan(0);
        const held = generated.alternatives.filter(alternative => alternative.assessment.holds);
        expect(held.length).toBeGreaterThan(0);
        for (const alternative of held) {
            const losses = alternative.assessment.shared_lane_losses ?? [];
            expect([alternative.id, alternative.verdict, losses.every(isNotChecked), losses.length]).toEqual([alternative.id, "unstable", true, 1]);
            expect(alternative.description).toContain("It is not counted as stable. The lanes its copies share could not be checked: "
                + "The copies on lane 1 of belt 2 need copy_offset along the lane.");
        }
        expect(generated.alternatives.some(alternative => alternative.verdict === "stable")).toBe(false);
        expect(generated.why_not_stable?.message).toContain("is not counted as stable: the lanes its copies share could not be checked: "
            + "The copies on lane 1 of belt 2 need copy_offset along the lane.");
    });
});
