import {describe, expect, test} from "vitest";
import {FactorioDataService} from "../../../src/data";
import {CONTAINER_GENERATED} from "./container-clock-cases";
import {
    CONTAINER_TARGET, containerClockCases, containerClockConfig, containerDrainPeriods, containerInterventions,
} from "./container-clock-fixtures";
import {readControls} from "./clock-controls";
import {expectControlIsConsistent, unclockedContainerStock} from "../helpers/fixture-mechanics";

/**
 * The container family (`container-clock-fixtures.ts`: a cargo wagon of normal and legendary quality, a car and a tank
 * between two inserters), checked against what the game recorded without generating a clock: the slots and the stock
 * each container holds in the simulator, the cut lengths that empty that stock, the periods the game took to run dry
 * under each cut, and the recorded clock controls against the fixture configs. The generation test
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

const controls = readControls("container-clock-controls.json").cases;
const variants = containerClockCases();

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

describe("the cuts that empty the container", () => {
    for (const variant of variants) {
        test(`${variant.name}: each cut is the periods the stock lasts at the target, plus 8, as the controls recorded`, () => {
            const expected = EXPECTED[variant.name];
            const period = controls[variant.name].native.period;
            const [cut1, cut2] = variant.recipe === "iron-gear-wheel" ? ["iron-plate", "iron-plate"] : ["iron-plate", "copper-cable"];
            for (const item of new Set([cut1, cut2])) {
                const perCraft = variant.recipe === "iron-gear-wheel" ? 2 : item === "iron-plate" ? 1 : 3;
                // stock over what the machine takes of it in a period at the target
                expect(containerDrainPeriods(variant, item), item).toBe(expected.stock[item].periods);
                expect(Math.ceil(expected.stock[item].items / (CONTAINER_TARGET * period / 60 * perCraft)), item).toBe(expected.stock[item].periods);
            }
            const [first, block, second] = containerInterventions(variant);
            expect(first[1] - first[0], "first cut").toBe(expected.stock[cut1].periods + 8);
            expect(second[1] - second[0], "second cut").toBe(expected.stock[cut2].periods + 8);
            expect(block[1] - block[0], "the output block lasts 4 periods").toBe(4);
            expect(containerInterventions(variant), "the protocol the game ran").toEqual(controls[variant.name].native.interventions);
        });
    }
});

describe("the periods the game took to run dry under each cut", () => {
    for (const variant of variants) {
        test(`${variant.name}: output holds the target until the cut input's stock is used up`, () => {
            const expected = EXPECTED[variant.name];
            const {native} = controls[variant.name];
            const [cut1, cut2] = variant.recipe === "iron-gear-wheel" ? ["iron-plate", "iron-plate"] : ["iron-plate", "copper-cable"];
            const [firstCut, block, secondCut] = native.recovery;
            expect(native.recovery.map(loss => loss.cut), "one trial a disturbance").toEqual(native.interventions!.map(([cut]) => cut));
            // the periods at the target before the output first falls short, and what follows: nothing, bar one part period
            const held = (during: number[]) => {
                const short = during.findIndex(items => items !== native.expected);
                const after = during.slice(short);
                expect(after.filter(items => items > 0).length, "at most one part period, then nothing").toBeLessThanOrEqual(1);
                expect(after.every(items => items < native.expected), "no period back at the target during the cut").toBe(true);
                return short;
            };
            // the game holds the target while the stock lasts and falls short within a period of it. The 100-slot wagon of
            // gears is the one container the first cut finds part full: its supply gives only the target's share, so it ran dry earlier
            const first = held(firstCut.during);
            if (variant.name === "container-wagon-legendary") {
                expect(first, "not yet full when the cut began").toBeLessThan(expected.stock[cut1].periods);
            } else {
                expect(first - expected.stock[cut1].periods, "periods the stock lasted").toBeGreaterThanOrEqual(0);
                expect(first - expected.stock[cut1].periods, "periods the stock lasted").toBeLessThanOrEqual(1);
            }
            // the output block: the disposal chest is full, nothing is dropped for the 4 periods (the fifth is the release)
            expect(block.during.slice(0, 4)).toEqual([0, 0, 0, 0]);
            // a second cut of the same input finds a container the recovery has not refilled to the full; the circuits' cut
            // of copper cable finds that stock full and takes the cable's own periods
            const second = held(secondCut.during);
            // how much of the stock the supplies put back in between depends on the clock: after the even-hands clock the second cut
            // found it nearly empty (0 to 5 periods), after planned-belt-slack it found 33 to 48 periods of it, never more than the first
            if (cut2 === cut1) {
                expect(second, "the stock is not refilled past the first cut's").toBeLessThanOrEqual(first);
                if (controls[variant.name].generation!.selection.id === "even-hands") expect(second, "the stock is not refilled between the cuts").toBeLessThanOrEqual(5);
            }
            else expect(second - expected.stock[cut2].periods, "periods the cable lasted").toBeGreaterThanOrEqual(-1);
            if (cut2 !== cut1) expect(second - expected.stock[cut2].periods, "periods the cable lasted").toBeLessThanOrEqual(1);
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

    test.each(variants.map(variant => variant.name))("%s: the game was recorded at the target rate over the pinned period and held it", name => {
        const variant = variants.find(it => it.name === name)!;
        const {native, generation} = controls[name];
        expectControlIsConsistent(native, generation!, containerClockConfig(variant).target_output.items_per_second);
        expect(native.target).toBe(CONTAINER_TARGET);
        // all six selected clocks are stable and meet the target in the baseline and in every judged period after each disturbance
        expect(generation!.verdict).toBe("stable");
        expect(native.baseline).toHaveLength(63);
        expect(native.baseline.every(items => items === native.expected), "baseline").toBe(true);
        for (const loss of native.recovery) {
            expect(loss.during, "every disturbance drops the output to 0").toContain(0);
            expect(loss.recovered, "33 judged periods").toHaveLength(33);
            expect(loss.recovered.every(items => items === native.expected), "back at the target").toBe(true);
        }
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
