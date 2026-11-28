/**
 * The throttles of a pasted blueprint: an inserter that takes from a belt into an infinity chest that removes every item.
 * Each row is a small blueprint of belts, inserters and chests, and the list of the throttles that the import reads in it,
 * as [inserter, chest, lane].
 */
import fs from "fs";
import path from "path";
import pako from "pako";
import { describe, expect, it } from "vitest";
import type { FactorioData } from "../data/factorio-data-types";
import { geometryDataOf, worldDataOf } from "./assemble";
import { decodeBlueprint } from "./decode";
import { geometryOf } from "./geometry";
import { throttlesOf } from "./throttles";
import { worldOf } from "./world";

const DATA = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../..", "resources", "data-filtered.json"), "utf8")) as FactorioData;

type Raw = Record<string, unknown>;
const VERSION_2 = 2 * 2 ** 48 + 1 * 2 ** 32 + 25 * 2 ** 16 + 10;
const pack = (json: unknown): string => "0" + Buffer.from(pako.deflate(new TextEncoder().encode(JSON.stringify(json)))).toString("base64");

/** Six belts going east on y 0.5, entities 1 to 6 */
const belts = (): Raw[] => [1, 2, 3, 4, 5, 6].map((n) => ({ entity_number: n, name: "transport-belt", position: { x: n - 0.5, y: 0.5 }, direction: 4 }));
/** A stack inserter beside the belt at tile `x`: north of it for lane 1, south of it for lane 2; it drops away from the belt */
const inserter = (n: number, x: number, lane: 1 | 2, extra: Raw = {}): Raw =>
    lane === 1
        ? { entity_number: n, name: "stack-inserter", position: { x: x + 0.5, y: -0.5 }, direction: 8, ...extra }
        : { entity_number: n, name: "stack-inserter", position: { x: x + 0.5, y: 1.5 }, direction: 0, ...extra };
/** The chest the inserter at tile `x` drops into */
const chest = (n: number, x: number, lane: 1 | 2, name = "infinity-chest", settings: Raw = { remove_unfiltered_items: true }): Raw => ({
    entity_number: n, name, position: { x: x + 0.5, y: lane === 1 ? -1.5 : 2.5 }, ...(name === "infinity-chest" ? { infinity_settings: settings } : {}),
});
/** A throttle: an inserter and its voiding chest */
const throttle = (n: number, x: number, lane: 1 | 2): Raw[] => [inserter(n, x, lane), chest(n + 1, x, lane)];
/** A real taker: an inserter into a steel chest */
const taker = (n: number, x: number, lane: 1 | 2): Raw[] => [inserter(n, x, lane), chest(n + 1, x, lane, "steel-chest")];

function throttlesIn(entities: Raw[], laneLines: readonly (1 | 2)[] = [1, 2]): [number, number, number][] {
    const decoded = decodeBlueprint(pack({ blueprint: { item: "blueprint", version: VERSION_2, entities } }));
    if (decoded.kind !== "blueprint") throw new Error("not a blueprint");
    const world = worldOf(decoded.entities, worldDataOf(DATA));
    const geometry = geometryOf(world, decoded.entities, geometryDataOf(DATA));
    return throttlesOf(world, geometry, decoded.entities, () => laneLines).map((t) => [t.inserter, t.chest, t.lane]);
}

