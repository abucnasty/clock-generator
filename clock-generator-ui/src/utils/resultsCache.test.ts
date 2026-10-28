import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import {
    afterCancel,
    estimateKeptBytes,
    evictionOrder,
    keyToShow,
    leanResults,
    RECORD_BYTES_CAP,
    RESULTS_SCHEMA_VERSION,
    selectionAfterRun,
    shouldReplace,
    usableEntry,
    type KeptResults,
    type ShownResults,
} from './resultsCache';

/** A clock with `entries` transfers and as many transitions, and a blueprint of `blueprint` characters */
function fakeClock(id: string, { entries = 0, blueprint = 100 }: { entries?: number; blueprint?: number } = {}): ClockAlternativeView {
    const transfers = Array.from({ length: entries }, (_, i) => ({ item_name: 'iron-plate', start_tick: i, end_tick: i + 1, amount: 1 }));
    const columns = { tick: new Int32Array(entries), from: new Uint8Array(entries), to: new Uint8Array(entries), reason: new Uint32Array(entries),
        state_tick: new Int32Array(0), state: new Uint8Array(0) };
    return {
        id,
        label: id,
        blueprintString: 'x'.repeat(blueprint),
        transferHistory: { total_duration_ticks: 60, entities: [{ entity_id: 'inserter:1', entity_type: 'inserter', label: 'Inserter 1', transfers }] },
        stateTransitionHistory: {
            total_duration_ticks: 60,
            entities: [{ entity_id: 'inserter:1', entity_type: 'inserter', label: 'Inserter 1', items: [], initial_status: 'IDLE', initial_factorio_state: 'working', columns }],
            reasons: [''],
        },
        clockWindows: { 'inserter:1': [] },
        fuelView: null,
    } as unknown as ClockAlternativeView;
}

function fakeResults(key: string, { stopped = false, clocks = [fakeClock('a'), fakeClock('b')] }: { stopped?: boolean; clocks?: ClockAlternativeView[] } = {}): KeptResults {
    return {
        generatedFor: { key, recipe: 'r', itemsPerSecond: 1, beltQuestion: { ask: false, answer: 'moving' }, generatedAt: 0 },
        generationAssumptions: { startDependenceRequested: false, complete: !stopped },
        alternatives: clocks,
        pickRule: null,
        skippedSearches: [],
        searchedDeeper: false,
        stopped,
        lean: false,
    };
}

const shown = (key: string, stopped = false): ShownResults => ({ results: fakeResults(key, { stopped }), pick: { id: 'b', label: 'B' } });

describe('afterCancel', () => {
    const same = shown('k');
    const other = shown('other');
    const stopped = shown('k', true);

    it.each([
        ['brings back complete results for the same build', 3, same, { kind: 'previous', shown: same }],
        ['keeps the clocks made so far when what was on screen was for another build', 2, other, { kind: 'partial' }],
        ['keeps the clocks made so far over a stopped run of the same build', 1, stopped, { kind: 'partial' }],
        ['brings back what was on screen for another build when no clock was made', 0, other, { kind: 'previous', shown: other }],
        ['brings back a stopped run of the same build when no clock was made', 0, stopped, { kind: 'previous', shown: stopped }],
        ['leaves nothing when nothing was made and nothing was on screen', 0, null, { kind: 'none' }],
    ])('%s', (_, clocksMade, previous, left) => {
        expect(afterCancel({ runKey: 'k', clocksMade, previous })).toEqual(left);
    });
});

describe('shouldReplace', () => {
    it('lets a complete generation replace anything', () => {
        expect(shouldReplace(null, { stopped: false })).toBe(true);
        expect(shouldReplace({ stopped: true }, { stopped: false })).toBe(true);
        expect(shouldReplace({ stopped: false }, { stopped: false })).toBe(true);
    });

    it('lets a stopped generation replace a stopped one or nothing, never a complete one', () => {
        expect(shouldReplace(undefined, { stopped: true })).toBe(true);
        expect(shouldReplace({ stopped: true }, { stopped: true })).toBe(true);
        expect(shouldReplace({ stopped: false }, { stopped: true })).toBe(false);
    });
});

describe('evictionOrder', () => {
    const entries = [
        { key: 'c', shownAt: 3, bytes: 10 },
        { key: 'a', shownAt: 1, bytes: 10 },
        { key: 'b', shownAt: 2, bytes: 10 },
    ];

    it.each<[string, string[], number, number, string[]]>([
        ['removes nothing when both limits hold', [], 3, 30, []],
        ['removes the least recently shown beyond the count', [], 2, 1000, ['a']],
        ['removes the least recently shown beyond the count', [], 1, 1000, ['a', 'b']],
        ['removes the least recently shown until the sizes fit', [], 10, 15, ['a', 'b']],
        ['never removes a kept key', ['a'], 2, 1000, ['b']],
        ['never removes a kept key', ['a', 'b', 'c'], 0, 0, []],
    ])('%s: keep %j, at most %s and %s bytes', (_, keep, maxKept, totalBytes, removed) => {
        expect(evictionOrder(entries, { keep, maxKept, totalBytes })).toEqual(removed);
    });
});

