import { describe, expect, it } from "vitest";
import { ConfigSchema } from "./schema";
import { Config } from "./index";
import { generateClockAlternatives } from "../crafting/generate-blueprint";
import { insertersScopeProblem } from "./inserter-scope";
import { beltPickupNotTestedNote, describeUncalibratedPickup, uncalibratedBeltPickups } from "./pickup-calibration";

/** A gear assembler fed from a belt by inserter 1, emptied into a chest by inserter 2 */
const gears = (fields: { lanes?: object[]; feeder?: object; output?: object } = {}): Config => ConfigSchema.parse({
    target_output: { recipe: "iron-gear-wheel", items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe: "iron-gear-wheel", crafting_speed: 1, productivity: 0 }],
    inserters: [
        { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 }, ...fields.feeder },
        { id: 2, source: { type: "machine", id: 1 }, sink: { type: "chest", id: 1 }, ...fields.output },
    ],
    belts: [{ id: 1, type: "turbo-transport-belt", lanes: fields.lanes ?? [{ ingredient: "iron-plate", stack_size: 4 }] }],
    chests: [{ id: 1, type: "infinity-chest", item_filter: [], remove_unfiltered_items: true }],
});
const warnings = () => {
    const warned: string[] = [];
    return { warned, logger: { log() { }, warn: (message: string) => { warned.push(message); }, error() { }, debug() { } } };
};

describe("belt pickups outside 16-item hands on 4-item belt stacks", () => {
    it("are none for a stack inserter with its full hand on 4-item belt stacks", () => {
        expect(uncalibratedBeltPickups(gears())).toEqual([]);
        expect(uncalibratedBeltPickups(gears({ feeder: { stack_size: 16 } }))).toEqual([]);
        expect(beltPickupNotTestedNote([])).toBeNull();
    });

    it.each([1, 2, 3])("include an item taken in %i-item belt stacks", stack_size => {
        expect(uncalibratedBeltPickups(gears({ lanes: [{ ingredient: "iron-plate", stack_size }] }))).toEqual([
            { inserter_id: 1, belt_id: 1, item: "iron-plate", lane_stack_sizes: [stack_size], hand_size: null, item_stack_size: null },
        ]);
    });

    it.each([1, 8, 12, 20])("include an item taken with a hand of %i", stack_size => {
        expect(uncalibratedBeltPickups(gears({ feeder: { stack_size } }))).toEqual([
            { inserter_id: 1, belt_id: 1, item: "iron-plate", lane_stack_sizes: [], hand_size: stack_size, item_stack_size: null },
        ]);
    });

    it("read the hand the simulator picks up with: an item that stacks to less than 16 cuts it", () => {
        const barrels = ConfigSchema.parse({
            ...gears(),
            target_output: { recipe: "empty-water-barrel", items_per_second: 1, copies: 1 },
            machines: [{ id: 1, recipe: "empty-water-barrel", crafting_speed: 1, productivity: 0 }],
            belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "water-barrel", stack_size: 4 }] }],
        });
        const [pickup] = uncalibratedBeltPickups(barrels);
        expect(pickup).toEqual({ inserter_id: 1, belt_id: 1, item: "water-barrel", lane_stack_sizes: [], hand_size: 10, item_stack_size: 10 });
        expect(describeUncalibratedPickup(pickup)).toBe("Inserter 1 picks up water-barrel from belt 1 with a 10-item hand (water-barrel stacks to 10).");
    });

    it("name each lane of the item that is off, and both the stacks and the hand", () => {
        const both_lanes = gears({
            lanes: [{ ingredient: "iron-plate", stack_size: 3 }, { ingredient: "iron-plate", stack_size: 2 }],
            feeder: { stack_size: 8 },
        });
        expect(uncalibratedBeltPickups(both_lanes).map(describeUncalibratedPickup)).toEqual([
            "Inserter 1 picks up iron-plate from belt 1 in 2- and 3-item belt stacks with an 8-item hand.",
        ]);
        const one_lane_off = gears({ lanes: [{ ingredient: "iron-plate", stack_size: 4 }, { ingredient: "iron-plate", stack_size: 1 }] });
        expect(uncalibratedBeltPickups(one_lane_off).map(describeUncalibratedPickup)).toEqual([
            "Inserter 1 picks up iron-plate from belt 1 in 1-item belt stacks.",
        ]);
    });

    it("leave out a lane of an item the inserter does not take: its sink does not, or its filters leave it", () => {
        expect(uncalibratedBeltPickups(gears({
            lanes: [{ ingredient: "iron-plate", stack_size: 4 }, { ingredient: "copper-plate", stack_size: 2 }],
        }))).toEqual([]);
        expect(uncalibratedBeltPickups(gears({
            lanes: [{ ingredient: "iron-plate", stack_size: 2 }, { ingredient: "copper-plate", stack_size: 4 }],
            feeder: { filters: ["copper-plate"] },
        }))).toEqual([]);
    });

    it("include a burner machine's fuel taken off a belt", () => {
        const fuel = ConfigSchema.parse({
            target_output: { recipe: "yumako-processing", items_per_second: 1, copies: 1 },
            machines: [{ id: 1, type: "biochamber", recipe: "yumako-processing", crafting_speed: 1, productivity: 0 }],
            inserters: [
                { id: 1, source: { type: "belt", id: 1 }, sink: { type: "machine", id: 1 } },
                { id: 2, source: { type: "belt", id: 2 }, sink: { type: "machine", id: 1 } },
            ],
            belts: [
                { id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "yumako", stack_size: 4 }] },
                { id: 2, type: "turbo-transport-belt", lanes: [{ ingredient: "nutrients", stack_size: 2 }] },
            ],
        });
        expect(uncalibratedBeltPickups(fuel).map(describeUncalibratedPickup)).toEqual([
            "Inserter 2 picks up nutrients from belt 2 in 2-item belt stacks.",
        ]);
    });

    it("leave out drops onto a belt, which were measured at belt stack sizes 1-4", () => {
        const drop = ConfigSchema.parse({
            ...gears(),
            inserters: [
                { id: 1, source: { type: "chest", id: 1 }, sink: { type: "machine", id: 1 }, stack_size: 8 },
                { id: 2, source: { type: "machine", id: 1 }, sink: { type: "belt", id: 1 }, stack_size: 8 },
            ],
            belts: [{ id: 1, type: "turbo-transport-belt", lanes: [{ ingredient: "iron-gear-wheel", stack_size: 2 }] }],
            chests: [{ id: 1, type: "infinity-chest", item_filter: [{ item_name: "iron-plate", request_count: 100 }] }],
        });
        expect(uncalibratedBeltPickups(drop)).toEqual([]);
    });

    it("leave out a belt pickup by another inserter, which is refused for that instead", () => {
        const bulk = gears({ lanes: [{ ingredient: "iron-plate", stack_size: 2 }], feeder: { prototype: "bulk-inserter" } });
        expect(uncalibratedBeltPickups(bulk)).toEqual([]);
        expect(insertersScopeProblem(bulk)).toContain("Inserter 1: picking up from a belt with a legendary bulk-inserter is not supported yet");
    });

    it("never throw on a half-made build: an unknown recipe or belt takes nothing", () => {
        const unknown_recipe = { ...gears({ lanes: [{ ingredient: "iron-plate", stack_size: 2 }] }) };
        unknown_recipe.machines = [{ ...unknown_recipe.machines[0], recipe: "no-such-recipe" }];
        expect(uncalibratedBeltPickups(unknown_recipe)).toEqual([]);
        const missing_belt = { ...gears({ lanes: [{ ingredient: "iron-plate", stack_size: 2 }] }) };
        missing_belt.belts = [];
        expect(uncalibratedBeltPickups(missing_belt)).toEqual([]);
    });

    it("are told in one note: what is not tested, what is calibrated, and that the clock may not match the game", () => {
        expect(beltPickupNotTestedNote(uncalibratedBeltPickups(gears({ lanes: [{ ingredient: "iron-plate", stack_size: 2 }], feeder: { stack_size: 12 } })))).toBe(
            "Not tested: Inserter 1 picks up iron-plate from belt 1 in 2-item belt stacks with a 12-item hand. Belt pickup timing is "
            + "calibrated with 16-item hands on 4-item belt stacks only; at other belt stack sizes and hand sizes it has not been "
            + "compared with the game, so the clock may not match the game.");
    });
});

