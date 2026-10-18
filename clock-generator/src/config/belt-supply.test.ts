import { describe, expect, it } from "vitest";
import { ConfigOverridesSchema, ConfigSchema } from "./schema";
import { parseConfig } from "./loader";

describe("backed-up belt configuration", () => {
    it.each([false, true])("migrates the former setting %s to the canonical config name", async value => {
        const input = {
            target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
            machines: [], inserters: [], belts: [], overrides: { non_moving_belts: value },
        };
        for (const config of [ConfigSchema.parse(input), await parseConfig(JSON.stringify(input))]) {
            expect(config.overrides).toEqual({ backed_up_belts: value });
            expect(JSON.stringify(config)).not.toContain("non_moving_belts");
        }
        expect(input.overrides).toEqual({ non_moving_belts: value });
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
