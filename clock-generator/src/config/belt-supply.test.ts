import path from "path";
import { describe, expect, it } from "vitest";
import { ConfigOverridesSchema, ConfigSchema } from "./schema";
import { loadConfigFromFile, parseConfig } from "./loader";

describe("backed-up belt configuration", () => {
    it.each([false, true])("migrates the former setting %s to the canonical config name", async value => {
        const input = {
            setpoint: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
            machines: [], inserters: [], belts: [], overrides: { non_moving_belts: value },
        };
        for (const config of [ConfigSchema.parse(input), await parseConfig(JSON.stringify(input))]) {
            expect(config.overrides).toEqual({ backed_up_belts: value });
            expect(JSON.stringify(config)).not.toContain("non_moving_belts");
        }
        expect(input.overrides).toEqual({ non_moving_belts: value });
    });

    it("migrates the legacy fixture's former setting, keeping the other overrides", async () => {
        const config = await loadConfigFromFile(path.join(__dirname, "fixtures/legacy/non-moving-belts.json"));
        expect(config.overrides).toEqual({ lcm: 2, backed_up_belts: true });
    });

    it("lets the canonical setting win when both spellings are present", () => {
        expect(ConfigOverridesSchema.parse({ non_moving_belts: true, backed_up_belts: false, lcm: 2 }))
            .toEqual({ backed_up_belts: false, lcm: 2 });
    });

    it("keeps moving supply as the default and rejects invalid migrated values", () => {
        expect(ConfigOverridesSchema.parse({})).toEqual({});
        expect(ConfigOverridesSchema.safeParse({ non_moving_belts: "true" }).success).toBe(false);
        expect(ConfigOverridesSchema.safeParse({ backed_up_belts: "true" }).success).toBe(false);
    });
});

describe("lane facts in the configuration", () => {
    const configWith = (lane: Record<string, unknown>, strategy?: "export") => ({
        setpoint: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
        machines: [], inserters: [],
        belts: [{ id: 1, type: "turbo-transport-belt", ...(strategy && { strategy }), lanes: [{ ingredient: "iron-plate", stack_size: 4, ...lane }] }],
    });

    it.each<[string, Record<string, unknown>]>([
        ["a supply rate", { supply_rate: 120.7 }],
        ["a dead end", { lane_end: { kind: "dead_end" } }],
        ["an outlet with its rate", { lane_end: { kind: "outlet", outlet_rate: 88 } }],
        ["a free outlet, without a rate", { lane_end: { kind: "outlet" } }],
        ["an unknown end", { lane_end: { kind: "unknown" } }],
        ["a lane each copy has to itself", { sharing: "one_per_copy" }],
        ["a lane the copies share", { sharing: "shared_by_copies" }],
        ["all three", { supply_rate: 60, lane_end: { kind: "dead_end" }, sharing: "one_per_copy" }],
    ])("keeps %s on a lane as the file states it", async (_, lane) => {
        const input = configWith(lane);
        for (const config of [ConfigSchema.parse(input), await parseConfig(JSON.stringify(input))]) {
            expect(config.belts[0].lanes[0]).toEqual({ ingredient: "iron-plate", stack_size: 4, ...lane });
        }
    });

    it("keeps the facts of an export lane beside its consumption, and refuses a lane end there: the consumption is its outlet rate", () => {
        const lane = { consumption_per_second: 5, supply_rate: 100, sharing: "one_per_copy" };
        expect(ConfigSchema.parse(configWith(lane, "export")).belts[0].lanes[0]).toEqual({ ingredient: "iron-plate", stack_size: 4, ...lane });
        expect(ConfigSchema.safeParse(configWith({ ...lane, lane_end: { kind: "outlet", outlet_rate: 5 } }, "export")).success).toBe(false);
    });

    it("adds no lane fact to a lane that states none", () => {
        expect(ConfigSchema.parse(configWith({})).belts[0].lanes[0]).toStrictEqual({ ingredient: "iron-plate", stack_size: 4 });
    });

    it.each<[string, Record<string, unknown>]>([
        ["a supply rate of zero", { supply_rate: 0 }],
        ["a supply rate that is not a number", { supply_rate: "120" }],
        ["an outlet rate of zero", { lane_end: { kind: "outlet", outlet_rate: 0 } }],
        ["an end of another kind", { lane_end: { kind: "loop" } }],
        ["an end given as text", { lane_end: "dead_end" }],
        ["a sharing of another kind", { sharing: "shared" }],
    ])("refuses %s", (_, lane) => {
        expect(ConfigSchema.safeParse(configWith(lane)).success).toBe(false);
    });
});
