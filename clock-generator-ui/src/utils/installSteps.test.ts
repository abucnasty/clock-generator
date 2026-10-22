import { describe, expect, it } from 'vitest';
import { INSTALL_COPY, REQUIRES_FACTORIO, installSteps, wiringList, type InstallStep } from './installSteps';

const ids = (steps: InstallStep[]) => steps.map(it => it.id);
const detailOf = (steps: InstallStep[], id: InstallStep['id']) => steps.find(it => it.id === id)?.detail ?? '';
const plain = { book: false, wiring: [[1]], drills: [] };

describe('installSteps', () => {
    it('lists the steps in order for a single blueprint', () => {
        expect(ids(installSteps(plain))).toEqual(['import', 'place', 'wire', 'enable', 'others', 'lock']);
    });

    it('adds the book step after import for a book, and says to use the first blueprint', () => {
        const steps = installSteps({ ...plain, book: true });
        expect(ids(steps)).toEqual(['import', 'book', 'place', 'wire', 'enable', 'others', 'lock']);
        expect(detailOf(steps, 'book')).toContain('Use the first blueprint');
        expect(detailOf(steps, 'book')).toContain('the book opens on it');
    });

    it('needs no clock when no inserter or drill is on the clock (each Always on, Never on, or with nothing to wait for): one step', () => {
        for (const book of [false, true]) {
            const steps = installSteps({ book, wiring: [], drills: [] });
            expect(ids(steps)).toEqual(['none']);
            expect(steps[0].detail).toBe('No inserter or drill is on the clock, so this build needs no clock. If you set an inserter to Never on, keep it switched off in the game yourself.');
        }
    });

    it('wires a clocked drill in a step of its own when every inserter runs all the time', () => {
        const steps = installSteps({ book: false, wiring: [], drills: [[2]] });
        expect(ids(steps)).toEqual(['import', 'place', 'drills', 'others', 'lock']);
        expect(detailOf(steps, 'drills')).toContain('(drill 1)');
        expect(detailOf(steps, 'drills')).toContain('Anything > 0');
    });

    it('wires clocked drills with the inserters, and promises none for a drill that is always on', () => {
        const withDrill = installSteps({ book: false, wiring: [[1]], drills: [[1]] });
        expect(detailOf(withDrill, 'wire')).toBe(INSTALL_COPY.wire.detail + INSTALL_COPY.wire.drills);
        expect(detailOf(withDrill, 'enable')).toBe(INSTALL_COPY.enable.detail + INSTALL_COPY.enable.drills);
        // a drill that is always on has no combinator, so nothing is said about drills
        const alwaysOnDrill = installSteps({ book: false, wiring: [[1]], drills: [] });
        expect(alwaysOnDrill.map(it => it.detail).join(' ')).not.toMatch(/drill/i);
        expect(ids(withDrill)).toEqual(ids(alwaysOnDrill));
    });

    it('says Factorio 2.1 in the import step', () => {
        const steps = installSteps(plain);
        expect(detailOf(steps, 'import')).toContain('Factorio 2.1');
        expect(steps[0].title).toContain('Factorio 2.1');
        expect(REQUIRES_FACTORIO).toBe('Needs Factorio 2.1.');
    });

    it('says how to set an inserter to switch on, and how to undo an older clock', () => {
        const steps = installSteps(plain);
        expect(detailOf(steps, 'enable')).toContain('Anything > 0');
        expect(detailOf(steps, 'enable')).toContain('Enable/disable');
        expect(detailOf(steps, 'others')).toContain('remove its wire, or untick Enable/disable');
    });

    it('names the clock lock among the parts to leave, and points the description to the list', () => {
        const wire = detailOf(installSteps(plain), 'wire');
        expect(wire).toContain('the Clock lock and every combinator described "Part of the clock"');
        expect(wire).toContain('The combinator\'s description names the same inserters; this list has all of it.');
        expect(wire).not.toMatch(/500 bytes/);
    });

    it('says what an inserter outside the list does, true for Always on, Never on and nothing to wait for', () => {
        const others = detailOf(installSteps(plain), 'others');
        expect(others).toContain('gets no combinator');
        expect(others).toContain('One set to Always on, or with nothing to wait for, runs all the time: do not wire it.');
        expect(others).toContain('One set to Never on is never switched on by the clock: keep it off in the game yourself.');
        expect(others).not.toMatch(/not in the list runs all the time/);
    });

    it('says the lock is off', () => {
        expect(detailOf(installSteps(plain), 'lock')).toContain('It is off');
    });

    it('does not state what the owner has not confirmed: carrying the wire along power poles', () => {
        const steps = installSteps({ book: true, wiring: [[1]], drills: [[1]] });
        expect(steps.map(it => it.detail).join(' ')).not.toMatch(/power pole/i);
    });

    it('never shows an enum, an old word or an empty string', () => {
        for (const input of [
            { book: true, wiring: [[1, 2]], drills: [[1]] },
            { book: false, wiring: [], drills: [[3]] },
            { book: false, wiring: [], drills: [] },
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

describe('wiringList', () => {
    const moves: Record<string, { items: string[]; route: string }> = {
        'inserter:1': { items: ['iron-plate'], route: 'Belt 1 to Machine 1' },
        'inserter:2': { items: ['copper-cable'], route: 'Machine 2 to Machine 1' },
        'drill:1': { items: ['stone'], route: 'into Machine 3' },
    };
    const none = { items: [], route: '' };
    const movesOf = (id: string) => moves[id] ?? none;

    it('has one row per combinator, inserters then drills, ordered by the first number', () => {
        const rows = wiringList({ wiring: [[3], [2, 1], [10]], drills: [[1]] }, movesOf);
        expect(rows.map(it => it.combinator)).toEqual(['Inserters 1, 2', 'Inserter 3', 'Inserter 10', 'Drill 1']);
    });

    it('gives each inserter its item ids (shown as icons) and its ends, one entry each', () => {
        const [merged, single] = wiringList({ wiring: [[2, 1], [3]], drills: [] }, movesOf);
        expect(merged.entries).toEqual([
            { label: 'Inserter 1', items: ['iron-plate'], route: 'Belt 1 to Machine 1' },
            { label: 'Inserter 2', items: ['copper-cable'], route: 'Machine 2 to Machine 1' },
        ]);
        expect(single.entries).toEqual([{ label: 'Inserter 3', items: [], route: '' }]);
    });

    it('gives a drill its item and where it mines into', () => {
        const [drill] = wiringList({ wiring: [], drills: [[1]] }, movesOf);
        expect(drill.entries).toEqual([{ label: 'Drill 1', items: ['stone'], route: 'into Machine 3' }]);
    });

    it('names each inserter once, by its number, never by an entity id', () => {
        const rows = wiringList({ wiring: [[1, 22], [3]], drills: [[4, 2]] }, () => none);
        expect(rows.flatMap(it => it.entries.map(entry => entry.label))).toEqual(['Inserter 1', 'Inserter 22', 'Inserter 3', 'Drill 2', 'Drill 4']);
        expect(rows.map(it => it.combinator)).toEqual(['Inserters 1, 22', 'Inserter 3', 'Drills 2, 4']);
    });

    it('drops an empty row', () => {
        expect(wiringList({ wiring: [[], [5, 4]], drills: [[]] }, () => none).map(it => it.combinator)).toEqual(['Inserters 4, 5']);
    });
});

