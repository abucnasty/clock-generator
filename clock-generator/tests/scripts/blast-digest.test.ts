// The results digest of a blast job (scripts/blast/blast.digest.ts): the canonical walk, and the lazy expansion of a sealed history.
import { describe, expect, it } from 'vitest';
import { reasonId } from '../../src/control-logic/mode/reason-table';
import { factorioStateCode, statusCode } from '../../src/state/status-codes';
import { type CompactStateTransitionHistory, expandStateTransitionHistory } from '../../src/crafting/sequence/compact-history';
import { EntityTransitionColumns } from '../../src/crafting/sequence/transition-columns';
import { digestAlternative, digestJob, expandedLazily, Lazy, shaOf } from '../../scripts/blast/blast.digest';

const columnsOf = (transitions: [number, string, string, string][], states: [number, string][] = []) => {
    const columns = new EntityTransitionColumns();
    transitions.forEach(([tick, from, to, reason]) => columns.push(tick, statusCode(from), statusCode(to), reasonId(reason)));
    states.forEach(([tick, state]) => columns.pushState(tick, factorioStateCode(state)));
    return columns.seal();
};

const history: CompactStateTransitionHistory = {
    total_duration_ticks: 100,
    entities: [
        {
            entity_id: 'machine:1', entity_type: 'machine', label: 'Machine 1', source: undefined, sink: undefined, items: ['gear'],
            initial_status: 'WORKING', initial_factorio_state: 'working',
            columns: columnsOf([[10, 'WORKING', 'OUTPUT_FULL', 'digest test: output full'], [40, 'OUTPUT_FULL', 'WORKING', 'digest test: taken']],
                [[0, 'working'], [10, 'full_output'], [40, 'working']]),
        },
        {
            entity_id: 'inserter:2', entity_type: 'inserter', label: 'Inserter 2',
            source: { entity_id: 'machine:1', entity_type: 'machine', label: 'Machine 1' },
            sink: { entity_id: 'chest:1', entity_type: 'chest', label: 'Chest 1' }, items: ['gear'],
            initial_status: 'IDLE', initial_factorio_state: 'unknown',
            columns: columnsOf([[20, 'IDLE', 'PICKUP', 'digest test: output full'], [20, 'PICKUP', 'SWING', 'digest test: hand full']]),
        },
    ],
};

describe('the canonical walk', () => {
    it('does not depend on the order of keys, and leaves out what is undefined', () => {
        expect(shaOf({ a: 1, b: [1, 2], c: undefined }).sha).toBe(shaOf({ b: [1, 2], a: 1 }).sha);
        expect(shaOf({ a: 1 }).sha).not.toBe(shaOf({ a: 2 }).sha);
        expect(shaOf([1, 2]).sha).not.toBe(shaOf([2, 1]).sha);
    });

    it('tells apart what JSON would not', () => {
        expect(shaOf('1').sha).not.toBe(shaOf(1).sha);
        expect(shaOf(new Map([[1, 2]])).sha).not.toBe(shaOf([[1, 2]]).sha);
        expect(shaOf(new Set([1])).sha).not.toBe(shaOf([1]).sha);
        expect(shaOf(-0).sha).not.toBe(shaOf(0).sha);
        expect(shaOf(null).sha).not.toBe(shaOf(undefined).sha);
    });

    it('hashes a lazy list as the array it makes', () => {
        expect(shaOf(new Lazy(3, index => ({ index }))).sha).toBe(shaOf([{ index: 0 }, { index: 1 }, { index: 2 }]).sha);
    });
});

describe('a sealed history', () => {
    it('hashes as its serializable form, made one entity at a time', () => {
        const lazy = expandedLazily(history, expandStateTransitionHistory);
        expect(lazy).not.toBe(history);
        expect(shaOf(lazy).sha).toBe(shaOf(expandStateTransitionHistory(history)).sha);
    });

    it('is left as it is where it is not sealed or there is no way to expand it', () => {
        const plain = { total_duration_ticks: 5, entities: [{ entity_id: 'a', transitions: [] }] };
        expect(expandedLazily(plain, expandStateTransitionHistory)).toBe(plain);
        expect(expandedLazily(history, undefined)).toBe(history);
        expect(expandedLazily(undefined, expandStateTransitionHistory)).toBeUndefined();
    });
});

describe('the digest of an alternative and of a job', () => {
    const alternative = (change: Record<string, unknown> = {}, run: Record<string, unknown> = {}) => ({
        id: 'x', label: 'L', description: 'D', insights: [{ text: 'i' }], verdict: 'stable', assessment: { holds: true },
        result: { serializable_transfer_history: { entities: [] }, serializable_state_transition_history: history,
            clock_only_run: { transfer_history: { entities: [] }, state_transition_history: history }, ...run },
        ...change,
    });

    it('names the component that moved, and only it', () => {
        const base = digestAlternative(alternative(), expandStateTransitionHistory);
        const moved = digestAlternative(alternative({ insights: [{ text: 'j' }] }), expandStateTransitionHistory);
        const names = Object.keys(base.results).filter(name => base.results[name] !== moved.results[name]);
        expect(names).toEqual(['insights']);
        expect(moved.results_sha256).not.toBe(base.results_sha256);
        expect(digestAlternative(alternative(), expandStateTransitionHistory)).toEqual(base);
    });

    it('sees a change in a history, and in the clock-only run', () => {
        const base = digestAlternative(alternative(), expandStateTransitionHistory);
        const shorter = { ...history, total_duration_ticks: 99 };
        const states = digestAlternative(alternative({}, { serializable_state_transition_history: shorter }), expandStateTransitionHistory);
        const clock_only = digestAlternative(alternative({}, { clock_only_run: { transfer_history: { entities: [] }, state_transition_history: shorter } }), expandStateTransitionHistory);
        const differ = (other: typeof base) => Object.keys(base.results).filter(name => base.results[name] !== other.results[name]);
        expect(differ(states)).toEqual(['state_transition_history']);
        expect(differ(clock_only)).toEqual(['clock_only_run']);
    });

    it('digests why_not_stable, the selected index and the ids for the job', () => {
        const job = digestJob({ why_not_stable: null, selected_index: 0, alternatives: [{ id: 'a' }, { id: 'b' }] });
        expect(Object.keys(job.results)).toEqual(['why_not_stable', 'selected_index', 'ids']);
        expect(digestJob({ why_not_stable: null, selected_index: 1, alternatives: [{ id: 'a' }, { id: 'b' }] }).results_sha256).not.toBe(job.results_sha256);
    });
});
