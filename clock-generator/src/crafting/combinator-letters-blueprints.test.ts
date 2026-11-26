import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import type { FactorioBlueprint } from "../blueprints/blueprint";
import { combinatorKey, combinatorLetters } from "./combinator-letters";
import { generateClockForConfig, type BlueprintGenerationResult } from "./generate-blueprint";
import { quiet } from "./generate-blueprint-test-helpers";

type Entity = FactorioBlueprint["entities"][number];

/** The first line of a combinator that switches inserters or drills on, by the entities it names: "inserter:1,5" */
function enablingLines(blueprint: FactorioBlueprint): Map<string, string> {
    const lines = new Map<string, string>();
    for (const entity of blueprint.entities as Entity[]) {
        const tags = entity.tags?.clock_generator;
        for (const [kind, ids] of [["inserter", tags?.inserters], ["drill", tags?.drills]] as const) {
            if (ids !== undefined && ids.length > 0) {
                lines.set(combinatorKey(kind, ids), (entity.player_description ?? "").split("\n")[0]);
            }
        }
    }
    return lines;
}

/** The letter the first line ends in, "(E)" or "(AA)", or null when it ends in none */
const letterOf = (line: string): string | null => /^.* \(([A-Z]+)\)$/.exec(line)?.[1] ?? null;

const blueprintsOf = (result: BlueprintGenerationResult) => [
    ["plain", result.blueprint],
    ["modulo", result.modulo_blueprint],
    ["subtick", result.subtick?.blueprint],
].flatMap(([name, blueprint]) => blueprint === undefined ? [] : [[name as string, blueprint as FactorioBlueprint] as const]);

const samples = [
    "AUTOMATION_SCIENCE_240", "ROCKET_FUEL_60", "IRON_BACTERIA_380_CULTIVATION", "PRODUCTIVITY_MODULE_80_CHEST_CHAIN", "GRENADE_240_FILLS_BELT_EXACTLY",
] as const;

describe("the letter at the end of the first line of every combinator that switches inserters or drills on", () => {
    const seen = new Set<string>();
    it.each(samples)("%s: each combinator's letter is the one the rule gives its group, the same in every blueprint of the clock", async name => {
        const result = generateClockForConfig(await loadConfigFromFile(ConfigPaths[name]), { logger: quiet });
        const blueprints = blueprintsOf(result);
        for (const [kind] of blueprints) seen.add(kind);
        expect(blueprints.length).toBeGreaterThan(0);
        const inLetters = new Map<string, string>();
        for (const [kind, blueprint] of blueprints) {
            const lines = enablingLines(blueprint);
            expect(lines.size, `${name} ${kind}`).toBeGreaterThan(0);
            // the groups the schedule names, and the drills' groups from the tags: the rule's own input
            const groups = {
                inserters: [...lines.keys()].filter(key => key.startsWith("inserter:")).map(key => key.slice(9).split(",").map(Number)),
                drills: [...lines.keys()].filter(key => key.startsWith("drill:")).map(key => key.slice(6).split(",").map(Number)),
            };
            const expected = combinatorLetters(groups);
            // no combinator is in both an inserter group and a drill group, and each inserter is in one group only
            const inserters = groups.inserters.flat();
            expect(new Set(inserters).size, `${name} ${kind}: an inserter in two groups`).toBe(inserters.length);
            for (const [key, line] of lines) {
                expect(letterOf(line), `${name} ${kind} ${key}: ${line}`).toBe(expected.get(key)!.letter);
                if (inLetters.has(key)) expect(inLetters.get(key), `${name} ${key}`).toBe(expected.get(key)!.letter);
                inLetters.set(key, expected.get(key)!.letter);
            }
            // the schedule's rows are the inserter groups
            expect(result.schedule.inserter_combinators.map(it => combinatorKey("inserter", it.inserter_ids)).sort())
                .toEqual(groups.inserters.map(ids => combinatorKey("inserter", ids)).sort());
            // a combinator that is part of the clock, or switches nothing on, has no letter
            for (const entity of blueprint.entities as Entity[]) {
                if (entity.tags?.clock_generator?.inserters === undefined && entity.tags?.clock_generator?.drills === undefined) {
                    expect(letterOf((entity.player_description ?? "").split("\n")[0]), `${name} ${kind}: ${entity.player_description}`).toBeNull();
                }
            }
        }
    }, 120_000);

    it("was checked on a plain, a modulo and a subtick blueprint", () => {
        expect([...seen].sort()).toEqual(["modulo", "plain", "subtick"]);
    });
});
