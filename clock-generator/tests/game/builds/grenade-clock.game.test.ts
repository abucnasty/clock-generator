import fs from "fs";
import {test} from "vitest";
import {capturePickupClockScenario} from "./pickup-clock-capture";
import {grenadeClockCases, grenadeClockScenario} from "./grenade-clock-fixtures";

// A passing capture preserves the measured counts, including clock failures; it does not certify stability.
for (const variant of grenadeClockCases()) {
    test(`grenade clock: ${variant.name}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!process.env.BELT_CLOCK_REPLAY_DIR && process.env.BELT_CLOCK_GENERATION_ONLY !== "1"
            && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
        await capturePickupClockScenario(await grenadeClockScenario(variant));
    }, 1_800_000);
}
