import {describe, expect, it} from "vitest";
import {ConfigSchema} from "./schema";
import {SimulationContext} from "../crafting/sequence/simulation-context";

const base = () => ({
    setpoint: {item: "iron-gear-wheel", items_per_second: 1, copies: 1},
    machines: [{id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0}],
    inserters: [
        {id: 1, source: {type: "belt", id: 1}, sink: {type: "machine", id: 1}, stack_size: 16},
        {id: 2, source: {type: "machine", id: 1}, sink: {type: "chest", id: 1}, stack_size: 16},
    ],
    belts: [{id: 1, type: "turbo-transport-belt", lanes: [{ingredient: "iron-plate", stack_size: 4, lane_end: {kind: "infinite"}}]}],
    chests: [{id: 1, type: "infinity-chest", item_filter: [], remove_unfiltered_items: true}],
});
const supported = {status: "supported", model: "belt", model_version: 1, entity_type: "transport-belt"};
const withSource = (fields: object) => {
    const config = base();
    return {...config, inserters: [{...config.inserters[0], source: {...config.inserters[0].source, ...fields}}, config.inserters[1]]};
};

describe("persistent pickup capture boundary", () => {
    it("keeps the omitted geometry default for manually configured belts", () => {
        const config = ConfigSchema.parse(base());
        expect(config.inserters[0].source).toEqual({type: "belt", id: 1, pickup_length: 1});
        expect(() => SimulationContext.fromConfig(config)).not.toThrow();
    });

    it("accepts a positive model declaration with matching geometry and lane data", () => {
        const config = ConfigSchema.parse(withSource({pickup_length: 1, near_lane: 1, pickup_capture: supported}));
        expect(() => SimulationContext.fromConfig(config)).not.toThrow();
        expect(config.inserters[0].source).toMatchObject({pickup_capture: supported});
    });

    it.each([
        {...supported, model: "splitter"},
        {...supported, model_version: 3},
        {...supported, entity_type: "splitter"},
        {...supported, model: "turbo-two-stream"},
    ])("rejects unsupported model declarations instead of stripping their new fields", capture => {
        expect(ConfigSchema.safeParse(withSource({near_lane: 1, pickup_capture: capture})).success).toBe(false);
    });

    it("requires matching physical inputs for a supported model", () => {
        expect(ConfigSchema.safeParse(withSource({pickup_capture: supported})).success).toBe(false);
        expect(ConfigSchema.safeParse(withSource({near_lane: 1, pickup_length: 0.5, pickup_capture: supported})).success).toBe(false);
    });
});
