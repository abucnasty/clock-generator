import fs from "fs";
import {test} from "vitest";
import {capturePickupClockScenario} from "./pickup-clock-capture";
import {SEARCH_FAMILY_CASES, searchScenarioOf} from "./filled-start-search-clock-fixtures";

// The picks of the search from every stable clock (CLOCK_SEARCH_FROM_EVERY_START=1) under the builds' own probes, from ruling 60's start. A passing
// capture preserves the measured counts, including clock failures; it does not certify stability. The generic protocol's cases are in
// missing-recordings-clock.game.test.ts (`from_every_start`).
for (const item of SEARCH_FAMILY_CASES) {
    test(`from every stable clock: ${item.name}`, async context => {
        const factorio = process.env.FACTORIO_PATH, save = process.env.FACTORIO_HARNESS_SAVE;
        context.skip(!process.env.BELT_CLOCK_REPLAY_DIR && process.env.BELT_CLOCK_GENERATION_ONLY !== "1"
            && (!factorio || !save || !fs.existsSync(save)), "Factorio harness is not configured");
        await capturePickupClockScenario(await searchScenarioOf(item));
    }, 3_600_000);
}
