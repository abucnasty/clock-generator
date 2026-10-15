/**
 * Where generations are kept between visits: IndexedDB when the browser has it, else memory for this visit only. The
 * entries (small) are read whole when the page opens and mirrored here, so "is something kept for this build" is
 * answered at once; a generation itself is read when it is shown.
 */

import {
    estimateKeptBytes,
    evictionOrder,
    leanResults,
    MAX_KEPT,
    RECORD_BYTES_CAP,
    RESULTS_SCHEMA_VERSION,
    shouldReplace,
    TOTAL_BYTES_CAP,
    usableEntry,
    type KeptEntry,
    type KeptPick,
    type KeptResults,
} from './resultsCache';

export interface ResultsStore {
    /** Whether what is kept outlives the page */
    readonly persistent: boolean;
    /** Every kept generation's entry */
    entries(): KeptEntry[];
    has(key: string): boolean;
    /** The generation kept for a build; null when none is, or it cannot be read */
    get(key: string): Promise<KeptResults | null>;
    /**
     * Keeps a generation for the build it was made for, unless a complete one is kept there and this one was stopped.
     * Over the size cap it is kept without its developer timelines, or not at all; the least recently shown others go
     * to make room. Never rejects.
     */
    put(results: KeptResults, pick: KeptPick, shownAt: number): Promise<void>;
    /** The player's pick for a kept generation */
    setPick(key: string, pick: KeptPick): Promise<void>;
    /** A kept generation is on screen again */
    touch(key: string, shownAt: number): Promise<void>;
}

/** What a store keeps its data in */
interface StoreBackend {
    persistent: boolean;
    getRecord(key: string): Promise<KeptResults | undefined>;
    /** Writes both together; rejects with a `QuotaExceededError` when the browser has no room */
    write(entry: KeptEntry, record: KeptResults): Promise<void>;
    writeEntry(entry: KeptEntry): Promise<void>;
    remove(keys: string[]): Promise<void>;
}

const isQuotaError = (error: unknown) => error instanceof DOMException && error.name === 'QuotaExceededError';

let warned = false;
function warnOnce(message: string, error?: unknown): void {
    if (!warned) {
        warned = true;
        console.warn(message, error);
    }
}

function createStore(backend: StoreBackend, initial: KeptEntry[], appVersion: string): ResultsStore {
    const mirror = new Map(initial.map((entry) => [entry.key, entry]));
    // one write at a time, in the order they were asked for
    let queue: Promise<unknown> = Promise.resolve();
    const serial = (work: () => Promise<void>): Promise<void> => {
        const run = queue.then(work, work).catch((error) => warnOnce('Could not keep the clocks', error));
        queue = run;
        return run;
    };
    const removeKeys = async (keys: string[]) => {
        if (keys.length === 0) return;
        keys.forEach((key) => mirror.delete(key));
        await backend.remove(keys);
    };
    const updateEntry = (key: string, change: Partial<KeptEntry>) => serial(async () => {
        const entry = mirror.get(key);
        if (!entry) return;
        const next = { ...entry, ...change };
        mirror.set(key, next);
        await backend.writeEntry(next);
    });

    return {
        persistent: backend.persistent,
        entries: () => [...mirror.values()],
        has: (key) => mirror.has(key),
        get: async (key) => {
            if (!mirror.has(key)) return null;
            try {
                return (await backend.getRecord(key)) ?? null;
            } catch {
                return null;
            }
        },
        put: (results, pick, shownAt) => serial(async () => {
            const key = results.generatedFor.key;
            if (!shouldReplace(mirror.get(key), results)) return;
            let record = results;
            let bytes = estimateKeptBytes(record);
            if (bytes > RECORD_BYTES_CAP) {
                record = leanResults(record);
                bytes = estimateKeptBytes(record);
            }
            if (bytes > RECORD_BYTES_CAP) {
                // too big even without the timelines: it stays on screen for this visit only
                return;
            }
            const entry: KeptEntry = { key, schema: RESULTS_SCHEMA_VERSION, appVersion, savedAt: Date.now(), shownAt, bytes, stopped: record.stopped, pick };
            mirror.set(key, entry);
            // the generation being kept is the one on screen: room is never made by removing it
            const keep = [key];
            await removeKeys(evictionOrder([...mirror.values()], { keep, maxKept: MAX_KEPT, totalBytes: TOTAL_BYTES_CAP }));
            for (;;) {
                try {
                    await backend.write(entry, record);
                    return;
                } catch (error) {
                    // no room: the least recently shown other one goes, until only this one would be left
                    const [oldest] = isQuotaError(error) ? evictionOrder([...mirror.values()], { keep, maxKept: mirror.size - 1, totalBytes: Infinity }) : [];
                    if (oldest === undefined) {
                        mirror.delete(key);
                        warnOnce('Could not keep the clocks', error);
                        return;
                    }
                    await removeKeys([oldest]);
                }
            }
        }),
        setPick: (key, pick) => updateEntry(key, { pick }),
        touch: (key, shownAt) => updateEntry(key, { shownAt }),
    };
}

