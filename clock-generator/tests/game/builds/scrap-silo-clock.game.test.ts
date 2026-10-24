import fs from "fs";
import {test} from "vitest";
import {assertHolds, captureScrapSilo, scrapSiloCases} from "./scrap-silo-clock-fixtures";

// Four hours of the scrap silo on each of its clocks, then windows missed and the scrap cut
for (const variant of scrapSiloCases()) {
    test(`scrap silo clock: ${variant.name}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        const summary = await captureScrapSilo(variant);
        if (!variant.explore) assertHolds(summary);
    }, 3_600_000);
}
