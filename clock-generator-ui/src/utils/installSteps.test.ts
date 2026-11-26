import { describe, expect, it } from 'vitest';
import { INSTALL_COPY, firstLineOf, installSteps, wiringList, wiringRowKey, type InstallStep, type InstallStepId, type WiringMoves } from './installSteps';

type Input = Parameters<typeof installSteps>[0];
const detailOf = (steps: InstallStep[], id: InstallStepId) => steps.find(it => it.id === id)?.detail ?? '';
const plain = { book: false, wiring: [[1]], drills: [] };
const book = { ...plain, book: true };
/** A clocked drill and no clocked inserter */
const drillOnly = { book: false, wiring: [], drills: [[2]] };
const withDrill = { book: false, wiring: [[1]], drills: [[1]] };

describe('installSteps', () => {
    it.each<[string, Input, InstallStepId[]]>([
        ['lists the steps in order for a single blueprint', plain, ['import', 'place', 'wire', 'enable', 'others', 'lock']],
        ['adds the book step after import for a book', book, ['import', 'book', 'place', 'wire', 'enable', 'others', 'lock']],
        ['wires a clocked drill in a step of its own when every inserter runs all the time', drillOnly, ['import', 'place', 'drills', 'others', 'lock']],
        ['lists the same steps for clocked drills wired with the inserters', withDrill, ['import', 'place', 'wire', 'enable', 'others', 'lock']],
    ])('%s', (_, input, order) => {
        expect(installSteps(input).map(it => it.id)).toEqual(order);
    });

    it.each([false, true])('needs no clock when no inserter or drill is on the clock (each Always on, or with nothing to wait for): one step, book %s', book => {
        expect(installSteps({ book, wiring: [], drills: [] })).toEqual([{ id: 'none', ...INSTALL_COPY.none }]);
    });

    it('wires clocked drills with the inserters, in the wire and enable steps', () => {
        const steps = installSteps(withDrill);
        expect(detailOf(steps, 'wire')).toBe(INSTALL_COPY.wire.detail + INSTALL_COPY.wire.drills);
        expect(detailOf(steps, 'enable')).toBe(INSTALL_COPY.enable.detail + INSTALL_COPY.enable.drills);
    });

    it('says Factorio 2.1 in the import step', () => {
        const [{ title, detail }] = installSteps(plain);
        expect(title).toContain('Factorio 2.1');
        expect(detail).toContain('Factorio 2.1');
    });

    it.each<[string, Input, InstallStepId, string[]]>([
        ['says to use the first blueprint of a book', book, 'book', ['Use the first blueprint', 'the book opens on it']],
        ['says how to wire a drill and set it to switch on', drillOnly, 'drills', ['"1 drill"', 'Anything > 0']],
        ['says how to set an inserter to switch on', plain, 'enable', ['Anything > 0', 'Enable if']],
        ['says what the combinator\'s lines hold: the count of inserters, then source, item and sink', plain, 'wire', [
            'starts with a count of inserters, such as "2 inserters"',
            'each inserter has a line of source, item and sink',
        ]],
        ['names the clock lock among the parts to leave, and points the description to the list', plain, 'wire', [
            'the Clock lock and every combinator described "Part of the clock"',
            'The combinator\'s description names the same inserters; this list has all of it.',
        ]],
        ['says what an inserter outside the list does, true for Always on and nothing to wait for, and how to undo an older clock', plain, 'others', [
            'gets no combinator',
            'One set to Always on, or with nothing to wait for, runs all the time: do not wire it.',
            'remove its wire, or untick Enable if',
        ]],
        ['says the lock is off', plain, 'lock', ['It is off']],
    ])('%s', (_, input, id, claims) => {
        const detail = detailOf(installSteps(input), id);
        for (const claim of claims) expect(detail).toContain(claim);
    });

    it.each<[string, Input, RegExp]>([
        ['anything of 500 bytes, as the list has all of the description', plain, /500 bytes/],
        ['that an inserter not in the list runs all the time', plain, /not in the list runs all the time/],
        ['anything of drills when the only drill is always on, as it has no combinator', plain, /drill/i],
        ['what is not confirmed: carrying the wire along power poles', { ...withDrill, book: true }, /power pole/i],
    ])('does not state %s', (_, input, claim) => {
        expect(installSteps(input).map(it => it.detail).join(' ')).not.toMatch(claim);
    });

    it('never shows an enum, an old word or an empty string', () => {
        const inputs = [{ book: true, wiring: [[1, 2]], drills: [[1]] }, { book: false, wiring: [], drills: [[3]] }, { book: false, wiring: [], drills: [] }];
        for (const text of inputs.flatMap(input => installSteps(input)).flatMap(it => [it.title, it.detail])) {
            expect(text.trim().length).toBeGreaterThan(0);
            expect(text).not.toMatch(/\bALWAYS\b|\bAUTO\b/);
            expect(text).not.toMatch(/potential|\bhands?\b|transfer/i);
        }
    });
});

