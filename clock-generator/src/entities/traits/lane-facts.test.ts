import { describe, expect, it } from "vitest";
import { Config, ConfigSchema } from "../../config/schema";
import { beltLanes, beltLanesOfFacts, supplyOfLaneEnd } from "./lane";
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

    it("has every copy share the lane, and never says a lane's end is unknown", () => {
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

describe("the question about every input lane", () => {
    const inserters = [take(1, 1), put(2, 2)];

    it.each([[true], [false], [undefined]])("answers as the switch (%s) when a belt is taken from", backed_up_belts => {
        const config = configOf({ machines, belts, inserters, overrides: backed_up_belts === undefined ? {} : { backed_up_belts } });
        expect(everyInputLaneIsDeadEnd(config)).toBe(backed_up_belts === true);
    });

    it.each([[true], [false]])("answers as the switch (%s) when no belt is taken from, or no belt is listed", backed_up_belts => {
        const overrides = { backed_up_belts };
        expect(everyInputLaneIsDeadEnd(configOf({ machines, belts, inserters: [put(1, 2)], overrides }))).toBe(backed_up_belts);
        expect(everyInputLaneIsDeadEnd(configOf({ overrides }))).toBe(backed_up_belts);
    });
});

describe("the lane traits of the facts", () => {
    it("carry the supply of each lane's end and match the single-supply form", () => {
        for (const backed_up_belts of [true, false]) {
            const config = configOf({ belts, overrides: { backed_up_belts } });
            const supply = backed_up_belts ? "backed_up" : "moving";
            for (const belt of config.belts) {
                expect(beltLanesOfFacts(belt, laneFactsOf(config))).toEqual(beltLanes(belt, supply));
            }
        }
    });

    it("name a dead end backed up and an outlet moving", () => {
        expect(supplyOfLaneEnd({ kind: "dead_end" })).toBe("backed_up");
        expect(supplyOfLaneEnd({ kind: "outlet", outlet_rate: { numerator: 1, denominator: 1 } })).toBe("moving");
    });
});
