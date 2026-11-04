import {describe, expect, test} from "vitest";
import {FactorioDataService} from "../../../src/data";
import {CONTAINER_GENERATED} from "./container-clock-cases";
import {
    CONTAINER_TARGET, containerClockCases, containerClockConfig, containerDrainPeriods,
} from "./container-clock-fixtures";
import {readControls, runHolds, RunControls} from "./clock-controls";
import {expectRunIsConsistent, unclockedContainerStock} from "../helpers/fixture-mechanics";

/**
 * The container family (`container-clock-fixtures.ts`: a cargo wagon of normal and legendary quality, a car and a tank
 * between two inserters), checked against what the game recorded without generating a clock: the slots and the stock
 * each container holds in the simulator, the time that stock lasts at the target, and the recorded runs against the fixture
 * configs (each supply cut takes the container's stock of the item with it, so the loss shows at once). The generation test
 * (container-clock.generation.test.ts) generates only the cases of container-clock-cases.ts. The documented mechanic is
 * docs/simulator.md "Cars, wagons and rocket silos as chests" and tests/game/builds/README.md "Containers between two inserters".
 */

interface Expected {
    /** Slots of the container, from the game data (README: a wagon 40, legendary 100; a car and a tank 80) */
    slots: number;
    /** Per cut input: the most the container holds of it (its free and filtered slots times the stack size) and the periods that stock lasts at the target */
    stock: Record<string, {items: number; periods: number}>;
}

const EXPECTED: Record<string, Expected> = {
    "container-wagon-normal": {slots: 40, stock: {"iron-plate": {items: 4000, periods: 125}}},
    "container-wagon-legendary": {slots: 100, stock: {"iron-plate": {items: 10000, periods: 313}}},
    // 10 slots filtered to iron plates, 30 to copper plates: the copper slots take no iron
    "container-wagon-filtered": {slots: 40, stock: {"iron-plate": {items: 1000, periods: 32}}},
    "container-wagon-legendary-mixed": {slots: 100, stock: {"iron-plate": {items: 5000, periods: 157}, "copper-cable": {items: 10000, periods: 105}}},
    "container-car-mixed": {slots: 80, stock: {"iron-plate": {items: 4000, periods: 125}, "copper-cable": {items: 8000, periods: 84}}},
    "container-tank-mixed": {slots: 80, stock: {"iron-plate": {items: 4000, periods: 125}, "copper-cable": {items: 8000, periods: 84}}},
};

const controls = readControls<RunControls>("container-clock-controls.json").cases;
const variants = containerClockCases();
const recorded = variants.map(variant => ({variant, native: controls[variant.name].native, generation: controls[variant.name].generation!}));

describe("slots and stock in the simulator", () => {
    test("the game data gives a wagon 40 slots (100 at legendary quality) and a car and a tank 80", () => {
        expect(["normal", "legendary"].map(quality => FactorioDataService.containerSlots("cargo-wagon", quality as "normal"))).toEqual([40, 100]);
        expect(["car", "tank"].map(type => FactorioDataService.containerSlots(type, "normal"))).toEqual([80, 80]);
    });

    for (const variant of variants) {
        test(`${variant.name}: the supplies fill the container to its slots' stock and no further`, () => {
            const expected = EXPECTED[variant.name];
            const items = Object.keys(expected.stock);
            const {slots, peak, capacity} = unclockedContainerStock(containerClockConfig(variant), items);
            expect(slots).toBe(expected.slots);
            for (const item of items) {
                expect(capacity[item], `${item} fits in its filtered and free slots`).toBe(expected.stock[item].items);
                expect(peak[item], `${item} fills the container, and no more`).toBe(expected.stock[item].items);
            }
        });
    }
});

describe("the stock each cut has to use up", () => {
    for (const variant of variants) {
        test(`${variant.name}: the periods the stock lasts at the target`, () => {
            const expected = EXPECTED[variant.name];
            const period = controls[variant.name].generation!.period;
            const [cut1, cut2] = variant.recipe === "iron-gear-wheel" ? ["iron-plate", "iron-plate"] : ["iron-plate", "copper-cable"];
            for (const item of new Set([cut1, cut2])) {
                const perCraft = variant.recipe === "iron-gear-wheel" ? 2 : item === "iron-plate" ? 1 : 3;
                // stock over what the machine takes of it in a period at the target
                expect(containerDrainPeriods(variant, item), item).toBe(expected.stock[item].periods);
                expect(Math.ceil(expected.stock[item].items / (CONTAINER_TARGET * period / 60 * perCraft)), item).toBe(expected.stock[item].periods);
            }
        });
    }
});

describe("the recorded clock controls of the container fixtures", () => {
    test("there is a control with a native summary and a pin for each of the 6 fixtures", () => {
        expect(variants).toHaveLength(6);
        expect(Object.keys(controls).sort()).toEqual(variants.map(variant => variant.name).sort());
        for (const variant of variants) {
            expect(controls[variant.name].native, variant.name).toBeDefined();
            expect(controls[variant.name].generation, variant.name).toBeDefined();
        }
    });

    test.each(recorded.map(({variant}) => variant.name))("%s: the game was recorded at the target over the pinned period, held it and recovered", name => {
        const {variant, native, generation} = recorded.find(it => it.variant.name === name)!;
        expectRunIsConsistent(native, generation, containerClockConfig(variant).target_output.items_per_second);
        expect(native.target).toBe(CONTAINER_TARGET);
        expect(generation.verdict).toBe("stable");
        expect(native.disturbances.map(disturbance => disturbance.kind)).toEqual(["cut iron-plate", "block output",
            variant.recipe === "iron-gear-wheel" ? "cut iron-plate" : "cut copper-cable"]);
        expect(runHolds(native), native.result).toBe(true);
    });

    test("the clock depends on the recipe, not on the container: one hash and one selection a recipe", () => {
        for (const recipe of ["iron-gear-wheel", "electronic-circuit"]) {
            const family = variants.filter(variant => variant.recipe === recipe).map(variant => controls[variant.name]);
            expect(new Set(family.map(control => control.generation!.clock_sha256)).size, recipe).toBe(1);
            expect(new Set(family.map(control => control.generation!.selection.id)).size, recipe).toBe(1);
            expect(new Set(family.map(control => control.generation!.period)).size, recipe).toBe(1);
        }
        expect(variants.filter(variant => variant.recipe === "iron-gear-wheel").map(variant => controls[variant.name].generation!.selection.id)[0]).toBe("planned-belt-slack");
        expect(variants.filter(variant => variant.recipe === "electronic-circuit").map(variant => controls[variant.name].generation!.selection.id)[0]).toBe("planned-belt-slack");
    });

    test("the generated cases are fixtures of the family, one a recipe, and the path each takes is stated", () => {
        for (const [name, path] of CONTAINER_GENERATED) {
            expect(variants.map(variant => variant.name), name).toContain(name);
            expect(path.length, name).toBeGreaterThan(10);
        }
        expect(new Set([...CONTAINER_GENERATED.keys()].map(name => variants.find(variant => variant.name === name)!.recipe)).size)
            .toBe(CONTAINER_GENERATED.size);
    });
});