describe('estimateKeptBytes and leanResults', () => {
    it('grows with the histories and the blueprints', () => {
        const small = estimateKeptBytes(fakeResults('k', { clocks: [fakeClock('a')] }));
        expect(estimateKeptBytes(fakeResults('k', { clocks: [fakeClock('a', { entries: 100 })] }))).toBeGreaterThan(small);
        expect(estimateKeptBytes(fakeResults('k', { clocks: [fakeClock('a', { blueprint: 10_000 })] }))).toBeGreaterThan(small);
    });

    it('empties the histories, keeps the wake windows, blueprints and fuel, and fits a big record under the cap', () => {
        // 45 000 entries in each of two histories, 100 bytes each: about 9 MB per clock
        const big = fakeResults('k', { clocks: [fakeClock('a', { entries: 45_000 }), fakeClock('b', { entries: 45_000 })] });
        expect(estimateKeptBytes(big)).toBeGreaterThan(RECORD_BYTES_CAP);
        const lean = leanResults(big);
        expect(lean.lean).toBe(true);
        expect(estimateKeptBytes(lean)).toBeLessThan(RECORD_BYTES_CAP);
        const [clock] = lean.alternatives;
        expect(clock.transferHistory).toEqual({ total_duration_ticks: 60, entities: [] });
        expect(clock.stateTransitionHistory).toEqual({ total_duration_ticks: 60, entities: [], reasons: [] });
        expect(clock.clockWindows).toEqual(big.alternatives[0].clockWindows);
        expect(clock.blueprintString).toBe(big.alternatives[0].blueprintString);
        expect(clock.fuelView).toBe(big.alternatives[0].fuelView);
        expect(big.lean).toBe(false);
    });
});

describe('usableEntry', () => {
    it('is usable for this schema and app version only', () => {
        expect(usableEntry({ schema: RESULTS_SCHEMA_VERSION, appVersion: '1.0.0' }, '1.0.0')).toBe(true);
        expect(usableEntry({ schema: RESULTS_SCHEMA_VERSION + 1, appVersion: '1.0.0' }, '1.0.0')).toBe(false);
        expect(usableEntry({ schema: RESULTS_SCHEMA_VERSION, appVersion: '0.9.0' }, '1.0.0')).toBe(false);
    });
});

describe('keyToShow', () => {
    const entries = [{ key: 'a', shownAt: 5 }, { key: 'b', shownAt: 9 }];

    // build 'c', replacing, with nothing set aside, unless the row says otherwise
    it.each<[string, Partial<Parameters<typeof keyToShow>[0]>, ReturnType<typeof keyToShow>]>([
        ['takes the results kept for the build over the ones set aside', { currentKey: 'a', dropped: { formKey: 'a' } }, { from: 'kept', key: 'a' }],
        ['takes the ones set aside for the build they were set aside from', { dropped: { formKey: 'c' } }, { from: 'dropped' }],
        ['takes the ones set aside only for the build they were set aside from', { dropped: { formKey: 'd' } }, null],
        ['falls back on load to the ones on screen when the page was left', { mode: 'load', shownKey: 'a' }, { from: 'kept', key: 'a' }],
        ['falls back on load only to the ones still kept', { mode: 'load', entries: [], shownKey: 'a' }, null],
        ['shows nothing on load when nothing was on screen (after Reset, New build, or a build never generated)', { mode: 'load', shownKey: null }, null],
        ['shows nothing on load when nothing was on screen, by default', { mode: 'load' }, null],
        ['does not fall back when replacing', { shownKey: 'a' }, null],
    ])('%s', (_, args, shown) => {
        expect(keyToShow({ currentKey: 'c', mode: 'replace', entries, dropped: null, ...args })).toEqual(shown);
    });
});

describe('selectionAfterRun', () => {
    const clocks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    it.each([
        ['selects the pick when it was made', clocks, { id: 'c', label: 'C' }, 0, { index: 2, pickGone: false }],
        ['selects the recommended clock and says the pick is gone when it was not made', clocks, { id: 'z', label: 'Z' }, 1, { index: 1, pickGone: true }],
        ['selects the recommended clock without a pick', clocks, null, 1, { index: 1, pickGone: false }],
        ['selects the first clock without a pick or a recommended one', [], null, null, { index: 0, pickGone: false }],
    ])('%s', (_, alternatives, pick, recommended, selection) => {
        expect(selectionAfterRun(alternatives, pick, recommended)).toEqual(selection);
    });
});
