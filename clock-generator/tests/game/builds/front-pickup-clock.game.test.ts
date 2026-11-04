import fs from "fs";
import {test} from "vitest";
import {capturePickupClockScenario} from "./pickup-clock-capture";
import {frontClockScenario, frontEntranceClockCases, frontExitClockCases} from "./front-clock-fixtures";

// One run each under the protocol (pickup-clock-capture.ts); a passing capture preserves what the game did, including a failure.
const cases = [...frontEntranceClockCases("different-items"), ...frontEntranceClockCases("same-item"),
    ...frontExitClockCases(true), ...frontExitClockCases(false)];
for (const variant of cases) {
    test(`operating clock: ${variant.name}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!process.env.BELT_CLOCK_REPLAY_DIR && process.env.BELT_CLOCK_GENERATION_ONLY !== "1"
            && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
        const scenario = frontClockScenario(variant);
        if (process.env.BELT_CLOCK_TRACE_PICKUPS === "1") {
            // 64 ticks of pickups, machine inventory and output after each release
            scenario.probe.trace_ticks = 64;
        }
        await capturePickupClockScenario(scenario);
    }, 960_000);
}
