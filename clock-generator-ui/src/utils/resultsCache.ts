/**
 * What is kept of a generation, so that a reload, an Undo of a build replaced as a whole, or a Cancel can show it
 * again, and the rules of keeping it: which one replaces which, how big they may be, and which go first. Pure: the
 * storage itself is `resultsStore.ts`.
 */

import type { ClockAlternativeView } from '../worker/types';
import type { PickRule } from './recommendedClock';
import type { GeneratedFor } from './resultsStaleness';

/**
 * The shape of what is kept. Bump it whenever `KeptResults` or `ClockAlternativeView` changes shape (a field added,
 * removed or changed): kept results of another version are thrown away when the page opens, never shown.
 */
export const RESULTS_SCHEMA_VERSION = 1;

/** The most generations kept, one per build */
export const MAX_KEPT = 10;

/** Above this (estimated), a generation is kept without its developer timelines; still above it, it is not kept */
export const RECORD_BYTES_CAP = 16 * 1024 * 1024;

/** The most kept in all (estimated); the least recently shown go first */
export const TOTAL_BYTES_CAP = 64 * 1024 * 1024;

/** Under Results after a run the player stopped */
export const STOPPED_NOTE = 'You stopped this run early, so not every clock was tried. Generate again to try them all.';

/** Under Results after a run that did not make the clock the player had picked */
export const pickGoneNote = (label: string) =>
    `${label}, the clock you picked, wasn't made this time, so the recommended clock is selected.`;

/** The clock the player chose, by id, with the name it had then; null when the selection follows the recommendation */
export type KeptPick = { id: string; label: string } | null;

/** One generation as it was shown: everything a run sets on the page except the log and the check */
export interface KeptResults {
    generatedFor: GeneratedFor;
    alternatives: ClockAlternativeView[];
    pickRule: PickRule | null;
    skippedSearches: string[];
    searchedDeeper: boolean;
    /** The player stopped the run before every clock was tried */
    stopped: boolean;
    /** Kept without the developer timelines, to fit `RECORD_BYTES_CAP` */
    lean: boolean;
}

/** The small row kept for each generation, read whole when the page opens */
export interface KeptEntry {
    /** The config key the clocks were made for, `generatedFor.key` */
    key: string;
    schema: number;
    appVersion: string;
    savedAt: number;
    /** When it was last on screen; the least recently shown go first */
    shownAt: number;
    /** Its estimated size */
    bytes: number;
    stopped: boolean;
    pick: KeptPick;
}

/** The results on the page, with the player's pick */
export interface ShownResults {
    results: KeptResults;
    pick: KeptPick;
}

/** A Cancel, and what it left on screen; `id` tells two of the same apart */
export interface RunStop {
    id: number;
    kept: 'previous' | 'partial' | 'none' | 'check';
}

const BYTES_PER_CHARACTER = 2;
const BYTES_PER_HISTORY_ENTRY = 100;
const BYTES_PER_CLOCK = 2048;

type History = { entities: { transfers?: unknown[]; transitions?: unknown[]; factorio_states?: unknown[] }[] } | null;

/** The transfers, transitions and Factorio states of a history */
function historyEntries(history: History): number {
    return history?.entities.reduce((sum, entity) =>
        sum + (entity.transfers?.length ?? 0) + (entity.transitions?.length ?? 0) + (entity.factorio_states?.length ?? 0), 0) ?? 0;
}

/**
 * The size of a kept generation, estimated from what makes it big: the blueprints and the developer timelines. Cheap
 * enough to run at every save.
 */
export function estimateKeptBytes(results: Pick<KeptResults, 'alternatives'>): number {
    return results.alternatives.reduce((sum, clock) => sum
        + BYTES_PER_CLOCK
        + clock.blueprintString.length * BYTES_PER_CHARACTER
        + BYTES_PER_HISTORY_ENTRY * (
            historyEntries(clock.transferHistory)
            + historyEntries(clock.stateTransitionHistory)
            + historyEntries(clock.clockOnlyTransferHistory)
            + historyEntries(clock.clockOnlyStateTransitionHistory)
        ), 0);
}

/** The generation without its developer timelines; the blueprints, wake windows and fuel stay */
export function leanResults(results: KeptResults): KeptResults {
    return {
        ...results,
        lean: true,
        alternatives: results.alternatives.map((clock) => ({
            ...clock,
            transferHistory: { total_duration_ticks: clock.transferHistory.total_duration_ticks, entities: [] },
            stateTransitionHistory: { total_duration_ticks: clock.stateTransitionHistory.total_duration_ticks, entities: [] },
            clockOnlyTransferHistory: null,
            clockOnlyStateTransitionHistory: null,
        })),
    };
}

