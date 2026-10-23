import {expect, test} from "vitest";
import {generateClockAlternatives} from "./generate-blueprint";
import {loadConfigFromFile} from "../config/loader";
import {ConfigPaths} from "../config/config-paths";
import {clockHash, readControls} from "../../tests/game/builds/clock-controls";

// the clocks the values of three scaffold-recordings builds were seen on (scaffold-recordings.game.test.ts)
const pins = readControls<{cases: Record<string, {config: string; backed_up_belts: boolean; clock_sha256: string}>}>("scaffold-recordings-clock-pins.json").cases;
const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

for (const [name, pin] of Object.entries(pins)) {
    test(`scaffold recordings: ${name}`, async () => {
        const loaded = await loadConfigFromFile((ConfigPaths as Record<string, string>)[pin.config]);
        const config = pin.backed_up_belts ? {...loaded, overrides: {...loaded.overrides, backed_up_belts: true}} : loaded;
        const generated = generateClockAlternatives(config, {logger: quiet});
        const selected = generated.alternatives[generated.selected_index];
        expect(clockHash(selected.result.subtick ?? selected.result), "the selected clock is not the one this build's recorded values belong to")
            .toBe(pin.clock_sha256);
    });
}
