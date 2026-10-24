import { beforeAll, describe, expect, test } from "vitest";
import { ClockAlternativesResult, generateClockAlternatives } from "./generate-blueprint";
import { windowDeciderCount } from "./alternatives";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";

// Clocks of the grouped hands rule are also offered with the windows of the takers that open together made one, as an
// alternative of their own that ranking picks or leaves; every clock says how many deciders it has.
const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };
const generate = async (sample: keyof typeof ConfigPaths) => generateClockAlternatives(await loadConfigFromFile(ConfigPaths[sample]), { logger: quiet });

describe("the productivity chain: the separate windows are selected, the shared ones are listed", () => {
    let generated: ClockAlternativesResult;
    beforeAll(async () => { generated = await generate("REAL_OWNER_PRODUCTIVITY_CHAIN"); });

    test("the separate clock has 10 deciders, one for each set of windows whatever the inserters carry", () => {
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe("planned-belt-slack");
        expect(selected.deciders).toBe(10);
        expect(new Set(Object.values(selected.result.clock_windows).map(ranges => JSON.stringify(ranges))).size).toBe(10);
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

    test("every alternative counts the deciders of its blueprint", () => {
        for (const alternative of generated.alternatives) {
            expect(alternative.deciders, alternative.id).toBe(windowDeciderCount(alternative.result.blueprint));
        }
    });
});

describe("military science: the shared windows keep the rate and recover where the separate ones do not", () => {
    test("the shared clock is selected with 4 deciders", async () => {
        const generated = await generate("MILITARY_SCIENCE");
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe("planned-belt-slack-shared");
        expect(selected.verdict).toBe("stable");
        expect(selected.deciders).toBe(4);
        const separate = generated.alternatives.find(it => it.id === "planned-belt-slack")!;
        expect(separate.verdict).toBe("no recovery");
    });
});
