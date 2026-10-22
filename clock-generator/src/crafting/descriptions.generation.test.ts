import { describe, expect, it } from "vitest";
import { ConfigPaths, isExpectedRefusal } from "../config/config-paths";
import { loadConfigFromFile } from "../config/loader";
import { MAX_PLAYER_DESCRIPTION_BYTES, wasCut } from "../blueprints/components";
import { generateClockAlternatives } from "./generate-blueprint";
import { quiet } from "./generate-blueprint-test-helpers";

// Factorio keeps 500 bytes of a combinator's description and of a blueprint's (2.1.21), and fitPlayerDescription cuts
// what is over: no description the generator writes may need it, in any sample, any alternative or any blueprint (plain,
// modulo, subtick). Merged inserters that take more than one route get a line each, which is where a description would
// grow. Thaeln's cell 09 is left out
// as the blast leaves it out: out of scope, and about 1,000 s alone.
const SKIP = ["REAL_THAELN_CELL09"];
const samples = Object.entries(ConfigPaths).filter(([key]) => !isExpectedRefusal(key) && !SKIP.includes(key));

describe("combinator descriptions fit what Factorio keeps", () => {
    it.each(samples)("%s: no description is cut, in any alternative or blueprint", async (_key, file) => {
        const generated = generateClockAlternatives(await loadConfigFromFile(file), { logger: quiet });
        const cut: string[] = [];
        for (const alternative of generated.alternatives) {
            const result = alternative.result;
            for (const blueprint of [result.blueprint, result.modulo_blueprint, result.subtick?.blueprint]) {
                // the blueprint's own description is kept to 500 bytes as well
                const own = blueprint?.description ?? "";
                expect(new TextEncoder().encode(own).length).toBeLessThanOrEqual(MAX_PLAYER_DESCRIPTION_BYTES);
                if (wasCut(own)) {
                    cut.push(`${alternative.id} ${blueprint!.label}: the blueprint's description`);
                }
                for (const entity of blueprint?.entities ?? []) {
                    const description = entity.player_description ?? "";
                    expect(new TextEncoder().encode(description).length).toBeLessThanOrEqual(MAX_PLAYER_DESCRIPTION_BYTES);
                    if (wasCut(description)) {
                        cut.push(`${alternative.id} ${blueprint!.label}: ${description.split("\n")[0]}`);
                    }
                }
            }
        }
        expect(cut).toEqual([]);
    }, 1_800_000);
});
