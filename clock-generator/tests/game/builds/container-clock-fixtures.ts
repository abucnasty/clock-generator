import path from "path";
import {expect} from "vitest";
import {Config, ConfigSchema} from "../../../src/config";
import "../../../src/data/factorio-data-file";
import {FactorioDataService} from "../../../src/data";
import {FactorioBlueprintFile} from "../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {Recording} from "../../../src/verification/recording";
import {BELT_SPEEDS} from "../helpers/belt-speed-fixtures";
import {PickupClockScenario} from "./pickup-clock-capture";

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
/** The clock's period in ticks, as generated (gears 192, circuits 384): the cuts are sized by it */
const PERIOD_TICKS = {"iron-gear-wheel": 192, "electronic-circuit": 384} as const;
/** What a craft takes of each input */
const INPUTS = {"iron-gear-wheel": [["iron-plate", 2]], "electronic-circuit": [["iron-plate", 1], ["copper-cable", 3]]} as const;

/**
 * The periods until a cut input's stock in the container has run out: the most of it the container holds, over what
 * the machine takes of it a period at the target. A cut of two periods, as the belt-fed families have, changes nothing
 * here: the container holds thousands of items.
 */
export function containerDrainPeriods(variant: ContainerClockCase, item: string): number {
    const container = variant.container;
    const slots = FactorioDataService.containerSlots(container.type as string, (container.quality as string | undefined) ?? "normal");
    const filters = (container.slot_filters ?? []) as {slot: number; item: string}[];
    const taking = slots - filters.filter(filter => filter.item !== item).length;
    const stock = taking * FactorioDataService.findItemOrThrow(item).stack_size;
    const per_craft = INPUTS[variant.recipe].find(([name]) => name === item)![1];
    const per_period = CONTAINER_TARGET * PERIOD_TICKS[variant.recipe] / 60 * per_craft;
    return Math.ceil(stock / per_period);
}

/**
 * The standard protocol, with the cuts long enough to empty the container: a cut of one input, an output block and a
 * cut of another (the only one again for gears), each followed until the output is back (40 periods, the first 6 after a release not judged).
 */
export function containerInterventions(variant: ContainerClockCase): [number, number, number][] {
    const [first, second] = variant.recipe === "iron-gear-wheel" ? ["iron-plate", "iron-plate"] : ["iron-plate", "copper-cable"];
    const cut1 = containerDrainPeriods(variant, first) + 8, cut2 = containerDrainPeriods(variant, second) + 8;
    const release1 = 66 + cut1, block = release1 + 40, unblock = block + 4, cut = unblock + 40, release2 = cut + cut2;
    return [[66, release1, block], [block, unblock, cut], [cut, release2, release2 + 40]];
}

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

interface Placed {name: string; position: {x: number; y: number}; [key: string]: unknown}

/** Where the inserters stand around each container, as checked in the game (a wagon stands on rails at x = 1) */
const LAYOUTS = {
    "cargo-wagon": {container: {x: 1, y: 0.5}, plates: {x: -0.5, y: 0.5, direction: 12}, cable: {x: -0.5, y: 1.5, direction: 12}, taker: {x: 2.5, y: 0.5}},
    car: {container: {x: 0, y: 0.5}, plates: {x: -1.5, y: 0.5, direction: 12}, cable: {x: 0.5, y: -1.5, direction: 0}, taker: {x: 1.5, y: 0.5}},
    tank: {container: {x: 0, y: 0.5}, plates: {x: -1.5, y: 0.5, direction: 12}, cable: {x: -1.5, y: 1.5, direction: 12}, taker: {x: 1.5, y: 0.5}},
} as const;

/** One step back from an inserter, against the way it moves items: where its supply chest stands */
function behind(inserter: {x: number; y: number; direction: number}): {x: number; y: number} {
    return inserter.direction === 12 ? {x: inserter.x - 1, y: inserter.y} : {x: inserter.x, y: inserter.y - 1};
}

/**
 * The supplies, their inserters into the container, the container (its slot filters in the blueprint), the inserter
 * that takes from it into the assembler, the output inserter and the disposal chest, left to right (west to east).
 */
