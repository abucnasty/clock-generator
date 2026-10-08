import { describe, it, expect } from "vitest";
import { OpenRange } from "../data-types";
import { entityDescriptionHeaderLines, mergedClockTicks, moduloSignalRanges, splitRepeatingRanges } from "./blueprint";
import { EntityId, ReadableEntityRegistry } from "../entities";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { generateClockForConfig } from "./generate-blueprint";

/** Replays the circuit: the clock reads `tick % period`, the modulo combinator one tick later */
function enabledTicksMatch(ranges: OpenRange[], period: number): boolean {
    const split = splitRepeatingRanges(ranges, period);
    if (!split) {
        return true;
    }
    const modulo_ranges = moduloSignalRanges(split.repeating, split.modulus);
    const inAny = (rs: OpenRange[], value: number) => rs.some(r => r.contains(value));
    for (let tick = period; tick < 3 * period; tick++) {
        const clock = tick % period;
        const modulo = ((tick - 1) % period) % split.modulus;
        const expected = inAny(ranges, clock);
        const actual = inAny(modulo_ranges, modulo) || inAny(split.remaining, clock);
        if (expected !== actual) {
            return false;
        }
    }
    return true;
}

function windowsEvery(spacing: number, length: number, period: number, offset = 0): OpenRange[] {
    const ranges: OpenRange[] = [];
    for (let start = offset; start < period; start += spacing) {
        ranges.push(OpenRange.from(start, Math.min(start + length - 1, period - 1)));
    }
    return ranges;
}

describe("splitRepeatingRanges", () => {
    it("checks windows repeating every crafting cycle against the clock modulo the cycle", () => {
        const ranges = windowsEvery(48, 5, 5808, 10);
        const split = splitRepeatingRanges(ranges, 5808);
        expect(split).toEqual({ modulus: 48, repeating: [OpenRange.from(10, 14)], remaining: [] });
        expect(enabledTicksMatch(ranges, 5808)).toBe(true);
    });

    it("keeps the windows that do not repeat as clock windows", () => {
        const ranges = OpenRange.reduceRanges([...windowsEvery(48, 4, 960, 2), OpenRange.from(100, 110), OpenRange.from(500, 503)]);
        const split = splitRepeatingRanges(ranges, 960)!;
        expect(split.modulus).toBe(48);
        expect(split.remaining.length).toBeGreaterThan(0);
        expect(enabledTicksMatch(ranges, 960)).toBe(true);
    });

    it("handles windows starting at the period boundary, where the modulo signal wraps", () => {
        const ranges = windowsEvery(24, 3, 480, 0);
        expect(splitRepeatingRanges(ranges, 480)?.modulus).toBe(24);
        expect(enabledTicksMatch(ranges, 480)).toBe(true);
    });

    it("leaves windows without a repeating pattern alone", () => {
        expect(splitRepeatingRanges([OpenRange.from(3, 9), OpenRange.from(40, 47), OpenRange.from(200, 210)], 480)).toBeNull();
    });

    it("leaves fractional periods alone", () => {
        expect(splitRepeatingRanges(windowsEvery(24, 3, 480), 480.5)).toBeNull();
    });

    it("matches the windows tick for tick for irregular patterns", () => {
        let seed = 7;
        const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        for (let trial = 0; trial < 40; trial++) {
            const period = [96, 240, 528, 960][trial % 4];
            const base = windowsEvery([12, 24, 48][trial % 3], 1 + Math.floor(random() * 6), period, Math.floor(random() * 12));
            const extra = Array.from({ length: 3 }, () => {
                const start = Math.floor(random() * (period - 5));
                return OpenRange.from(start, start + Math.floor(random() * 5));
            });
            const dropped = base.filter(() => random() > 0.1);
            expect(enabledTicksMatch(OpenRange.reduceRanges([...dropped, ...extra]), period)).toBe(true);
        }
    });
});

