import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { FeasibilityError } from "../config/errors";
import { alwaysOnReasonProblemsOf, quiet } from "./generate-blueprint-test-helpers";


describe("why the selected clock does not meet goal 1, as a generation says it", () => {
    // a hand of 2 every 8 ticks takes at most 15 packs a second out of a copy (the simulator's inserter, free-running, moves
    // exactly that), under the 21.82 a copy of the target: the feasibility pass refuses it before any clock is tried
    it("is not reached where the inserters' hands are too small for the target: the build is refused before any clock", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.SAMPLE_CONFIG);
        const config = { ...sample, inserters: sample.inserters.map(inserter => ({ ...inserter, stack_size: 2 })) };
        expect(() => generateClockAlternatives(config, { logger: quiet })).toThrow(FeasibilityError);
        expect(() => generateClockAlternatives(config, { logger: quiet })).toThrow("Inserter 2 can take at most 15 a second of logistic science "
            + "pack out of the build (1 hand of 2 every 8 ticks), and the target is 21.82 a second.");
    });

    it("is the output chest filling up on issue #100's config, whose buffer chest nothing empties", async () => {
        // the config's former `type` on its machines is read with the game data, which the loader has from the samples above
        const generated = generateClockAlternatives(await loadConfigFromFile(path.join(__dirname, "../../tests/configs/issue-100-electromagnetic-science-buffer-chest.json")),
            { logger: quiet });
        expect(generated.alternatives.every(it => it.verdict === "unstable" && it.assessment.items_per_second === 0)).toBe(true);
        expect(generated.alternatives[generated.selected_index].result.stability_check.as_built?.full_output_chests).toEqual([{
            chest_id: 1, chest_type: "buffer-chest", name: "Chest 1", item: "electromagnetic-science-pack", item_label: "electromagnetic science pack",
            held: 9600, capacity: 9600, inserter_ids: [1, 2],
        }]);
        expect(generated.why_not_stable).toEqual({
            cause: "output chest full",
            message: "No clock holds the target rate of 48 a second: Chest 1 fills up. Nothing takes any electromagnetic science pack out of it, "
                + "so it holds 9,600 of 9,600 and inserters 1 and 2 have nowhere to drop. The closest, Batched swings: 2 output swings per "
                + "cycle, moves 0 a second, 48 under the target. Use an infinity chest, or add an inserter that takes the items out, and "
                + "generate again. Not made: Fractional swings (Cannot satisfy fractional swing constraint: sub-cycle 1 requires 3 swings, but "
                + "maximum allowed is 2 due to insertion limits. Total swings: 3200, cycle multiplier: 1100); Even hands (only "
                + "made where every inserter takes from a machine or a chest; inserter 5 takes from a belt); Shifted swings (no shifted round of swings passes the clock-only check).",
        });
    });

    it("is not said of a sample whose selected clock is stable", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240);
        const generated = generateClockAlternatives(config, { logger: quiet });
        expect(alwaysOnReasonProblemsOf(config, generated)).toEqual([]);
        expect(generated.alternatives[generated.selected_index].verdict).toBe("stable");
        expect(generated.why_not_stable).toBeNull();
    });
});
