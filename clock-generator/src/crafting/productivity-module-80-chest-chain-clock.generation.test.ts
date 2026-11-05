import { describe, it, expect, beforeAll, test } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { ConfigPaths } from "../config/config-paths";
import { generateClockAlternatives, type ClockAlternativesResult } from "./generate-blueprint";
import { windowDeciderCount } from "./alternatives";
import { alwaysOnReasonProblemsOf, quiet } from "./generate-blueprint-test-helpers";
import {readControls, RunControls, runHolds} from "../../tests/game/builds/clock-controls";
import { GENERATED_ALTERNATIVE } from "../../tests/game/builds/productivity-module-80-chest-chain-clock-fixtures";

// The productivity module chain (PRODUCTIVITY_MODULE_80_CHEST_CHAIN) at 80 modules a second over 6 copies: nine machines with chests
// between them, 1.3% of room in the whole chain. No clock observed from the plan holds. Windows made from the hands, rounded up where
// they are fractional, and from the order of the chain (src/crafting/candidates/grouped-hands.ts) hold in one cycle (72 ticks).
// Generated once for both describes of this file: it takes minutes, and the two used to generate it each in a file of their own.
let generation: Promise<{ config: Config; result: ClockAlternativesResult }> | undefined;
const generateProductivityChain = () => generation ??= (async () => {
    const config = await loadConfigFromFile(ConfigPaths.PRODUCTIVITY_MODULE_80_CHEST_CHAIN);
    return { config, result: generateClockAlternatives(config, { logger: quiet }) };
})();

describe("a clock for the productivity module chain from the hands and the order of the chain", () => {
    let config: Config;
    let result: ClockAlternativesResult;
    beforeAll(async () => {
        ({ config, result } = await generateProductivityChain());
    });

    it("names why every inserter and drill a clock leaves always on is", () => {
        expect(alwaysOnReasonProblemsOf(config, result)).toEqual([]);
    });

    it("selects a stable clock of one cycle at the target rate, and runs no search", () => {
        const selected = result.alternatives[result.selected_index];
        expect(selected.id).toBe(GENERATED_ALTERNATIVE);
        expect(selected.verdict).toBe("stable");
        expect(selected.result.simulation_duration.ticks).toBe(72);
        expect(selected.assessment.items_per_second).toBeCloseTo(80, 6);
        // 575.625 counting every waiting state; 508.125 with an arm swinging back from its drop on no list; the kept lists count 666.25
        expect(selected.assessment.wake_ups_per_minute).toBeCloseTo(666.25, 2);
        expect(selected.assessment.backpressure_loss?.survives).toBe(true);
        expect(selected.assessment.backpressure_loss?.recovered_after_periods).toBe(7);
        expect(result.skipped_searches.length).toBeGreaterThan(0);
        expect(result.why_not_stable).toBeNull();
    });

    it("the game's run of the recorded clock holds the target and recovers", () => {
        // the pin of the clock (hash, period, selection) is checked against the record (clock-controls.test.ts)
        const { native } = readControls<RunControls>("productivity-module-80-chest-chain-clock-controls.json").cases["generated-one-copy"];
        // the game holds the target over the baseline and is back at it after each loss
        expect(runHolds(native), native.result).toBe(true);
    });
});

// Clocks of the grouped hands rule are also offered with the windows of the takers that open together made one, as an
// alternative of their own that ranking picks or leaves; every clock says how many deciders it has.
describe("the productivity chain: the separate windows are selected, the shared ones are listed", () => {
    let generated: ClockAlternativesResult;
    beforeAll(async () => { generated = (await generateProductivityChain()).result; });

    test("the separate clock has 12 deciders, one for each set of windows whatever the inserters carry", () => {
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe("planned-belt-slack");
        expect(selected.deciders).toBe(12);
        expect(new Set(Object.values(selected.result.clock_windows).map(ranges => JSON.stringify(ranges))).size).toBe(12);
        // a decider of inserters that carry different items outputs them all
        const outputs = selected.result.blueprint.entities.flatMap(entity => {
            const conditions = (entity as { control_behavior?: { decider_conditions?: { outputs?: unknown[] } } }).control_behavior?.decider_conditions;
            return entity.name === "decider-combinator" && conditions?.outputs && conditions.outputs.length > 1 ? [conditions.outputs.length] : [];
        });
        expect(outputs.length).toBeGreaterThan(0);
    });

    test("the shared clock has 6 deciders, is stable, wakes inserters more, and is listed beside the separate one", () => {
        const shared = generated.alternatives.find(it => it.id === "planned-belt-slack-shared")!;
        expect(shared.label).toBe("Batched swings, shared windows: 1 output swing per cycle");
        expect(shared.verdict).toBe("stable");
        expect(shared.deciders).toBe(6);
        expect(shared.result.grouped_hands).toEqual({ shared_windows: true });
        const selected = generated.alternatives[generated.selected_index];
        expect(shared.assessment.wake_ups_per_minute!).toBeGreaterThan(selected.assessment.wake_ups_per_minute!);
        expect(shared.description).toContain("share one wake window");
    });

    test("a decider of inserters that carry different items names them all, and each count where they move different numbers", () => {
        const descriptions = (id: string) => generated.alternatives.find(it => it.id === id)!.result.blueprint.entities
            .filter(entity => entity.name === "decider-combinator")
            .map(entity => (entity.player_description ?? "").split("\n").slice(0, 2));
        // the same count for every inserter of a decider reads as it did, whatever they carry
        expect(descriptions("planned-belt-slack")).toContainEqual([
            "2 inserters [item=plastic-bar] [item=electronic-circuit] (6, 9)",
            "2.424 swings each in 1 window per 72-tick period: open 35–60",
        ]);
        expect(descriptions("planned-belt-slack")).toContainEqual([
            "2 inserters [item=advanced-circuit] [item=electronic-circuit] (8, 10)",
            "3.333 swings each in 1 window per 72-tick period: open 3–28",
        ]);
        expect(descriptions("planned-belt-slack-shared")).toContainEqual([
            "3 inserters [item=copper-cable] [item=plastic-bar] [item=electronic-circuit] (5, 6, 9)",
            "2.424 to 4.848 swings (inserters 6, 9: 2.424; inserter 5: 4.848) in 2 windows per 72-tick period: open 1–4, 35–72",
        ]);
    });

    test("every alternative counts the deciders of its blueprint", () => {
        for (const alternative of generated.alternatives) {
            expect(alternative.deciders, alternative.id).toBe(windowDeciderCount(alternative.result.blueprint));
        }
    });
});