describe("entityDescriptionHeaderLines", () => {
    const machine = (id: number, recipe: string) => ({ entity_id: EntityId.forMachine(id), metadata: { recipe: { name: recipe } } });
    const inserter = (id: number, source: EntityId, sink: EntityId) =>
        ({ entity_id: EntityId.forInserter(id), source: { entity_id: source }, sink: { entity_id: sink } });
    const belt = EntityId.forBelt(1);
    const entities = [
        machine(1, "rocket-fuel-from-jelly"),
        machine(2, "jellynut-processing"),
        inserter(1, belt, EntityId.forMachine(1)),
        inserter(2, EntityId.forMachine(1), belt),
        inserter(3, belt, EntityId.forMachine(2)),
        inserter(6, EntityId.forMachine(2), EntityId.forMachine(1)),
        inserter(10, belt, EntityId.forMachine(1)),
        { entity_id: EntityId.forDrill(1), sink_id: EntityId.forMachine(1) },
    ];
    const registry = {
        getEntityById: (id: EntityId) => entities.find(entity => entity.entity_id.id === id.id) ?? null,
    } as unknown as ReadableEntityRegistry;
    const header = (ids: EntityId[], kind?: string) => entityDescriptionHeaderLines(ids, registry, "[item=jelly]", kind);

    it("names the recipe of the machine an inserter fills", () => {
        expect(header([EntityId.forInserter(3)])).toEqual(["Inserter 3 for [item=jelly] into [recipe=jellynut-processing]"]);
    });

    it("names the recipe of the machine an inserter empties", () => {
        expect(header([EntityId.forInserter(2)])).toEqual(["Inserter 2 for [item=jelly] from [recipe=rocket-fuel-from-jelly]"]);
    });

    it("names both recipes of an inserter between two machines", () => {
        expect(header([EntityId.forInserter(6)]))
            .toEqual(["Inserter 6 for [item=jelly] from [recipe=jellynut-processing] into [recipe=rocket-fuel-from-jelly]"]);
    });

    it("lists the inserters sharing a combinator in one line when their machines have the same recipe", () => {
        expect(header([EntityId.forInserter(10), EntityId.forInserter(1)], "fuel"))
            .toEqual(["Inserters 1, 10 for [item=jelly] into [recipe=rocket-fuel-from-jelly] (fuel)"]);
    });

    it("gives each recipe a line when the inserters sharing a combinator work with different machines", () => {
        expect(header([EntityId.forInserter(10), EntityId.forInserter(3), EntityId.forInserter(1)])).toEqual([
            "Inserters 1, 3, 10 for [item=jelly]",
            "- 1, 10: into [recipe=rocket-fuel-from-jelly]",
            "- 3: into [recipe=jellynut-processing]",
        ]);
    });

    it("names the recipe of the machine a drill fills", () => {
        expect(header([EntityId.forDrill(1)])).toEqual(["Drill 1 for [item=jelly] into [recipe=rocket-fuel-from-jelly]"]);
    });
});

describe("combinator descriptions of the rocket fuel biochambers", async () => {
    const quiet = { log() {}, warn() {}, error() {}, debug() {} };
    const result = generateClockForConfig(await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL), { logger: quiet });
    const first_lines = (result.blueprint.entities ?? [])
        .map(entity => (entity.player_description ?? "").split("\n")[0])
        .filter(line => line.startsWith("Inserter"));

    it("name the recipes of the machines of every inserter", () => {
        expect(first_lines.sort()).toEqual([
            "Inserter 11 for [item=jellynut-seed] from [recipe=jellynut-processing] (by-product)",
            "Inserter 12 for [item=nutrients] into [recipe=jellynut-processing] (fuel)",
            "Inserter 3 for [item=jellynut] into [recipe=jellynut-processing]",
            "Inserters 1, 5 for [item=bioflux] into [recipe=rocket-fuel-from-jelly]",
            "Inserters 10, 13 for [item=nutrients] into [recipe=rocket-fuel-from-jelly] (fuel)",
            "Inserters 2, 4 for [item=rocket-fuel] from [recipe=rocket-fuel-from-jelly]",
            "Inserters 6, 7, 8, 9 for [item=jelly] from [recipe=jellynut-processing] into [recipe=rocket-fuel-from-jelly]",
        ]);
    });
});

describe("mergedClockTicks", () => {
    it("is the fewest ticks that hold a whole number of periods and of every fuel clock", () => {
        expect(mergedClockTicks(128, [95, 138])).toBe(839040);
        expect(mergedClockTicks(64, [96])).toBe(192);
    });

    it("is the period when every fuel clock already fits it", () => {
        expect(mergedClockTicks(128, [64, 32])).toBe(128);
        expect(mergedClockTicks(128, [])).toBe(128);
    });

    it("is null for a period that is not a whole number of ticks", () => {
        expect(mergedClockTicks(142.5, [95])).toBeNull();
    });

    it("is null when the count does not fit a signal", () => {
        expect(mergedClockTicks(128, [9973, 9967, 9949])).toBeNull();
    });
});

