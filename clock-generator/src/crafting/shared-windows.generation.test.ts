import { describe, expect, test } from "vitest";
import { generateClockAlternatives } from "./generate-blueprint";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";

// Clocks of the grouped hands rule are also offered with the windows of the takers that open together made one, as an
// alternative of their own that ranking picks or leaves; every clock says how many deciders it has. The productivity chain
// is generated once, in productivity-module-80-chest-chain-clock.generation.test.ts, which asserts on it too.
const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };
const generate = async (sample: keyof typeof ConfigPaths) => generateClockAlternatives(await loadConfigFromFile(ConfigPaths[sample]), { logger: quiet });

/**
 * The crafting speeds the sample had before it took those of the build (2026-11-05: 66.0253, 57.8125 and 112.244). On the earlier
 * ones the separate windows of its takers lose the rate (no recovery) and the shared ones keep it; on the build's own the separate
 * ones are stable and are selected (the second test).
 */
const EARLIER_SPEEDS: Record<number, number> = { 1: 66.031247377396, 2: 62.437498569489, 3: 112.20000267029 };
const generateOnEarlierSpeeds = async () => {
    const config = await loadConfigFromFile(ConfigPaths.MILITARY_SCIENCE_120);
    return generateClockAlternatives({ ...config, machines: config.machines.map(machine => ({ ...machine, crafting_speed: EARLIER_SPEEDS[machine.id] })) }, { logger: quiet });
};

describe("military science: the shared windows keep the rate and recover where the separate ones do not", () => {
    test("on the speeds before the build's own the shared clock is selected with 4 deciders", async () => {
        const generated = await generateOnEarlierSpeeds();
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe("planned-belt-slack-shared");
        expect(selected.verdict).toBe("stable");
        expect(selected.deciders).toBe(4);
        const separate = generated.alternatives.find(it => it.id === "planned-belt-slack")!;
        expect(separate.verdict).toBe("no recovery");
    });

    test("on the build's own speeds the separate clock is stable and is selected", async () => {
        const generated = await generate("MILITARY_SCIENCE_120");
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe("planned-belt-slack");
        expect(selected.verdict).toBe("stable");
        expect(selected.assessment.wake_ups_per_minute).toBeLessThan(generated.alternatives.find(it => it.id === "planned-belt-slack-shared")!.assessment.wake_ups_per_minute!);
    });
});
