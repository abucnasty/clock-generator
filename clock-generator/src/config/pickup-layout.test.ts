import {expect, test} from "vitest";
import {ConfigSchema} from "./schema";
import {BELT_PICKUP_LAYOUTS, pickupLengthForLayout} from "../common/belt-pickup-layout";
import {SimulationContext} from "../crafting/sequence/simulation-context";

function config(source: object) {
    return {
        target_output: {recipe: "iron-gear-wheel", items_per_second: 1, copies: 1},
        machines: [{id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0}],
        inserters: [{id: 1, source: {type: "belt", id: 1, ...source}, sink: {type: "machine", id: 1}}],
        belts: [{id: 1, type: "turbo-transport-belt", lanes: [{ingredient: "iron-plate", stack_size: 4}]}],
    };
}

for (const layout of BELT_PICKUP_LAYOUTS) test(`explicit ${layout} layout supplies reach independently of supply motion`, () => {
    for (const backed_up_belts of [false, true]) {
        const parsed = ConfigSchema.parse({...config({pickup_layout: layout, near_lane: 1}), overrides: {backed_up_belts}});
        expect(parsed.inserters[0].source).toMatchObject({pickup_layout: layout, pickup_length: pickupLengthForLayout(layout)});
        const input = SimulationContext.fromConfig(parsed).inserters[0].inserter_state.inserter;
        expect(input.pickup_layout).toBe(layout);
        expect(input.pickup_length).toBe(pickupLengthForLayout(layout));
        expect(input.belt_supply).toBe(backed_up_belts ? "backed_up" : "moving");
    }
});

test("manual half-tile geometry needs a layout choice, including direct engine inputs", () => {
    expect(() => ConfigSchema.parse(config({pickup_length: 0.5}))).toThrow("Choose the underground pickup layout");
    const parsed = ConfigSchema.parse(config({pickup_layout: "side-entrance"}));
    const source = parsed.inserters[0].source;
    if (source.type !== "belt") throw Error("Expected belt");
    delete source.pickup_layout;
    expect(() => SimulationContext.fromConfig(parsed)).toThrow("Choose the underground pickup layout");
    expect(ConfigSchema.safeParse(config({pickup_layout: "side-entrance", pickup_length: 1})).success).toBe(false);
    expect(ConfigSchema.safeParse(config({pickup_layout: "unknown"})).success).toBe(false);
});

test("older positive underground captures require recapture and remain unclassified across reloads", () => {
    let parsed = ConfigSchema.parse(config({pickup_length: 0.5, near_lane: 1, pickup_capture: {
        status: "supported", model: "belt", model_version: 1, entity_type: "underground-belt", sidecar_version: "0.11.0",
    }}));
    for (let reload = 0; reload < 3; reload++) {
        parsed = ConfigSchema.parse(JSON.parse(JSON.stringify(parsed)));
        expect(parsed.inserters[0].source).toMatchObject({pickup_capture: {status: "unclassified", reason: "layout-not-captured"}});
        expect(() => SimulationContext.fromConfig(parsed)).toThrow("Update Sidecar and recapture");
    }
});

test("capture model 2 needs explicit layout and consistent geometry", () => {
    const capture = {status: "supported", model: "belt", model_version: 2, entity_type: "underground-belt", sidecar_version: "0.11.0"};
    expect(ConfigSchema.safeParse(config({pickup_length: 0.5, near_lane: 1, pickup_capture: capture})).success).toBe(false);
    const parsed = ConfigSchema.parse(config({pickup_layout: "front-entrance", near_lane: 1, pickup_capture: capture}));
    expect(parsed.inserters[0].source).toMatchObject({pickup_layout: "front-entrance", pickup_length: 0.5, pickup_capture: capture});
    expect(() => SimulationContext.fromConfig(parsed)).not.toThrow();
});


test("right-bend capture requires the measured approach, lane and new capture model", () => {
    const capture = {status: "supported", model: "belt", model_version: 3, entity_type: "transport-belt"};
    const source = {pickup_layout: "bend-right-upstream", near_lane: 1, pickup_capture: capture};
    expect(() => SimulationContext.fromConfig(ConfigSchema.parse(config(source)))).not.toThrow();
    expect(ConfigSchema.safeParse(config({...source, near_lane: 2})).success).toBe(false);
    expect(ConfigSchema.safeParse(config({...source, pickup_capture: {...capture, model_version: 2}})).success).toBe(false);
    expect(ConfigSchema.safeParse(config({...source, pickup_layout: "side-straight"})).success).toBe(false);
    expect(ConfigSchema.safeParse(config({...source, pickup_capture: {...capture, entity_type: "underground-belt"}})).success).toBe(false);
});


test("a manual right-bend layout refuses belt tiers outside its measured timing", () => {
    const parsed = ConfigSchema.parse(config({pickup_layout: "bend-right-upstream", near_lane: 1}));
    parsed.belts[0].type = "express-transport-belt";
    expect(() => SimulationContext.fromConfig(parsed)).toThrow("calibrated for turbo belts only");
});