export function containerClockScaffold(variant: ContainerClockCase): string {
    const type = variant.container.type as keyof typeof LAYOUTS;
    const layout = LAYOUTS[type];
    const inputs = variant.recipe === "iron-gear-wheel" ? (["plates"] as const) : (["plates", "cable"] as const);
    const items = {plates: "iron-plate", cable: "copper-cable"} as const;
    const filters = ((variant.container.slot_filters ?? []) as {slot: number; item: string}[]).map(filter => ({index: filter.slot, name: filter.item}));
    const inventory = filters.length > 0 ? {filters} : undefined;
    const container: Placed = type === "cargo-wagon"
        ? {name: "cargo-wagon", position: layout.container, orientation: 0, ...(variant.container.quality ? {quality: variant.container.quality} : {}), ...(inventory ? {inventory} : {})}
        : {name: type, position: layout.container, orientation: 0, ...(inventory ? {trunk_inventory: inventory} : {})};
    const machine = {x: layout.taker.x + 2, y: layout.taker.y};
    const entities: Placed[] = [
        ...(type === "cargo-wagon" ? Array.from({length: 9}, (_, index) => ({name: "straight-rail", position: {x: 1, y: -7 + 2 * index}, direction: 0})) : []),
        container,
        ...inputs.flatMap(input => [
            {name: "infinity-chest", position: behind(layout[input]),
                infinity_settings: {remove_unfiltered_items: true, filters: [{name: items[input], count: 200, mode: "exactly", index: 1}]}},
            {name: "stack-inserter", position: {x: layout[input].x, y: layout[input].y}, direction: layout[input].direction, quality: "legendary"},
        ]),
        {name: "stack-inserter", position: layout.taker, direction: 12, quality: "legendary"},
        {name: "assembling-machine-3", position: machine, recipe: variant.recipe, quality: "legendary"},
        {name: "stack-inserter", position: {x: machine.x + 2, y: machine.y}, direction: 12, quality: "legendary"},
        {name: "infinity-chest", position: {x: machine.x + 3, y: machine.y}, infinity_settings: {remove_unfiltered_items: true, filters: []}},
    ];
    return encodeBlueprintFile({blueprint: {item: "blueprint", label: `Container clock ${variant.name}`, version: 562949955649536,
        entities: entities.map((entity, index) => ({entity_number: index + 1, ...entity}))}} as unknown as FactorioBlueprintFile);
}

/** The native build is the config's: one machine at its speed, the container between its supplies and the machine */
export function assertContainerHardware(recording: Recording, config: Config, variant: ContainerClockCase): void {
    expect(recording.machines).toHaveLength(1);
    expect(recording.config.machines).toMatchObject([{recipe: config.machines[0].recipe, crafting_speed: CONTAINER_CRAFTING_SPEED, productivity: 0}]);
    const chests = (recording.config.chests ?? []) as {type: string; quality?: string; slot_filters?: unknown[]}[];
    const container = chests.filter(chest => chest.type === variant.container.type);
    expect(container).toHaveLength(1);
    expect(container[0].quality).toBe(variant.container.type === "cargo-wagon" ? (variant.container.quality ?? "normal") : undefined);
    expect((container[0].slot_filters ?? []).length).toBe(((variant.container.slot_filters ?? []) as unknown[]).length);
    const taker = recording.inserters.filter(inserter => inserter.source.type === "chest" && inserter.sink.type === "machine");
    expect(taker).toHaveLength(1);
    expect(recording.inserters.filter(inserter => inserter.source.type === "machine")).toHaveLength(1);
}

export function containerClockScenario(variant: ContainerClockCase): PickupClockScenario {
    return {
        name: variant.name, speed: BELT_SPEEDS[0], backed: false,
        config: () => containerClockConfig(variant), scaffold: () => containerClockScaffold(variant),
        interventions: containerInterventions(variant),
        probeFile: path.join(__dirname, "container-clock-probe.lua"),
        probe: {family: "container", cuts: variant.recipe === "iron-gear-wheel" ? ["iron-plate", "iron-plate"] : ["iron-plate", "copper-cable"]} as PickupClockScenario["probe"],
        controls: path.join(__dirname, "container-clock-controls.json"),
        assertHardware: (recording, config) => assertContainerHardware(recording, config, variant),
    };
}
