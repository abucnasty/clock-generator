import { describe, expect, test } from "vitest";
import { combineClockAlternativeRuns, generateClockAlternatives, COORDINATED_SOURCES_MAKER } from "./generate-blueprint";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";

// Clocks of the grouped hands rule are also offered with the windows of the takers that open together made one, as an
// alternative of their own that ranking picks or leaves; every clock says how many deciders it has. The productivity chain
// is generated once, as the record job config-PRODUCTIVITY_MODULE_80_CHEST_CHAIN, which has per-job checks on it too (tests/game/builds/job-checks/samples.ts).
const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

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
    test("on the speeds before the build's own the shared clock is selected with 4 deciders, the per-branch clock left aside", async () => {
        const generated = await generateOnEarlierSpeeds();
        // the per-branch clock, composed from these after them, is not what this test is about; of today's makers the shared clock is selected
        const made = generated.alternatives.filter(it => it.maker !== COORDINATED_SOURCES_MAKER);
        const selected = made[combineClockAlternativeRuns([{ signature: "", alternatives: made }], it => it.ranking).selected_index];
        expect(selected.id).toBe("round_robin_polling_shared");
        expect(selected.maker).toBe("planned-belt-slack-shared");
        expect(selected.verdict).toBe("stable");
        expect(selected.deciders).toBe(4);
        const separate = generated.alternatives.find(it => it.maker === "planned-belt-slack")!;
        expect(separate.verdict).toBe("no recovery");
        // the strategy says which rule made each: the Round-Robin Polling rule's windows, shared or not
        expect(selected.strategy).toMatchObject({ id: "round_robin_polling", tuning_method: "calculated", routing: { router: "direct" },
            settings: { output_count: { kind: "output_swings", count: selected.result.used_terminal_swing_count }, shared_windows: "shared_enable_windows" },
            output_swings: selected.result.used_terminal_swing_count });
        expect(separate.strategy).toMatchObject({ id: "round_robin_polling", tuning_method: "calculated" });
        expect(separate.strategy.settings.shared_windows).toBeUndefined();
        // signals a minute: one for each window of a decider, shared by the inserters on it, counted where the wake-ups are
        expect(selected.assessment.signals_per_minute).toBeGreaterThan(0);
    });

});
