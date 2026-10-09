import { describe, it, expect } from "vitest";
import { OpenRange } from "../data-types";
import { entityDescriptionHeaderLines, lockWires, mergedClockTicks, splitRepeatingRanges, WIRE_REACH_TILES } from "./blueprint";
import { Entity, EntityType, Position } from "../blueprints/components";
import { ConstantCombinatorEntity } from "../blueprints/entity/constant-combinator";
import { EntityId, ReadableEntityRegistry } from "../entities";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { generateClockForConfig } from "./generate-blueprint";
import { CircuitReplay } from "./circuit-replay";

/**
 * Replays the circuit in positions, without the 1 every signal counts from: the clock reads the tick's position in
 * the period, and a modulo of it reads that position modulo the modulus
 */
function enabledTicksMatch(ranges: OpenRange[], period: number): boolean {
    const split = splitRepeatingRanges(ranges, period);
    if (!split) {
        return true;
    }
    const inAny = (rs: OpenRange[], value: number) => rs.some(r => r.contains(value));
    for (let tick = period; tick < 3 * period; tick++) {
        const clock = tick % period;
        const modulo = clock % split.modulus;
        const expected = inAny(ranges, clock);
        const actual = inAny(split.repeating, modulo) || inAny(split.remaining, clock);
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

    /** The lock filter is a combinator between the clock and the combinators of the windows, which takes a tick */
    const FILTER_TICKS = 1;

    /**
     * Replays the circuit of a blueprint with one clock: the tick's count, from 1, and every modulo of it, which is
     * a tick behind the count and 1 more than the count modulo the modulus, as the combinators of the windows read
     * them through the lock filter: FILTER_TICKS after they count
     */
    const enabledTicks = (blueprint: Blueprint, item_name: string, ticks: number): number[] => {
        const clock = blueprint.entities.find(entity => (entity.player_description ?? "").startsWith("Clock for"))!;
        const counted_to = constantOf(clock);
        const modulos = blueprint.entities.filter(entity => entity.name === "arithmetic-combinator").map(entity => {
            const conditions = (entity.control_behavior as { arithmetic_conditions: { second_constant: number; output_signal: { name: string } } }).arithmetic_conditions;
            return { signal: conditions.output_signal.name, modulus: conditions.second_constant };
        });
        const decider = blueprint.entities.find(entity => entity.name === "decider-combinator" && entity !== clock
            && behavior(entity).includes(`"signal":{"name":"${item_name}"`))!;
        type Condition = { first_signal: { name: string }; comparator: string; constant: number; compare_type?: string };
        const conditions = (decider.control_behavior as { decider_conditions: { conditions: Condition[] } }).decider_conditions.conditions;
        const enabled: number[] = [];
        for (let tick = 1 + FILTER_TICKS; tick <= ticks; tick++) {
            const counted = tick - FILTER_TICKS;
            const signals = new Map(modulos.map(modulo => [modulo.signal, ((counted - 1) % counted_to) % modulo.modulus + 1]));
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
        expect(fuel_clocks.map(clock => constantOf(clock)).sort()).toEqual([...fuel_moduli].sort());
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
            "[virtual-signal=signal-clock] counts 1 to 128, 21 times in the 2688 ticks the clock counts\n- The clock period: every combinator of the swing counts reads it",
            "[virtual-signal=signal-B] counts 1 to 192, 14 times in the 2688 ticks the clock counts\n- Fuel clock: inserters 10, 13 may fill a fuel slot once every 192 ticks",
            "[virtual-signal=signal-C] counts 1 to 224, 12 times in the 2688 ticks the clock counts\n- Fuel clock: inserter 12 may fill a fuel slot once every 224 ticks",
        ]);
    });

    it("gives the rate of all copies and of one", async () => {
        const blueprint = await blueprintOf(ConfigPaths.AGRICULTURAL_SCIENCE);
        expect(blueprint.description?.split("\n")[0])
            .toBe("Target: 250 [item=agricultural-science-pack] per second over 5 copies (50 each)");
    });
});

