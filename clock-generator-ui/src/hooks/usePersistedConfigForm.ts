import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { ChestType } from 'clock-generator/light';
import { askEngine } from '../worker/engineClient';
import {
    backupKey,
    buildKey,
    copyName,
    DELETED_ELSEWHERE_MESSAGE,
    LIBRARY_KEY,
    mostRecent,
    nextConflict,
    NO_CONFLICT,
    openLibrary,
    otherTabProblemMessage,
    readIndex,
    removeBuild,
    renameBuild as renameIndexBuild,
    setBuildRecipe,
    STORAGE_FULL_MESSAGE,
    TAB_BUILD_KEY,
    touchBuild,
    upsertBuild,
    classifyStorageEvent,
    type BuildMeta,
    type ConflictState,
    type LibraryIndex,
    type StorageLike,
} from '../utils/buildLibrary';
import { useNotify } from './useMessages';
import {
    createDefaultConfig,
    type BeltFormData,
    type ChestFormData,
    type ConfigFormData,
    type DrillFormData,
    type InfinityChestFormData,
    type InfinityFilterFormData,
    type InserterFormData,
    type MachineFormData,
} from '../utils/configForm/formData';

/** Migrate legacy inserter data to include id field */
function migrateInserters(inserters: unknown[]): InserterFormData[] {
    return inserters.map((ins: unknown, index: number) => {
        const i = ins as InserterFormData & { id?: number; _uuid?: string };
        const withId = typeof i.id === 'number' ? i : { ...i, id: index + 1 };
        return withId._uuid ? withId as InserterFormData : { ...withId, _uuid: crypto.randomUUID() } as InserterFormData;
    });
}

/** Migrate legacy chest data to include type field */
function migrateChests(chests: unknown[]): ChestFormData[] {
    return chests.map((chest: unknown) => {
        const c = chest as { type?: string; id: number; _uuid?: string; storage_size?: number; item_filter?: string | InfinityFilterFormData[] };
        const uuid = c._uuid ?? crypto.randomUUID();
        // If already has a valid type, return as-is (with uuid)
        if (c.type === ChestType.INFINITY_CHEST) {
            return { ...(c as InfinityChestFormData), _uuid: uuid };
        }
        // Default to buffer chest (handles legacy data without type)
        return {
            type: ChestType.BUFFER_CHEST,
            id: c.id,
            _uuid: uuid,
            storage_size: c.storage_size ?? 1,
            item_filter: (typeof c.item_filter === 'string' ? c.item_filter : '') as string,
        };
    });
}

/** The config in an imported file, not yet checked against the config schema; files from before chest types have chests without a type */
export function readConfigFile(content: string): unknown {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed?.chests)) {
        parsed.chests = migrateChests(parsed.chests);
    }
    return parsed;
}

/** The saved form state with the legacy fields migrated; null if it is not JSON or lacks the required fields */
export function readSavedConfig(stored: string): ConfigFormData | null {
    try {
        const parsed = JSON.parse(stored);
        // Basic validation - check if it has the required fields
        if (parsed && parsed.target_output && parsed.machines && parsed.chests) {
            // Migrate legacy chests
            parsed.chests = migrateChests(parsed.chests);
            // Migrate legacy inserters (assign id / _uuid if missing)
            if (Array.isArray(parsed.inserters)) {
                parsed.inserters = migrateInserters(parsed.inserters);
            }
            // Migrate machines, belts, drills: add _uuid if missing
            if (Array.isArray(parsed.machines)) {
                parsed.machines = parsed.machines.map((m: MachineFormData & { _uuid?: string }) =>
                    m._uuid ? m : { ...m, _uuid: crypto.randomUUID() });
            }
            if (Array.isArray(parsed.belts)) {
                parsed.belts = parsed.belts.map((b: BeltFormData & { _uuid?: string }) =>
                    b._uuid ? b : { ...b, _uuid: crypto.randomUUID() });
            }
            if (parsed.drills && Array.isArray(parsed.drills.configs)) {
                parsed.drills.configs = parsed.drills.configs.map((d: DrillFormData & { _uuid?: string }) =>
                    d._uuid ? d : { ...d, _uuid: crypto.randomUUID() });
            }
            // forms saved before ids were renumbered on delete carry a UI-only `next_ids`; it is no longer used
            delete parsed.next_ids;
            return parsed as ConfigFormData;
        }
    } catch (e) {
        console.warn('Failed to load config from localStorage:', e);
    }
    return null;
}

