/**
 * A build of one copy for the page's tests: a row of nine automation science assemblers on two belts (the engine's
 * `tests/configs/automation-row.ts`: belt 1 brings gear wheels on lane 1 and copper plates on lane 2 to nine input inserters,
 * each with an output inserter onto belt 2), with the engine's results for it (oneCopyResults.ts, as they came), and the views
 * of its clocks as the worker gives them.
 */
import type { CheckedLanes, Config } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { laneTakersOf } from '../utils/laneTakers';
import { AUTOMATION_240, viewOf } from './checkedLanesFixtures';
import { NINE_APART_HOLDS, NINE_APART_MISSES, ROW_LANES, SIX_APART_MISSES } from './oneCopyResults';

export { NINE_APART_HOLDS, NINE_APART_MISSES, ROW_LANES, SIX_APART_MISSES };

/**
 * The row as a config, as far as the page reads it: machine n has input inserter 2n - 1 and output inserter 2n, no inserter has an
 * id (the engine numbers them in the order of the list), the input inserters stand `pitch` tiles apart along belt 1, which flows east
 */
export function rowConfig(machines: number, pitch: number): Pick<Config, 'belts' | 'inserters'> {
    return {
        belts: [
            { id: 1, type: 'turbo-transport-belt', flow_direction: 4, lanes: [{ ingredient: 'iron-gear-wheel' }, { ingredient: 'copper-plate' }] },
            { id: 2, type: 'turbo-transport-belt', lanes: [{ ingredient: 'automation-science-pack' }] },
        ],
        inserters: Array.from({ length: machines }, (_, index) => [
            { source: { type: 'belt', id: 1 }, sink: { type: 'machine', id: index + 1 }, position: { x: 10 + index * pitch + 0.5, y: -1.5 } },
            { source: { type: 'machine', id: index + 1 }, sink: { type: 'belt', id: 2 }, position: { x: 10 + index * pitch + 0.5, y: 2.5 } },
        ]).flat(),
    } as unknown as Pick<Config, 'belts' | 'inserters'>;
}

/** The machine each inserter of the row puts into, as the worker carries it */
const machineOfInserterOf = (config: Pick<Config, 'inserters'>): Record<number, number> => Object.fromEntries(config.inserters.flatMap((inserter, index) =>
    inserter.sink.type === 'machine' ? [[inserter.id ?? index + 1, inserter.sink.id]] : []));

/** The view of a clock of the row: a clock of the kept automation science result with one copy, the row's checked lanes and what the worker carries of the row */
export function rowView(checked: CheckedLanes, pitch: number, base = 'takt_batches_observed'): ClockAlternativeView {
    const config = rowConfig(9, pitch);
    const view = viewOf(AUTOMATION_240, base);
    return { ...view, copies: 1, checkedLanes: checked,
        assumptions: { ...view.assumptions, lanes: ROW_LANES, machineOfInserter: machineOfInserterOf(config), laneTakers: laneTakersOf(config) } };
}
