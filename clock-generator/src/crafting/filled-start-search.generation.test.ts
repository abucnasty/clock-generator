import {expect, test} from "vitest";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import {clockHash, readControls} from "../../tests/game/builds/clock-controls";
import {searchPicks} from "../../tests/game/builds/filled-start-search-clock-fixtures";
import {SEARCH_CONTROLS_FILE} from "../../tests/game/builds/missing-recordings-clock-fixtures";
import {withSearchFromEveryStart} from "../../tests/game/helpers/search-switch";
import {generateClockAlternatives} from "./generate-blueprint";

// docs/clock-candidates.md, "Coordinated Sources": CLOCK_SEARCH_FROM_EVERY_START=1 starts the local choice of Coordinated Sources from every
// stable clock, not only from those that tie the recommended clock. Processing unit 80 (circuit export) is the build it was found on: the record's
// pick (5259f325, 3,311.25 wakeups a minute) is reached from the recommended clock alone, and the pick from every stable clock is 0bdd8324 (3,046.875).
// The picks the switch moves are recorded in the game (tests/game/builds/filled-start-search-clock-controls.json); each pin is the clock the
// switch makes.
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

async function selectedOfProcessingUnit80(on: boolean) {
    const config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNIT_80_CIRCUIT_EXPORT);
    const generated = withSearchFromEveryStart(on, () => generateClockAlternatives(config, {logger: quiet}));
    const selected = generated.alternatives[generated.selected_index];
    return {id: selected.id, hash: clockHash(selected.result.subtick ?? selected.result).slice(0, 8), verdict: selected.verdict};
}

test("processing unit 80: the switch off keeps the record's pick", async () => {
    expect(await selectedOfProcessingUnit80(false)).toEqual({id: "coordinated_sources", hash: "5259f325", verdict: "stable"});
});

test("processing unit 80: the switch on picks the clock that starting from every stable clock finds", async () => {
    expect(await selectedOfProcessingUnit80(true)).toEqual({id: "coordinated_sources", hash: "0bdd8324", verdict: "stable"});
});

// each pick recorded in the game is the clock the switch on makes: its entry's pin (the clock the game ran) is the generation's. The plain
// processing unit 80 job is the test above, which also finds its pin
const controls = readControls(SEARCH_CONTROLS_FILE).cases;
test("processing unit 80: the pin of the game recording is the pick the switch on makes", () => {
    expect(controls["processing-unit-80-from-every-start"].generation!.clock_sha256.slice(0, 8)).toBe("0bdd8324");
});

for (const pick of searchPicks().filter(it => it.name !== "processing-unit-80-from-every-start")) {
    test(`${pick.name}: the pin is the pick the switch on makes for ${pick.job}`, async () => {
        const entry = controls[pick.name];
        expect(entry, `${pick.name} has an entry in ${SEARCH_CONTROLS_FILE}`).toBeDefined();
        const loaded = await loadConfigFromFile(ConfigPaths[pick.config]);
        const config = pick.variant ? pick.variant(loaded) : loaded;
        const generated = withSearchFromEveryStart(true, () => generateClockAlternatives(config, {logger: quiet}));
        const selected = generated.alternatives[generated.selected_index];
        expect({id: selected.id, hash: clockHash(selected.result.subtick ?? selected.result), verdict: selected.verdict})
            .toEqual({id: entry.generation!.selection.id, hash: entry.generation!.clock_sha256, verdict: entry.generation!.verdict});
    });
}
