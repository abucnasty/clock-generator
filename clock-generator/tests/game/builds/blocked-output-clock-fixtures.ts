import path from "path";
import {expect} from "vitest";
import {Config, ConfigSchema} from "../../../src/config";
import {FactorioBlueprintFile} from "../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../src/blueprints/serde";
import {Recording} from "../../../src/verification/recording";
import {BELT_SPEEDS, FixtureBeltSpeed} from "../helpers/belt-speed-fixtures";
import {PickupClockScenario} from "./pickup-clock-capture";

/**
 * Recovery through a blocked output at belt stack sizes 1-4 (roadmap C3). A legendary assembler 3 makes iron gears from
 * an infinity chest of iron plates; its output inserter drops onto a belt that runs OUTLET_TILES tiles to a loader into an
 * infinity chest. The stack size is the force's (`belt_stack_size_bonus`, set by the probe as B5 does), which would also
 * change what a belt-fed input finds on its belt: the input here is fed from a chest, so only the drop sees it.
 */
export interface BlockedOutputClockCase {name: string; speed: FixtureBeltSpeed; stackSize: 1 | 2 | 3 | 4}

/** A legendary assembler 3 without modules or beacons: 1.25 x 2.5 */
export const BLOCKED_OUTPUT_CRAFTING_SPEED = 3.125;
/** Gears a second at every tier and stack size: 80% of the machine, two thirds of a normal lane at stack size 1 */
export const BLOCKED_OUTPUT_TARGET = 5;
/** Belt tiles from the drop to the loader: the belt-output controls buffer 112-192 items at stack size 4, 7 to 12 tiles */
export const BLOCKED_OUTPUT_OUTLET_TILES = 10;
/**
 * The output alone is blocked, for 24 periods (the over-hood outage): at 16 items a period the stack-4 lane takes about
 * ten periods to fill. Baseline before period 64, recovery judged from 6 periods after the release to period 130: the
 * harness records to two periods past the last intervention's end, and the runner wants 130 counted periods.
 */
export const BLOCKED_OUTPUT_INTERVENTIONS: [number, number, number][] = [[66, 90, 130]];

export function blockedOutputClockCases(): BlockedOutputClockCase[] {
    return BELT_SPEEDS.flatMap(speed => ([1, 2, 3, 4] as const).map(stackSize => ({
        name: `blocked-output-${speed.name}-stack-${stackSize}`, speed, stackSize,
    })));
}

export function blockedOutputClockConfig(variant: BlockedOutputClockCase): Config {
    const product = "iron-gear-wheel";
    return ConfigSchema.parse({
        target_output: {recipe: product, items_per_second: BLOCKED_OUTPUT_TARGET, copies: 1},
        machines: [{id: 1, type: "machine", recipe: product, crafting_speed: BLOCKED_OUTPUT_CRAFTING_SPEED, productivity: 0}],
        inserters: [
            {id: 1, source: {type: "machine", id: 1}, sink: {type: "belt", id: 1}, stack_size: 16},
            {id: 2, source: {type: "chest", id: 1}, sink: {type: "machine", id: 1}, stack_size: 16},
        ],
        belts: [{id: 1, type: `${variant.speed.prefix}transport-belt`, lanes: [
            {ingredient: product, stack_size: variant.stackSize}, {ingredient: "", stack_size: variant.stackSize},
        ]}],
        chests: [{type: "infinity-chest", id: 1, item_filter: [{item_name: "iron-plate", request_count: 100}]}],
    });
}

/**
 * Plates chest, input inserter, assembler, output inserter (all facing north: they take from the north and put down to
 * the south), then the output belt eastward from below the output inserter to its loader and the receiving chest.
 */
export function blockedOutputClockScaffold(variant: BlockedOutputClockCase): string {
    const belt = `${variant.speed.prefix}transport-belt`;
    const lastBelt = BLOCKED_OUTPUT_OUTLET_TILES - 0.5;
    const entities = [
        {name: "infinity-chest", position: {x: 0.5, y: -2.5},
            infinity_settings: {remove_unfiltered_items: true, filters: [{name: "iron-plate", count: 100, mode: "exactly", index: 1}]}},
        {name: "stack-inserter", position: {x: 0.5, y: -1.5}, direction: 0, quality: "legendary"},
        {name: "assembling-machine-3", position: {x: 0.5, y: 0.5}, recipe: "iron-gear-wheel", quality: "legendary"},
        {name: "stack-inserter", position: {x: 0.5, y: 2.5}, direction: 0, quality: "legendary"},
        ...Array.from({length: BLOCKED_OUTPUT_OUTLET_TILES}, (_, tile) => ({name: belt, position: {x: 0.5 + tile, y: 3.5}, direction: 4})),
        {name: `${variant.speed.prefix}loader`, position: {x: lastBelt + 1.5, y: 3.5}, direction: 4, type: "input"},
        {name: "infinity-chest", position: {x: lastBelt + 3, y: 3.5}, infinity_settings: {remove_unfiltered_items: true, filters: []}},
    ].map((entity, index) => ({entity_number: index + 1, ...entity}));
    return encodeBlueprintFile({blueprint: {item: "blueprint", label: `Blocked output ${variant.name}`,
        version: 562949955649536, entities}} as unknown as FactorioBlueprintFile);
}

/** The native build is the config's: one machine at its speed, a chest-fed input, an output that drops stacks of the case's size */
export function assertBlockedOutputHardware(recording: Recording, config: Config, variant: BlockedOutputClockCase): void {
    expect(recording.machines).toHaveLength(1);
    expect(recording.config.machines).toMatchObject([{recipe: config.machines[0].recipe,
        crafting_speed: BLOCKED_OUTPUT_CRAFTING_SPEED, productivity: 0}]);
    const input = recording.inserters.filter(inserter => inserter.source.type === "chest" && inserter.sink.type === "machine");
    const output = recording.inserters.filter(inserter => inserter.source.type === "machine");
    expect(input).toHaveLength(1);
    expect(output).toHaveLength(1);
    expect(output[0].sink.type).toBe("belt");
    const counts = output[0].samples.held_count;
    const drops = counts.slice(1).map((count, index) => counts[index] - count).filter(count => count > 0);
    expect(drops.length).toBeGreaterThan(0);
    expect(drops.every(count => count === variant.stackSize)).toBe(true);
    expect(Math.max(...counts)).toBe(variant.stackSize === 3 ? 15 : 16);
    expect(output[0].samples.held_item.map(([, item]) => item).filter(Boolean).every(item => item === config.target_output.recipe)).toBe(true);
}

export function blockedOutputClockScenario(variant: BlockedOutputClockCase): PickupClockScenario {
    return {
        name: variant.name, speed: variant.speed, backed: false,
        config: () => blockedOutputClockConfig(variant), scaffold: () => blockedOutputClockScaffold(variant),
        interventions: BLOCKED_OUTPUT_INTERVENTIONS,
        probeFile: path.join(__dirname, "blocked-output-clock-probe.lua"),
        probe: {family: "chest-fed", stackSize: variant.stackSize},
        controls: path.join(__dirname, "blocked-output-clock-controls.json"),
        assertHardware: (recording, config) => assertBlockedOutputHardware(recording, config, variant),
    };
}
