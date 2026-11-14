import type { Config } from '../../src/config/schema';

/** Where a row of gear assemblers stands and what it makes (`gearRow`) */
export interface GearRowOptions {
    /** Assemblers in the row, each with an input inserter from the belt and an output inserter into a chest of its own */
    readonly machines: number;
    /** Tiles from one assembler, and its input inserter, to the next one downstream; at least 3, which is the assembler's width */
    readonly pitch: number;
    /** The gears each assembler makes a second: 30 for two assemblers, 20 for three (the 120 plates a second of a full lane) */
    readonly items_per_second_each: number;
}

/** The crafting speed of a legendary assembling machine 3 with four legendary speed modules, as the game reports it */
const CRAFTING_SPEED = 18.75;

/**
 * A row of gear assemblers on one dead-end turbo belt of iron plate, as the game's scaffolds in
 * `tests/game/mechanics/input-lane-gap/fixtures/` hold it and the Sidecar exports it: four infinity chests of iron plate
 * with a stack inserter each put the plate on the belt from outside the build (the belt's only lane, 120 a second at
 * most); each assembler's input inserter takes from the belt at its own place, and its output inserter puts the gears in
 * an infinity chest that removes all it is given. The inserters have no ids, as a Sidecar export gives them: the feeders
 * are inserters 1 to 4, then each assembler's input and output in turn.
 *
 * The positions are the scaffold's, from the first feeder, so that the tiles between two input inserters are the pitch.
 * A gear takes 2 plates: 2 assemblers at 30 gears a second each, or 3 at 20, ask for the 120 plates a second that the lane
 * carries, and no more.
 */
export function gearRow(options: GearRowOptions): Config {
    const at = (index: number) => 7.5 + index * options.pitch;
    const machines = Array.from({ length: options.machines }, (_, index) => ({
        id: index + 1, recipe: 'iron-gear-wheel', productivity: 0, prototype: 'assembling-machine-3', quality: 'legendary',
        crafting_speed: CRAFTING_SPEED, position: { x: at(index), y: 1.5 },
    }));
    const feeders = [0, 1, 2, 3].map(index => ({
        source: { type: 'chest' as const, id: index + 1 },
        sink: { type: 'belt' as const, id: 1, belt_direction: 4 },
        prototype: 'stack-inserter', quality: 'legendary', stack_size: 16,
        position: { x: 0.5 + index, y: -2.5 }, direction: 0,
    }));
    const feeder_chests = [0, 1, 2, 3].map(index => ({
        type: 'infinity-chest' as const, id: index + 1, item_filter: [{ item_name: 'iron-plate', request_count: 100 }], remove_unfiltered_items: false,
        position: { x: 0.5 + index, y: -3.5 },
    }));
    const row = machines.flatMap(machine => [
        {
            source: { type: 'belt' as const, id: 1, near_lane: 2 },
            sink: { type: 'machine' as const, id: machine.id },
            prototype: 'stack-inserter', quality: 'legendary', stack_size: 16,
            position: { x: machine.position.x, y: -0.5 }, direction: 0,
        },
        {
            source: { type: 'machine' as const, id: machine.id },
            sink: { type: 'chest' as const, id: 4 + machine.id },
            prototype: 'stack-inserter', quality: 'legendary', stack_size: 16,
            position: { x: machine.position.x, y: 3.5 }, direction: 0,
        },
    ]);
    const output_chests = machines.map(machine => ({
        type: 'infinity-chest' as const, id: 4 + machine.id, item_filter: [], remove_unfiltered_items: true,
        position: { x: machine.position.x, y: 4.5 },
    }));
    return {
        setpoint: { recipe: 'iron-gear-wheel', items_per_second: options.items_per_second_each * options.machines, copies: 1 },
        machines,
        inserters: [...feeders, ...row],
        belts: [
            { id: 1, type: 'turbo-transport-belt', flow_direction: 4, lanes: [
                { ingredient: 'iron-plate', stack_size: 4, lane_end: { kind: 'dead_end' } },
            ] },
        ],
        chests: [...feeder_chests, ...output_chests],
        overrides: {},
    } as Config;
}
