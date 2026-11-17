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
    /**
     * The output line of the automation science sample's scaffold (automation-240.scaffold), stated in `output_belt` as
     * the sample states it: each assembler's output goes onto it at the place of the assembler of the same number in the
     * sample. Only a row of nine assemblers 9 tiles apart stands for that scaffold, in one copy or in copies 27 tiles
     * apart. Without it, each output inserter drops on a tile of its own. `off_line`: assemblers among the first four whose
     * output does not join the line (it leaves the build on its side belt).
     */
    readonly output_line?: { readonly off_line?: readonly number[] };
}

/** The tiles between two assemblers of the sample's scaffold, and between their side loads on the output line */
const SCAFFOLD_PITCH = 9;

/**
 * The automation science sample's output line (resources/config-samples/science/automation/automation-240.json), with
 * each side load at a point of its own, so that a number names an output inserter of the row, not a copy
 */
function scaffoldOutputLine(off_line: readonly number[]): NonNullable<Config['output_belt']> {
    const first = [1, 2, 3, 4].filter(machine => !off_line.includes(machine));
    if (first.length === 0 || off_line.some(machine => machine < 1 || machine > 4)) {
        throw new Error('automationRow: off_line takes some of the first four assemblers, not all of them');
    }
    const sideExit = { lane: 'right' as const, layout: 'side-exit' as const };
    return {
        side_belt: { lane: 'right', tiles: 2, left_curves: 1 },
        stretches: [
            { points: [
                ...first.map((machine, k) => k === 0 ? { side_load: [machine], ...sideExit }
                    : { tiles: (machine - first[k - 1]) * SCAFFOLD_PITCH, side_load: [machine], ...sideExit }),
                { tiles: (4 - first[first.length - 1]) * SCAFFOLD_PITCH + 2, right_curves: 1 },
            ] },
            { points: [
                { side_load: { stretch: 1 }, lane: 'left', layout: 'side-entrance' },
                { tiles: 7, drop: 5, lane: 'right' },
                { tiles: 11, left_curves: 1, right_curves: 1, side_load: [6], ...sideExit },
                { tiles: SCAFFOLD_PITCH, side_load: [7], ...sideExit },
                { tiles: SCAFFOLD_PITCH, side_load: [8], ...sideExit },
                { tiles: 16, splitter_input: 'right' },
            ] },
            { points: [{ drop: 9, lane: 'left' }, { tiles: 16, left_curves: 1, right_curves: 3, splitter_input: 'left' }] },
            { points: [{ splitter_output: 'right' }, { tiles: 1, side_load: { stretch: 5 }, lane: 'right', layout: 'side-straight' },
                { tiles: 2, lane_end: { kind: 'infinite' } }] },
            { points: [{ splitter_output: 'left' }, { tiles: 12, left_curves: 5 }] },
        ],
        splitter: { input_priority: 'right', output_priority: 'right' },
    };
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
        ...(options.output_line !== undefined && { output_belt: outputLineOf(options) }),
    } as Config;
}

function outputLineOf(options: AutomationRowOptions): NonNullable<Config['output_belt']> {
    const copies = options.copies ?? 1;
    const spaced = copies === 1 || (options.copy_offset?.x === options.machines * SCAFFOLD_PITCH && options.copy_offset.y === 0);
    if (options.machines * copies !== 9 || options.pitch !== SCAFFOLD_PITCH || !spaced) {
        throw new Error('automationRow: the output line stands for the sample\'s scaffold, nine assemblers 9 tiles apart');
    }
    return scaffoldOutputLine(options.output_line?.off_line ?? []);
}