describe("the count of a clock", async () => {
    const quiet = { log() {}, warn() {}, error() {}, debug() {} };
    type Blueprint = ReturnType<typeof generateClockForConfig>["blueprint"];
    type Entity = Blueprint["entities"][number];
    type Condition = { first_signal: { name: string }; comparator: string; constant?: number; compare_type?: string };
    type Output = { signal: { name: string }; copy_count_from_input?: boolean; constant?: number };
    type Decider = { conditions: Condition[]; outputs: Output[]; else_outputs?: Output[] };
    const deciderOf = (entity: Entity) => (entity.control_behavior as { decider_conditions: Decider }).decider_conditions;
    const deciders = (blueprint: Blueprint) => blueprint.entities.filter(entity => entity.name === "decider-combinator");
    const conditionsOf = (blueprint: Blueprint): Condition[] => deciders(blueprint).flatMap(entity => deciderOf(entity).conditions ?? []);
    const readsLock = (entity: Entity) => deciderOf(entity).conditions.some(condition => condition.first_signal.name === "signal-lock");
    const isFilter = (entity: Entity) => readsLock(entity) && deciderOf(entity).outputs.some(output => output.signal.name === "signal-everything");
    /** A decider that counts: it outputs the count it reads back, at most up to its period */
    const isLoop = (entity: Entity) => readsLock(entity) && !isFilter(entity);
    const windowDeciders = (blueprint: Blueprint) => deciders(blueprint).filter(entity => !readsLock(entity));
    const numberOf = (entity: Entity) => entity.entity_number;

    const rocket_fuel = await loadConfigFromFile(ConfigPaths.GLEBA_ROCKET_FUEL);
    const blueprints: [string, Blueprint][] = [
        ["agricultural science", generateClockForConfig(await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE), { logger: quiet }).blueprint],
        ["rocket fuel, one clock with the fuel clocks", generateClockForConfig(rocket_fuel, { logger: quiet, fuel_consumption_view: false }).blueprint],
        ["rocket fuel, subtick clock and fuel clocks of their own", generateClockForConfig(
            { ...rocket_fuel, target_output: { ...rocket_fuel.target_output, items_per_second: 54 } },
            { logger: quiet, fuel_consumption_view: false },
        ).subtick!.blueprint],
    ];

    /** The networks of one colour of a blueprint, as the sets of connectors ("entity number:connector") a wire joins */
    const networksOf = (blueprint: Blueprint, red: boolean): Set<string>[] => {
        const parent = new Map<string, string>();
        const find = (node: string): string => {
            if (!parent.has(node)) {
                parent.set(node, node);
            }
            const up = parent.get(node)!;
            if (up === node) {
                return node;
            }
            const root = find(up);
            parent.set(node, root);
            return root;
        };
        for (const [from, from_connector, to, to_connector] of blueprint.wires) {
            // the red connectors are 1 and 3, the green 2 and 4
            if ((from_connector % 2 === 1) === red) {
                parent.set(find(`${from}:${from_connector}`), find(`${to}:${to_connector}`));
            }
        }
        const networks = new Map<string, Set<string>>();
        for (const node of Array.from(parent.keys())) {
            const root = find(node);
            networks.set(root, (networks.get(root) ?? new Set<string>()).add(node));
        }
        return Array.from(networks.values());
    };
    const networkOf = (networks: Set<string>[], entity: Entity, connector: number): Set<string> =>
        networks.find(members => members.has(`${numberOf(entity)}:${connector}`)) ?? new Set<string>();

    it.each(blueprints)("starts at 1 for every window (%s), so a switched-off clock, which reads as 0, enables nothing", (_, blueprint) => {
        const lower_bounds = conditionsOf(blueprint).filter(condition => condition.comparator === "≥");
        expect(lower_bounds.length).toBeGreaterThan(0);
        expect(lower_bounds.every(condition => condition.constant! >= 1)).toBe(true);
        expect(conditionsOf(blueprint).filter(condition => condition.comparator === "≤").every(condition => condition.constant! >= 1)).toBe(true);
    });

    it.each(blueprints)("has one constant combinator, the lock, which is off (%s)", (_, blueprint) => {
        const constants = blueprint.entities.filter(entity => entity.name === "constant-combinator");
        expect(constants).toHaveLength(1);
        expect(constants[0].control_behavior).toEqual({
            sections: { sections: [{ index: 1, filters: [{ index: 1, type: "virtual", name: "signal-lock", quality: "normal", comparator: "=", count: 1 }] }] },
            is_on: false,
        });
        expect(constants[0].player_description).toBe(
            "Clock lock: switch on to stop every clock; no inserter is enabled while it is on. Off by default. Switching off starts the clocks again from the beginning, and the first period after may be a tick off");
    });

    it.each(blueprints)("is counted by deciders that start over at 1 and wait there while the lock is on (%s)", (_, blueprint) => {
        const loops = deciders(blueprint).filter(isLoop);
        expect(loops.length).toBeGreaterThan(0);
        const rows = (list: Output[] | undefined, signal: string, copy: boolean) =>
            (list ?? []).filter(row => row.signal.name === signal && (row.copy_count_from_input ?? true) === copy);
        for (const loop of loops) {
            const { conditions, outputs, else_outputs } = deciderOf(loop);
            const counted = conditions[0].first_signal.name;
            expect(conditions[0]).toMatchObject({ comparator: "<" });
            expect(conditions[0].constant).toBeGreaterThan(1);
            // the lock is off: absent, not compared with a constant
            expect(conditions).toHaveLength(2);
            expect(conditions[1]).toMatchObject({ first_signal: { name: "signal-lock" }, comparator: "=", compare_type: "and" });
            expect(conditions[1].constant).toBeUndefined();
            // the count and 1 more while counting, 1 otherwise
            expect(rows(outputs, counted, true)).toHaveLength(1);
            expect(rows(outputs, counted, false).map(row => row.constant)).toEqual([1]);
            expect(rows(else_outputs, counted, false).map(row => row.constant)).toEqual([1]);
            expect(rows(else_outputs, counted, true)).toHaveLength(0);
            // every other signal it puts out counts from 1 as well, in the same two places
            const constants = outputs.filter(row => row.copy_count_from_input === false);
            expect(constants.every(row => row.constant === 1)).toBe(true);
            expect((else_outputs ?? []).map(row => row.signal.name).sort()).toEqual(constants.map(row => row.signal.name).sort());
        }
    });

    it.each(blueprints)("is read through one filter per clock, which the lock switches off (%s)", (_, blueprint) => {
        const filters = deciders(blueprint).filter(isFilter);
        expect(filters).toHaveLength(deciders(blueprint).filter(isLoop).length);
        for (const filter of filters) {
            const { conditions, outputs, else_outputs } = deciderOf(filter);
            expect(conditions).toHaveLength(1);
            expect(conditions[0]).toMatchObject({ first_signal: { name: "signal-lock" }, comparator: "=" });
            expect(conditions[0].constant).toBeUndefined();
            expect(outputs[0]).toMatchObject({ signal: { name: "signal-everything" }, copy_count_from_input: true });
            expect(else_outputs).toEqual([]);
            // the harness and the recorder find the clock and the inserters' combinators by what their descriptions start with
            const lines = (filter.player_description ?? "").split("\n");
            expect(lines[0]).toBe("Clock lock filter: disables the clock when [virtual-signal=signal-lock] is active");
            expect(lines[0].startsWith("Clock for")).toBe(false);
            expect(lines.length).toBeGreaterThanOrEqual(3);
            expect(lines.some(line => /^Inserters? ([\d, ]+) for/.test(line))).toBe(false);
        }
    });

    it.each(blueprints)("reaches every clock and every filter with the lock, on red wires within reach (%s)", (_, blueprint) => {
        const [lock] = blueprint.entities.filter(entity => entity.name === "constant-combinator");
        const network = networkOf(networksOf(blueprint, true), lock, 1);
        deciders(blueprint).filter(entity => isLoop(entity) || isFilter(entity)).forEach(receiver =>
            expect(network.has(`${numberOf(receiver)}:1`), `${receiver.player_description?.split("\n")[0]}`).toBe(true));
        // never on a green network, which would join clocks that count on the same signal
        expect(blueprint.wires.some(([from, from_connector, to, to_connector]) =>
            (from === numberOf(lock) || to === numberOf(lock)) && (from_connector % 2 === 0 || to_connector % 2 === 0))).toBe(false);
        // and no wire is longer than a copper wire reaches
        const position = (entity_number: number) => blueprint.entities.find(entity => entity.entity_number === entity_number)!.position;
        blueprint.wires.forEach(([from, , to]) =>
            expect(Math.hypot(position(from).x - position(to).x, position(from).y - position(to).y)).toBeLessThanOrEqual(9));
    });

    it.each(blueprints)("is read by the combinators of the windows only through a filter (%s)", (_, blueprint) => {
        const green = networksOf(blueprint, false);
        const filters = new Set(deciders(blueprint).filter(isFilter).map(numberOf));
        const windows = windowDeciders(blueprint);
        const window_inputs = new Set(windows.map(window => `${numberOf(window)}:2`));
        expect(windows.length).toBeGreaterThan(0);
        for (const window of windows) {
            const members = Array.from(networkOf(green, window, 2));
            // the output of exactly one filter, and the inputs of combinators of the windows
            const outputs = members.filter(member => member.endsWith(":4"));
            expect(outputs).toHaveLength(1);
            expect(filters.has(Number(outputs[0].split(":")[0]))).toBe(true);
            members.filter(member => member !== outputs[0]).forEach(member => expect(window_inputs.has(member), member).toBe(true));
            // and their outputs, which the game wires to inserters, are not wired here; the red wire of the lock may pass by their inputs
            blueprint.wires.filter(([from, , to]) => from === numberOf(window) || to === numberOf(window)).forEach(([from, from_connector, , to_connector]) =>
                expect([1, 2]).toContain(from === numberOf(window) ? from_connector : to_connector));
        }
    });

    it.each(blueprints)("keeps the clock off the network of the combinators of the windows (%s)", (_, blueprint) => {
        const green = networksOf(blueprint, false);
        const windows = new Set(windowDeciders(blueprint).map(numberOf));
        for (const filter of deciders(blueprint).filter(isFilter)) {
            const members = Array.from(networkOf(green, filter, 2));
            expect(members.length).toBeGreaterThan(1);
            members.forEach(member => expect(windows.has(Number(member.split(":")[0])), member).toBe(false));
        }
    });

    it("ends at the period, where the clock starts over", () => {
        const [, blueprint] = blueprints[0];
        const period = Number(/Clock period: (\d+) ticks/.exec(blueprint.description ?? "")![1]);
        const clock = blueprint.entities.find(entity => (entity.player_description ?? "").startsWith("Clock for"))!;
        expect(deciderOf(clock).conditions[0]).toMatchObject({ first_signal: { name: "signal-clock" }, comparator: "<", constant: period });
        expect(Math.max(...conditionsOf(blueprint).flatMap(it => it.constant === undefined ? [] : [it.constant]))).toBe(period);
        expect((clock.player_description ?? "").split("\n").at(-1)).toBe(`- Counts 1 to ${period}, never 0; stops at 1 while [virtual-signal=signal-lock] is on`);
    });

    it("is, with no modulo and no fuel clock, a clock, the lock and a filter, like the example it follows", () => {
        const [, blueprint] = blueprints[0];
        expect(blueprint.entities.filter(entity => entity.name !== "decider-combinator" || readsLock(entity)).map(entity => entity.name))
            .toEqual(["decider-combinator", "constant-combinator", "decider-combinator"]);
        const clock = blueprint.entities.find(isLoop)!;
        expect(deciderOf(clock).outputs.map(row => row.signal.name)).toEqual(["signal-clock", "signal-clock"]);
        expect(deciderOf(clock).else_outputs!.map(row => row.signal.name)).toEqual(["signal-clock"]);
    });

    it("gives each modulo of the one clock 1 more than its position, from the decider that counts", () => {
        const [, blueprint] = blueprints[1];
        const clock = blueprint.entities.find(isLoop)!;
        const derived = deciderOf(clock).else_outputs!.map(row => row.signal.name).filter(name => name !== "signal-T");
        const modulo_outputs = blueprint.entities.filter(entity => entity.name === "arithmetic-combinator")
            .map(entity => (entity.control_behavior as { arithmetic_conditions: { output_signal: { name: string } } }).arithmetic_conditions.output_signal.name);
        expect(derived.sort()).toEqual(modulo_outputs.sort());
        expect(derived).toContain("signal-clock");
    });

    it("gives the subtick clock its 1 in the filter after it, and not on the network it counts on", () => {
        const [, blueprint] = blueprints[2];
        // the decider of the clock and the fuel clocks add 1 to their own count only
        deciders(blueprint).filter(isLoop).forEach(loop =>
            expect(deciderOf(loop).outputs.filter(row => row.copy_count_from_input === false)).toHaveLength(1));
        const with_row = deciders(blueprint).filter(isFilter).filter(filter => deciderOf(filter).outputs.length > 1);
        expect(with_row).toHaveLength(1);
        expect(deciderOf(with_row[0]).outputs[1]).toMatchObject({ signal: { name: "signal-clock" }, copy_count_from_input: false, constant: 1 });
    });

    it.each(blueprints)("wires the filter of the main network to the output of the last combinator of it, not to the clock (%s)", (_, blueprint) => {
        const entity = (entity_number: number) => blueprint.entities.find(it => it.entity_number === entity_number)!;
        // what the input of each filter is wired to directly, by the output connector of the other end
        const sources = (filter: Entity) => blueprint.wires.flatMap(([from, from_connector, to, to_connector]) => {
            if (from === numberOf(filter) && from_connector === 2 && to_connector === 4) return [entity(to)];
            if (to === numberOf(filter) && to_connector === 2 && from_connector === 4) return [entity(from)];
            return [];
        });
        const filters = deciders(blueprint).filter(isFilter);
        const sourced = filters.map(filter => sources(filter).map(it => it.name === "arithmetic-combinator"
            ? `${it.name} ${(it.control_behavior as { arithmetic_conditions: { operation: string; second_constant: number } }).arithmetic_conditions.operation} ${(it.control_behavior as { arithmetic_conditions: { second_constant: number } }).arithmetic_conditions.second_constant}`
            : (it.player_description ?? "").split(":")[0]));
        const arithmetic = blueprint.entities.filter(it => it.name === "arithmetic-combinator");
        const last_arithmetic = arithmetic.length === 0 ? null : arithmetic.reduce((last, it) => it.position.x > last.position.x ? it : last);
        const wired = (filter: Entity) => sources(filter).map(numberOf);
        if (last_arithmetic === null) {
            // a plain clock: the filter reads the clock
            expect(sourced).toEqual([["Clock for [item=agricultural-science-pack]"]]);
        } else if (blueprint === blueprints[1][1]) {
            // modulos of the one clock: the filter reads the last of them
            expect(filters.map(wired)).toEqual([[numberOf(last_arithmetic)]]);
        } else {
            // a subtick clock: the filter reads the modulo of the subtick, which is a network of its own and not the clock's,
            // and each fuel clock is read by the filter after it
            const [main, ...fuel] = filters;
            expect(wired(main)).toEqual([numberOf(last_arithmetic)]);
            expect(last_arithmetic.player_description).toContain("step 2 of 2");
            fuel.forEach(filter => expect(sources(filter).map(it => (it.player_description ?? "").split(":")[0])).toEqual(["Fuel clock"]));
            const green = networksOf(blueprint, false);
            const clock = blueprint.entities.find(it => (it.player_description ?? "").startsWith("Clock for"))!;
            expect(networkOf(green, main, 2).has(`${numberOf(clock)}:4`)).toBe(false);
        }
    });

    it.each(blueprints)("has red wires between inputs only, so nothing outputs onto the red network of the lock (%s)", (_, blueprint) => {
        const red = blueprint.wires.filter(([, from_connector]) => from_connector % 2 === 1);
        expect(red.length).toBeGreaterThan(0);
        // the red connector of the input is 1; the lock is a constant combinator, whose only one is 1 as well
        red.forEach(([from, from_connector, to, to_connector]) => expect([from_connector, to_connector], `${from} to ${to}`).toEqual([1, 1]));
        const names = new Map(blueprint.entities.map(entity => [entity.entity_number, entity.name]));
        const lock = blueprint.entities.find(entity => entity.name === "constant-combinator")!;
        const network = networkOf(networksOf(blueprint, true), lock, 1);
        // the red network joins the lock and combinators and nothing else
        Array.from(network).forEach(member => expect(["constant-combinator", "decider-combinator", "arithmetic-combinator"]).toContain(names.get(Number(member.split(":")[0]))));
        expect(Array.from(network).every(member => member.endsWith(":1"))).toBe(true);
    });

    describe("replaying the circuit", () => {
        const periodOf = (blueprint: Blueprint) => Number(/Clock period: (\d+) ticks/.exec(blueprint.description ?? "")?.[1]);
        const countedBy = (loop: Entity) => deciderOf(loop).conditions[0].first_signal.name;
        const periodOfLoop = (loop: Entity) => deciderOf(loop).conditions[0].constant!;
        const valueOf = (replay: CircuitReplay, entity: Entity, connector: number, signal: string) => replay.network(numberOf(entity), connector).get(signal) ?? 0;
        /** The windows a combinator is open for, as positions in the period: the values it checks for less 1 */
        const windowsOf = (decider: Entity) => {
            const { conditions } = deciderOf(decider);
            return conditions.flatMap((condition, index) => condition.comparator === "≥" ? [[condition.constant! - 1, conditions[index + 1].constant! - 1]] : []);
        };
        /** The combinators of the windows that read the clock of the period and nothing else */
        const readingTheClock = (blueprint: Blueprint) => windowDeciders(blueprint)
            .filter(decider => deciderOf(decider).conditions.every(condition => condition.first_signal.name === "signal-clock"));

        it.each(blueprints)("counts 1 to the period on every clock and starts over (%s)", (_, blueprint) => {
            const replay = new CircuitReplay(blueprint);
            const loops = deciders(blueprint).filter(isLoop);
            const longest = Math.max(...loops.map(periodOfLoop));
            const counts = loops.map(() => [] as number[]);
            for (let tick = 0; tick < 2.5 * longest; tick++) {
                replay.step();
                loops.forEach((loop, index) => counts[index].push(replay.output(numberOf(loop)).get(countedBy(loop)) ?? 0));
            }
            loops.forEach((loop, index) => expect(counts[index]).toEqual(counts[index].map((_, tick) => tick % periodOfLoop(loop) + 1)));
        });

        it.each(blueprints)("gives the combinators of the windows a clock that counts 1 to its period (%s)", (_, blueprint) => {
            const replay = new CircuitReplay(blueprint);
            const [first] = windowDeciders(blueprint);
            const seen: number[] = [];
            for (let tick = 0; tick < 2.2 * Math.max(...deciders(blueprint).filter(isLoop).map(periodOfLoop)); tick++) {
                replay.step();
                seen.push(valueOf(replay, first, 2, "signal-clock"));
            }
            const steady = seen.slice(20);
            if (blueprint === blueprints[2][1]) {
                // the subtick clock: the position in the period in 1/9 ticks, from 1, a step of the scale each tick
                const [scale, modulus] = blueprint.entities.filter(it => it.name === "arithmetic-combinator")
                    .map(it => (it.control_behavior as { arithmetic_conditions: { second_constant: number } }).arithmetic_conditions.second_constant);
                steady.slice(1).forEach((value, tick) => expect(value - 1).toBe((steady[tick] - 1 + scale) % modulus));
                expect(Math.min(...steady)).toBeGreaterThanOrEqual(1);
            } else {
                const period = periodOf(blueprint);
                expect(steady.slice(1)).toEqual(steady.slice(1).map((_, tick) => steady[tick] % period + 1));
                expect(Math.min(...steady)).toBe(1);
                expect(Math.max(...steady)).toBe(period);
            }
        });

        it.each(blueprints.slice(0, 2))("enables a combinator of a window for its planned window, two ticks after the clock counts it (%s)", (_, blueprint) => {
            const replay = new CircuitReplay(blueprint);
            const loop = blueprint.entities.find(isLoop)!;
            const period = periodOf(blueprint);
            const deciders_read = readingTheClock(blueprint);
            expect(deciders_read.length).toBeGreaterThan(0);
            const counts: number[] = [];
            const enabled = deciders_read.map(() => [] as boolean[]);
            for (let tick = 0; tick < 4 * period + 30; tick++) {
                replay.step();
                counts.push(replay.output(numberOf(loop)).get(countedBy(loop)) ?? 0);
                deciders_read.forEach((decider, index) => enabled[index].push(replay.output(numberOf(decider)).size > 0));
            }
            // the filter and the combinator are a tick each: what the clock counted two ticks ago is what the combinator answers
            deciders_read.forEach((decider, index) => {
                const windows = windowsOf(decider);
                const expected = counts.map((count, tick) => ({ tick, on: windows.some(([a, b]) => { const position = (count - 1) % period; return position >= a && position <= b; }) }));
                const from = 2 * period + 10;
                expect(enabled[index].slice(from + 2)).toEqual(expected.slice(from, counts.length - 2).map(it => it.on));
                expect(enabled[index].some(Boolean)).toBe(true);
            });
        });

        it.each(blueprints)("enables nothing from the third tick the lock is on, for as long as it is, and exactly again from the second period after it is off (%s)", (_, blueprint) => {
            const replay = new CircuitReplay(blueprint);
            const lock = blueprint.entities.find(entity => entity.name === "constant-combinator")!;
            const loops = deciders(blueprint).filter(isLoop);
            const filters = deciders(blueprint).filter(isFilter);
            const windows = windowDeciders(blueprint);
            const period = Number.isInteger(periodOf(blueprint)) ? periodOf(blueprint) : periodOfLoop(loops[0]);
            // the windows of the subtick clock are in 1/9 ticks and left to the other tests
            const reading = blueprint === blueprints[2][1] ? [] : readingTheClock(blueprint);
            const counted = loops[0];
            const run = (ticks: number, each: () => void) => { for (let tick = 0; tick < ticks; tick++) { replay.step(); each(); } };
            const quiet = () => [...filters, ...windows].every(entity => replay.output(numberOf(entity)).size === 0);

            run(1000, () => {});
            expect(quiet()).toBe(false);
            replay.setOn(numberOf(lock), true);
            const counts_locked: number[] = [];
            const quiet_from_third: boolean[] = [];
            let ticks_on = 0;
            run(3000, () => {
                ticks_on++;
                counts_locked.push(...loops.map(loop => replay.output(numberOf(loop)).get(countedBy(loop)) ?? 0));
                if (ticks_on >= 3) quiet_from_third.push(quiet());
            });
            expect(quiet_from_third.every(Boolean)).toBe(true);
            expect(quiet_from_third).toHaveLength(2998);
            // every clock waits at 1
            expect(counts_locked.slice(3 * loops.length).every(count => count === 1)).toBe(true);

            replay.setOn(numberOf(lock), false);
            const counts: number[] = [];
            const enabled = reading.map(() => [] as boolean[]);
            const total = 4 * period + 20;
            run(total, () => {
                counts.push(replay.output(numberOf(counted)).get(countedBy(counted)) ?? 0);
                reading.forEach((decider, index) => enabled[index].push(replay.output(numberOf(decider)).size > 0));
            });
            // the count goes on from the 1 it waited at, and starts over at its period
            expect(counts.slice(0, 5)).toEqual([2, 3, 4, 5, 6]);
            expect(counts.slice(0, periodOfLoop(counted) - 1).every((count, tick) => count === tick + 2)).toBe(true);
            // from the second period the combinators read the clock as exactly as ever
            const mark = 2 * period + 10;
            reading.forEach((decider, index) => {
                const windows_of = windowsOf(decider);
                const expected = counts.map(count => windows_of.some(([a, b]) => (count - 1) % period >= a && (count - 1) % period <= b));
                expect(enabled[index].slice(mark + 2)).toEqual(expected.slice(mark, total - 2));
            });
        });
    });
});