describe("a generation with a belt pickup outside the calibration", () => {
    it("is generated, with a build insight on every clock and one warning in the log", () => {
        const { warned, logger } = warnings();
        const { alternatives } = generateClockAlternatives(gears({ lanes: [{ ingredient: "iron-plate", stack_size: 2 }] }), { logger });
        expect(alternatives.length).toBeGreaterThan(0);
        for (const alternative of alternatives) {
            expect(alternative.insights.filter(it => it.id === "belt-pickup-not-tested")).toEqual([{
                id: "belt-pickup-not-tested",
                scope: "build",
                title: "Not tested: belt pickup outside 16-item hands on 4-item belt stacks",
                what: "Inserter 1 picks up iron-plate from belt 1 in 2-item belt stacks.",
                why: "Belt pickup timing is calibrated with 16-item hands on 4-item belt stacks only. At other belt stack sizes and "
                    + "hand sizes the simulator's pickup timing has not been compared with the game.",
                explanation: "The clock may not match the game: its rate, stability and wake-ups are worked out from pickup timing "
                    + "never checked there.",
            }]);
        }
        expect(warned).toEqual([beltPickupNotTestedNote(uncalibratedBeltPickups(gears({ lanes: [{ ingredient: "iron-plate", stack_size: 2 }] })))]);
    });

    it("is not told about a build inside the calibration", () => {
        const { warned, logger } = warnings();
        const { alternatives } = generateClockAlternatives(gears(), { logger });
        expect(alternatives.flatMap(it => it.insights).filter(it => it.id === "belt-pickup-not-tested")).toEqual([]);
        expect(warned).toEqual([]);
    });
});