/** A store in memory: for a browser without IndexedDB, and for the tests. Nothing outlives the page */
export function createMemoryResultsStore(appVersion: string = __APP_VERSION__): ResultsStore {
    const records = new Map<string, KeptResults>();
    return createStore({
        persistent: false,
        getRecord: async (key) => records.get(key),
        write: async (entry, record) => {
            records.set(entry.key, record);
        },
        writeEntry: async () => {},
        remove: async (keys) => {
            keys.forEach((key) => records.delete(key));
        },
    }, [], appVersion);
}

const DATABASE = 'clock-generator-results';
const DATABASE_VERSION = 1;
const ENTRIES = 'entries';
const RECORDS = 'records';
/** How long the database may stay blocked (another tab holds an older version open) before memory is used */
const OPEN_TIMEOUT_MS = 3000;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new DOMException('The write was aborted', 'AbortError'));
    });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            settled = true;
            reject(new Error('The results database stayed blocked'));
        }, OPEN_TIMEOUT_MS);
        const request = factory.open(DATABASE, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'key' });
            if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS, { keyPath: 'key' });
        };
        request.onsuccess = () => {
            clearTimeout(timer);
            if (settled) {
                // too late: memory is in use already
                request.result.close();
                return;
            }
            settled = true;
            resolve(request.result);
        };
        request.onerror = () => {
            clearTimeout(timer);
            if (!settled) {
                settled = true;
                reject(request.error);
            }
        };
    });
}

function indexedDbBackend(db: IDBDatabase): StoreBackend {
    // another tab upgrading the database asks this one to let go of it; what is kept here then stays in memory
    db.onversionchange = () => db.close();
    return {
        persistent: true,
        getRecord: async (key) => {
            const row = await requestResult(db.transaction(RECORDS).objectStore(RECORDS).get(key)) as { key: string; results: KeptResults } | undefined;
            return row?.results;
        },
        write: (entry, record) => {
            const transaction = db.transaction([ENTRIES, RECORDS], 'readwrite');
            transaction.objectStore(RECORDS).put({ key: entry.key, results: record });
            transaction.objectStore(ENTRIES).put(entry);
            return transactionDone(transaction);
        },
        writeEntry: (entry) => {
            const transaction = db.transaction(ENTRIES, 'readwrite');
            transaction.objectStore(ENTRIES).put(entry);
            return transactionDone(transaction);
        },
        remove: (keys) => {
            const transaction = db.transaction([ENTRIES, RECORDS], 'readwrite');
            for (const key of keys) {
                transaction.objectStore(ENTRIES).delete(key);
                transaction.objectStore(RECORDS).delete(key);
            }
            return transactionDone(transaction);
        },
    };
}

/**
 * Opens the kept generations: in IndexedDB, throwing away the ones another version of the page kept; in memory when
 * the browser has no IndexedDB, it fails, or it stays blocked for 3 s. Never rejects.
 */
export async function openResultsStore(
    env: { indexedDB?: IDBFactory } = globalThis,
    appVersion: string = __APP_VERSION__,
): Promise<ResultsStore> {
    const factory = env.indexedDB;
    if (!factory) {
        return createMemoryResultsStore(appVersion);
    }
    try {
        const db = await openDatabase(factory);
        const all = await requestResult(db.transaction(ENTRIES).objectStore(ENTRIES).getAll()) as KeptEntry[];
        const backend = indexedDbBackend(db);
        const unusable = all.filter((entry) => !usableEntry(entry, appVersion)).map((entry) => entry.key);
        if (unusable.length > 0) {
            await backend.remove(unusable).catch(() => {});
        }
        return createStore(backend, all.filter((entry) => usableEntry(entry, appVersion)), appVersion);
    } catch (error) {
        warnOnce('Clocks are kept for this visit only', error);
        return createMemoryResultsStore(appVersion);
    }
}