/** Whether a new generation for a build replaces the one kept for it: a stopped run never replaces a complete one */
export function shouldReplace(existing: Pick<KeptEntry, 'stopped'> | null | undefined, incoming: Pick<KeptResults, 'stopped'>): boolean {
    return !incoming.stopped || !existing || existing.stopped;
}

/**
 * The keys to remove so that at most `maxKept` are kept and their sizes fit `totalBytes`: the least recently shown
 * first, never one of `keep`. Nothing when both already hold.
 */
export function evictionOrder(
    entries: Pick<KeptEntry, 'key' | 'shownAt' | 'bytes'>[],
    { keep, maxKept, totalBytes }: { keep: string[]; maxKept: number; totalBytes: number },
): string[] {
    let count = entries.length;
    let bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    const evicted: string[] = [];
    const oldestFirst = [...entries].sort((a, b) => a.shownAt - b.shownAt).filter((entry) => !keep.includes(entry.key));
    for (const entry of oldestFirst) {
        if (count <= maxKept && bytes <= totalBytes) {
            break;
        }
        evicted.push(entry.key);
        count--;
        bytes -= entry.bytes;
    }
    return evicted;
}

/** Whether an entry can be shown: kept by this version of the page, in this shape */
export function usableEntry(entry: Pick<KeptEntry, 'schema' | 'appVersion'>, appVersion: string): boolean {
    return entry.schema === RESULTS_SCHEMA_VERSION && entry.appVersion === appVersion;
}

/** The results set aside when the build was replaced as a whole (Import, Paste, Reset), for an Undo to bring back */
export interface DroppedResults {
    /** The key of the form that was replaced */
    formKey: string;
    shown: ShownResults;
}

/**
 * Which results to show on an empty Results page for the build with `currentKey`, first match wins: the ones kept for
 * this build; the ones set aside by the last Import, Paste or Reset of this build (its Undo); on load only, the ones
 * shown most recently, as they were (stale when the build changed since). Null when none.
 */
export function keyToShow({ currentKey, mode, entries, dropped }: {
    currentKey: string;
    mode: 'load' | 'replace';
    entries: Pick<KeptEntry, 'key' | 'shownAt'>[];
    dropped: Pick<DroppedResults, 'formKey'> | null;
}): { from: 'kept'; key: string } | { from: 'dropped' } | null {
    if (entries.some((entry) => entry.key === currentKey)) {
        return { from: 'kept', key: currentKey };
    }
    if (dropped !== null && dropped.formKey === currentKey) {
        return { from: 'dropped' };
    }
    if (mode === 'load' && entries.length > 0) {
        const latest = entries.reduce((a, b) => (b.shownAt > a.shownAt ? b : a));
        return { from: 'kept', key: latest.key };
    }
    return null;
}

/**
 * What a Cancel of a generation for `runKey` leaves on screen, first match wins: the results shown before it when
 * they were complete and for the same build (a cancelled regenerate or Search deeper loses nothing); the clocks made so
 * far; the results shown before it, whatever they were; nothing.
 */
export function afterCancel({ runKey, clocksMade, previous }: {
    runKey: string;
    clocksMade: number;
    previous: ShownResults | null;
}): { kind: 'previous'; shown: ShownResults } | { kind: 'partial' } | { kind: 'none' } {
    if (previous && previous.results.generatedFor.key === runKey && !previous.results.stopped) {
        return { kind: 'previous', shown: previous };
    }
    if (clocksMade > 0) {
        return { kind: 'partial' };
    }
    if (previous) {
        return { kind: 'previous', shown: previous };
    }
    return { kind: 'none' };
}

/**
 * The clock selected when a run ends or results come back: the player's pick when it is among them; otherwise the
 * recommended one, and `pickGone` when there was a pick
 */
export function selectionAfterRun(
    alternatives: Pick<ClockAlternativeView, 'id'>[],
    pick: KeptPick,
    recommendedIndex: number | null,
): { index: number; pickGone: boolean } {
    const picked = pick === null ? -1 : alternatives.findIndex((clock) => clock.id === pick.id);
    if (picked >= 0) {
        return { index: picked, pickGone: false };
    }
    return { index: recommendedIndex ?? 0, pickGone: pick !== null };
}
