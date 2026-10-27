import { beforeAll, describe, expect, it } from "vitest";
import { generateClockAlternatives, type ClockAlternative } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { Config } from "../config";
import { OpenRange } from "../data-types";
import { EntityId } from "../entities";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { deciderBuildOrder } from "./decider-order";
import { alwaysOnReasonProblemsOf } from "./generate-blueprint-test-helpers";

/**
 * The order the check of a clock gives its deciders (`deciderBuildOrder`, from the windows and the inserters' filters)
 * is the order the exported blueprint builds them in, on samples where inserters with the same windows share a decider
 * and on those with fuel clocks of their own: of two inserters, the one whose decider has the higher entity number
 * stands later. It decides which of two windows that open together the game updates first (#268). Checked on
 * every alternative of every sample in the roadmap's blast radius (2026-10-20); these are cheap ones that have both.
 */
const SAMPLES = ["LITHIUM_PLATES", "ACCUMULATOR_640", "IRON_BACTERIA_CULTIVATION", "CHEMICAL_SCIENCE_SHARED_FOUNDRY", "GLEBA_ROCKET_FUEL_JELLY_STACK_15"] as const;

describe("the decider build order of a clock's check", () => {
    for (const sample of SAMPLES) {
        describe(sample, () => {
            let config: Config;
            let alternatives: ClockAlternative[];

            beforeAll(async () => {
                const loaded = await loadConfigFromFile(ConfigPaths[sample]);
                config = { ...loaded, overrides: { ...loaded.overrides, backed_up_belts: true } };
                ({ alternatives } = generateClockAlternatives(config));
            });

            it("names why every inserter and drill a clock leaves always on is", () => {
                expect(alwaysOnReasonProblemsOf(config, { alternatives })).toEqual([]);
            });

            it("is the order the exported blueprint builds them in", () => {
                const registry = createEntityRegistryFromConfig(config);
                let shared = 0;
                for (const alternative of alternatives) {
                    const windows = new Map(Object.entries(alternative.result.clock_windows).map(([key, ranges]) =>
                        [key, ranges.map(range => OpenRange.from(range.start, range.end))] as const));
                    const derived = deciderBuildOrder(windows, registry);
                    const built = new Map<string, number>();
                    for (const decider of alternative.result.schedule.inserter_combinators) {
                        shared += decider.inserter_ids.length > 1 ? 1 : 0;
                        decider.inserter_ids.forEach(id => built.set(EntityId.forInserter(id).id, decider.entity_number));
                    }
                    const window_deciders = Array.from(derived.keys()).filter(key => built.has(key));
                    for (const a of window_deciders) {
                        for (const b of window_deciders) {
                            expect(Math.sign(derived.get(a)! - derived.get(b)!), `${alternative.id}: ${a} against ${b}`)
                                .toBe(Math.sign(built.get(a)! - built.get(b)!));
                        }
                    }
                    // a fuel inserter on a clock of its own has no window of the period: its decider comes after them all
                    const last_window_decider = Math.max(...window_deciders.map(key => built.get(key)!));
                    for (const [key, number] of built) {
                        if (!derived.has(key)) {
                            expect(number, `${alternative.id}: ${key}`).toBeGreaterThan(last_window_decider);
                        }
                    }
                }
                expect(shared).toBeGreaterThan(0);
            });
        });
    }
});
