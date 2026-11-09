import { describe, expect, it } from "vitest";
import { Config, ConfigSchema } from "../../config/schema";
import { beltLanesOfFacts, supplyOfLaneEnd } from "./lane";
import { everyInputLaneIsDeadEnd, isDeadEnd, laneFactsOf } from "./lane-facts";

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
const every_lane = [[1, 1], [1, 2], [2, 1], [2, 2]] as const;

describe("the lane facts of a config", () => {
    it("gives every lane a dead end when the config's belts are backed up", () => {
        const facts = laneFactsOf(configOf({ belts, overrides: { backed_up_belts: true } }));
        for (const [belt, lane] of every_lane) {
            expect(facts.of(belt, lane).lane_end).toEqual({ kind: "dead_end" });
            expect(isDeadEnd(facts.of(belt, lane))).toBe(true);
        }
    });

    it.each([[{ backed_up_belts: false }], [{}], [undefined]])("gives every lane a free outlet when the switch is %j", overrides => {
        const facts = laneFactsOf(configOf({ belts, overrides }));
        for (const [belt, lane] of every_lane) {
            expect(facts.of(belt, lane).lane_end).toEqual({ kind: "outlet", outlet_rate: facts.of(belt, lane).supply_rate });
            expect(isDeadEnd(facts.of(belt, lane))).toBe(false);
        }
    });

    it("supplies each lane at its capacity: half the belt's speed times the lane's stack size", () => {
        const facts = laneFactsOf(configOf({ belts }));
        expect(facts.of(1, 1).supply_rate).toEqual({ numerator: 120, denominator: 1 });
        expect(facts.of(1, 2).supply_rate).toEqual({ numerator: 60, denominator: 1 });
        expect(facts.of(2, 1).supply_rate).toEqual({ numerator: 15, denominator: 2 });
        // the side of a belt that lists one lane is at the first lane's stack
        expect(facts.of(2, 2).supply_rate).toEqual({ numerator: 15, denominator: 2 });
    });

    it("has every copy share the lane, and never says a lane's end is unknown, when no lane states a fact", () => {
        for (const overrides of [{ backed_up_belts: true }, { backed_up_belts: false }]) {
            const facts = laneFactsOf(configOf({ belts, overrides }));
            for (const [belt, lane] of every_lane) {
                expect(facts.of(belt, lane).sharing).toBe("shared_by_copies");
                expect(facts.of(belt, lane).lane_end.kind).not.toBe("unknown");
            }
        }
    });

    it("refuses a lane of a belt that is not in the config", () => {
        expect(() => laneFactsOf(configOf({ belts })).of(3, 1)).toThrow("belt 3");
    });
});

