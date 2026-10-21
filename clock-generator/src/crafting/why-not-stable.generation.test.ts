import { describe, expect, it } from "vitest";
import { generateClockAlternatives } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { quiet } from "./generate-blueprint-test-helpers";
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
        const generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.REAL_STUPIDFATHOBBIT_CELL06), { logger: quiet });
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
        expect(generated.not_made.map(it => it.id)).toEqual(["even-hands", "uneven-output", "shifted-swings"]);
        expect(generated.why_not_stable).toEqual({
            cause: "nothing holds",
            message: "No clock holds the target rate of 240 a second. The closest, 2 output swings per cycle, moves 180 a second, 60 "
                + "under the target. Not made: Even hands (even hands are only made where every inserter takes from a machine or a "
                + "chest; inserter:1 does not); Uneven output swings (no moved output swing passes the clock-only check); Shifted "
                + "swings (no shifted round of swings passes the clock-only check).",
        });
    });

    it("is not said of a sample whose selected clock is stable", async () => {
        const generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE), { logger: quiet });
        expect(generated.alternatives[generated.selected_index].verdict).toBe("stable");
        expect(generated.why_not_stable).toBeNull();
    });
});
