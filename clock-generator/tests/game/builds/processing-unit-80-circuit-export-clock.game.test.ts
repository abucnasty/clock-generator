import fs from "fs";
import {test} from "vitest";
import {capturePickupClockScenario} from "./pickup-clock-capture";
import {PROCESSING_UNIT_80_CIRCUIT_EXPORT_CASES, processingUnitCircuitExportClockScenario} from "./processing-unit-80-circuit-export-clock-fixtures";

// A passing capture preserves the measured counts, including clock failures; it does not certify stability.
for (const variant of PROCESSING_UNIT_80_CIRCUIT_EXPORT_CASES) {
    test(`processing unit circuit export clock: ${variant.name}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!process.env.BELT_CLOCK_REPLAY_DIR && process.env.BELT_CLOCK_GENERATION_ONLY !== "1"
            && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
        await capturePickupClockScenario(await processingUnitCircuitExportClockScenario(variant));
    }, 1_800_000);
}
