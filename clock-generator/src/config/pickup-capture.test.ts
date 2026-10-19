import {describe, expect, it} from "vitest";
import {ConfigSchema} from "./schema";
import {sidecarPickupInserters} from "./pickup-capture";
import {SimulationContext} from "../crafting/sequence/simulation-context";

const base = () => ({
    target_output: {recipe: "iron-gear-wheel", items_per_second: 1, copies: 1},
    machines: [{id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0}],
    inserters: [
        {id: 1, source: {type: "belt", id: 1}, sink: {type: "machine", id: 1}, stack_size: 16},
        {id: 2, source: {type: "machine", id: 1}, sink: {type: "chest", id: 1}, stack_size: 16},
    ],
    belts: [{id: 1, type: "turbo-transport-belt", lanes: [{ingredient: "iron-plate", stack_size: 4}]}],
    chests: [{id: 1, type: "infinity-chest", item_filter: [], remove_unfiltered_items: true}],
});
const supported = {status: "supported", model: "belt", model_version: 1, entity_type: "transport-belt", sidecar_version: "0.11.0"};
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

    it.each(["0.9.1", "0.11.0", "99.0.0"])("preserves an unsupported splitter from %s across save/reload", version => {
        let config = ConfigSchema.parse({...base(), sidecar_version: version, pickup_warnings: [{inserter_id: 1, reason: "splitter"}]});
        for (let reload = 0; reload < 3; reload++) {
            config = ConfigSchema.parse(JSON.parse(JSON.stringify(config)));
            expect(config.inserters[0].source).toMatchObject({pickup_capture: {
                status: "unsupported", entity_type: "splitter", reason: "splitter", sidecar_version: version,
            }});
            // Parsing fills manual defaults, but they can never turn this capture into a supported pickup.
            expect(() => SimulationContext.fromConfig(config)).toThrow(/Inserter 1: Pickup captured as unsupported \(splitter\)/);
        }
    });

    it("does not treat geometry or even the current mod version as a positive capture declaration", () => {
        const raw = withSource({pickup_length: 0.5, near_lane: 2});
        const config = ConfigSchema.parse({...raw, sidecar_version: "0.11.0"});
        expect(config.inserters[0].source).toMatchObject({pickup_length: 0.5, pickup_capture: {status: "unclassified", reason: "legacy"}});
        expect(() => SimulationContext.fromConfig(config)).toThrow(/Update Sidecar and recapture/);
    });

    it("migrates pasted entries before defaults and gives an explicit warning precedence", () => {
        const entries = [{source: {type: "belt", id: 1, near_lane: 1, pickup_capture: supported}}];
        expect(sidecarPickupInserters(entries, "0.11.0", [{inserter_id: 1, reason: "merge"}])).toMatchObject([
            {source: {pickup_capture: {status: "unsupported", reason: "merge"}}},
        ]);
        expect(sidecarPickupInserters(entries, "0.11.0", [])).toEqual(entries);
    });

    it.each([
        {...supported, model: "splitter"},
        {...supported, model_version: 3},
        {...supported, entity_type: "splitter"},
    ])("rejects unsupported model declarations instead of stripping their new fields", capture => {
        expect(ConfigSchema.safeParse(withSource({near_lane: 1, pickup_capture: capture})).success).toBe(false);
    });

    it("requires matching physical and supply inputs for a supported model", () => {
        expect(ConfigSchema.safeParse(withSource({pickup_capture: supported})).success).toBe(false);
        expect(ConfigSchema.safeParse(withSource({near_lane: 1, pickup_length: 0.5, pickup_capture: supported})).success).toBe(false);
        expect(ConfigSchema.safeParse(withSource({near_lane: 1, pickup_capture: {...supported, model: "turbo-two-stream"}})).success).toBe(false);
    });
});
