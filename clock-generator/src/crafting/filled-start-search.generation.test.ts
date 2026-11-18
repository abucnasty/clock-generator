import {afterEach, expect, test} from "vitest";
import {ConfigPaths} from "../config/config-paths";
import {loadConfigFromFile} from "../config/loader";
import {clockHash} from "../../tests/game/builds/clock-controls";
import {generateClockAlternatives} from "./generate-blueprint";
import {SEARCH_FROM_EVERY_START_VARIABLE} from "./candidates/coordinated-sources";

// docs/clock-candidates.md, "Coordinated Sources": CLOCK_SEARCH_FROM_EVERY_START=1 starts the local choice of Coordinated Sources from every
// stable clock, not only from those that tie the recommended clock. Processing unit 80 (circuit export) is the build it was found on: the record's
// pick (5259f325, 3,311.25 wakeups a minute) is reached from the recommended clock alone, and the pick from every stable clock is 0bdd8324 (3,046.875).
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

const before = process.env[SEARCH_FROM_EVERY_START_VARIABLE];
afterEach(() => {
    if (before === undefined) delete process.env[SEARCH_FROM_EVERY_START_VARIABLE];
    else process.env[SEARCH_FROM_EVERY_START_VARIABLE] = before;
});

async function selectedOfProcessingUnit80() {
    const config = await loadConfigFromFile(ConfigPaths.PROCESSING_UNIT_80_CIRCUIT_EXPORT);
    const generated = generateClockAlternatives(config, {logger: quiet});
    const selected = generated.alternatives[generated.selected_index];
    return {id: selected.id, hash: clockHash(selected.result.subtick ?? selected.result).slice(0, 8), verdict: selected.verdict};
}

test("processing unit 80: the switch off keeps the record's pick", async () => {
    delete process.env[SEARCH_FROM_EVERY_START_VARIABLE];
    expect(await selectedOfProcessingUnit80()).toEqual({id: "coordinated_sources", hash: "5259f325", verdict: "stable"});
});

test("processing unit 80: the switch on picks the clock that starting from every stable clock finds", async () => {
    process.env[SEARCH_FROM_EVERY_START_VARIABLE] = "1";
    expect(await selectedOfProcessingUnit80()).toEqual({id: "coordinated_sources", hash: "0bdd8324", verdict: "stable"});
});

test("processing unit 80: any other value leaves the switch off", async () => {
    process.env[SEARCH_FROM_EVERY_START_VARIABLE] = "0";
    expect((await selectedOfProcessingUnit80()).hash).toBe("5259f325");
});
