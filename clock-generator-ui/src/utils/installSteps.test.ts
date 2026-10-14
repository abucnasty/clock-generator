import { describe, expect, it } from 'vitest';
import { INSTALL_COPY, REQUIRES_FACTORIO, installSteps, wiringRows, wiringTargets, type InstallStep } from './installSteps';

const ids = (steps: InstallStep[]) => steps.map(it => it.id);
const detailOf = (steps: InstallStep[], id: InstallStep['id']) => steps.find(it => it.id === id)?.detail ?? '';

describe('installSteps', () => {
    it('lists the steps in order for a single blueprint', () => {
        expect(ids(installSteps({ book: false, wiring: [[1]], hasDrills: false })))
            .toEqual(['import', 'place', 'wire', 'enable', 'others', 'lock']);
    });

    it('adds the book step after import for a book', () => {
        expect(ids(installSteps({ book: true, wiring: [[1]], hasDrills: false })))
            .toEqual(['import', 'book', 'place', 'wire', 'enable', 'others', 'lock']);
    });

    it('has one "nothing to wire" step when no combinator switches an inserter on', () => {
        expect(ids(installSteps({ book: false, wiring: [], hasDrills: false }))).toEqual(['import', 'place', 'none', 'lock']);
        expect(ids(installSteps({ book: true, wiring: [], hasDrills: false }))).toEqual(['import', 'book', 'place', 'none', 'lock']);
    });

    it('says Factorio 2.1 in the import step and in the caption', () => {
        const steps = installSteps({ book: false, wiring: [[1]], hasDrills: false });
        expect(detailOf(steps, 'import')).toContain('Factorio 2.1');
        expect(steps[0].title).toContain('Factorio 2.1');
        expect(REQUIRES_FACTORIO).toBe('Needs Factorio 2.1.');
    });

    it('says how to set an inserter to switch on', () => {
        const enable = detailOf(installSteps({ book: false, wiring: [[1]], hasDrills: false }), 'enable');
        expect(enable).toContain('Anything > 0');
        expect(enable).toContain('Enable/disable');
    });

    it('says the lock is off', () => {
        expect(detailOf(installSteps({ book: false, wiring: [[1]], hasDrills: false }), 'lock')).toContain('It is off');
    });

    it('adds the drill sentence to the enable step, and changes nothing else', () => {
        const without = installSteps({ book: true, wiring: [[1]], hasDrills: false });
        const withDrills = installSteps({ book: true, wiring: [[1]], hasDrills: true });
        expect(detailOf(withDrills, 'enable')).toBe(detailOf(without, 'enable') + INSTALL_COPY.enable.drills);
        expect(withDrills.filter(it => it.id !== 'enable')).toEqual(without.filter(it => it.id !== 'enable'));
    });

    it('does not state what the owner has not confirmed: carrying the wire along power poles', () => {
        const steps = installSteps({ book: true, wiring: [[1]], hasDrills: true });
        expect(steps.map(it => it.detail).join(' ')).not.toMatch(/power pole/i);
    });

    it('never shows an enum, an old word or an empty string', () => {
        for (const input of [
            { book: true, wiring: [[1, 2]], hasDrills: true },
            { book: false, wiring: [], hasDrills: false },
        ]) {
            for (const { title, detail } of installSteps(input)) {
                for (const text of [title, detail]) {
                    expect(text.trim().length).toBeGreaterThan(0);
                    expect(text).not.toMatch(/\bALWAYS\b|\bAUTO\b/);
                    expect(text).not.toMatch(/potential|\bhands?\b|transfer/i);
                }
            }
        }
    });
});

describe('wiringRows', () => {
    it('orders the rows by their first inserter and names each once', () => {
        const rows = wiringRows([[3], [1, 2], [10]]);
        expect(rows).toEqual(['Inserters 1, 2', 'Inserter 3', 'Inserter 10']);
        const numbers = rows.flatMap(row => row.replace(/^Inserters? /, '').split(', ').map(Number));
        expect(numbers).toEqual([1, 2, 3, 10]);
    });

    it('sorts the ids inside a row and drops an empty row', () => {
        expect(wiringRows([[5, 4], []])).toEqual(['Inserters 4, 5']);
    });

    it('prints numbers, never an entity id', () => {
        for (const row of wiringRows([[1, 22], [3]])) {
            expect(row).toMatch(/^Inserters? \d+(, \d+)*$/);
        }
    });

    it('lists the inserters a row is wired to one by one', () => {
        expect(wiringTargets([[3], [2, 1]])).toEqual(['Inserter 1, Inserter 2', 'Inserter 3']);
    });
});