describe("the clock of a blueprint with fuel inserters", () => {
    const quiet = { log() {}, warn() {}, error() {}, debug() {} };
    type Blueprint = ReturnType<typeof generateClockForConfig>["blueprint"];
    const behavior = (entity: Blueprint["entities"][number]) => JSON.stringify(entity.control_behavior ?? {});
    const constantOf = (entity: Blueprint["entities"][number]) => Number(/"constant":(\d+)/.exec(behavior(entity))![1]);

    /** Replays the circuit of a blueprint with one clock: the tick's count, and every modulo of it a tick later */
    const enabledTicks = (blueprint: Blueprint, item_name: string, ticks: number): number[] => {
        const clock = blueprint.entities.find(entity => (entity.player_description ?? "").startsWith("Clock for"))!;
        const counted_to = constantOf(clock) + 1;
        const modulos = blueprint.entities.filter(entity => entity.name === "arithmetic-combinator").map(entity => {
            const conditions = (entity.control_behavior as { arithmetic_conditions: { second_constant: number; output_signal: { name: string } } }).arithmetic_conditions;
            return { signal: conditions.output_signal.name, modulus: conditions.second_constant };
        });
        const decider = blueprint.entities.find(entity => entity.name === "decider-combinator" && entity !== clock
            && behavior(entity).includes(`"signal":{"name":"${item_name}"`))!;
        type Condition = { first_signal: { name: string }; comparator: string; constant: number; compare_type?: string };
        const conditions = (decider.control_behavior as { decider_conditions: { conditions: Condition[] } }).decider_conditions.conditions;
        const enabled: number[] = [];
        for (let tick = 1; tick <= ticks; tick++) {
            const signals = new Map(modulos.map(modulo => [modulo.signal, ((tick - 1) % counted_to) % modulo.modulus]));
            // the conditions come in pairs, at least and at most, and any pair enables
            let any = false;
            for (let index = 0; index < conditions.length; index += 2) {
                const value = signals.get(conditions[index].first_signal.name)!;
                any = any || (value >= conditions[index].constant && value <= conditions[index + 1].constant);
            }
            if (any) {
                enabled.push(tick);
            }
        }
        return enabled;
    };

    it("enables each fuel inserter for its window of every count of its fuel clock, and the others every period", async () => {
        const config = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
        const result = generateClockForConfig(config, { logger: quiet, fuel_consumption_view: false });
        const period = result.simulation_duration.ticks;
        const fuel_clock = Object.values(result.unplanned_inserter_clocks!).find(clock => clock.own_clock)!;
        const window_ticks = fuel_clock.window.end - fuel_clock.window.start + 1;

        // the rocket fuel biochambers share a fuel clock and its combinator, and the jellynut biochamber has its own
        const blueprint = result.blueprint;
        const nutrient_deciders = blueprint.entities.filter(entity => entity.name === "decider-combinator" && behavior(entity).includes('"signal":{"name":"nutrients"'));
        expect(nutrient_deciders).toHaveLength(2);

        const fuel_moduli = Array.from(new Set(Object.values(result.unplanned_inserter_clocks!)
            .filter(clock => clock.own_clock).map(clock => clock.modulus))).sort((a, b) => a - b);
        expect(fuel_moduli).toEqual([176, 220]);
        // the one clock counts a whole number of every fuel clock
        const span = 7040 * 2;
        const bioflux = enabledTicks(blueprint, "bioflux", span);
        // every period has the same ticks enabled
        const of_period = (index: number) => bioflux.filter(tick => Math.floor(tick / period) === index).map(tick => tick % period);
        expect(of_period(1).length).toBeGreaterThan(0);
        expect(of_period(5)).toEqual(of_period(1));
        expect(of_period(9)).toEqual(of_period(1));

        // one of the two nutrient combinators is enabled for a window every 176 ticks, the other every 220
        const fuel_windows = (modulus: number) => {
            const decider = nutrient_deciders.find(entity => {
                const signal = /"first_signal":\{"name":"([^"]+)"/.exec(behavior(entity))![1];
                const modulo = blueprint.entities.find(other => other.name === "arithmetic-combinator" && behavior(other).includes(`"output_signal":{"name":"${signal}"`))!;
                return behavior(modulo).includes(`"second_constant":${modulus}`);
            })!;
            return enabledTicks({ ...blueprint, entities: blueprint.entities.filter(entity => !nutrient_deciders.includes(entity) || entity === decider) }, "nutrients", span);
        };
        for (const modulus of fuel_moduli) {
            const enabled = fuel_windows(modulus);
            expect(enabled.length).toBe(Math.floor(span / modulus) * window_ticks);
            const starts = enabled.filter((tick, index) => index === 0 || tick !== enabled[index - 1] + 1);
            starts.slice(1).forEach((start, index) => expect(start - starts[index]).toBe(modulus));
        }
    });

    it("keeps a clock per fuel interval, on a network of its own, when the period is not a whole number of ticks", async () => {
        const config = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
        const slower = { ...config, target_output: { ...config.target_output, items_per_second: 54 } };
        const result = generateClockForConfig(slower, { logger: quiet, fuel_consumption_view: false });

        expect(Number.isInteger(result.simulation_duration.ticks)).toBe(false);
        expect(result.fuel_plan?.separate_clocks_reason).toBe("fractional_period");
        const blueprint = result.subtick!.blueprint;
        const fuel_moduli = Array.from(new Set(Object.values(result.unplanned_inserter_clocks!)
            .filter(clock => clock.own_clock).map(clock => clock.modulus)));
        const fuel_clocks = blueprint.entities.filter(entity => (entity.player_description ?? "").startsWith("Fuel clock"));
        expect(fuel_clocks).toHaveLength(fuel_moduli.length);
        expect(fuel_clocks.map(clock => constantOf(clock) + 1).sort()).toEqual([...fuel_moduli].sort());
        // nothing counts on the signal of the one clock
        expect(blueprint.entities.some(entity => behavior(entity).includes('"name":"signal-T"'))).toBe(false);
    });
});

