import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { deadlockRiskNote, describeSharedItem, sharedItemDeadlockRisks } from "./deadlock-risk";
import { generateClockAlternatives, type ClockAlternative } from "./generate-blueprint";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };
const risksOf = (config: Config) => sharedItemDeadlockRisks(createEntityRegistryFromConfig(structuredClone(config)));

// Utility science: inserter 1 brings flying robot frames and low density structures off one belt, inserter 2 low
// density structures and processing units off another, both into the one machine. Recorded in Factorio 2.1.21 on
// 2026-10-10 under uneven output swings with belts that do not move: the machine held 16 processing units and 16 low
// density structures and no frames, inserter 1 held 12 low density structures, and nothing moved in 53 periods.
describe("the deadlock risk of two inserters that bring the same item", () => {
    let utility_science: Config;

    beforeAll(async () => {
        utility_science = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE);
    });

    it("is a machine with an inserter that brings two items, where another inserter brings one of the same", () => {
        expect(risksOf(utility_science)).toEqual([{
            machine_id: 1,
            item: "low-density-structure",
            inserters: [
                { inserter_id: 1, other_items: ["flying-robot-frame"] },
                { inserter_id: 2, other_items: ["processing-unit"] },
            ],
        }]);
    });

    it("is read off the build without its filters too: what an inserter brings is what its belt has of what its machine takes", () => {
        const unfiltered: Config = { ...utility_science, inserters: utility_science.inserters.map(({ filters: _filters, ...inserter }) => inserter) as Config["inserters"] };
        expect(unfiltered.inserters.some(inserter => "filters" in inserter)).toBe(false);
        expect(risksOf(unfiltered)).toEqual(risksOf(utility_science));
    });

    it("says which two inserters share which item, and what else each brings", () => {
        const [risk] = risksOf(utility_science);
        expect(describeSharedItem(risk)).toBe(
            "Inserters 1 and 2 both bring low-density-structure to machine 1; inserter 1 also brings flying-robot-frame, inserter 2 processing-unit.");
        expect(deadlockRiskNote([risk])).toContain("Deadlock risk: Inserters 1 and 2 both bring low-density-structure to machine 1");
        expect(deadlockRiskNote([])).toBeNull();
    });

    it("is not there when the item is brought by one inserter only", () => {
        // the low density structures of inserter 2 taken out of its filters: only inserter 1 brings them
        const one_bringer: Config = { ...utility_science, inserters: utility_science.inserters.map(inserter =>
            inserter.id === 2 ? { ...inserter, filters: ["processing-unit"] } : inserter) as Config["inserters"] };
        expect(risksOf(one_bringer)).toEqual([]);
    });

    it("is not there when neither of two inserters that bring the same item brings anything else", () => {
        const only_shared: Config = { ...utility_science, inserters: utility_science.inserters.map(inserter =>
            inserter.id === 1 || inserter.id === 2 ? { ...inserter, filters: ["low-density-structure"] } : inserter) as Config["inserters"] };
        expect(risksOf(only_shared)).toEqual([]);
    });

    it("is on no other sample that generates", async () => {
        const with_risk: string[] = [];
        for (const [key, path] of Object.entries(ConfigPaths)) {
            try {
                if (risksOf(await loadConfigFromFile(path)).length > 0) {
                    with_risk.push(key);
                }
            } catch {
                // a sample that is not a whole config has no build to read
            }
        }
        expect(with_risk).toEqual(["UTILITY_SCIENCE"]);
    });
});

describe("the clocks of a build with a deadlock risk", () => {
    let alternatives: ClockAlternative[];
    let selected: ClockAlternative;

    beforeAll(async () => {
        const config = await loadConfigFromFile(ConfigPaths.UTILITY_SCIENCE);
        const generated = generateClockAlternatives(config, { logger: quiet });
        alternatives = generated.alternatives;
        selected = alternatives[generated.selected_index];
    }, 120_000);

    it("all name the risk, in an insight of the build", () => {
        for (const alternative of alternatives) {
            expect(alternative.deadlock_risks, alternative.id).toHaveLength(1);
            const insight = alternative.insights.find(it => it.id === "deadlock-risk");
            expect(insight?.scope, alternative.id).toBe("build");
            expect(insight?.what).toContain("Inserters 1 and 2 both bring low-density-structure to machine 1");
        }
    });

    it("are ranked by what they hold, not by whether they get back from a loss: the verdict is shown and does not decide", () => {
        for (const alternative of alternatives.filter(it => Number.isInteger(it.result.simulation_duration.ticks))) {
            expect(alternative.meets_target_rate, alternative.id).toBe(alternative.holds_expected_output);
        }
        const no_recovery = alternatives.filter(it => it.holds_expected_output && !it.is_stable);
        expect(no_recovery.length).toBeGreaterThan(0);
        expect(no_recovery.every(it => it.backpressure_loss?.survives === false)).toBe(true);
        expect(selected.id).toBe("planned-belt-slack");
    });
});

describe("the clocks of a build without a deadlock risk", () => {
    it("name none, and need to get back from every loss to meet the target rate", async () => {
        const config = await loadConfigFromFile(ConfigPaths.MILITARY_SCIENCE);
        const { alternatives } = generateClockAlternatives(config, { logger: quiet });
        for (const alternative of alternatives) {
            expect(alternative.deadlock_risks).toEqual([]);
            expect(alternative.insights.some(it => it.id === "deadlock-risk")).toBe(false);
            expect(alternative.meets_target_rate && !alternative.is_stable, alternative.id).toBe(false);
        }
    }, 120_000);
});
