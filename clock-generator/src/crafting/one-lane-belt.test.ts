import { describe, expect, it } from "vitest";
import { Config, ConfigSchema } from "../config/schema";
import { OpenRange } from "../data-types";
import { Entity } from "../entities";
import { everyInputLaneIsDeadEnd } from "../entities/traits/lane-ends";
import { laneFactsOfConfig } from "../entities/traits/build-traits";
import { isDeadEnd } from "../entities/traits/lane-facts";
import { backpressureHandTicks } from "./clock";
import { countedInserters } from "./inserter-counters";
import { movingPickupPhaseStarts } from "./moving-pickup-phase-starts";
import { clockBeltOf } from "./plan/unclocked-run";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";

type Lane = Config["belts"][number]["lanes"][number];

const iron = (fields: Partial<Lane> = {}): Lane => ({ ingredient: "iron-plate", stack_size: 1, ...fields });

/** One machine fed by one inserter from belt 1, which has the lanes given; with `backed_up_belts` set as given */
function configOf(lanes: Lane[], backed_up_belts?: boolean): Config {
    return ConfigSchema.parse({
        setpoint: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
        machines: [{ id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0 }],
        inserters: [{ id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 } }],
        belts: [{ id: 1, type: "transport-belt", lanes }],
        ...(backed_up_belts !== undefined && { overrides: { backed_up_belts } }),
    }) as Config;
}

/** The belt a clock is made for when the belt-fed inserter has a window */
function clockBelt(config: Config) {
    const registry = createEntityRegistryFromConfig(config);
    const inserter = registry.getAll().find(Entity.isInserter)!;
    return clockBeltOf(config, registry, new Map([[inserter.entity_id.id, [OpenRange.from(0, 10)]]]));
}

/** What the belt-fed inserter of the config reads of its belt's lanes */
function pickupOf(config: Config) {
    const inserter = createEntityRegistryFromConfig(config).getAll().find(Entity.isInserter)!;
    return {
        lane_ends: inserter.belt_lane_facts!.map(facts => facts.lane_end.kind),
        has_backpressure: countedInserters(config)[0].pickup_has_backpressure,
        hand_ticks: backpressureHandTicks(createEntityRegistryFromConfig(config)).size > 0,
    };
}

describe("a belt that states one lane", () => {
    it("has one lane: its lane facts hold no fact for the lane it does not state", () => {
        for (const backed_up_belts of [true, false, undefined]) {
            const facts = laneFactsOfConfig(configOf([iron()], backed_up_belts));
            expect(facts.lanesOf(1)).toHaveLength(1);
            expect(() => facts.of(1, 2)).toThrow("Lane 2 of belt 1 is not in the config");
        }
    });

    it("is backed up where its lane is a dead end, and gets a clock for backed-up belts", () => {
        for (const config of [configOf([iron({ lane_end: { kind: "dead_end" } })]), configOf([iron()], true)]) {
            expect(everyInputLaneIsDeadEnd(config)).toBe(true);
            expect(clockBelt(config)).toEqual({ kind: "backed_up" });
            expect(pickupOf(config)).toEqual({ lane_ends: ["dead_end"], has_backpressure: true, hand_ticks: true });
        }
    });

    it("moves where its lane is an infinite end, as before", () => {
        for (const config of [configOf([iron()]), configOf([iron({ lane_end: { kind: "infinite" } })])]) {
            expect(everyInputLaneIsDeadEnd(config)).toBe(false);
            expect(clockBelt(config)).toEqual({ kind: "moving" });
            expect(pickupOf(config)).toEqual({ lane_ends: ["infinite"], has_backpressure: false, hand_ticks: false });
        }
    });

    it("moves where its lane states an infinite end and the config's belts are backed up: no dead end comes from the lane it does not state", () => {
        const config = configOf([iron({ lane_end: { kind: "infinite" } })], true);
        expect(everyInputLaneIsDeadEnd(config)).toBe(false);
        expect(clockBelt(config)).toEqual({ kind: "moving" });
        expect(pickupOf(config)).toEqual({ lane_ends: ["infinite"], has_backpressure: false, hand_ticks: false });
        // a pickup with no dead end is a moving pickup, so its starts are varied
        expect([...movingPickupPhaseStarts(config)].length).toBeGreaterThan(0);
    });
});

describe("a belt that states two lanes", () => {
    const two = (first: Lane, second: Lane, backed_up_belts?: boolean) => configOf([first, second], backed_up_belts);

    it("is backed up only where both lanes are dead ends", () => {
        const dead_end = iron({ lane_end: { kind: "dead_end" } });
        expect(everyInputLaneIsDeadEnd(two(dead_end, dead_end))).toBe(true);
        expect(clockBelt(two(dead_end, dead_end))).toEqual({ kind: "backed_up" });
        expect(pickupOf(two(dead_end, dead_end))).toEqual({ lane_ends: ["dead_end", "dead_end"], has_backpressure: true, hand_ticks: true });
    });

    it("moves where one lane is a dead end and the other an infinite end", () => {
        for (const config of [two(iron({ lane_end: { kind: "dead_end" } }), iron()), two(iron(), iron({ lane_end: { kind: "dead_end" } }))]) {
            expect(everyInputLaneIsDeadEnd(config)).toBe(false);
            expect(clockBelt(config)).toEqual({ kind: "moving" });
            expect(pickupOf(config).has_backpressure).toBe(false);
        }
    });

    it("keeps a stated lane with no item as a lane, with the end it states or the switch gives it", () => {
        const empty = (fields: Partial<Lane> = {}) => ({ ingredient: "", stack_size: 1, ...fields });
        const dead_end = iron({ lane_end: { kind: "dead_end" } });
        expect(everyInputLaneIsDeadEnd(two(dead_end, empty()))).toBe(false);
        expect(clockBelt(two(dead_end, empty()))).toEqual({ kind: "moving" });
        expect(everyInputLaneIsDeadEnd(two(dead_end, empty({ lane_end: { kind: "dead_end" } })))).toBe(true);
        expect(everyInputLaneIsDeadEnd(two(iron(), empty(), true))).toBe(true);
        expect(laneFactsOfConfig(two(dead_end, empty())).lanesOf(1).map(facts => isDeadEnd(facts))).toEqual([true, false]);
    });
});
