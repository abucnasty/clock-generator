import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { Config } from "../../config/schema";
import { Entity } from "../../entities";
import { sharedHandRefusal } from "../result-windows";
import { createEntityRegistryFromConfig } from "../sequence/simulation-context";
import { feasibilityOfConfig } from "./feasibility-test-helpers";

/**
 * S2, a shared hand at a placer's target, on the scrap silo: recycler 1 places its results into rocket silo 14, and
 * each of inserters 1-12 takes one of them out. An inserter that waits for a full hand there and takes two of them holds
 * part of a hand of one and waits for it while the other fills the silo (recorded in 2.1.21).
 */
describe("S2: an inserter that takes two of a placer's results out of its target stops the build for good", async () => {
    const sample = await loadConfigFromFile(ConfigPaths.RECYCLING_SCRAP_SILO) as Config;
    const shared = (): Config => {
        const config = structuredClone(sample);
        config.inserters = config.inserters.map(it => it.id === 10 ? { ...it, filters: ["processing-unit", "low-density-structure"] } : it);
        return config;
    };

    it("one inserter a result: it passes", () => {
        expect(feasibilityOfConfig(sample).issues).toEqual([]);
    });

    it("inserter 10 takes processing units and low density structure out of the silo: refused", () => {
        const { rules, issues, texts } = feasibilityOfConfig(shared());
        expect(rules).toEqual(["S2"]);
        expect(issues[0]).toMatchObject({ nodes: ["machine:1", "chest:14"], edges: ["inserter:10/processing-unit", "inserter:10/low-density-structure"] });
        expect(texts[0]).toMatchInlineSnapshot(`"Inserter 10 takes processing unit and low density structure out of chest 14. An inserter that holds part of a hand of one of them takes only more of that one, so the others pile up in chest 14, and once it is full the one it waits for cannot come in: the build stops for good. Give each result an inserter of its own. An inserter whose filters the clock sets by signal would not wait; such a clock is not planned yet."`);
    });

    it("the same condition and text as sharedHandRefusal, which refuses it during planning", () => {
        const registry = createEntityRegistryFromConfig(shared());
        const machine = registry.getAll().filter(Entity.isMachine)[0];
        expect(feasibilityOfConfig(shared()).texts).toEqual([sharedHandRefusal(machine, registry)]);
        const original = createEntityRegistryFromConfig(sample);
        expect(sharedHandRefusal(original.getAll().filter(Entity.isMachine)[0], original)).toBeNull();
    });
});
