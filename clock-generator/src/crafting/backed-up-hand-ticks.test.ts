import path from "path";
import {beforeAll, expect, test} from "vitest";
import {Config} from "../config";
import {loadConfigFromFile} from "../config/loader";
import {OpenRange} from "../data-types";
import {SimulationContext} from "./sequence/simulation-context";
import {backedUpHandTicks, withWindowsAtLeast} from "./clock";
import {GameFixturePaths} from "../../tests/game/helpers/fixture-paths";

// The front underground exit's electromagnetic plant: its input inserter takes accumulators and supercapacitors, each
// on a lane of its own, through the half tile of the exit
let config: Config;
beforeAll(async () => {config = await loadConfigFromFile(path.join(GameFixturePaths.FRONT_UNDERGROUND_EXIT, "config.json"));});

function handTicksAt(prefix: "" | "fast-" | "express-" | "turbo-", backed_up_belts: boolean, layout?: {pickup_layout: "side-straight"; pickup_length: 1}) {
    const copy = structuredClone(config);
    copy.belts.forEach(belt => {belt.type = `${prefix}transport-belt`;});
    copy.overrides = {...copy.overrides, backed_up_belts};
    const input = copy.inserters.find(inserter => inserter.source.type === "belt")!;
    if (layout && input.source.type === "belt") Object.assign(input.source, layout);
    return backedUpHandTicks(SimulationContext.fromConfig(copy).entity_registry);
}

test("a backed-up belt slower than a stack a tick names the ticks a hand takes from the lanes at rest", () => {
    expect(handTicksAt("", true)).toEqual(new Map([["inserter:2", 10]]));
    expect(handTicksAt("fast-", true)).toEqual(new Map([["inserter:2", 6]]));
});

test("none where the belt gives a stack a tick, or where it moves", () => {
    expect(handTicksAt("express-", true).size).toBe(0);
    expect(handTicksAt("turbo-", true).size).toBe(0);
    expect(handTicksAt("", true, {pickup_layout: "side-straight", pickup_length: 1}).size).toBe(0);
    expect(handTicksAt("", false).size).toBe(0);
});

test("a window shorter than a hand takes is lengthened at its end, across the period's end too; longer ones stay", () => {
    const windows = new Map([
        ["inserter:2", [OpenRange.from(1, 8), OpenRange.from(25, 46), OpenRange.from(1405, 1407)]],
        ["inserter:1", [OpenRange.from(1, 3)]],
    ]);
    const lengthened = withWindowsAtLeast(windows, new Map([["inserter:2", 10]]), 1408);
    expect(lengthened.get("inserter:2")).toEqual([OpenRange.from(0, 10), OpenRange.from(25, 46), OpenRange.from(1405, 1407)]);
    expect(lengthened.get("inserter:1")).toBe(windows.get("inserter:1"));
    expect(withWindowsAtLeast(windows, new Map([["inserter:2", 10]]), 1408.5).get("inserter:2")).toBe(windows.get("inserter:2"));
});
