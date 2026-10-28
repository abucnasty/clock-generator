import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { parseConfig } from "../../config/loader";
import { Config } from "../../config/schema";
import { buildTraits } from "./build-traits";
import { TRAIT_BASIS } from "./trait-basis";

/** The paths of the figures a trait holds, as TraitFieldPath spells them: no path for a null, nothing for an empty list */
function figurePaths(value: unknown, path: string, paths: Set<string>): void {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
        if (value.length === 0) return;
        if (value.every(element => typeof element !== "object")) {
            paths.add(path);
            return;
        }
        value.forEach(element => figurePaths(element, path, paths));
        return;
    }
    if (typeof value === "object") {
        const keys = Object.keys(value);
        // a ratio is one figure
        if (keys.length === 2 && keys.includes("numerator") && keys.includes("denominator")) {
            paths.add(path);
            return;
        }
        for (const [key, field] of Object.entries(value)) figurePaths(field, `${path}.${key}`, paths);
        return;
    }
    paths.add(path);
}

describe("TRAIT_BASIS", () => {
    // The compiler holds TRAIT_BASIS to the trait types (Record<TraitFieldPath, Basis>): a field without a row, or a row
    // without a field, does not build. This holds the types to what the builder makes.
    it("has a row for every figure the traits of the samples hold, and every row is a figure one of them holds", async () => {
        const paths = new Set<string>();
        for (const file of Object.values(ConfigPaths)) {
            const traits = buildTraits(await parseConfig(fs.readFileSync(file, "utf8")) as Config);
            for (const node of Object.values(traits)) {
                for (const [trait, value] of Object.entries(node)) {
                    if (trait !== "kind" && trait !== "entity") figurePaths(value, trait, paths);
                }
            }
        }
        expect([...paths].filter(path => !(path in TRAIT_BASIS)), "figures without a row").toEqual([]);
        expect(Object.keys(TRAIT_BASIS).filter(path => !paths.has(path)), "rows no sample holds").toEqual([]);
    });

    // the mechanics audit is kept outside the repository: its ids are checked for their form only
    it("cites rules of the game that exist, and audit items in the audit's form", () => {
        const rules = fs.readFileSync(path.resolve(__dirname, "../../rules-of-the-game.ts"), "utf8");
        const numbered = new Set(Array.from(rules.matchAll(/^ \* (\d+)\. /gm), match => Number(match[1])));
        for (const [field, basis] of Object.entries(TRAIT_BASIS)) {
            for (const rule of basis.rule?.split(", ") ?? []) {
                expect(rule, field).toMatch(/^R\d+$/);
                expect(numbered.has(Number(rule.slice(1))), `${field} ${rule}`).toBe(true);
            }
            for (const audit of basis.audit?.split(", ") ?? []) {
                // the mechanics audit of 0.25.0 has 27 items
                expect(audit, field).toMatch(/^A([1-9]|1\d|2[0-7])$/);
            }
        }
    });

    // P3 2.2: a floor whose standing is below measured is null where it is not known to hold
    it("stands every timing floor on measured mechanics", () => {
        const floors = Object.entries(TRAIT_BASIS).filter(([path]) => path.startsWith("timing.by_item.floor."));
        expect(floors.map(([path]) => path)).toEqual(["timing.by_item.floor.pickup", "timing.by_item.floor.drop", "timing.by_item.floor.cycle"]);
        expect(floors.map(([, basis]) => basis.standing)).toEqual(["measured", "measured", "measured"]);
    });
});