interface StoredConfig {
    /** As saved */
    text: string;
    /** Null when it cannot be read as the form state */
    config: ConfigFormData | null;
}

/** The page's localStorage, reached only inside the calls: in some browsers merely reading `localStorage` throws */
const pageLocal: StorageLike = {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
    key: (i) => window.localStorage.key(i),
    get length() {
        return window.localStorage.length;
    },
};
const pageSession: Pick<Storage, 'getItem' | 'setItem'> = {
    getItem: (key) => window.sessionStorage.getItem(key),
    setItem: (key, value) => window.sessionStorage.setItem(key, value),
};

/** A localStorage read; null when there is nothing, or the storage is blocked */
function readItem(key: string): string | null {
    try {
        return pageLocal.getItem(key);
    } catch (e) {
        console.warn('Failed to read localStorage:', e);
        return null;
    }
}

/** The build saved under `key`; null if there is none */
function readConfigFromStorage(key: string): StoredConfig | null {
    const text = readItem(key);
    return text ? { text, config: readSavedConfig(text) } : null;
}

/**
 * Copies a saved build that cannot be loaded to `key` (its backup key), as the defaults are saved over it next; gives
 * the message that tells the user so
 */
export function backUpSavedConfig(storage: Pick<Storage, 'setItem'>, text: string, key: string): string {
    const failed = 'Your saved build could not be loaded.';
    try {
        storage.setItem(key, text);
    } catch (e) {
        // the console is then the only place it is kept
        console.warn('Failed to back up the saved config, which was:', text, e);
        return `${failed} A copy of it could not be kept, so the browser console shows it.`;
    }
    return `${failed} A copy of it is kept in this browser's localStorage under the key "${key}"; `
        + 'the browser console says what is wrong with it.';
}

/** The form state as saved in localStorage */
export function serializeConfig(config: ConfigFormData): string {
    // Strip internal _uuid fields — they are UI-only and shouldn't be in the exported config.
    return JSON.stringify(config, (key, value) =>
        key === '_uuid' ? undefined : value
    );
}

/** The index as saved now; null when it cannot be read, so the one in memory stands */
function storedIndex(): LibraryIndex | null {
    let text: string | null;
    try {
        text = pageLocal.getItem(LIBRARY_KEY);
    } catch {
        return null;
    }
    const read = readIndex(text);
    return read.kind === 'ok' ? read.index : null;
}

/**
 * The index as saved now, for the other tabs' changes; when it is gone or cannot be read (removed by another tab or by
 * hand), the one in memory, less the builds whose keys are gone, so the menu neither empties nor hides a build
 */
function indexNow(memory: LibraryIndex): LibraryIndex {
    return storedIndex() ?? { ...memory, builds: memory.builds.filter((build) => readItem(buildKey(build.id)) !== null) };
}

/** The build open in this tab: its id and its form, which always change together */
interface OpenBuild {
    id: string;
    form: ConfigFormData;
}

const newBuildMeta = (id: string, form: ConfigFormData, name: string | null, now: number): BuildMeta => ({
    id,
    name,
    recipe: form.target_output.recipe,
    createdAt: now,
    openedAt: now,
});

