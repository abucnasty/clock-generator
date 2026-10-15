import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { findRepeatedUnits, validateCopies } from './copies-validator';
import { CopiesError } from './errors';
import { parseConfig } from './loader';
import { Config } from './schema';

type Machine = Config['machines'][number];
type Inserter = Config['inserters'][number];

const machine = (id: number, recipe: string): Machine => ({ id, recipe, productivity: 0, crafting_speed: 1 });

const belt = (id: number, ingredient: string): Config['belts'][number] => ({
    id,
    type: 'transport-belt',
    lanes: [{ ingredient, stack_size: 1 }],
});

const inserter = (source: Inserter['source'], sink: Inserter['sink']): Inserter => ({ source, sink, stack_size: 1 });

const config = (parts: Partial<Config> & { copies?: number }): Config => ({
    target_output: { recipe: 'iron-gear-wheel', items_per_second: 1, copies: parts.copies ?? 1 },
    machines: [],
    inserters: [],
    belts: [],
    ...parts,
});

const intoMachine = (beltId: number, machineId: number) => inserter({ type: 'belt', id: beltId }, { type: 'machine', id: machineId });
const outOfMachine = (machineId: number, beltId: number) => inserter({ type: 'machine', id: machineId }, { type: 'belt', id: beltId });
const between = (from: number, to: number) => inserter({ type: 'machine', id: from }, { type: 'machine', id: to });

/** A pair of machines, the first fed from belt 1 and handing over to the second, which drops onto belt 2 */
const pair = (first: number, second: number) => [
    intoMachine(1, first),
    between(first, second),
    outOfMachine(second, 2),
];

