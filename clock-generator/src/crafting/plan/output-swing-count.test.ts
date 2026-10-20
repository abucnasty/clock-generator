import { beforeAll, describe, expect, it } from "vitest";
import { Config } from "../../config";
import { validateConfig } from "./validate-config";
import { pickupClockConfig, pickupClockSpeedCases } from "../../../tests/game/builds/pickup-clock-speed-coverage";

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

// On the express moving half-tile pickups a cold plant gets one hand of each ingredient before its output blocks where
// backed-up belts give it two: 44 packs made against 88, 2.75 hands against 5.5. Planned on 2.75, the whole swings were
// 2, a period of part ticks that no moving clock can be made for, and the backoff never reached 3, where one holds.
describe("output swings per cycle of a build on moving belts", () => {
    let moving: Config;
    beforeAll(async () => {
        const variant = pickupClockSpeedCases("electromagnetic").find(it => it.name === "electromagnetic-express-underground-entrance-moving")!;
        moving = await pickupClockConfig(variant);
    });

    it("counts whole swings as on backed-up belts", () => {
        const backed_up: Config = { ...moving, overrides: { ...moving.overrides, backed_up_belts: true } };
        expect(validateConfig(backed_up, { logger: quiet }).output_swings_per_cycle).toBe(5);
        expect(validateConfig(moving, { logger: quiet }).output_swings_per_cycle).toBe(5);
    });

    it("keeps the build's own count for fractional swings, which are that count rather than capped by it", () => {
        const fractional: Config = { ...moving, overrides: { ...moving.overrides, use_fractional_swings: true } };
        expect(validateConfig(fractional, { logger: quiet }).output_swings_per_cycle).toBe(2.75);
    });
});
