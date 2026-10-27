import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { MAX_KEPT, type KeptResults } from './resultsCache';
import { createMemoryResultsStore, openResultsStore } from './resultsStore';

/** A clock whose histories hold `entries` transfers and as many transitions */
function clock(id: string, entries = 0): ClockAlternativeView {
    const transfers = Array.from({ length: entries }, (_, i) => ({ item_name: 'iron-plate', start_tick: i, end_tick: i + 1, amount: 1 }));
    return {
        id,
        label: id,
        blueprintString: 'bp',
        transferHistory: { total_duration_ticks: 60, entities: [{ entity_id: 'inserter:1', entity_type: 'inserter', label: 'Inserter 1', transfers }] },
        stateTransitionHistory: { total_duration_ticks: 60, entities: [], reasons: [] },
        clockWindows: {},
        fuelView: null,
        assumptions: { loopSeeds: [{ machineId: 'machine:1', item: 'pentapod-egg', items: 37 }], outputDrops: [],
            overrides: { loop_seed_items: 37, check_start_dependence: false }, machineFuel: [] },
        assessment: { holds: true, items_per_second: 1, wake_ups_per_minute: 1,
            backpressure_loss: null, start_dependence: null },
    } as unknown as ClockAlternativeView;
}

function results(key: string, { stopped = false, clocks = [clock('a')] } = {}): KeptResults {
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

describe('the memory store', () => {
    it('gives back what was put', async () => {
        const store = createMemoryResultsStore('1.0.0');
        const kept = results('k');
        await store.put(kept, { id: 'a', label: 'A' }, 5);
        expect(await store.get('k')).toEqual(kept);
        expect(store.entries()).toMatchObject([{ key: 'k', shownAt: 5, pick: { id: 'a', label: 'A' }, stopped: false, appVersion: '1.0.0' }]);
        expect(await store.get('other')).toBeNull();
    });

    it('answers whether a build has kept clocks without waiting', async () => {
        const store = createMemoryResultsStore();
        await store.put(results('k'), null, 1);
        expect(store.has('k')).toBe(true);
        expect(store.has('other')).toBe(false);
    });

    it('changes only the entry on setPick and touch', async () => {
        const store = createMemoryResultsStore();
        const kept = results('k');
        await store.put(kept, null, 1);
        await store.setPick('k', { id: 'b', label: 'B' });
        await store.touch('k', 9);
        expect(store.entries()[0]).toMatchObject({ pick: { id: 'b', label: 'B' }, shownAt: 9 });
        expect(await store.get('k')).toEqual(kept);
    });

    it('keeps a complete generation over a stopped one, and a stopped one over a stopped one', async () => {
        const store = createMemoryResultsStore();
        const complete = results('k', { clocks: [clock('a'), clock('b')] });
        await store.put(complete, null, 1);
        await store.put(results('k', { stopped: true }), null, 2);
        expect(await store.get('k')).toEqual(complete);
        expect(store.entries()[0].stopped).toBe(false);

        const other = createMemoryResultsStore();
        await other.put(results('k', { stopped: true }), null, 1);
        const later = results('k', { stopped: true, clocks: [clock('c')] });
        await other.put(later, null, 2);
        expect(await other.get('k')).toEqual(later);
    });

    it('lets the least recently shown go when one more than the most is put', async () => {
        const store = createMemoryResultsStore();
        for (let i = 0; i < MAX_KEPT; i++) {
            await store.put(results(`k${i}`), null, 100 + i);
        }
        // k0 was shown last, so k1 is the least recently shown
        await store.touch('k0', 500);
        await store.put(results('new'), null, 600);
        expect(store.entries()).toHaveLength(MAX_KEPT);
        expect(store.has('k1')).toBe(false);
        expect(store.has('k0')).toBe(true);
        expect(store.has('new')).toBe(true);
        expect(await store.get('k1')).toBeNull();
    });

    it('keeps a generation over the size cap without its developer timelines', async () => {
        const store = createMemoryResultsStore();
        // 90 000 transfers, 100 bytes each: about 9 MB per clock
        await store.put(results('big', { clocks: [clock('a', 90_000), clock('b', 90_000)] }), null, 1);
        const kept = await store.get('big');
        expect(kept?.lean).toBe(true);
        expect(kept?.alternatives[0].transferHistory.entities).toEqual([]);
        expect(kept?.alternatives[0].stateTransitionHistory.entities).toEqual([]);
        expect(kept?.alternatives[0].blueprintString).toBe('bp');
    });

    it('does not outlive the page', () => {
        expect(createMemoryResultsStore().persistent).toBe(false);
    });
});

describe('openResultsStore', () => {
    it('keeps the clocks in memory when the browser has no IndexedDB', async () => {
        const store = await openResultsStore({}, '1.0.0');
        expect(store.persistent).toBe(false);
        await store.put(results('k'), null, 1);
        expect(store.has('k')).toBe(true);
    });
});
