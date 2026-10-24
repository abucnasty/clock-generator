import fs from "fs";
import {test} from "vitest";
import {assertHolds, captureOreVoider, oreVoiderCases} from "./ore-voider-clock-fixtures";

// An hour of the ore voider's recycler cell on its selected clock, with a loss of the ore and a backlog in its car after it
for (const variant of oreVoiderCases()) {
    test(`ore voider clock: ${variant.name}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        assertHolds(await captureOreVoider(variant));
    }, 3_600_000);
}
