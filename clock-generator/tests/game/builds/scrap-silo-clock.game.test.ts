import fs from "fs";
import {test} from "vitest";
import {assertHolds, captureScrapSilo, scrapSiloCases} from "./scrap-silo-clock-fixtures";

// One run of the scrap silo on each of its clocks under the game tests' protocol: steady state, a baseline of one whole clock
// cycle (5,760 ticks on results in turn: the minute holds none), the scrap supply cut and the output blocked, each recovered from.
// Estimate for results in turn: steady state at about 3,600 to 3,900 (8 hands of 16 scrap in the minute), the baseline 5,760,
// each disturbance about 1,300 to fall (the minute holds 7 or 8 hands and the baseline's lowest is 7: two hands have to leave it)
// and 3,900 to recover (8 hands brought in again, one every 480 ticks), so about 3,900 + 5,760 + 2 x 5,200 = 20,100 ticks, under
// the cap of 54,000
for (const variant of scrapSiloCases()) {
    test(`scrap silo clock: ${variant.name}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!factorio || !save || !fs.existsSync(save), "Factorio harness is not configured");
        const summary = await captureScrapSilo(variant);
        if (!variant.explore) assertHolds(summary);
    }, 960_000);
}