describe("the throttles of a blueprint", () => {
    it("reads one throttle on lane 1", () => {
        expect(throttlesIn([...belts(), ...throttle(10, 5, 1)])).toEqual([[10, 11, 1]]);
    });

    it("reads a throttle on each lane", () => {
        expect(throttlesIn([...belts(), ...throttle(10, 5, 1), ...throttle(12, 5, 2)])).toEqual([[10, 11, 1], [12, 13, 2]]);
    });

    it("reads two throttles that drop into one chest", () => {
        // a second belt line above the first: its inserter takes from lane 2 of that line and drops into the first throttle's chest
        const second: Raw[] = [21, 22, 23, 24, 25, 26].map((n) => ({ entity_number: n, name: "transport-belt", position: { x: n - 20.5, y: -3.5 }, direction: 4 }));
        const upper = { entity_number: 20, name: "stack-inserter", position: { x: 5.5, y: -2.5 }, direction: 0 };
        expect(throttlesIn([...belts(), ...second, ...throttle(10, 5, 1), upper])).toEqual([[10, 11, 1], [20, 11, 2]]);
    });

    it("reads two throttles one after the other on one lane", () => {
        expect(throttlesIn([...belts(), ...throttle(10, 3, 1), ...throttle(12, 5, 1)])).toEqual([[10, 11, 1], [12, 13, 1]]);
    });

    it("reads a throttle downstream of a real taker of its lane, and not the taker", () => {
        expect(throttlesIn([...belts(), ...taker(30, 1, 1), ...throttle(10, 5, 1)])).toEqual([[10, 11, 1]]);
    });

    it("lets a taker of the other lane downstream stand", () => {
        expect(throttlesIn([...belts(), ...throttle(10, 3, 1), ...taker(30, 5, 2)])).toEqual([[10, 11, 1]]);
    });

    describe("does not read a throttle where", () => {
        const second: Raw[] = [21, 22, 23, 24, 25, 26].map((n) => ({ entity_number: n, name: "transport-belt", position: { x: n - 20.5, y: -3.5 }, direction: 4 }));
        const withChest = (settings: Raw) => [...belts(), inserter(10, 5, 1), chest(11, 5, 1, "infinity-chest", settings)];
        it.each<[string, Raw[]]>([
            ["the chest has a filter", withChest({ remove_unfiltered_items: true, filters: [{ index: 1, name: "iron-plate", count: 50 }] })],
            ["the chest does not remove unfiltered items", withChest({ remove_unfiltered_items: false })],
            ["an inserter takes from the chest", [...belts(), ...throttle(10, 5, 1), { entity_number: 30, name: "stack-inserter", position: { x: 6.5, y: -1.5 }, direction: 12 }, { entity_number: 31, name: "steel-chest", position: { x: 7.5, y: -1.5 } }]],
            ["a machine's output inserter also drops into the chest", [...belts(), ...throttle(10, 5, 1),
                { entity_number: 30, name: "assembling-machine-3", position: { x: 5.5, y: -4.5 }, recipe: "iron-gear-wheel" },
                { entity_number: 31, name: "stack-inserter", position: { x: 5.5, y: -2.5 }, direction: 0 }]],
            ["a filtered inserter of a second belt also drops into the chest", [...belts(), ...second, ...throttle(10, 5, 1), { entity_number: 20, name: "stack-inserter", position: { x: 5.5, y: -2.5 }, direction: 0, use_filters: true, filters: [{ index: 1, name: "iron-plate", quality: "normal", comparator: "=" }] }]],
            ["the inserter has a filter", [...belts(), inserter(10, 5, 1, { use_filters: true, filters: [{ index: 1, name: "iron-plate", quality: "normal", comparator: "=" }] }), chest(11, 5, 1)]],
            ["the pickup has no near lane", [...belts(), { entity_number: 10, name: "stack-inserter", position: { x: 6.5, y: 0.5 }, direction: 12 }, { entity_number: 11, name: "infinity-chest", position: { x: 7.5, y: 0.5 }, infinity_settings: { remove_unfiltered_items: true } }]],
            ["a taker of the lane that is not a throttle is downstream", [...belts(), ...throttle(10, 3, 1), ...taker(30, 5, 1)]],
            ["the chest is a steel chest", [...belts(), inserter(10, 5, 1), chest(11, 5, 1, "steel-chest")]],
        ])("%s", (_, entities) => {
            expect(throttlesIn(entities)).toEqual([]);
        });

        it("the belt has no lane for it", () => {
            expect(throttlesIn([...belts(), ...throttle(10, 5, 1)], [2])).toEqual([]);
        });

        const takerOfChest = (n: number, x: number): Raw[] => [
            { entity_number: n, name: "stack-inserter", position: { x: x + 0.5, y: -2.5 }, direction: 8 },
            { entity_number: n + 1, name: "steel-chest", position: { x: x + 0.5, y: -3.5 } },
        ];

        it("an upstream throttle that its chest's taker holds does not hold the throttle downstream", () => {
            expect(throttlesIn([...belts(), ...throttle(10, 3, 1), ...throttle(12, 5, 1), ...takerOfChest(30, 3)])).toEqual([[12, 13, 1]]);
        });

        it("a throttle downstream that its chest's taker holds is a real taker for the throttle upstream: neither is read", () => {
            expect(throttlesIn([...belts(), ...throttle(10, 3, 1), ...throttle(12, 5, 1), ...takerOfChest(30, 5)])).toEqual([]);
        });
    });
});
