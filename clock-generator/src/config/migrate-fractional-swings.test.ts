import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseConfig } from "./loader";
import { dropFractionalSwingsOverride } from "./migrate-fractional-swings";

const FIXTURE = path.join(__dirname, "fixtures", "legacy", "fractional-swings.json");

describe("the former use_fractional_swings override", () => {
    it("is read from overrides of any value, and nothing else is changed", () => {
        expect(dropFractionalSwingsOverride({ use_fractional_swings: true, lcm: 2 })).toEqual({ lcm: 2 });
        expect(dropFractionalSwingsOverride({ use_fractional_swings: false })).toEqual({});
        for (const value of [undefined, null, 3, "overrides", [], { lcm: 2 }]) {
            expect(dropFractionalSwingsOverride(value)).toBe(value);
        }
    });

    it("loads with a config that carries it, as the same config without it", async () => {
        const text = fs.readFileSync(FIXTURE, "utf8");
        const without = JSON.parse(text);
        delete without.overrides.use_fractional_swings;
        const config = await parseConfig(text);
        expect(config.overrides).toEqual({ lcm: 2 });
        expect(config).toEqual(await parseConfig(JSON.stringify(without)));
    });
});