describe("lockWires", () => {
    const combinator = (x: number): Entity => ({ name: EntityType.DECIDER_COMBINATOR, position: Position.fromXY(x, 0) });
    const lockAt = (x: number) => ConstantCombinatorEntity.lock({ position: Position.fromXY(x, 1.5) });
    const distance = (a: Entity, b: Entity) => Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
    /** The entities the lock reaches over the wires, as a graph walk from the lock */
    const reached = (lock: Entity, wires: ReturnType<typeof lockWires>): Set<Entity> => {
        const seen = new Set<Entity>([lock]);
        for (let changed = true; changed;) {
            changed = false;
            for (const { from, to } of wires) {
                if (seen.has(from.entity) !== seen.has(to.entity)) {
                    seen.add(from.entity).add(to.entity);
                    changed = true;
                }
            }
        }
        return seen;
    };
    const row = Array.from({ length: 40 }, (_, index) => combinator(0.5 + index));

    it("reaches a receiver beside the lock with one wire", () => {
        const lock = lockAt(0.5);
        const wires = lockWires(lock, [row[0]], row);
        expect(wires).toHaveLength(1);
        expect(wires[0]).toMatchObject({ color: "red", from: { entity: lock }, to: { entity: row[0], side: "input" } });
    });

    it("passes by the combinators between receivers that are further apart than a wire reaches, and reaches every receiver", () => {
        const lock = lockAt(0.5);
        const receivers = [row[0], row[1], row[22], row[39]];
        const wires = lockWires(lock, receivers, row);
        const seen = reached(lock, wires);
        receivers.forEach(receiver => expect(seen.has(receiver)).toBe(true));
        expect(wires.length).toBeGreaterThan(receivers.length);
        wires.forEach(wire => {
            expect(wire.color).toBe("red");
            expect(distance(wire.from.entity, wire.to.entity)).toBeLessThanOrEqual(WIRE_REACH_TILES);
        });
        // it hops over the row and not back: each wire goes on to a combinator further along, and only inputs are wired
        wires.forEach(wire => expect(wire.to.side).toBe("input"));
        wires.slice(1).forEach(wire => expect(wire.to.entity.position.x).toBeGreaterThan(wire.from.entity.position.x));
    });

    it("takes receivers in the order of the row whatever order they come in", () => {
        const lock = lockAt(0.5);
        const wires = lockWires(lock, [row[30], row[0], row[15]], row);
        expect(wires.every(wire => distance(wire.from.entity, wire.to.entity) <= WIRE_REACH_TILES)).toBe(true);
        [row[0], row[15], row[30]].forEach(receiver => expect(reached(lock, wires).has(receiver)).toBe(true));
    });

    it("fails where no combinator on the way lets the lock reach a receiver", () => {
        const lock = lockAt(0.5);
        const far = combinator(20.5);
        expect(() => lockWires(lock, [row[0], far], [row[0], far])).toThrow(/does not reach the combinator at \(20.5, 0\)/);
    });
});
