import fs from "fs";
import {test} from "vitest";
import {capturePickupClockScenario} from "./pickup-clock-capture";
import {electromagneticDrainedEndClockCases, electromagneticDrainedEndClockScenario} from "./electromagnetic-science-330-drained-end-clock-fixtures";

// A passing capture preserves the measured counts, including clock failures; it does not certify stability.
for (const variant of electromagneticDrainedEndClockCases()) {
    test(`electromagnetic science drained end clock: ${variant.name}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!process.env.BELT_CLOCK_REPLAY_DIR && process.env.BELT_CLOCK_GENERATION_ONLY !== "1"
            && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
        await capturePickupClockScenario(await electromagneticDrainedEndClockScenario(variant));
    }, 1_800_000);
}
