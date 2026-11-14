import type { Config } from '../../src/config/schema';

/** Where a row of automation science assemblers stands and what it holds (`automationRow`) */
export interface AutomationRowOptions {
    /** Assemblers in the row, each with an input inserter from belt 1 and an output inserter onto belt 2 */
    readonly machines: number;
    /** Tiles from one assembler, and its input inserter, to the next one downstream */
    readonly pitch: number;
    /** Four infinity chests upstream of the row and an inserter from each onto belt 1 (two of gears, two of copper) */
    readonly feeders?: boolean;
    /** `setpoint.copies`, 1 by default */
    readonly copies?: number;
    /** `setpoint.copy_offset`; none by default */
    readonly copy_offset?: { x: number; y: number };
    /** `setpoint.items_per_second`, the sample's 240 by default */
    readonly items_per_second?: number;
    /** Each assembler at a crafting speed of its own, a little faster down the row, so that the row is not copies of one */
    readonly distinct?: boolean;
    /** The input belt (belt 1): the sample's turbo belt with both lanes ending in a dead end by default */
    readonly input?: { readonly belt: 'turbo-transport-belt' | 'express-transport-belt'; readonly lane_end: 'dead_end' | 'infinite' };
}

/** The crafting speed of the automation science sample (automation-240.json): a legendary assembler with its beacons */
const CRAFTING_SPEED = 68.890625;

/**
 * A row of automation science assemblers on two turbo belts, as the automation science sample has one (240 a second,
 * stack inserters of 16): belt 1 brings gears (lane 1) and copper (lane 2) east, to a dead end, and each assembler's input
 * inserter takes from it at its own place; each output inserter puts the science onto belt 2. With `feeders`, four
 * infinity chests stand upstream of the row with an inserter from each onto belt 1: supply from outside the build. The
 * inserters have no ids, as a Sidecar export gives them: the feeders are inserters 1 to 4, then each assembler's input
 * and output in turn.
 */
export function automationRow(options: AutomationRowOptions): Config {
    const at = (index: number) => 10 + index * options.pitch + 0.5;
    const machines = Array.from({ length: options.machines }, (_, index) => ({
        id: index + 1, recipe: 'automation-science-pack', productivity: 100, prototype: 'assembling-machine-3',
        crafting_speed: options.distinct === true ? CRAFTING_SPEED + index / 64 : CRAFTING_SPEED,
        position: { x: at(index), y: 0.5 },
    }));
    const feeders = options.feeders !== true ? [] : ['iron-gear-wheel', 'iron-gear-wheel', 'copper-plate', 'copper-plate'].map((_, index) => ({
        source: { type: 'chest' as const, id: index + 1 },
        sink: { type: 'belt' as const, id: 1 },
        stack_size: 16,
        position: { x: 1.5 + index, y: -2.5 },
    }));
    const chests = options.feeders !== true ? [] : ['iron-gear-wheel', 'iron-gear-wheel', 'copper-plate', 'copper-plate'].map((item, index) => ({
        type: 'infinity-chest' as const, id: index + 1, item_filter: [{ item_name: item, request_count: 100 }], remove_unfiltered_items: false,
        position: { x: 1.5 + index, y: -3.5 },
    }));
    const row = machines.flatMap(machine => [
        {
            source: { type: 'belt' as const, id: 1, near_lane: 2 },
            sink: { type: 'machine' as const, id: machine.id },
            stack_size: 16, filters: ['copper-plate', 'iron-gear-wheel'],
            position: { x: machine.position.x, y: -1.5 },
        },
        {
            source: { type: 'machine' as const, id: machine.id },
            sink: { type: 'belt' as const, id: 2 },
            stack_size: 16, filters: ['automation-science-pack'],
            position: { x: machine.position.x, y: 2.5 },
        },
    ]);
    return {
        setpoint: {
            recipe: 'automation-science-pack', items_per_second: options.items_per_second ?? 240, copies: options.copies ?? 1,
            ...(options.copy_offset !== undefined && { copy_offset: options.copy_offset }),
        },
        machines,
        inserters: [...feeders, ...row],
        belts: [
            { id: 1, type: options.input?.belt ?? 'turbo-transport-belt', flow_direction: 4, lanes: [
                { ingredient: 'iron-gear-wheel', stack_size: 4, lane_end: { kind: options.input?.lane_end ?? 'dead_end' } },
                { ingredient: 'copper-plate', stack_size: 4, lane_end: { kind: options.input?.lane_end ?? 'dead_end' } },
            ] },
            { id: 2, type: 'turbo-transport-belt', lanes: [{ ingredient: 'automation-science-pack', stack_size: 4 }] },
        ],
        chests,
        overrides: {},
    } as Config;
}