/** Your builds, as the page uses them */
export interface BuildLibrary {
    /** The index's rows, in the order saved */
    builds: BuildMeta[];
    /** False when a newer version of the site wrote the list: it is read, and never written here */
    writable: boolean;
    currentId: string;
    currentMeta: BuildMeta;
    /** Checks and opens a saved build; false (with the load notice set) when it cannot be loaded */
    openBuild: (id: string) => Promise<boolean>;
    /** Opens a new blank build; gives its row */
    newBuild: () => BuildMeta;
    /** Opens a copy of the open build; gives its row */
    duplicateBuild: () => BuildMeta;
    /** Null names it after its target recipe */
    renameBuild: (name: string | null) => void;
    /**
     * Removes the open build and opens the most recently opened other one, or a new blank one; gives the removed row,
     * and the id of the blank build made in its place (which an Undo removes again)
     */
    deleteBuild: () => Promise<{ deleted: BuildMeta; madeId: string | null }>;
    /** Adds a build and opens it, or puts it in the place of `replaceId`; gives its id and the row of the build open before */
    addBuild: (form: ConfigFormData, name: string | null, options?: { replaceId?: string }) => { id: string; previous: BuildMeta };
    /** For an Undo: removes `removeId`, puts `meta` back with `form`, and opens it, with no check (the form was open before) */
    restore: (args: { meta: BuildMeta; form: ConfigFormData; removeId?: string }) => void;
    /** Another tab saving this build */
    conflict: ConflictState;
    /** Loads the other tab's version, calling `beforeApply` just before (for Undo); false when it could not */
    loadOtherTabVersion: (beforeApply: () => void) => Promise<boolean>;
    closeConflict: () => void;
}

/**
 * The form of the build open in this tab, one of Your builds, loaded from localStorage and saved back to its own key on
 * every change (one key per build, so editing one never touches another).
 *
 * The engine's worker checks the saved build against the config schema first, so it is loaded (`isLoaded`) once that
 * worker is up. Until then the state is the default config, nothing is saved, and `unchecked` holds the saved build,
 * which Save build file offers; if the check fails, `loadError` says why. A saved build that cannot be loaded is backed
 * up before the defaults are saved over it, and `loadNotice` tells the user so.
 *
 * A `storage` listener hears the other tabs: another tab saving this build raises `library.conflict` (once per
 * episode), another deleting it warns, and a change to the list of builds shows in the menu without a reload.
 */
