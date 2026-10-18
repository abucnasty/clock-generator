import {expect, it} from "vitest";
import {ConfigSchema} from "./schema";
import {validateInserterCoverage} from "./inserter-coverage-validator";

function config() {
    return {
        target_output: {recipe: "electronic-circuit", items_per_second: 1, copies: 1},
        machines: [{id: 1, recipe: "electronic-circuit", crafting_speed: 1, productivity: 0}],
        belts: [{id: 1, type: "turbo-transport-belt", lanes: [{ingredient: "", stack_size: 4}, {ingredient: "iron-plate", stack_size: 4}]}],
        inserters: [{source: {type: "belt", id: 1, pickup_length: 1, pickup_merge: {
            lane: 2, outer: {ingredient: "iron-plate", stack_size: 4}, inner: {ingredient: "copper-cable", stack_size: 4},
            downstream_tiles: 3, outlet: "open",
        }}, sink: {type: "machine", id: 1}}],
    };
}
it("preserves both ingredients and accepts moving or backed-up supply without changing geometry", () => {
    for (const backed_up_belts of [false, true]) {
        const parsed = ConfigSchema.parse({...config(), overrides: {backed_up_belts}});
        expect(parsed.inserters[0].source).toMatchObject(config().inserters[0].source);
        expect(validateInserterCoverage(parsed).filter(issue => issue.kind === "missing_input_inserter")).toEqual([]);
    }
});
it.each(["express-transport-belt", "fast-transport-belt", "transport-belt"])("rejects an uncalibrated speed: %s", type => {
    const raw = config(); raw.belts[0].type = type;
    expect(ConfigSchema.safeParse(raw).success).toBe(false);
});
it("rejects unsupported geometry, stream stack sizes, receiving lanes and shared pickups", () => {
    const underground = config(); underground.inserters[0].source.pickup_length = 0.5;
    const smaller = config(); smaller.inserters[0].source.pickup_merge.inner.stack_size = 2;
    const wrongItem = config(); wrongItem.belts[0].lanes[1].ingredient = "copper-cable";
    const otherLane = config(); otherLane.belts[0].lanes[0].ingredient = "copper-cable";
    const shared = config(); shared.inserters.push(structuredClone(shared.inserters[0]));
    for (const raw of [underground, smaller, wrongItem, otherLane, shared]) expect(ConfigSchema.safeParse(raw).success).toBe(false);
    const raw = config();
    expect(ConfigSchema.safeParse({...raw, inserters: [{...raw.inserters[0], source: {...raw.inserters[0].source, pickup_supply: ["through", "side-inner"]}}]}).success).toBe(false);
});