describe('validateCopies', () => {
    it('refuses two identical machine-to-machine pairs and names the machines of each copy', () => {
        const c = config({
            machines: [machine(1, 'copper-cable'), machine(2, 'electronic-circuit'), machine(3, 'copper-cable'), machine(4, 'electronic-circuit')],
            inserters: [...pair(1, 2), ...pair(3, 4)],
            belts: [belt(1, 'copper-plate'), belt(2, 'electronic-circuit')],
            copies: 3,
        });
        const found = findRepeatedUnits(c);
        expect(found.gcd).toBe(2);
        expect(found.copies).toEqual([{ machine_ids: [1, 2] }, { machine_ids: [3, 4] }]);

        expect(() => validateCopies(c)).toThrow(CopiesError);
        try {
            validateCopies(c);
        } catch (e) {
            expect((e as CopiesError).message).toBe(
                'The config holds 2 identical copies of a unit of 2 machines (copy 1: machines 1, 2; copy 2: machines 3, 4). '
                + 'Describe one copy and set target_output.copies to 6 (now 3, times 2).');
            expect((e as CopiesError).units).toEqual([{ machine_ids: [1, 2] }, { machine_ids: [3, 4] }]);
        }
    });

    it('tells a writer with copies = 1 to set copies to 2', () => {
        const c = config({
            machines: [machine(1, 'copper-cable'), machine(2, 'electronic-circuit'), machine(3, 'copper-cable'), machine(4, 'electronic-circuit')],
            inserters: [...pair(1, 2), ...pair(3, 4)],
            belts: [belt(1, 'copper-plate'), belt(2, 'electronic-circuit')],
        });
        expect(() => validateCopies(c)).toThrow('set target_output.copies to 2 (now 1, times 2)');
    });

    it('ignores ids and listing order when comparing units', () => {
        const c = config({
            machines: [machine(9, 'electronic-circuit'), machine(5, 'copper-cable'), machine(7, 'electronic-circuit'), machine(2, 'copper-cable')],
            inserters: [...pair(5, 9).reverse(), ...pair(2, 7)],
            belts: [belt(2, 'electronic-circuit'), belt(1, 'copper-plate')],
        });
        expect(findRepeatedUnits(c).copies).toEqual([{ machine_ids: [2, 7] }, { machine_ids: [5, 9] }]);
    });

    it('refuses three identical single machines fed from a belt and dropping onto a belt of the same spec', () => {
        const c = config({
            machines: [machine(1, 'iron-gear-wheel'), machine(2, 'iron-gear-wheel'), machine(3, 'iron-gear-wheel')],
            inserters: [
                intoMachine(1, 1), outOfMachine(1, 3),
                intoMachine(2, 2), outOfMachine(2, 4),
                intoMachine(1, 3), outOfMachine(3, 5),
            ],
            belts: [belt(1, 'iron-plate'), belt(2, 'iron-plate'), belt(3, 'iron-gear-wheel'), belt(4, 'iron-gear-wheel'), belt(5, 'iron-gear-wheel')],
        });
        expect(findRepeatedUnits(c).gcd).toBe(3);
        expect(() => validateCopies(c)).toThrow(
            'The config holds 3 identical copies of a unit of 1 machine (copy 1: machines 1; copy 2: machines 2; copy 3: machines 3).');
    });

    it('does not refuse units that repeat while another unit appears another number of times', () => {
        // Two cable casters, each feeding its own circuit plant, and one plastic plant: {A, A, B}.
        const c = config({
            machines: [machine(1, 'casting-copper-cable'), machine(2, 'advanced-circuit'), machine(3, 'casting-copper-cable'), machine(4, 'advanced-circuit'), machine(5, 'plastic-bar')],
            inserters: [intoMachine(1, 1), between(1, 2), intoMachine(1, 3), between(3, 4), intoMachine(3, 5), outOfMachine(2, 2), outOfMachine(4, 2)],
            belts: [belt(1, 'copper-plate'), belt(2, 'advanced-circuit'), belt(3, 'coal')],
        });
        // The plastic plant joins nothing, so the components are {1, 2}, {3, 4} and {5}.
        const found = findRepeatedUnits(c);
        expect(found.units).toHaveLength(3);
        expect(found.gcd).toBe(1);
        expect(() => validateCopies(c)).not.toThrow();
    });

    it('does not refuse a single chain', () => {
        const c = config({
            machines: [machine(1, 'copper-cable'), machine(2, 'electronic-circuit'), machine(3, 'advanced-circuit')],
            inserters: [intoMachine(1, 1), between(1, 2), between(2, 3), outOfMachine(3, 2)],
            belts: [belt(1, 'copper-plate'), belt(2, 'advanced-circuit')],
        });
        expect(findRepeatedUnits(c).units).toHaveLength(1);
        expect(() => validateCopies(c)).not.toThrow();
    });

    it('does not refuse two pairs joined by one inserter, which are one unit', () => {
        const c = config({
            machines: [machine(1, 'copper-cable'), machine(2, 'electronic-circuit'), machine(3, 'copper-cable'), machine(4, 'electronic-circuit')],
            inserters: [...pair(1, 2), ...pair(3, 4), between(2, 3)],
            belts: [belt(1, 'copper-plate'), belt(2, 'electronic-circuit')],
        });
        expect(findRepeatedUnits(c).units).toHaveLength(1);
        expect(() => validateCopies(c)).not.toThrow();
    });

    it('tells units apart that differ in a spec', () => {
        const c = config({
            machines: [machine(1, 'iron-gear-wheel'), { ...machine(2, 'iron-gear-wheel'), productivity: 0.1 }],
            inserters: [intoMachine(1, 1), outOfMachine(1, 2), intoMachine(1, 2), outOfMachine(2, 2)],
            belts: [belt(1, 'iron-plate'), belt(2, 'iron-gear-wheel')],
        });
        expect(findRepeatedUnits(c).gcd).toBe(1);
    });

    it('does not let infinity chests or belts join units', () => {
        const c = config({
            machines: [machine(1, 'iron-gear-wheel'), machine(2, 'iron-gear-wheel')],
            chests: [{ type: 'infinity-chest', id: 1, item_filter: [{ item_name: 'iron-plate', request_count: 10 }] }],
            inserters: [
                inserter({ type: 'chest', id: 1 }, { type: 'machine', id: 1 }),
                inserter({ type: 'chest', id: 1 }, { type: 'machine', id: 2 }),
                outOfMachine(1, 1), outOfMachine(2, 1),
            ],
            belts: [belt(1, 'iron-gear-wheel')],
        });
        expect(findRepeatedUnits(c).units).toHaveLength(2);
        expect(findRepeatedUnits(c).gcd).toBe(2);
    });
});

describe('validateCopies on the config samples', () => {
    const root = path.resolve(__dirname, '../../resources/config-samples');

    const filesUnder = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
        .flatMap(entry => entry.isDirectory()
            ? filesUnder(path.join(dir, entry.name))
            : entry.name.endsWith('.json') ? [path.join(dir, entry.name)] : []);

    it('does not refuse any sample', async () => {
        let checked = 0;
        for (const file of filesUnder(root)) {
            let sample: Config;
            try {
                sample = await parseConfig(fs.readFileSync(file, 'utf-8'));
            } catch {
                continue; // not a config
            }
            checked++;
            expect(() => validateCopies(sample), path.relative(root, file)).not.toThrow();
        }
        expect(checked).toBeGreaterThan(10);
    });

    it('does not refuse the advanced circuit sample: two cable casters, two circuit plants and one plastic plant', async () => {
        const file = path.join(root, 'intermediates/advanced-circuit/advanced-circuit.json');
        const sample = await parseConfig(fs.readFileSync(file, 'utf-8'));
        const found = findRepeatedUnits(sample);
        expect(found.units).toHaveLength(1); // the plastic plant feeds both circuit plants
        expect(found.gcd).toBe(1);
    });
});
