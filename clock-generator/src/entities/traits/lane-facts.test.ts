import { describe, expect, it } from "vitest";
import { ConfigPaths } from "../../config/config-paths";
import { loadConfigFromFile } from "../../config/loader";
import { BeltConfigSchema, Config, ConfigSchema } from "../../config/schema";
import { beltLaneFactsOf } from "../../light";
import { variantJobs } from "../../../tests/game/builds/variant-jobs";
import { carriedItemsOf, laneFactsOfConfig } from "./build-traits";
import { beltLanesOfFacts, supplyOfLaneEnd } from "./lane";
import { everyInputLaneIsDeadEnd, withEveryLaneEnd } from "./lane-ends";
import { isDeadEnd, laneFactsOf } from "./lane-facts";
import { laneRolesOf } from "./lane-role";

type Parts = Partial<Pick<Config, "machines" | "inserters" | "belts" | "chests" | "overrides">>;

function configOf(parts: Parts): Config {
    return ConfigSchema.parse({
        setpoint: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
        machines: [], belts: [], inserters: [], ...parts,
    }) as Config;
}

const belts: Config["belts"] = [
    { id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-plate", stack_size: 4 }, { ingredient: "copper-plate", stack_size: 2 }] },
    { id: 2, type: "transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 1 }] },
];

const machines = [{ id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0 }];
const take = (id: number, belt: number) => ({ id, source: { type: "belt" as const, id: belt }, sink: { type: "machine" as const, id: 1 } });
const put = (id: number, belt: number) => ({ id, source: { type: "machine" as const, id: 1 }, sink: { type: "belt" as const, id: belt } });
// belt 2 states one lane, so it has one lane
const every_lane = [[1, 1], [1, 2], [2, 1]] as const;
/** No lane has a role: the config has no inserter */
const no_roles = { of: () => null };
/** Whether every input lane of the config is a dead end, by the ends its lane facts give */
const inputLanesAreDeadEnds = (config: Config) => everyInputLaneIsDeadEnd(config, laneFactsOfConfig(config));
/** The roles of the lanes of a config, from what its inserters carry */
const rolesOf = (config: Config) => laneRolesOf(config, carriedItemsOf(config));

describe("the lane facts of a config", () => {
    it("gives every lane a dead end when the config's belts are backed up", () => {
        const facts = laneFactsOfConfig(configOf({ belts, overrides: { backed_up_belts: true } }));
        for (const [belt, lane] of every_lane) {
            expect(facts.of(belt, lane).lane_end).toEqual({ kind: "dead_end" });
            expect(isDeadEnd(facts.of(belt, lane))).toBe(true);
        }
    });

    it.each([[{ backed_up_belts: false }], [{}], [undefined]])("gives every lane an infinite end when the switch is %j", overrides => {
        const facts = laneFactsOfConfig(configOf({ belts, overrides }));
        for (const [belt, lane] of every_lane) {
            expect(facts.of(belt, lane).lane_end).toEqual({ kind: "infinite" });
            expect(isDeadEnd(facts.of(belt, lane))).toBe(false);
        }
    });

    it("supplies each lane at its capacity: half the belt's speed times the lane's stack size", () => {
        const facts = laneFactsOfConfig(configOf({ belts }));
        expect(facts.of(1, 1).supply_rate).toEqual({ numerator: 120, denominator: 1 });
        expect(facts.of(1, 2).supply_rate).toEqual({ numerator: 60, denominator: 1 });
        expect(facts.of(2, 1).supply_rate).toEqual({ numerator: 15, denominator: 2 });
    });

    it("has every copy share the lane, and never says a lane's end is unknown, when no lane states a fact", () => {
        for (const overrides of [{ backed_up_belts: true }, { backed_up_belts: false }]) {
            const facts = laneFactsOfConfig(configOf({ belts, overrides }));
            for (const [belt, lane] of every_lane) {
                expect(facts.of(belt, lane).sharing).toBe("shared");
                expect(facts.of(belt, lane).lane_end.kind).not.toBe("unknown");
            }
        }
    });

    it("refuses a lane of a belt that is not in the config", () => {
        expect(() => laneFactsOfConfig(configOf({ belts })).of(3, 1)).toThrow("belt 3");
    });
});

describe("the lane facts a config states", () => {
    const iron = { ingredient: "iron-plate", stack_size: 4 };
    const copper = { ingredient: "copper-plate", stack_size: 2 };
    /** Belt 1 of `belts` with its first lane's fields added to */
    const stating = (fields: Record<string, unknown>) => [{ ...belts[0], lanes: [{ ...iron, ...fields }, copper] }, belts[1]] as Config["belts"];
    const derived = (backed_up_belts: boolean) => laneFactsOfConfig(configOf({ belts, overrides: { backed_up_belts } }));

    it.each([[true], [false]])("reads each stated fact alone and derives the others from the switch (%s)", backed_up_belts => {
        const overrides = { backed_up_belts };
        const today = derived(backed_up_belts).of(1, 1);
        const supply = laneFactsOfConfig(configOf({ belts: stating({ supply_rate: 88 }), overrides })).of(1, 1);
        expect(supply).toEqual({ ...today, supply_rate: { numerator: 88, denominator: 1 } });
        const end = laneFactsOfConfig(configOf({ belts: stating({ lane_end: { kind: "unknown" } }), overrides })).of(1, 1);
        expect(end).toEqual({ ...today, lane_end: { kind: "unknown" } });
        const sharing = laneFactsOfConfig(configOf({ belts: stating({ sharing: "per_copy" }), overrides })).of(1, 1);
        expect(sharing).toEqual({ ...today, sharing: "per_copy" });
    });

    it.each([[true], [false]])("reads every fact together, whatever the switch (%s)", backed_up_belts => {
        const [first, second] = stating({ supply_rate: 120.7, lane_end: { kind: "dead_end" }, sharing: "per_copy" });
        const facts = laneFactsOfConfig(configOf({ belts: [{ ...first, flow_direction: 8 }, second] as Config["belts"], overrides: { backed_up_belts } }));
        expect(facts.of(1, 1)).toEqual({
            supply_rate: { numerator: 1207, denominator: 10 }, lane_end: { kind: "dead_end" }, sharing: "per_copy", flow_direction: { x: 0, y: 1 },
            role: null,
        });
    });

    it.each([[{ kind: "dead_end" }], [{ kind: "unknown" }], [{ kind: "infinite" }]])("states the end %j of a lane", lane_end => {
        const facts = laneFactsOfConfig(configOf({ belts: stating({ lane_end }), overrides: { backed_up_belts: lane_end.kind !== "dead_end" } }));
        expect(facts.of(1, 1).lane_end).toEqual(lane_end);
    });

    it.each([[true], [false]])("reads an infinite end as the lane states it, whatever the switch (%s)", backed_up_belts => {
        const facts = laneFactsOfConfig(configOf({ belts: stating({ lane_end: { kind: "infinite" } }), overrides: { backed_up_belts } }));
        expect(facts.of(1, 1).lane_end).toEqual({ kind: "infinite" });
    });

    it("leaves every lane that states nothing as the switch gives it", () => {
        for (const backed_up_belts of [true, false]) {
            const stated = laneFactsOfConfig(configOf({
                belts: stating({ supply_rate: 50, lane_end: { kind: "unknown" }, sharing: "per_copy" }), overrides: { backed_up_belts },
            }));
            for (const [belt, lane] of every_lane.filter(([belt, lane]) => belt !== 1 || lane !== 1)) {
                expect(stated.of(belt, lane)).toEqual(derived(backed_up_belts).of(belt, lane));
            }
        }
    });

    it("holds no fact of the side a belt that states one lane does not state, whatever the switch", () => {
        const one_lane = { id: 2, type: "transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 1, lane_end: { kind: "dead_end" } }] };
        for (const backed_up_belts of [true, false]) {
            const facts = laneFactsOfConfig(configOf({ belts: [belts[0], one_lane] as Config["belts"], overrides: { backed_up_belts } }));
            expect(facts.lanesOf(2).map(lane => lane.lane_end)).toEqual([{ kind: "dead_end" }]);
            expect(() => facts.of(2, 2)).toThrow("Lane 2 of belt 2 is not in the config");
            expect(facts.lanesOf(1)).toEqual([facts.of(1, 1), facts.of(1, 2)]);
        }
    });

    it("reads the facts of an export lane beside its consumption", () => {
        const belt = { id: 3, type: "turbo-transport-belt", strategy: "export",
            lanes: [{ ingredient: "iron-plate", stack_size: 4, consumption_per_second: 5, supply_rate: 100, sharing: "per_copy" }] };
        const config = configOf({ belts: [belt] as Config["belts"] });
        expect(config.belts[0].lanes[0]).toHaveProperty("consumption_per_second", 5);
        expect(laneFactsOfConfig(config).of(3, 1)).toMatchObject({ supply_rate: { numerator: 100, denominator: 1 }, sharing: "per_copy" });
    });

    it("keeps the infinite end of a lane with a consumption and no item: the other lane's end does not reach it", () => {
        const belt = { id: 3, type: "turbo-transport-belt", strategy: "export", lanes: [
            { ingredient: "iron-plate", stack_size: 4, lane_end: { kind: "dead_end" } },
            { ingredient: "", stack_size: 4, consumption_per_second: 1 }] };
        for (const overrides of [undefined, { backed_up_belts: true }, { backed_up_belts: false }]) {
            const facts = laneFactsOfConfig(configOf({ belts: [belt] as Config["belts"], overrides }));
            expect(facts.lanesOf(3).map(lane => lane.lane_end.kind)).toEqual(["dead_end", "infinite"]);
        }
    });

    it("gives the lane traits the supply of a stated end", () => {
        const config = configOf({ belts: stating({ lane_end: { kind: "dead_end" } }) });
        expect(beltLanesOfFacts(config.belts[0], laneFactsOfConfig(config)).map(lane => lane.supply)).toEqual(["backed_up", "moving"]);
    });
});

describe("the question about every input lane", () => {
    const inserters = [take(1, 1), put(2, 2)];

    it.each([[true], [false]])("answers as the switch (%s) when a belt is taken from", backed_up_belts => {
        const config = configOf({ machines, belts, inserters, overrides: { backed_up_belts } });
        expect(inputLanesAreDeadEnds(config)).toBe(backed_up_belts);
    });

    it("reads only the input lane without the switch: the copper plate lane beside it has no role", () => {
        const config = configOf({ machines, belts, inserters });
        expect(laneFactsOfConfig(config).lanesOf(1).map(lane => [lane.role, lane.lane_end.kind])).toEqual([["input", "dead_end"], [null, "infinite"]]);
        expect(inputLanesAreDeadEnds(config)).toBe(true);
    });

    it("reads the ends the input lanes state", () => {
        const ending = (kind: "dead_end" | "unknown") => [{ ...belts[0], lanes: belts[0].lanes.map(lane => ({ ...lane, lane_end: { kind } })) }, belts[1]] as Config["belts"];
        expect(inputLanesAreDeadEnds(configOf({ machines, belts: ending("dead_end"), inserters }))).toBe(true);
        expect(inputLanesAreDeadEnds(configOf({ machines, belts: ending("unknown"), inserters, overrides: { backed_up_belts: true } }))).toBe(false);
    });

    it.each([[true], [false]])("answers as the switch (%s) when no belt is taken from, or no belt is listed", backed_up_belts => {
        const overrides = { backed_up_belts };
        expect(inputLanesAreDeadEnds(configOf({ machines, belts, inserters: [put(1, 2)], overrides }))).toBe(backed_up_belts);
        expect(inputLanesAreDeadEnds(configOf({ overrides }))).toBe(backed_up_belts);
    });
    // the question is answered from the ends alone, without the rates of the lane facts: it gives the ends the lane
    // facts give, on every sample as it is and with the switch either way
    it("gives the answer of the lane facts of every input lane, on every sample", async () => {
        for (const [key, file] of Object.entries(ConfigPaths)) {
            const sample = await loadConfigFromFile(file) as Config;
            for (const backed_up_belts of [sample.overrides?.backed_up_belts, true, false]) {
                const config = { ...sample, overrides: { ...sample.overrides, backed_up_belts } };
                const facts = laneFactsOfConfig(config);
                const input_lanes = config.belts.flatMap(belt => facts.lanesOf(belt.id)).filter(lane => lane.role === "input" || lane.role === "buffer");
                const expected = input_lanes.length === 0 ? backed_up_belts === true : input_lanes.every(isDeadEnd);
                expect(inputLanesAreDeadEnds(config), `${key} with backed_up_belts ${backed_up_belts}`).toBe(expected);
            }
        }
    });
});

describe("one end stated on every lane", () => {
    const exporting = { id: 3, type: "turbo-transport-belt", strategy: "export",
        lanes: [{ ingredient: "iron-plate", stack_size: 4, consumption_per_second: 5 }, { ingredient: "", stack_size: 4 }] };
    const stated = { ...belts[0], lanes: [{ ...belts[0].lanes[0], lane_end: { kind: "infinite" } }, belts[0].lanes[1]] };
    const config = configOf({ belts: [stated, exporting] as Config["belts"], overrides: { backed_up_belts: false } });

    it.each(["dead_end", "infinite"] as const)("states %s on every lane without a consumption, a stated end included, and changes nothing else", kind => {
        const before = structuredClone(config);
        const forced = withEveryLaneEnd(config, kind);
        expect(config).toEqual(before);
        expect(forced.overrides).toEqual(config.overrides);
        expect(forced.belts.flatMap(belt => (belt.lanes as readonly { lane_end?: unknown }[]).map(lane => lane.lane_end)))
            .toEqual([{ kind }, { kind }, undefined, { kind }]);
        expect(forced.belts.flatMap(belt => laneFactsOfConfig(forced).lanesOf(belt.id).map(lane => lane.lane_end.kind)))
            .toEqual([kind, kind, "infinite", kind]);
    });

    it("gives the ends the switch gives a config that states none", () => {
        const plain = configOf({ belts: [...belts, exporting] as Config["belts"] });
        const ends = (it: Config) => it.belts.flatMap(belt => laneFactsOfConfig(it).lanesOf(belt.id).map(lane => lane.lane_end.kind));
        for (const [value, kind] of [[true, "dead_end"], [false, "infinite"]] as const) {
            expect(ends(withEveryLaneEnd(plain, kind))).toEqual(ends({ ...plain, overrides: { backed_up_belts: value } }));
        }
    });
});

describe("the lane traits of the facts", () => {
    it("carry the supply of each lane's end, and of the lane it states on the other side of a belt that states one", () => {
        for (const backed_up_belts of [true, false]) {
            const config = configOf({ belts, overrides: { backed_up_belts } });
            const supply = backed_up_belts ? "backed_up" : "moving";
            for (const belt of config.belts) {
                expect(beltLanesOfFacts(belt, laneFactsOfConfig(config)).map(lane => lane.supply)).toEqual([supply, supply]);
            }
        }
    });

    it("name a dead end backed up and an infinite end moving", () => {
        expect(supplyOfLaneEnd({ kind: "dead_end" })).toBe("backed_up");
        expect(supplyOfLaneEnd({ kind: "infinite" })).toBe("moving");
    });
});

describe("the flow direction a belt states", () => {
    it("gives both lanes of a belt its cardinal direction of the game as a map step, and none where the belt states none", () => {
        const belts = [
            { id: 1, type: "turbo-transport-belt", flow_direction: 4, lanes: [{ ingredient: "iron-ore", stack_size: 4 }, { ingredient: "iron-ore", stack_size: 4 }] },
            { id: 2, type: "turbo-transport-belt", flow_direction: 12, lanes: [{ ingredient: "copper-ore", stack_size: 4 }] },
            { id: 3, type: "turbo-transport-belt", lanes: [{ ingredient: "coal", stack_size: 4 }, { ingredient: "coal", stack_size: 4 }] }];
        const facts = laneFactsOf({ belts } as never, no_roles);
        expect([facts.of(1, 1), facts.of(1, 2), facts.of(2, 1), facts.of(3, 1), facts.of(3, 2)].map(it => it.flow_direction))
            .toEqual([{ x: 1, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, null, null]);
    });

    it("is read from the belt alone: the schema drops it from a lane", () => {
        const lane = { ingredient: "iron-ore", stack_size: 4, flow_direction: 4 };
        const parsed = BeltConfigSchema.parse({ id: 1, type: "turbo-transport-belt", lanes: [lane] });
        expect(parsed.lanes[0]).not.toHaveProperty("flow_direction");
        expect(laneFactsOf({ belts: [parsed] } as never, no_roles).of(1, 1).flow_direction).toBeNull();
    });
});

describe("the facts of every lane, as the light entry gives them", () => {
    /** What laneFactsOf gives each lane the config states, with its belt, its number and the capacity of its lane traits */
    function expectedOf(config: Config) {
        const facts = laneFactsOfConfig(config);
        return config.belts.flatMap(belt => {
            const traits = beltLanesOfFacts(belt, facts);
            const listed: readonly Config["belts"][number]["lanes"][number][] = belt.lanes;
            return listed.map((stated, index) => {
                const lane = index + 1 as 1 | 2;
                return {
                    belt_id: belt.id, lane, ...facts.of(belt.id, lane),
                    capacity: traits[index].items_per_second_ceiling, supply_rate_by_default: stated.supply_rate === undefined,
                };
            });
        });
    }

    it("lists each lane a belt states, with its capacity, and says whether its supply rate is the capacity by default", () => {
        const [first, second] = belts;
        const config = configOf({ belts: [{ ...first, lanes: [{ ...first.lanes[0], supply_rate: 88 }, first.lanes[1]] }, second] as Config["belts"] });
        expect(beltLaneFactsOf(config, rolesOf(config)).map(({ belt_id, lane, capacity, supply_rate, supply_rate_by_default }) =>
            ({ belt_id, lane, capacity, supply_rate, supply_rate_by_default }))).toEqual([
            { belt_id: 1, lane: 1, capacity: { numerator: 120, denominator: 1 }, supply_rate: { numerator: 88, denominator: 1 }, supply_rate_by_default: false },
            { belt_id: 1, lane: 2, capacity: { numerator: 60, denominator: 1 }, supply_rate: { numerator: 60, denominator: 1 }, supply_rate_by_default: true },
            { belt_id: 2, lane: 1, capacity: { numerator: 15, denominator: 2 }, supply_rate: { numerator: 15, denominator: 2 }, supply_rate_by_default: true },
        ]);
    });

    it("gives the facts laneFactsOf gives, on every sample with the switch either way", async () => {
        for (const [key, file] of Object.entries(ConfigPaths)) {
            const sample = await loadConfigFromFile(file) as Config;
            for (const backed_up_belts of [sample.overrides?.backed_up_belts, true, false]) {
                const config = { ...sample, overrides: { ...sample.overrides, backed_up_belts } };
                expect(beltLaneFactsOf(config, rolesOf(config)), `${key} with backed_up_belts ${backed_up_belts}`).toEqual(expectedOf(config));
            }
        }
    });

    it("gives the facts laneFactsOf gives, on the config of every variant job of the blast", async () => {
        for (const job of variantJobs()) {
            const config = await job.config();
            expect(beltLaneFactsOf(config, rolesOf(config)), job.name).toEqual(expectedOf(config));
        }
    });
});
