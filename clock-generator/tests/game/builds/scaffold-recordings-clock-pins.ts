import {expect} from "vitest";
import {ClockAlternative} from "../../../src/crafting/generate-blueprint";
import {ConfigPaths} from "../../../src/config/config-paths";
import {clockHash, readControls} from "./clock-controls";

/** The clocks the values of the builds of scaffold-recordings.game.test.ts were seen on, by build name */
export const scaffoldClockPins = readControls<{cases: Record<string, {config: string; backed_up_belts: boolean; clock_sha256: string}>}>(
    "scaffold-recordings-clock-pins.json").cases;

/**
 * Checks that the clock a generation selected is the one the values of the scaffold-recordings build `name` were seen
 * on. A generation test that makes the build's clock anyway calls this on its own generation, instead of the build being
 * generated a second time in scaffold-recordings-clock.generation.test.ts. `build` is what that generation was made of,
 * checked against the pin: the config file, and whether the config says the belts are backed up.
 */
export function expectPinnedScaffoldClock(name: string, build: {config: string; backed_up_belts: boolean}, selected: ClockAlternative) {
    const pin = scaffoldClockPins[name];
    expect(pin, `${name} is not in scaffold-recordings-clock-pins.json`).toBeDefined();
    expect(build.config, `${name}: the pin is of another config`).toBe((ConfigPaths as Record<string, string>)[pin.config]);
    expect(build.backed_up_belts, `${name}: the pin is of another supply`).toBe(pin.backed_up_belts);
    expect(clockHash(selected.result.subtick ?? selected.result), "the selected clock is not the one this build's recorded values belong to")
        .toBe(pin.clock_sha256);
}
