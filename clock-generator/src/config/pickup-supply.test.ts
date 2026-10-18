import { describe, expect, it } from "vitest";
import { ConfigSchema, InserterConfigSchema } from "./schema";

function config(pickup_supply: unknown, pickup_length = 1) {
    return {
        target_output: { recipe: "electronic-circuit", items_per_second: 1, copies: 1 }, machines: [],
        belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ingredient: "", stack_size: 4}, {ingredient: "iron-plate", stack_size: 4}] }],
        inserters: [{source: {type: "belt", id: 1, pickup_length, ...(pickup_supply === undefined ? {} : {pickup_supply})}, sink: {type: "machine", id: 1}}],
    };
}

describe("single-stream pickup supply configuration", () => {
    it("preserves receiving-lane profiles independently of motion, geometry and preference", () => {
        for (const backed_up_belts of [false, true]) {
            const parsed = ConfigSchema.parse({...config(["through", "side-inner"]), overrides: {backed_up_belts}});
            expect(parsed.inserters[0].source).toEqual({type: "belt", id: 1, pickup_length: 1, pickup_supply: ["through", "side-inner"]});
        }
    });
    it("leaves old configs on through supply without adding serialized metadata", () => {
        expect(ConfigSchema.parse(config(undefined)).inserters[0].source).not.toHaveProperty("pickup_supply");
    });
    it.each([[], ["through"], ["through", "side-inner", "through"], ["through", "merge"], ["through", 0.25]].map(profiles => ({profiles})))("rejects invalid profiles or a lane-count mismatch: $profiles", ({profiles}) => {
        expect(ConfigSchema.safeParse(config(profiles)).success).toBe(false);
    });
    it("rejects side-entry profiles at underground endpoints", () => {
        expect(ConfigSchema.safeParse(config(["through", "side-outer"], 0.5)).success).toBe(false);
        expect(ConfigSchema.safeParse(config(["through", "through"], 0.5)).success).toBe(true);
    });
    it("does not attach supply profiles to non-belt sources", () => {
        expect(InserterConfigSchema.parse({source: {type: "chest", id: 1, pickup_supply: ["side-inner"]}, sink: {type: "machine", id: 1}}).source).not.toHaveProperty("pickup_supply");
    });
});
