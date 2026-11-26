import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { ConfigPaths } from "../config/config-paths";
import type { FactorioData } from "../data/factorio-data-types";
import { FactorioDataService, generateClockAlternatives, parseConfigFromJson } from "../index";

// Its own test file keeps the cold recipe-data reads independent of earlier generation in the process.
it("keeps the public default listing's reads of caller-initialized recipe data", async () => {
    const dataPath = path.resolve(__dirname, "../../resources/data-filtered.json");
    const [dataText, configText] = await Promise.all([readFile(dataPath, "utf8"), readFile(ConfigPaths.ELECTRIC_FURNACE_20, "utf8")]);
    const data: FactorioData = JSON.parse(dataText);
    const recipe = data.recipe["electric-furnace"];
    const original = Object.getOwnPropertyDescriptor(recipe, "energy_required")!;
    const energy_required = recipe.energy_required;
    expect(energy_required).toBe(5);
    let reads = 0;
    Object.defineProperty(recipe, "energy_required", {
        configurable: original.configurable, enumerable: original.enumerable,
        get() { reads++; return energy_required; },
    });
    try {
        FactorioDataService.initialize(data);
        const config = parseConfigFromJson(configText);
        const before = reads;
        generateClockAlternatives(config);
        // 2 reads each from the region finder, the copies conversion, the speed-as-capacity rule and the joined-groups notice
        expect(reads - before).toBe(8_754);
    } finally {
        Object.defineProperty(recipe, "energy_required", original);
    }
});
