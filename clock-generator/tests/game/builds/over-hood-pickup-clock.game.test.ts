import fs from "fs";
import {test} from "vitest";
import {capturePickupClockScenario, pickupClockInterventions} from "./pickup-clock-capture";
import {overHoodClockCases, overHoodClockScenario} from "./over-hood-clock-fixtures";

// A passing capture preserves the measured counts, including clock failures; it does not certify stability.
for (const family of ["different-items", "same-item"] as const) for (const variant of overHoodClockCases(family)) {
    test(`operating clock: ${variant.name}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!process.env.BELT_CLOCK_REPLAY_DIR && process.env.BELT_CLOCK_GENERATION_ONLY !== "1"
            && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
        const scenario = overHoodClockScenario(variant);
        if (process.env.BELT_CLOCK_TRACE_PICKUPS === "1") {
            scenario.probe.trace_periods = [62, ...pickupClockInterventions(scenario.outagePeriods).map(([, release]) => release + 6)];
            scenario.probe.trace_ticks = 64;
        }
        await capturePickupClockScenario(scenario);
    }, 960_000);
}
