import fs from "fs";
import {test} from "vitest";
import {capturePickupClockScenario} from "./pickup-clock-capture";
import {carCases, carScenario} from "./car-clock-fixtures";
import {readControls, RunControls} from "./clock-controls";
import {expectRunAgreesWithSelection} from "../helpers/fixture-mechanics";

// A passing capture preserves the measured counts, including clock failures; it does not certify stability.
for (const variant of carCases()) {
    test(`car clock: ${variant.name}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!process.env.BELT_CLOCK_REPLAY_DIR && process.env.BELT_CLOCK_GENERATION_ONLY !== "1"
            && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
        await capturePickupClockScenario(await carScenario(variant));
        // the run equals its controls entry (compared in the capture): what it says of the selection, but a known difference
        if (process.env.BELT_CLOCK_CALIBRATE === "1" || process.env.BELT_CLOCK_GENERATION_ONLY === "1" || process.env.BELT_CLOCK_EXPECTATIONS) return;
        const {native, generation, known_differences} = readControls<RunControls>("car-clock-controls.json").cases[variant.name];
        expectRunAgreesWithSelection(variant.name, native, {verdict: generation!.verdict, holds: generation!.selection.holds}, true, known_differences);
    }, 960_000);
}