describe("the target rate in a blueprint", async () => {
    const quiet = { log() {}, warn() {}, error() {}, debug() {} };
    const blueprintOf = async (path: string) => generateClockForConfig(await loadConfigFromFile(path), { logger: quiet }).blueprint;
    const clockDescription = (blueprint: Awaited<ReturnType<typeof blueprintOf>>) =>
        (blueprint.entities ?? []).map(entity => entity.player_description ?? "").find(text => text.startsWith("Clock for"))!;

    it("is in the description of the blueprint, with the clock period", async () => {
        const blueprint = await blueprintOf(ConfigPaths.GLEBA_ROCKET_FUEL);
        expect(blueprint.description).toBe("Target: 60 [item=rocket-fuel] per second\nClock period: 128 ticks");
    });

    it("is on the clock combinator", async () => {
        const blueprint = await blueprintOf(ConfigPaths.GLEBA_ROCKET_FUEL);
        expect(clockDescription(blueprint).split("\n").slice(0, 2)).toEqual([
            "Clock for [item=rocket-fuel]:",
            "- Target: 60 [item=rocket-fuel] per second",
        ]);
    });

    it("says on each modulo of the clock what reads it", async () => {
        const blueprint = await blueprintOf(ConfigPaths.GLEBA_ROCKET_FUEL);
        const modulo_descriptions = (blueprint.entities ?? [])
            .filter(entity => entity.name === "arithmetic-combinator")
            .map(entity => entity.player_description ?? "");
        expect(modulo_descriptions).toEqual([
            "[virtual-signal=signal-clock] counts 0 to 127, 21 times in the 2688 ticks the clock counts\n- The clock period: every combinator of the swing counts reads it",
            "[virtual-signal=signal-B] counts 0 to 191, 14 times in the 2688 ticks the clock counts\n- Fuel clock: inserters 10, 13 may fill a fuel slot once every 192 ticks",
            "[virtual-signal=signal-C] counts 0 to 223, 12 times in the 2688 ticks the clock counts\n- Fuel clock: inserter 12 may fill a fuel slot once every 224 ticks",
        ]);
    });

    it("gives the rate of all copies and of one", async () => {
        const blueprint = await blueprintOf(ConfigPaths.AGRICULTURAL_SCIENCE);
        expect(blueprint.description?.split("\n")[0])
            .toBe("Target: 265 [item=agricultural-science-pack] per second over 5 copies (53 each)");
    });
});
