import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadConfigFromFile } from "../config/loader";
import { generateClockWithSwingBackoff } from "./generate-clock";

// The agricultural science sample with its egg biochambers at speed 80 and the feeders' hands at 8. In a planned clock of
// 5 output swings (480 ticks), a ghost wakeup comes after every window of inserters 1 and 2, which take bioflux and
// nutrients off the belt. Shaped, neither would keep a window. An inserter with no window is not under the clock and runs
// all the time, so the router cannot make the clock from those windows.
const CONFIG = path.join(__dirname, "fixtures", "agricultural-science-250-egg-biochambers-at-80.json");

describe("ghost-wakeup shaping on a build where it would leave an inserter no window", async () => {
    const config = await loadConfigFromFile(CONFIG);
    const messages: string[] = [];
    const logger = { log: (m: string) => messages.push(m), info() { }, warn() { }, error() { }, debug() { } };
    const result = generateClockWithSwingBackoff({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, { verify_as_built: true, logger: logger as never });

    it("leaves every window of inserters 1 and 2 as planned", () => {
        expect(messages.some(it => it.includes("inserter:1: shaping would leave it no enable window"))).toBe(true);
        expect(messages.some(it => it.includes("inserter:2: shaping would leave it no enable window"))).toBe(true);
        const shaped = (result.ghost_wakeup_windows ?? []).map(it => it.inserter_id);
        expect(shaped).not.toContain("inserter:1");
        expect(shaped).not.toContain("inserter:2");
    });

    it("gives every inserter that swings an enable window", () => {
        for (const id of ["inserter:1", "inserter:2"]) {
            expect(result.clock_windows[id]?.length ?? 0, id).toBeGreaterThan(0);
        }
    });
});