describe("the lane facts a config states", () => {
    const iron = { ingredient: "iron-plate", stack_size: 4 };
    const copper = { ingredient: "copper-plate", stack_size: 2 };
    /** Belt 1 of `belts` with its first lane's fields added to */
    const stating = (fields: Record<string, unknown>) => [{ ...belts[0], lanes: [{ ...iron, ...fields }, copper] }, belts[1]] as Config["belts"];
    const derived = (backed_up_belts: boolean) => laneFactsOf(configOf({ belts, overrides: { backed_up_belts } }));

    it.each([[true], [false]])("reads each stated fact alone and derives the others from the switch (%s)", backed_up_belts => {
        const overrides = { backed_up_belts };
        const today = derived(backed_up_belts).of(1, 1);
        const supply = laneFactsOf(configOf({ belts: stating({ supply_rate: 88 }), overrides })).of(1, 1);
        expect(supply).toEqual({ ...today, supply_rate: { numerator: 88, denominator: 1 } });
        const end = laneFactsOf(configOf({ belts: stating({ lane_end: { kind: "outlet", outlet_rate: 30 } }), overrides })).of(1, 1);
        expect(end).toEqual({ ...today, lane_end: { kind: "outlet", outlet_rate: { numerator: 30, denominator: 1 } } });
        const sharing = laneFactsOf(configOf({ belts: stating({ sharing: "one_per_copy" }), overrides })).of(1, 1);
        expect(sharing).toEqual({ ...today, sharing: "one_per_copy" });
    });

    it.each([[true], [false]])("reads all three facts together, whatever the switch (%s)", backed_up_belts => {
        const facts = laneFactsOf(configOf({
            belts: stating({ supply_rate: 120.7, lane_end: { kind: "dead_end" }, sharing: "one_per_copy" }), overrides: { backed_up_belts },
        }));
        expect(facts.of(1, 1)).toEqual({
            supply_rate: { numerator: 1207, denominator: 10 }, lane_end: { kind: "dead_end" }, sharing: "one_per_copy",
        });
    });

    it.each([[{ kind: "dead_end" }], [{ kind: "unknown" }], [{ kind: "outlet", outlet_rate: 7.5 }]])("states the end %j of a lane", lane_end => {
        const facts = laneFactsOf(configOf({ belts: stating({ lane_end }), overrides: { backed_up_belts: lane_end.kind !== "dead_end" } }));
        expect(facts.of(1, 1).lane_end).toEqual(lane_end.kind === "outlet" ? { kind: "outlet", outlet_rate: { numerator: 15, denominator: 2 } } : lane_end);
    });

    it.each([[true], [false]])("reads an outlet that states no rate as a free outlet at the lane's capacity (switch %s)", backed_up_belts => {
        const facts = laneFactsOf(configOf({ belts: stating({ lane_end: { kind: "outlet" } }), overrides: { backed_up_belts } }));
        expect(facts.of(1, 1).lane_end).toEqual({ kind: "outlet", outlet_rate: { numerator: 120, denominator: 1 } });
    });

    it("leaves every lane that states nothing as the switch gives it", () => {
        for (const backed_up_belts of [true, false]) {
            const stated = laneFactsOf(configOf({
                belts: stating({ supply_rate: 50, lane_end: { kind: "unknown" }, sharing: "one_per_copy" }), overrides: { backed_up_belts },
            }));
            for (const [belt, lane] of every_lane.filter(([belt, lane]) => belt !== 1 || lane !== 1)) {
                expect(stated.of(belt, lane)).toEqual(derived(backed_up_belts).of(belt, lane));
            }
        }
    });

    it("derives every fact of the second side of a belt that lists one lane", () => {
        const one_lane = { id: 2, type: "transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 1, lane_end: { kind: "dead_end" } }] };
        const facts = laneFactsOf(configOf({ belts: [belts[0], one_lane] as Config["belts"] }));
        expect(facts.of(2, 1).lane_end).toEqual({ kind: "dead_end" });
        expect(facts.of(2, 2)).toEqual(derived(false).of(2, 2));
    });

    it("reads the facts of an export lane beside its consumption", () => {
        const belt = { id: 3, type: "turbo-transport-belt", strategy: "export",
            lanes: [{ ingredient: "iron-plate", stack_size: 4, consumption_per_second: 5, lane_end: { kind: "outlet", outlet_rate: 5 } }] };
        const config = configOf({ belts: [belt] as Config["belts"] });
        expect(config.belts[0].lanes[0]).toHaveProperty("consumption_per_second", 5);
        expect(laneFactsOf(config).of(3, 1).lane_end).toEqual({ kind: "outlet", outlet_rate: { numerator: 5, denominator: 1 } });
    });

    it("gives the lane traits the supply of a stated end", () => {
        const config = configOf({ belts: stating({ lane_end: { kind: "dead_end" } }) });
        expect(beltLanesOfFacts(config.belts[0], laneFactsOf(config)).map(lane => lane.supply)).toEqual(["backed_up", "moving"]);
    });
});

describe("the question about every input lane", () => {
    const inserters = [take(1, 1), put(2, 2)];

    it.each([[true], [false], [undefined]])("answers as the switch (%s) when a belt is taken from", backed_up_belts => {
        const config = configOf({ machines, belts, inserters, overrides: backed_up_belts === undefined ? {} : { backed_up_belts } });
        expect(everyInputLaneIsDeadEnd(config)).toBe(backed_up_belts === true);
    });

    it("reads the ends the input lanes state", () => {
        const ending = (kind: "dead_end" | "unknown") => [{ ...belts[0], lanes: belts[0].lanes.map(lane => ({ ...lane, lane_end: { kind } })) }, belts[1]] as Config["belts"];
        expect(everyInputLaneIsDeadEnd(configOf({ machines, belts: ending("dead_end"), inserters }))).toBe(true);
        expect(everyInputLaneIsDeadEnd(configOf({ machines, belts: ending("unknown"), inserters, overrides: { backed_up_belts: true } }))).toBe(false);
    });

    it.each([[true], [false]])("answers as the switch (%s) when no belt is taken from, or no belt is listed", backed_up_belts => {
        const overrides = { backed_up_belts };
        expect(everyInputLaneIsDeadEnd(configOf({ machines, belts, inserters: [put(1, 2)], overrides }))).toBe(backed_up_belts);
        expect(everyInputLaneIsDeadEnd(configOf({ overrides }))).toBe(backed_up_belts);
    });
});

describe("the lane traits of the facts", () => {
    it("carry the supply of each lane's end", () => {
        for (const backed_up_belts of [true, false]) {
            const config = configOf({ belts, overrides: { backed_up_belts } });
            const supply = backed_up_belts ? "backed_up" : "moving";
            for (const belt of config.belts) {
                expect(beltLanesOfFacts(belt, laneFactsOf(config)).map(lane => lane.supply)).toEqual([supply, supply]);
            }
        }
    });

    it("name a dead end backed up and an outlet moving", () => {
        expect(supplyOfLaneEnd({ kind: "dead_end" })).toBe("backed_up");
        expect(supplyOfLaneEnd({ kind: "outlet", outlet_rate: { numerator: 1, denominator: 1 } })).toBe("moving");
    });
});
