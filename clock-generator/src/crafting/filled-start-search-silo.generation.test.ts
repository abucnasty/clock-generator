import {expect, test} from "vitest";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import {clockHash, readControls} from "../../tests/game/builds/clock-controls";
import {SEARCH_CONTROLS_FILE} from "../../tests/game/builds/missing-recordings-clock-fixtures";
import {withSearchFromEveryStart} from "../../tests/game/helpers/search-switch";
import {generateClockAlternatives} from "./generate-blueprint";

// The lithium plate (silo chest) pick of the search from every stable clock, in a file of its own: the generation takes minutes (205 s with the
// switch on on the host of 2026-11-18). The rest of the picks are in filled-start-search.generation.test.ts.
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

test("lithium-silo-from-every-start: the pin is the pick the switch on makes for config-LITHIUM_PLATE_80_SILO_CHEST", async () => {
    const entry = readControls(SEARCH_CONTROLS_FILE).cases["lithium-silo-from-every-start"];
    expect(entry, `lithium-silo-from-every-start has an entry in ${SEARCH_CONTROLS_FILE}`).toBeDefined();
    const config = await loadConfigFromFile(ConfigPaths.LITHIUM_PLATE_80_SILO_CHEST);
    const generated = withSearchFromEveryStart(true, () => generateClockAlternatives(config, {logger: quiet}));
    const selected = generated.alternatives[generated.selected_index];
    expect({id: selected.id, hash: clockHash(selected.result.subtick ?? selected.result), verdict: selected.verdict})
        .toEqual({id: entry.generation!.selection.id, hash: entry.generation!.clock_sha256, verdict: entry.generation!.verdict});
}, 900_000);
