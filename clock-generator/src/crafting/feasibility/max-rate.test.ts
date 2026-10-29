import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths, ExpectedRefusals } from "../../config/config-paths";
import { FeasibilityError } from "../../config/errors";
import { loadConfigFromFile } from "../../config/loader";
import type { Config } from "../../config/schema";
import { ConfigSchema } from "../../config/schema";
import { assertFeasible } from "./assert-feasible";
import { targetRateMaxOf } from "./max-rate";

const withRate = (config: Config, items_per_second: number): Config =>
    ConfigSchema.parse({ ...config, target_output: { ...config.target_output, items_per_second } });

/** Whether the feasibility pass refuses the config */
function refused(config: Config): boolean {
    try {
        assertFeasible(config);
        return false;
    } catch (error) {
        if (error instanceof FeasibilityError) return true;
        throw error;
    }
}

/** The most one copy's target can be, over all copies, rounded down to the thousandth as a player types it */
const typedMax = (config: Config, max: number): number => Math.floor(max * config.target_output.copies * 1000) / 1000;

describe("the most a target can be agrees with the feasibility pass over the samples", () => {
    const samples = Object.entries(ConfigPaths).filter(([key]) => !(key in ExpectedRefusals));
    it.each(samples)("%s: the pass accepts the maximum and refuses above it", async (_key, file) => {
        const config = await loadConfigFromFile(file) as Config;
        const max = targetRateMaxOf(config);
        // the sample's own target is carried: it is never above the maximum
        expect(refused(config)).toBe(false);
        if (max === null) return;
        const total = max.per_copy_per_second * config.target_output.copies;
        expect(total).toBeGreaterThanOrEqual(config.target_output.items_per_second * (1 - 1e-9));
        expect(refused(withRate(config, typedMax(config, max.per_copy_per_second)))).toBe(false);
        expect(refused(withRate(config, Math.ceil(total * 1000 + 1) / 1000))).toBe(true);
        expect(max.limit).toBeNull();
    });
});

describe("the ore voider", () => {
    let config: Config;
    beforeAll(async () => { config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_ORE_VOIDER_OVERBEACONED) as Config; });
    it("is refused above 480 a second, by the inserters that bring the ore in", () => {
        const max = targetRateMaxOf(config)!;
        expect(max.per_copy_per_second).toBe(480);
        expect(max.cut).toBe("C7 inserters");
        expect(refused(withRate(config, 480))).toBe(false);
        expect(refused(withRate(config, 480.01))).toBe(true);
    });
    it("says what stops a target above it", () => {
        const max = targetRateMaxOf(withRate(config, 500))!;
        expect(max.limit).toContain("Inserters 3, 4, 5 and 6 can bring at most 480 a second of iron ore into the build");
    });
});
