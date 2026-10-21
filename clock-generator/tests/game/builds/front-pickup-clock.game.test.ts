import fs from "fs";
import {test} from "vitest";
import {capturePickupClockScenario, pickupClockInterventions} from "./pickup-clock-capture";
import {frontClockScenario, frontEntranceClockCases, frontExitClockCases} from "./front-clock-fixtures";

// A passing capture preserves the measured counts, including clock failures; it does not certify stability.
const cases = [...frontEntranceClockCases("different-items"), ...frontEntranceClockCases("same-item"),
    ...frontExitClockCases(true), ...frontExitClockCases(false)];
for (const variant of cases) {
    test(`operating clock: ${variant.name}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!process.env.BELT_CLOCK_REPLAY_DIR && process.env.BELT_CLOCK_GENERATION_ONLY !== "1"
            && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
        const scenario = frontClockScenario(variant);
        if (process.env.BELT_CLOCK_TRACE_PICKUPS === "1") {
            scenario.probe.trace_periods = [62, ...pickupClockInterventions(scenario.outagePeriods).map(([, release]) => release + 6)];
            scenario.probe.trace_ticks = 64;
        }
        await capturePickupClockScenario(scenario);
    }, 960_000);
}