export function usePersistedConfigForm() {
    const notify = useNotify();
    const [opened] = useState(() => openLibrary(pageLocal, pageSession, Date.now()));
    const writable = opened.writable;
    const [index, setIndex] = useState(opened.index);
    const [stored] = useState(() => readConfigFromStorage(buildKey(opened.activeId)));
    const [defaultConfig] = useState(createDefaultConfig);
    const [current, setCurrent] = useState<OpenBuild>(() => ({ id: opened.activeId, form: defaultConfig }));
    const [isLoaded, setIsLoaded] = useState(stored?.config == null);
    // why the saved config could not be checked, e.g. the engine's worker did not start
    const [loadError, setLoadError] = useState<string | null>(null);
    // one that cannot be read at all is backed up at once, before the first save (doing it twice does no harm)
    const [loadNotice, setLoadNotice] = useState(() => {
        if (stored?.config !== null) return null;
        console.warn('Saved config in localStorage is not the form state, using defaults');
        return backUpSavedConfig(pageLocal, stored.text, backupKey(opened.activeId));
    });
    const [conflict, setConflictState] = useState<ConflictState>(NO_CONFLICT);

    // read by the handlers and the storage listener, which may run after an await; the id is set with the state
    const idRef = useRef(opened.activeId);
    const formRef = useRef(current.form);
    const indexRef = useRef(index);
    const conflictRef = useRef(conflict);
    // the text this tab last wrote or loaded for its build, which another tab's save is told from
    const lastTextRef = useRef<string | null>(stored?.text ?? null);
    // this tab's build was deleted in another tab: it stays open here, and the next save lists it again
    const deletedElsewhereRef = useRef(false);
    // a save failed: the warning shows once, until a save works again
    const storageFullRef = useRef(false);
    useEffect(() => {
        formRef.current = current.form;
    }, [current.form]);

    const setConflict = useCallback((next: (state: ConflictState) => ConflictState) => {
        const value = next(conflictRef.current);
        conflictRef.current = value;
        setConflictState(value);
    }, []);

    /** The index to show: as given, with this tab's build kept while it is open here after another tab deleted it */
    const showIndex = useCallback((next: LibraryIndex) => {
        const id = idRef.current;
        const own = indexRef.current.builds.find((build) => build.id === id);
        const shown = deletedElsewhereRef.current && own && !next.builds.some((build) => build.id === id) ? upsertBuild(next, own) : next;
        indexRef.current = shown;
        setIndex(shown);
    }, []);

    /**
     * Changes the index as saved now (another tab may have changed it since this one read it) and saves it; one that
     * cannot be saved is kept in memory. `force` saves it even when the change gives the same index.
     */
    const commitIndex = useCallback((update: (index: LibraryIndex) => LibraryIndex, { force = false } = {}) => {
        const base = storedIndex() ?? indexRef.current;
        const next = update(base);
        if ((next !== base || force) && writable) {
            try {
                pageLocal.setItem(LIBRARY_KEY, JSON.stringify(next));
            } catch (e) {
                console.warn('Failed to save the list of builds:', e);
            }
        }
        showIndex(next);
    }, [writable, showIndex]);

    /** Opens a build in this tab: the form and its id change together, and any warning about the build before goes */
    const show = useCallback((next: OpenBuild, text: string | null) => {
        if (next.id !== idRef.current) {
            deletedElsewhereRef.current = false;
        }
        idRef.current = next.id;
        formRef.current = next.form;
        lastTextRef.current = text;
        setCurrent(next);
        setConflict((state) => nextConflict(state, { kind: 'switched' }));
    }, [setConflict]);

    useEffect(() => {
        if (stored === null || stored.config === null) {
            return;
        }
        const savedConfig = stored.config;
        let alive = true;
        askEngine({ kind: 'saved-config', config: savedConfig }).then(
            (problem) => {
                if (!alive) return;
                if (problem === null) {
                    // unless the config was replaced (imported or reset) in the meantime
                    setCurrent((previous) => (previous.form === defaultConfig ? { id: previous.id, form: savedConfig } : previous));
                } else {
                    console.warn('Saved config in localStorage is invalid, using defaults:', problem);
                    setLoadNotice(backUpSavedConfig(pageLocal, stored.text, backupKey(opened.activeId)));
                }
                setIsLoaded(true);
            },
            (e) => {
                console.warn('Failed to check the config from localStorage:', e);
                if (alive) setLoadError(e instanceof Error ? e.message : 'Failed to check the saved config');
            },
        );
        return () => {
            alive = false;
        };
    }, [stored, defaultConfig, opened.activeId]);

    // the tab remembers its build, so a reload stays on it
    useEffect(() => {
        try {
            pageSession.setItem(TAB_BUILD_KEY, current.id);
        } catch {
            // blocked storage: a reload opens the most recent build
        }
    }, [current.id]);

    // Save the build to its own key whenever it changes, once the saved one is loaded; text equal to what is saved is
    // not written again (one less write, and no storage event in the other tabs)
    useEffect(() => {
        if (!isLoaded) return;
        const key = buildKey(current.id);
        const text = serializeConfig(current.form);
        let wrote = false;
        try {
            if (pageLocal.getItem(key) !== text) {
                pageLocal.setItem(key, text);
                wrote = true;
            }
        } catch (e) {
            console.warn('Failed to save config to localStorage:', e);
            if (!storageFullRef.current) {
                storageFullRef.current = true;
                notify({ severity: 'warning', text: STORAGE_FULL_MESSAGE });
            }
            return;
        }
        storageFullRef.current = false;
        lastTextRef.current = text;
        if (!wrote) return;
        setConflict((state) => nextConflict(state, { kind: 'saved-here' }));
        const own = indexRef.current.builds.find((build) => build.id === current.id);
        const recipe = current.form.target_output.recipe;
        if (deletedElsewhereRef.current && own) {
            // deleted in another tab: this edit lists it again
            deletedElsewhereRef.current = false;
            commitIndex((saved) => upsertBuild(saved, { ...own, recipe }), { force: true });
        } else if (own && own.recipe !== recipe) {
            // the menu names a build after its target recipe without reading it: the index keeps a copy
            commitIndex((saved) => setBuildRecipe(saved, current.id, recipe));
        }
    }, [current, isLoaded, notify, setConflict, commitIndex]);

    // the other tabs: the browser tells every tab of this site but the one that wrote
    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            try {
                if (event.storageArea !== window.localStorage) return;
            } catch {
                return;
            }
            const saved = event.key === null ? indexNow(indexRef.current) : indexRef.current;
            const change = classifyStorageEvent(event, { activeId: idRef.current, lastText: lastTextRef.current, index: saved });
            if (change === 'ignore') return;
            if (change === 'changed-elsewhere') {
                setConflict((state) => nextConflict(state, { kind: 'event', text: event.newValue ?? '' }));
                return;
            }
            if (change === 'deleted-elsewhere' && !deletedElsewhereRef.current) {
                // the build's key and the index both go: one warning
                deletedElsewhereRef.current = true;
                lastTextRef.current = null;
                notify({ severity: 'warning', text: DELETED_ELSEWHERE_MESSAGE });
            }
            showIndex(indexNow(indexRef.current));
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [notify, setConflict, showIndex]);

    /** Keeps the id: every edit, Undo and the form's own helpers go through it */
    const setConfig = useCallback<Dispatch<SetStateAction<ConfigFormData>>>((action) => {
        setCurrent((previous) => {
            const form = typeof action === 'function' ? action(previous.form) : action;
            return form === previous.form ? previous : { id: previous.id, form };
        });
    }, []);

    // Reset build keeps the build, now empty, in its place: the save writes the default over it
    const resetConfig = useCallback(() => setConfig(createDefaultConfig()), [setConfig]);

    // the saved config while it waits for the check, unless it was replaced in the meantime
    const unchecked = !isLoaded && current.form === defaultConfig ? stored?.config ?? null : null;

    const dismissLoadNotice = useCallback(() => setLoadNotice(null), []);

    /** A saved build read and checked as the first load does; null (backed up, with the load notice) when it cannot be */
    const loadBuild = useCallback(async (id: string): Promise<{ form: ConfigFormData; text: string | null } | null> => {
        const text = readItem(buildKey(id));
        if (text === null) {
            // listed but never saved: a new build is saved on its first change
            return { form: createDefaultConfig(), text: null };
        }
        const form = readSavedConfig(text);
        let problem: string | null = form === null ? 'not the form state' : null;
        if (form !== null) {
            try {
                problem = await askEngine({ kind: 'saved-config', config: form });
            } catch (e) {
                problem = e instanceof Error ? e.message : 'the check failed';
            }
        }
        if (problem !== null || form === null) {
            console.warn('A saved build cannot be loaded:', problem);
            setLoadNotice(backUpSavedConfig(pageLocal, text, backupKey(id)));
            return null;
        }
        return { form, text };
    }, []);

    const ownMeta = useCallback((): BuildMeta => {
        const id = idRef.current;
        return indexRef.current.builds.find((build) => build.id === id) ?? newBuildMeta(id, formRef.current, null, 0);
    }, []);

    const openBuild = useCallback(async (id: string) => {
        const loaded = await loadBuild(id);
        if (loaded === null) return false;
        show({ id, form: loaded.form }, loaded.text);
        commitIndex((saved) => touchBuild(saved, id, Date.now()));
        return true;
    }, [loadBuild, show, commitIndex]);

    const newBuild = useCallback(() => {
        const form = createDefaultConfig();
        const meta = newBuildMeta(crypto.randomUUID(), form, null, Date.now());
        show({ id: meta.id, form }, null);
        commitIndex((saved) => upsertBuild(saved, meta));
        return meta;
    }, [show, commitIndex]);

    const duplicateBuild = useCallback(() => {
        const source = ownMeta();
        // fresh _uuids, through the saved text
        const form = readSavedConfig(serializeConfig(formRef.current)) ?? createDefaultConfig();
        const meta = newBuildMeta(crypto.randomUUID(), form, source.name === null ? null : copyName(source.name), Date.now());
        show({ id: meta.id, form }, null);
        commitIndex((saved) => upsertBuild(saved, meta));
        return meta;
    }, [ownMeta, show, commitIndex]);

    const renameBuild = useCallback((name: string | null) => {
        const own = ownMeta();
        if (deletedElsewhereRef.current) {
            // deleted in another tab: naming it keeps it, as an edit does
            deletedElsewhereRef.current = false;
            try {
                pageLocal.setItem(buildKey(own.id), serializeConfig(formRef.current));
            } catch (e) {
                console.warn('Failed to save config to localStorage:', e);
            }
            commitIndex((saved) => upsertBuild(saved, { ...own, name }), { force: true });
            return;
        }
        commitIndex((saved) => renameIndexBuild(saved, own.id, name));
    }, [ownMeta, commitIndex]);

    const deleteBuild = useCallback(async () => {
        const deleted = ownMeta();
        const next = mostRecent(indexRef.current, deleted.id);
        // the next build is checked before anything goes, so the page never shows a build that is no longer saved
        const loaded = next ? await loadBuild(next.id) : null;
        try {
            pageLocal.removeItem(buildKey(deleted.id));
        } catch (e) {
            console.warn('Failed to remove a build from localStorage:', e);
        }
        const now = Date.now();
        if (next && loaded) {
            show({ id: next.id, form: loaded.form }, loaded.text);
            commitIndex((saved) => touchBuild(removeBuild(saved, deleted.id), next.id, now));
            return { deleted, madeId: null };
        }
        const form = createDefaultConfig();
        const meta = newBuildMeta(crypto.randomUUID(), form, null, now);
        show({ id: meta.id, form }, null);
        commitIndex((saved) => upsertBuild(removeBuild(saved, deleted.id), meta));
        return { deleted, madeId: meta.id };
    }, [ownMeta, loadBuild, show, commitIndex]);

    const addBuild = useCallback((form: ConfigFormData, name: string | null, options?: { replaceId?: string }) => {
        const previous = ownMeta();
        const now = Date.now();
        const replaced = options?.replaceId ? indexRef.current.builds.find((build) => build.id === options.replaceId) : undefined;
        const meta = { ...newBuildMeta(replaced?.id ?? crypto.randomUUID(), form, name, now), createdAt: replaced?.createdAt ?? now };
        show({ id: meta.id, form }, null);
        commitIndex((saved) => upsertBuild(saved, meta));
        return { id: meta.id, previous };
    }, [ownMeta, show, commitIndex]);

    const restore = useCallback(({ meta, form, removeId }: { meta: BuildMeta; form: ConfigFormData; removeId?: string }) => {
        if (removeId !== undefined) {
            try {
                pageLocal.removeItem(buildKey(removeId));
            } catch (e) {
                console.warn('Failed to remove a build from localStorage:', e);
            }
        }
        show({ id: meta.id, form }, null);
        commitIndex((saved) => upsertBuild(removeId === undefined ? saved : removeBuild(saved, removeId), { ...meta, openedAt: Date.now() }));
    }, [show, commitIndex]);

    const loadOtherTabVersion = useCallback(async (beforeApply: () => void) => {
        const episode = conflictRef.current;
        if (episode.status === 'none') return false;
        const id = idRef.current;
        const form = readSavedConfig(episode.text);
        let problem: string | null = form === null ? 'It is not a build.' : null;
        if (form !== null) {
            try {
                problem = await askEngine({ kind: 'saved-config', config: form });
            } catch (e) {
                problem = e instanceof Error ? e.message : 'The check failed.';
            }
        }
        // another build was opened meanwhile: nothing to load into
        if (idRef.current !== id) return false;
        if (problem !== null || form === null) {
            setConflict((state) => nextConflict(state, { kind: 'closed' }));
            notify({ severity: 'error', text: otherTabProblemMessage(problem ?? '') });
            return false;
        }
        beforeApply();
        show({ id, form }, episode.text);
        setConflict((state) => nextConflict(state, { kind: 'loaded' }));
        return true;
    }, [notify, setConflict, show]);

    const closeConflict = useCallback(() => setConflict((state) => nextConflict(state, { kind: 'closed' })), [setConflict]);

    const currentMeta = useMemo(
        () => index.builds.find((build) => build.id === current.id) ?? newBuildMeta(current.id, current.form, null, 0),
        [index.builds, current.id, current.form],
    );
    const library = useMemo((): BuildLibrary => ({
        builds: index.builds,
        writable,
        currentId: current.id,
        currentMeta,
        openBuild,
        newBuild,
        duplicateBuild,
        renameBuild,
        deleteBuild,
        addBuild,
        restore,
        conflict,
        loadOtherTabVersion,
        closeConflict,
    }), [index.builds, writable, current.id, currentMeta, openBuild, newBuild, duplicateBuild, renameBuild, deleteBuild, addBuild, restore, conflict, loadOtherTabVersion, closeConflict]);

    return { config: current.form, setConfig, resetConfig, isLoaded, loadError, unchecked, loadNotice, dismissLoadNotice, library };
}
