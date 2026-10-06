import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { FactorioDataService } from "../../data";
import { fuelClocks, fuelOnlyInserters, fuelWindowsOverPeriod, largestDivisorAtMost } from "./fuel-clock";
import { SimulationContext } from "./simulation-context";

beforeAll(() => {
    FactorioDataService.findRecipeOrThrow("iron-gear-wheel");
});

describe("largestDivisorAtMost", () => {
    it("is the largest divisor of the period that is not above the limit", () => {
        expect(largestDivisorAtMost(960, 117)).toBe(96);
        expect(largestDivisorAtMost(960, 96)).toBe(96);
        expect(largestDivisorAtMost(960, 95)).toBe(80);
        expect(largestDivisorAtMost(97, 50)).toBe(1);
    });

    it("is null when no divisor is at least the minimum", () => {
        expect(largestDivisorAtMost(960, 20, 25)).toBeNull();
        expect(largestDivisorAtMost(97, 50, 25)).toBeNull();
    });
});

describe("fuelClocks", () => {
    const registryOf = async (bonus?: number) => {
        const config = await loadConfigFromFile(ConfigPaths.BIOCHAMBER_FUEL);
        const machines = config.machines.map(machine => ({ ...machine, energy_consumption_bonus: bonus ?? machine.energy_consumption_bonus }));
        return SimulationContext.fromConfig({ ...config, machines }).entity_registry;
    };

    it("finds the inserters that only fill a fuel slot", async () => {
        const registry = await registryOf();
        expect(fuelOnlyInserters(registry).map(inserter => inserter.entity_id.id)).toEqual(["inserter:3"]);
    });

    it("repeats within a divisor of the period, at least as often as the fuel slot's limit lasts", async () => {
        // 926% energy consumption: 2.565 nutrients a second, so the 5 nutrients the slot holds last about 117 ticks
        const registry = await registryOf();
        const period = 960;
        const clock = fuelClocks(registry, period).get("inserter:3")!;

        expect(period % clock.modulus).toBe(0);
        expect(clock.modulus).toBeLessThanOrEqual(117);
        expect(clock.modulus).toBeGreaterThan(25);
        expect(clock.window.end_inclusive).toBeLessThan(clock.modulus);

        const windows = fuelWindowsOverPeriod(clock, period);
        expect(windows).toHaveLength(period / clock.modulus);
        windows.forEach((window, index) => expect(window.start_inclusive).toBe(index * clock.modulus + clock.window.start_inclusive));
    });

    it("swings more often for a machine that burns fuel faster", async () => {
        const slow = fuelClocks(await registryOf(0), 960).get("inserter:3")!;
        const fast = fuelClocks(await registryOf(926.17), 960).get("inserter:3")!;
        expect(fast.modulus).toBeLessThan(slow.modulus);
    });

    it("says when one inserter cannot keep a machine fuelled", async () => {
        const registry = await registryOf(100000);
        expect(() => fuelClocks(registry, 960)).toThrow(/Inserter 3 cannot keep machine:1 fuelled/);
    });
});
