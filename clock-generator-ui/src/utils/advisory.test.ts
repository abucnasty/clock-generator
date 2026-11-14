import { expect, it } from 'vitest';
import { ADVISORY_COPY, advisoryInserters, advisoryMachines, dropsByTiles, idLines, pickupFact, type Advisory } from './advisory';

const drops = (ids: number[], tiles: number) => ids.map(inserter_id => ({ inserter_id, tiles }));

it('gives the inserters of an advisory once each, in order', () => {
    expect(advisoryInserters({ kind: 'side-loaded-drop', drops: [...drops([13, 11], 2), ...drops([12], 3)] })).toEqual([11, 12, 13]);
    const pickup = { belt_id: 1, item: 'iron-plate', lane_stack_sizes: [], hand_size: 12, item_stack_size: null };
    expect(advisoryInserters({ kind: 'pickup-not-tested', pickups: [{ ...pickup, inserter_id: 4 }, { ...pickup, inserter_id: 1 }, { ...pickup, inserter_id: 4, item: 'coal' }] }))
        .toEqual([1, 4]);
    expect(advisoryInserters({ kind: 'lanes-shared-by-copies', inserters: [5, 2], text: '' })).toEqual([2, 5]);
    expect(advisoryInserters({ kind: 'copy-gap-needed', text: '' })).toEqual([]);
    const machines: Advisory = { kind: 'machine-prototype', problem: 'recipe-not-made', machines: [{ machine_id: 3, message: '' }, { machine_id: 1, message: '' }] };
    expect(advisoryInserters(machines)).toEqual([]);
    expect(advisoryMachines(machines)).toEqual([1, 3]);
});

it('draws one shape for each length of the belt to the side-load, its inserters in order', () => {
    expect(dropsByTiles([...drops([17, 11], 2), ...drops([5], 1)])).toEqual([{ tiles: 1, inserters: [5] }, { tiles: 2, inserters: [11, 17] }]);
});

it('breaks a long list of inserters into lines of six for the drawing', () => {
    expect(idLines([11, 12, 13, 15, 16, 17])).toEqual(['11, 12, 13, 15, 16, 17']);
    expect(idLines([1, 2, 3, 4, 5, 6, 7, 8])).toEqual(['1, 2, 3, 4, 5, 6,', '7, 8']);
});

it('says what each untested belt pickup is, in the words of the log', () => {
    const item = (id: string) => ({ 'iron-plate': 'Iron plate', 'uranium-235': 'Uranium-235' })[id] ?? id;
    expect(pickupFact({ inserter_id: 1, belt_id: 2, item: 'iron-plate', lane_stack_sizes: [2], hand_size: null, item_stack_size: null }, item))
        .toBe('Inserter 1 picks up iron plate from belt 2 in 2-item belt stacks.');
    expect(pickupFact({ inserter_id: 3, belt_id: 1, item: 'iron-plate', lane_stack_sizes: [1, 2, 3], hand_size: 12, item_stack_size: null }, item))
        .toBe('Inserter 3 picks up iron plate from belt 1 in 1-, 2- and 3-item belt stacks with a 12-item hand.');
    expect(pickupFact({ inserter_id: 3, belt_id: 1, item: 'uranium-235', lane_stack_sizes: [], hand_size: 8, item_stack_size: 8 }, item))
        .toBe('Inserter 3 picks up uranium-235 from belt 1 with an 8-item hand (uranium-235 stacks to 8).');
});

it('keeps every line short and names no word the glossary avoids', () => {
    const lines = Object.values(ADVISORY_COPY.lines);
    expect(lines.every(line => line.split(' ').length <= 8)).toBe(true);
    const words = JSON.stringify(ADVISORY_COPY).toLowerCase();
    for (const avoided of ['belt buffer', 'shared by copies', 'validate', 'player', 'target output', 'jam', 'starv']) {
        expect(words).not.toContain(avoided);
    }
});
