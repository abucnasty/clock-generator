import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { alwaysOnReasonProblemsOf, quiet } from "./generate-blueprint-test-helpers";
import { pickupClockConfig, pickupClockSpeedCases } from "../../tests/game/builds/pickup-clock-speed-coverage";

const BACKED_UP_ADVICE = " If the input belts back up at their pickups, answer Backed up for the belts and generate again: a clock may hold then.";

describe("why the selected clock does not meet goal 1, as a generation says it", () => {
    it("is the moving lane phases on the normal moving underground entrance, which holds in the game from its recorded start", async () => {
        const variant = pickupClockSpeedCases("electromagnetic").find(it => it.name === "electromagnetic-normal-underground-entrance-moving")!;
        const generated = generateClockAlternatives(await pickupClockConfig(variant), { logger: quiet });
        expect(generated.why_not_stable).toEqual({
            cause: "moving lane phases",
            message: "The selected clock (1 output swing per cycle) is made for a moving belt. It holds the target rate from the "
                + "modeled start, but not when the lanes reach inserter 2 in another phase: from such a start it moves 880 of 1056 "
                + "items over 6 periods. In the game a belt's lanes reach the pickups in whatever phase they happen to have, so the "
                + `build can fall short.${BACKED_UP_ADVICE}`,
        });
    });

    it("is no recovery for a sample that holds its target and is not taken away from for a while", async () => {
        const config = await loadConfigFromFile(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL06);
        const generated = generateClockAlternatives(config, { logger: quiet });
        expect(alwaysOnReasonProblemsOf(config, generated)).toEqual([]);
        expect(generated.why_not_stable).toEqual({
            cause: "no recovery",
            message: "The selected clock (Batched swings: 6 output swings per cycle, subtick clock) holds the target rate, but does not "
                + "get back to it by itself after steel-plate is not taken away. A buffer, or a faster machine, lets it catch up.",
        });
    });

    it("is nothing holds where the inserters' hands are too small for the target, with the clocks that could not be made", async () => {
        const sample = await loadConfigFromFile(ConfigPaths.SAMPLE_CONFIG);
        const config = { ...sample, inserters: sample.inserters.map(inserter => ({ ...inserter, stack_size: 2 })) };
        const generated = generateClockAlternatives(config, { logger: quiet });
        expect(alwaysOnReasonProblemsOf(config, generated)).toEqual([]);
        expect(generated.not_made.map(it => it.id)).toEqual(["even-hands", "uneven-output", "shifted-swings"]);
        expect(generated.why_not_stable).toEqual({
            cause: "nothing holds",
            message: "No clock holds the target rate of 240 a second. The closest, 2 output swings per cycle, moves 180 a second, 60 "
                + "under the target. Not made: Even hands (even hands are only made where every inserter takes from a machine or a "
                + "chest; inserter:1 does not); Uneven output swings (no moved output swing passes the clock-only check); Shifted "
                + "swings (no shifted round of swings passes the clock-only check).",
        });
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
                + "maximum allowed is 2 due to insertion limits. Total swings: 3200, cycle multiplier: 1100); Even hands (even hands are not "
                + "made for a build with inserters outside the plan); Shifted swings (no shifted round of swings passes the clock-only check).",
        });
    });

    it("is not said of a sample whose selected clock is stable", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        const generated = generateClockAlternatives(config, { logger: quiet });
        expect(alwaysOnReasonProblemsOf(config, generated)).toEqual([]);
        expect(generated.alternatives[generated.selected_index].verdict).toBe("stable");
        expect(generated.why_not_stable).toBeNull();
    });
});
