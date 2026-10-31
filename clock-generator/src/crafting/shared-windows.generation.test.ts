import { beforeAll, describe, expect, test } from "vitest";
import { ClockAlternativesResult, generateClockAlternatives } from "./generate-blueprint";
import { windowDeciderCount } from "./inserter-counters";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";

// Clocks of the grouped hands rule are also offered with the windows of the takers that open together made one, as an
// alternative of their own that ranking picks or leaves; every clock says how many deciders it has.
const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };
const generate = async (sample: keyof typeof ConfigPaths) => generateClockAlternatives(await loadConfigFromFile(ConfigPaths[sample]), { logger: quiet });

describe("the productivity chain: the cheaper shared windows are selected, the separate ones are listed", () => {
    let generated: ClockAlternativesResult;
    beforeAll(async () => { generated = await generate("REAL_OWNER_PRODUCTIVITY_CHAIN"); });

    test("the shared clock is selected and the separate clock still has one decider for each of its 10 sets of windows", () => {
        // Cost ranks the grouped-hands plans as well as the final clocks: the separate clock now has 10 sets of
        // windows, while the cheaper shared clock has 6 deciders. The previous alternative is still offered and stable.
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.id).toBe("planned-belt-slack-shared");
        expect(selected.deciders).toBe(6);
        const previous = generated.alternatives.find(it => it.id === "planned-belt-slack")!;
        expect(previous.verdict).toBe("stable");
        expect(previous.deciders).toBe(10);
        expect(new Set(Object.values(previous.result.clock_windows).map(ranges => JSON.stringify(ranges))).size).toBe(10);
        // a decider of inserters that carry different items outputs them all
        const outputs = previous.result.blueprint.entities.flatMap(entity => {
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
        // Shared windows cost less despite more wake-ups, so compare with the still-made separate clock, not itself.
        const previous = generated.alternatives.find(it => it.id === "planned-belt-slack")!;
        expect(shared.assessment.wake_ups_per_minute!).toBeGreaterThan(previous.assessment.wake_ups_per_minute!);
        expect(shared.ranking.cost!.ns_per_tick).toBeLessThan(previous.ranking.cost!.ns_per_tick);
        expect(shared.description).toContain("share one wake window");
    });

    test("a decider of inserters that carry different items names them all, and each count where they move different numbers", () => {
        const descriptions = (id: string) => generated.alternatives.find(it => it.id === id)!.result.blueprint.entities
            .filter(entity => entity.name === "decider-combinator")
            .map(entity => (entity.player_description ?? "").split("\n").slice(0, 2));
        // Cost-priced grouped-hands plans change the separate windows; their descriptions must name the windows now made.
        // The same count for every inserter of a decider reads alike, whatever they carry.
        expect(descriptions("planned-belt-slack")).toContainEqual([
            "2 inserters [item=plastic-bar] [item=electronic-circuit] (6, 9)",
            "2.424 swings each in 1 window per 72-tick period: open 5–30",
        ]);
        expect(descriptions("planned-belt-slack")).toContainEqual([
            "2 inserters [item=advanced-circuit] [item=electronic-circuit] (8, 10)",
            "3.333 swings each in 1 window per 72-tick period: open 3–36",
        ]);
        expect(descriptions("planned-belt-slack-shared")).toContainEqual([
            "3 inserters [item=copper-cable] [item=plastic-bar] [item=electronic-circuit] (5, 6, 9)",
            "2.424 to 4.848 swings (inserters 6, 9: 2.424; inserter 5: 4.848) in 1 window per 72-tick period: open 5–46",
        ]);
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
