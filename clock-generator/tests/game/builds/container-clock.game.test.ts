import fs from "fs";
import {test} from "vitest";
import {capturePickupClockScenario} from "./pickup-clock-capture";
import {containerClockCases, containerClockScenario} from "./container-clock-fixtures";

// One run each under the protocol (pickup-clock-capture.ts); each supply cut takes the container's stock of the item with it.
for (const variant of containerClockCases()) {
    test(`container clock: ${variant.name}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!process.env.BELT_CLOCK_REPLAY_DIR && process.env.BELT_CLOCK_GENERATION_ONLY !== "1"
            && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
        await capturePickupClockScenario(containerClockScenario(variant));
    }, 960_000);
}
