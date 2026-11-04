import fs from "fs";
import {test} from "vitest";
import {capturePickupClockScenario} from "./pickup-clock-capture";
import {thaelnCell09ClockScenario} from "./thaeln-cell09-clock-fixtures";

// A passing capture preserves the measured counts, including clock failures; it does not certify stability.
test("Thaeln's cell 09 clock: generated-one-copy", async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!process.env.BELT_CLOCK_REPLAY_DIR && process.env.BELT_CLOCK_GENERATION_ONLY !== "1"
        && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
    await capturePickupClockScenario(await thaelnCell09ClockScenario());
}, 1_800_000);
