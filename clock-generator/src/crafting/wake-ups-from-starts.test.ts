import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { hasStockTheClockDoesNotSet, START_PLACES, startPlaces, wakeUpsFromStarts } from "./wake-ups-from-starts";

describe("the places a clock is started from", () => {
    it("are twelve evenly spaced places in whole ticks, the cold start first, as the as-built check's start phases", () => {
        expect(startPlaces(480)).toEqual([0, 40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440]);
        expect(startPlaces(1728 / 19)).toEqual([0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77]);
        expect(startPlaces(5)).toEqual([0, 1, 2, 3, 4]);
        expect(startPlaces(480)).toHaveLength(START_PLACES);
    });
});

describe("the wake-ups of a clock from the starts", () => {
    it("are the mean over every place", () => {
        const figures = [1258.3, 1258.3, 1257.9, 1278.2, 1277.5, 1207.7, 1207.7, 1207.5, 1277.5, 1277.5, 1226.3, 1226.5];
        const asked: number[] = [];
        const from_starts = wakeUpsFromStarts(480, place => { asked.push(place); return figures[place / 40]; })!;
        expect(asked).toEqual(startPlaces(480));
        expect(from_starts.places).toEqual(startPlaces(480));
        expect(from_starts.wake_ups_per_minute).toEqual(figures);
        expect(from_starts.mean).toBeCloseTo(figures.reduce((sum, it) => sum + it, 0) / 12, 9);
    });

    it("are not taken where a start has no long run, or the period has one place", () => {
        expect(wakeUpsFromStarts(480, place => place === 200 ? null : 10)).toBeNull();
        expect(wakeUpsFromStarts(1, () => 10)).toBeNull();
    });
});

describe("a stock the clock does not set", () => {
    it("is a loop of machines or a machine that makes its own ingredient", async () => {
        const registryOf = async (path: string) => createEntityRegistryFromConfig(await loadConfigFromFile(path));
        expect(hasStockTheClockDoesNotSet(await registryOf(ConfigPaths.AGRICULTURAL_SCIENCE))).toBe(true);
        expect(hasStockTheClockDoesNotSet(await registryOf(ConfigPaths.IRON_BACTERIA_CULTIVATION))).toBe(true);
        expect(hasStockTheClockDoesNotSet(await registryOf(ConfigPaths.ELECTRIC_FURNACE))).toBe(false);
    });
});
