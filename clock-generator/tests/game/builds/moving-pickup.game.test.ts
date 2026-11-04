import fs from "fs";
import {test} from "vitest";
import {capturePickupClockSpeed, pickupClockSpeedCases} from "./pickup-clock-speed-coverage";

// The different-items pickup fixture on its generated clock, one run each under the protocol (pickup-clock-capture.ts): the
// turbo straight belt, underground entrance and exit, moving and backed up.
for (const variant of pickupClockSpeedCases("electromagnetic")) test(`speed coverage: ${variant.name}`, async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!process.env.BELT_CLOCK_REPLAY_DIR && process.env.BELT_CLOCK_GENERATION_ONLY !== "1" && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
    await capturePickupClockSpeed(variant);
}, 960_000);
