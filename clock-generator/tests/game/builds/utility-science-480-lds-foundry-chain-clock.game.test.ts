import fs from "fs";
import {test} from "vitest";
import {capturePickupClockScenario} from "./pickup-clock-capture";
import {utilityScienceLdsFoundryChainClockScenario} from "./utility-science-480-lds-foundry-chain-clock-fixtures";

// A passing capture preserves the measured counts, including clock failures; it does not certify stability.
test("utility science 480 clock: generated-one-copy", async context => {
    const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
    context.skip(!process.env.BELT_CLOCK_REPLAY_DIR && process.env.BELT_CLOCK_GENERATION_ONLY !== "1"
        && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
    await capturePickupClockScenario(await utilityScienceLdsFoundryChainClockScenario());
}, 1_800_000);
