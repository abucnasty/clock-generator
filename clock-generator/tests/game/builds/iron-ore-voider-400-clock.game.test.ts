import fs from "fs";
import {test} from "vitest";
import {assertHolds, captureOreVoider, oreVoiderCases} from "./iron-ore-voider-400-clock-fixtures";

// One run of the ore voider's recycler cell on its selected clock under the game tests' protocol: steady state, a baseline,
// the ore supply cut and the output blocked, each recovered from. About 16,000 ticks (steady state at about 3,800, the baseline
// 3,600, each disturbance about 300 to fall and 3,900 to recover), under the cap of 54,000
for (const variant of oreVoiderCases()) {
    test(`ore voider clock: ${variant.name}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        assertHolds(await captureOreVoider(variant));
    }, 960_000);
}
