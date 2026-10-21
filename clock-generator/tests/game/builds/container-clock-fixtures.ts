import {Config, ConfigSchema} from "../../../src/config";

/**
 * Clocks through a car, a tank or a cargo wagon taken as a chest. The container stands between two inserters, so the
 * build holds a rate: infinity chests feed the container, one inserter takes from it into a legendary assembler 3
 * (crafting speed 3.125, no modules or beacons), and the output inserter drops into a disposal chest. Iron gears come
 * from iron plates alone; electronic circuits from iron plates and copper cable, mixed in the container, whose slots are
 * split between the two by slot filters (unfiltered, a mixed container fills with the item that keeps arriving while the
 * other is cut, and the build cannot recover).
 */
export interface ContainerClockCase {
    name: string;
    recipe: "iron-gear-wheel" | "electronic-circuit";
    /** The container's config, without its id */
    container: Record<string, unknown>;
}

/** A legendary assembler 3 without modules or beacons: 1.25 x 2.5 */
export const CONTAINER_CRAFTING_SPEED = 3.125;
/** Products a second: 80% of the machine for both recipes (gears 0.5 s, circuits 0.5 s, one product a craft) */
export const CONTAINER_TARGET = 5;
/** The standard protocol: a cut of one input, an output block and a cut of another (the only one again for gears) */
export const CONTAINER_INTERVENTIONS: [number, number, number][] = [[66, 68, 84], [84, 88, 104], [104, 106, 132]];

const filtered = (from: number, to: number, item: string) =>
    Array.from({length: to - from + 1}, (_, index) => ({slot: from + index, item}));

export function containerClockCases(): ContainerClockCase[] {
    return [
        {name: "container-wagon-normal", recipe: "iron-gear-wheel", container: {type: "cargo-wagon"}},
        {name: "container-wagon-legendary", recipe: "iron-gear-wheel", container: {type: "cargo-wagon", quality: "legendary"}},
        {name: "container-wagon-filtered", recipe: "iron-gear-wheel",
            container: {type: "cargo-wagon", slot_filters: [...filtered(1, 10, "iron-plate"), ...filtered(11, 40, "copper-plate")]}},
        {name: "container-wagon-legendary-mixed", recipe: "electronic-circuit",
            container: {type: "cargo-wagon", quality: "legendary", slot_filters: [...filtered(1, 50, "iron-plate"), ...filtered(51, 100, "copper-cable")]}},
        {name: "container-car-mixed", recipe: "electronic-circuit",
            container: {type: "car", slot_filters: [...filtered(1, 40, "iron-plate"), ...filtered(41, 80, "copper-cable")]}},
        {name: "container-tank-mixed", recipe: "electronic-circuit",
            container: {type: "tank", slot_filters: [...filtered(1, 40, "iron-plate"), ...filtered(41, 80, "copper-cable")]}},
    ];
}

export function containerClockConfig(variant: ContainerClockCase): Config {
    const inputs = variant.recipe === "iron-gear-wheel" ? ["iron-plate"] : ["iron-plate", "copper-cable"];
    const supplies = inputs.map((item, index) => ({type: "infinity-chest", id: 10 + index,
        item_filter: [{item_name: item, request_count: 200}]}));
    return ConfigSchema.parse({
        target_output: {recipe: variant.recipe, items_per_second: CONTAINER_TARGET, copies: 1},
        machines: [{id: 1, type: "machine", recipe: variant.recipe, crafting_speed: CONTAINER_CRAFTING_SPEED, productivity: 0}],
        inserters: [
            ...inputs.map((item, index) => ({id: 1 + index, source: {type: "chest", id: 10 + index}, sink: {type: "chest", id: 1},
                stack_size: 16, filters: [item]})),
            {id: 3, source: {type: "chest", id: 1}, sink: {type: "machine", id: 1}, stack_size: 16},
            {id: 4, source: {type: "machine", id: 1}, sink: {type: "chest", id: 2}, stack_size: 16},
        ],
        belts: [],
        chests: [
            {id: 1, ...variant.container},
            {type: "infinity-chest", id: 2, item_filter: [], remove_unfiltered_items: true},
            ...supplies,
        ],
    });
}