describe('wiringList', () => {
    const moves: Record<string, WiringMoves> = {
        'inserter:1': { items: ['iron-plate'], route: 'Belt 1 to Machine 1', from: { label: 'Belt 1' }, to: { label: 'Machine 1', recipe: 'iron-gear-wheel' } },
        'inserter:2': { items: ['copper-cable'], route: 'Machine 2 to Machine 1' },
        'drill:1': { items: ['stone'], route: 'into Machine 3', to: { label: 'Machine 3', recipe: 'rail' } },
    };
    const none = { items: [], route: '' };
    const movesOf = (id: string) => moves[id] ?? none;
    const combinators = (facts: Parameters<typeof wiringList>[0]) => wiringList(facts, movesOf).map(it => it.combinator);

    it('has one row per combinator, inserters then drills, ordered by the first number', () => {
        expect(combinators({ wiring: [[3], [2, 1], [10]], drills: [[1]] })).toEqual(['Inserters 1, 2', 'Inserter 3', 'Inserter 10', 'Drill 1']);
    });

    it.each([
        ['gives each inserter its item ids (shown as icons), its ends and the recipe of a machine, one entry each', { wiring: [[2, 1], [3]], drills: [] }, [
            [
                { label: 'Inserter 1', items: ['iron-plate'], route: 'Belt 1 to Machine 1', from: { label: 'Belt 1' }, to: { label: 'Machine 1', recipe: 'iron-gear-wheel' } },
                { label: 'Inserter 2', items: ['copper-cable'], route: 'Machine 2 to Machine 1' },
            ],
            [{ label: 'Inserter 3', items: [], route: '' }],
        ]],
        ['gives a drill its item and where it mines into', { wiring: [], drills: [[1]] }, [[{ label: 'Drill 1', items: ['stone'], route: 'into Machine 3', to: { label: 'Machine 3', recipe: 'rail' } }]]],
    ])('%s', (_, facts, entries) => {
        expect(wiringList(facts, movesOf).map(it => it.entries)).toEqual(entries);
    });

    it('names each inserter once, by its number, never by an entity id', () => {
        const rows = wiringList({ wiring: [[1, 22], [3]], drills: [[4, 2]] }, () => none);
        expect(rows.flatMap(it => it.entries.map(entry => entry.label))).toEqual(['Inserter 1', 'Inserter 22', 'Inserter 3', 'Drill 2', 'Drill 4']);
        expect(rows.map(it => it.combinator)).toEqual(['Inserters 1, 22', 'Inserter 3', 'Drills 2, 4']);
    });

    it('drops an empty row', () => {
        expect(combinators({ wiring: [[], [5, 4]], drills: [[]] })).toEqual(['Inserters 4, 5']);
    });

    it('gives a row the first line of its combinator\'s description, found by the ids it switches on in any order', () => {
        const lines = { 'inserter:1,2': 'two inserters line', 'drill:1': 'a drill line' };
        const rows = wiringList({ wiring: [[3], [2, 1]], drills: [[1]], lines }, movesOf);
        expect(rows.map(it => it.line)).toEqual(['two inserters line', undefined, 'a drill line']);
        expect(rows.map(it => 'line' in it)).toEqual([true, false, true]);
    });

    it('keeps a row\'s key by its kind: inserter 1 and drill 1 do not share a line', () => {
        expect(wiringRowKey('inserter', [2, 1])).toBe('inserter:1,2');
        expect(wiringRowKey('drill', [1])).toBe('drill:1');
        expect(firstLineOf('first\nsecond')).toBe('first');
        expect(firstLineOf('only')).toBe('only');
    });
});

describe('the letter of a combinator in the steps and in the wiring list', () => {
    const sentence = 'The first line of the combinator\'s description has its letter last, such as (E). The wiring reference and the Layout view show the same letter.';

    it('says in the wire step, and in the step of a clock that wires only drills, that the first line has the letter the page shows, last', () => {
        expect(detailOf(installSteps(plain), 'wire')).toContain(sentence);
        expect(detailOf(installSteps(withDrill), 'wire')).toContain(sentence);
        expect(detailOf(installSteps(drillOnly), 'drills')).toContain(sentence);
        // once in a step, and in no other
        for (const input of [plain, withDrill, drillOnly]) {
            const said = installSteps(input).filter(step => step.detail.includes(sentence));
            expect(said).toHaveLength(1);
            expect(said[0].detail.split(sentence)).toHaveLength(2);
        }
    });

    it('gives each row its kind, its ascending ids and its letter by the row\'s key, none where the clock has none', () => {
        const letters = { 'inserter:1,2': { letter: 'A', colour: 0, round: false }, 'drill:1': { letter: 'C', colour: 2, round: false } };
        const rows = wiringList({ wiring: [[3], [2, 1]], drills: [[1]], letters }, () => ({ items: [], route: '' }));
        expect(rows.map(row => [row.kind, row.ids, row.letter?.letter])).toEqual([['inserter', [1, 2], 'A'], ['inserter', [3], undefined], ['drill', [1], 'C']]);
        expect(rows.map(row => 'letter' in row)).toEqual([true, false, true]);
    });
});
