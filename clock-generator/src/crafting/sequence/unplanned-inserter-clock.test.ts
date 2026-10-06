import { beforeAll, describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { FactorioDataService } from "../../data";
import { byProductClockFor, byProductOnlyInserters, clockWindowsOverPeriod, fuelOnlyInserters, isByProductOnlyInserter, largestDivisorAtMost, unplannedInserterClocks } from "./unplanned-inserter-clock";
import { Entity, Machine } from "../../entities";
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

describe("fuel clocks", () => {
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
        const clock = unplannedInserterClocks(registry, period).get("inserter:3")!;

        expect(period % clock.modulus).toBe(0);
        expect(clock.modulus).toBeLessThanOrEqual(117);
        expect(clock.modulus).toBeGreaterThan(25);
        expect(clock.window.end_inclusive).toBeLessThan(clock.modulus);

        const windows = clockWindowsOverPeriod(clock, period);
        expect(windows).toHaveLength(period / clock.modulus);
        windows.forEach((window, index) => expect(window.start_inclusive).toBe(index * clock.modulus + clock.window.start_inclusive));
    });

    it("swings more often for a machine that burns fuel faster", async () => {
        const slow = unplannedInserterClocks(await registryOf(0), 960).get("inserter:3")!;
        const fast = unplannedInserterClocks(await registryOf(926.17), 960).get("inserter:3")!;
        expect(fast.modulus).toBeLessThan(slow.modulus);
    });

    it("says when one inserter cannot keep a machine fuelled", async () => {
        const registry = await registryOf(100000);
        expect(() => unplannedInserterClocks(registry, 960)).toThrow(/Inserter 3 cannot keep up: 5 nutrients in the fuel slot of machine:1 lasts/);
    });
});

describe("by-product clocks", () => {
    // the rocket fuel build: jellynut-processing makes jelly for two machines and jellynut-seed at 2% on the side
    const registryOf = async () => {
        const config = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
        return SimulationContext.fromConfig(config).entity_registry;
    };

    it("finds the inserter that only takes a by-product no machine uses", async () => {
        const registry = await registryOf();
        const inserters = byProductOnlyInserters(registry);
        expect(inserters).toHaveLength(1);
        expect(Array.from(inserters[0].filtered_items)).toEqual(["jellynut-seed"]);
        expect(isByProductOnlyInserter(registry, inserters[0])).toBe(true);
    });

    it("does not take an inserter of the main product for one of a by-product", async () => {
        const registry = await registryOf();
        const jelly_inserter = registry.getAll().filter(Entity.isInserter)
            .find(inserter => inserter.filtered_items.has("jelly"))!;
        expect(isByProductOnlyInserter(registry, jelly_inserter)).toBe(false);
    });

    it("looks at the machine at least as often as a hand of the by-product builds up, on a divisor of the period", async () => {
        const registry = await registryOf();
        const period = 128;
        const clock = unplannedInserterClocks(registry, period).get(byProductOnlyInserters(registry)[0].entity_id.id)!;

        expect(clock.kind).toBe("by-product");
        expect(period % clock.modulus).toBe(0);
        // the seed is made at about 0.047 a tick at most, so a hand of 8 builds up in about 171 ticks, but the stack of 10
        // only has room for 2 over a hand: the machine is looked at at least every 2 / 0.047 = 42 ticks
        expect(clock.modulus).toBeLessThanOrEqual(42);
        expect(clock.modulus).toBe(32);
        // a short look, not a long wait at the machine
        expect(clock.window.end_inclusive - clock.window.start_inclusive + 1).toBeLessThan(clock.modulus);
    });

    it("uses the time a hand takes to build up when no divisor of the period fits the stack's room", async () => {
        const registry = await registryOf();
        const inserter = byProductOnlyInserters(registry)[0];
        const machine = registry.getEntityByIdOrThrow(inserter.source.entity_id) as Machine;
        // 118 ticks (2 x 59) has the divisors 1, 2, 59 and 118: none from a swing's time to 42, but 59 is within the 171
        // ticks a hand takes
        const clock = byProductClockFor(inserter, machine, registry, 118);
        expect(118 % clock.modulus).toBe(0);
        expect(clock.modulus).toBeGreaterThan(42);
        expect(clock.modulus).toBeLessThanOrEqual(171);
    });

    it("says when one inserter cannot keep up", async () => {
        const registry = await registryOf();
        const inserter = byProductOnlyInserters(registry)[0];
        const machine = registry.getEntityByIdOrThrow(inserter.source.entity_id);
        // a prime clock period above the time a hand of seeds takes has no divisor between a swing and that time
        expect(() => byProductClockFor(inserter, machine as Machine, registry, 211))
            .toThrow(/cannot keep up: a hand of jellynut-seed the machine makes lasts/);
    });
});
