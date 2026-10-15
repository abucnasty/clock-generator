import { exampleTitle } from './exampleBuilds';

/**
 * Your builds: every build kept in this browser, each saved under its own localStorage key, and an index of them.
 *
 * The first build keeps the key the page always saved to (`clock-generator-config`), so a save made before builds
 * could be named is the first build as it is: opening the library writes only the index, and never copies, rewrites or
 * removes a build. Every other build is saved under `clock-generator-build:<id>`. A tab remembers its build in
 * sessionStorage, so a reload stays on it.
 */

/** The index of the builds: `{ version, builds }` */
export const LIBRARY_KEY = 'clock-generator-builds';
/** The id of the first build, saved where the page saved its one build before */
export const LEGACY_BUILD_ID = 'default';
/** Where the build with the id `default` is saved */
export const LEGACY_BUILD_KEY = 'clock-generator-config';
/** This tab's build id, in sessionStorage */
export const TAB_BUILD_KEY = 'clock-generator-tab-build';
const BUILD_KEY_PREFIX = 'clock-generator-build:';
const BACKUP_SUFFIX = '.backup';
const LIBRARY_VERSION = 1;
const NAME_MAX_LENGTH = 60;
const FILE_NAME_MAX_LENGTH = 60;
/** The name of a build with neither a name of its own nor a target recipe */
export const UNTITLED_BUILD = 'Untitled build';

export interface BuildMeta {
    id: string;
    /** The player's name for it; null when it is named after its target recipe */
    name: string | null;
    /** A copy of its target recipe, so the menu can name it without reading the build */
    recipe: string;
    /** Epoch ms */
    createdAt: number;
    /** Epoch ms; the most recently opened build comes first, and is the one a new tab opens */
    openedAt: number;
}

export interface LibraryIndex {
    version: number;
    builds: BuildMeta[];
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Where a build is saved */
export function buildKey(id: string): string {
    return id === LEGACY_BUILD_ID ? LEGACY_BUILD_KEY : `${BUILD_KEY_PREFIX}${id}`;
}

/** Where a build that could not be loaded is kept */
export function backupKey(id: string): string {
    return `${buildKey(id)}${BACKUP_SUFFIX}`;
}

/** A storage read that gives null when the storage throws (blocked in some browsers) */
function readItem(storage: Pick<Storage, 'getItem'> | null, key: string): string | null {
    try {
        return storage?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

function isBuildMeta(row: unknown): row is BuildMeta {
    if (typeof row !== 'object' || row === null) return false;
    const r = row as Record<string, unknown>;
    return typeof r.id === 'string' && r.id !== ''
        && (r.name === null || typeof r.name === 'string')
        && typeof r.recipe === 'string'
        && typeof r.createdAt === 'number' && Number.isFinite(r.createdAt)
        && typeof r.openedAt === 'number' && Number.isFinite(r.openedAt);
}

type IndexRead =
    | { kind: 'ok'; index: LibraryIndex; writable: boolean }
    | { kind: 'missing' }
    | { kind: 'unreadable' };

/**
 * The index as saved. Rows with a field of the wrong type are dropped, and of two rows with one id the first is kept.
 * An index of a newer version is read for the fields this version knows, and is not `writable`: a newer page wrote it.
 */
export function readIndex(text: string | null): IndexRead {
    if (text === null) return { kind: 'missing' };
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { kind: 'unreadable' };
    }
    if (typeof parsed !== 'object' || parsed === null) return { kind: 'unreadable' };
    const { version, builds } = parsed as Record<string, unknown>;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || !Array.isArray(builds)) {
        return { kind: 'unreadable' };
    }
    const seen = new Set<string>();
    const rows: BuildMeta[] = [];
    for (const row of builds) {
        if (!isBuildMeta(row) || seen.has(row.id)) continue;
        seen.add(row.id);
        const { id, name, recipe, createdAt, openedAt } = row;
        rows.push({ id, name, recipe, createdAt, openedAt });
    }
    return { kind: 'ok', index: { version: LIBRARY_VERSION, builds: rows }, writable: version <= LIBRARY_VERSION };
}

/** The target recipe of a saved build; '' when the text cannot be read */
export function recipeOfSavedText(text: string | null): string {
    if (text === null) return '';
    try {
        const recipe = JSON.parse(text)?.target_output?.recipe;
        return typeof recipe === 'string' ? recipe : '';
    } catch {
        return '';
    }
}

const newMeta = (id: string, recipe: string, now: number): BuildMeta => ({ id, name: null, recipe, createdAt: now, openedAt: now });

/**
 * An index made from the builds' keys, for an index that cannot be read: the first build, and every
 * `clock-generator-build:<id>` that is not a backup, named after their recipes. Nothing is dropped.
 */
export function rebuildIndex(storage: StorageLike, now: number): LibraryIndex {
    const builds: BuildMeta[] = [];
    let keys: string[] = [];
    try {
        keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => key !== null);
    } catch {
        // blocked storage: only the first build
    }
    const legacy = readItem(storage, LEGACY_BUILD_KEY);
    if (legacy !== null) {
        builds.push(newMeta(LEGACY_BUILD_ID, recipeOfSavedText(legacy), now));
    }
    for (const key of [...keys].sort()) {
        if (!key.startsWith(BUILD_KEY_PREFIX) || key.endsWith(BACKUP_SUFFIX)) continue;
        const id = key.slice(BUILD_KEY_PREFIX.length);
        if (id === '' || id === LEGACY_BUILD_ID) continue;
        builds.push(newMeta(id, recipeOfSavedText(readItem(storage, key)), now));
    }
    if (builds.length === 0) {
        builds.push(newMeta(LEGACY_BUILD_ID, '', now));
    }
    return { version: LIBRARY_VERSION, builds };
}

/** The most recently opened build, leaving out `exceptId`; null when there is none */
export function mostRecent(index: LibraryIndex, exceptId?: string): BuildMeta | null {
    let best: BuildMeta | null = null;
    for (const build of index.builds) {
        if (build.id === exceptId) continue;
        if (best === null || build.openedAt > best.openedAt) best = build;
    }
    return best;
}

/**
 * Opens the library: the index as saved, or made for the first time (a save from before builds is the first build,
 * `default`, as it is), or rebuilt from the builds' keys when it cannot be read. The index is written when it was made
 * or rebuilt, unless a newer page wrote it; a write that throws (storage full or blocked) leaves it in memory, and the
 * next load tries again. A build's own key is never touched. The tab opens the build it had, or else the most recently
 * opened one.
 */
export function openLibrary(local: StorageLike, session: Pick<Storage, 'getItem'> | null, now: number): {
    index: LibraryIndex;
    activeId: string;
    writable: boolean;
} {
    const read = readIndex(readItem(local, LIBRARY_KEY));
    let index: LibraryIndex;
    let writable = true;
    let changed = false;
    if (read.kind === 'ok') {
        index = read.index;
        writable = read.writable;
    } else if (read.kind === 'missing') {
        index = { version: LIBRARY_VERSION, builds: [newMeta(LEGACY_BUILD_ID, recipeOfSavedText(readItem(local, LEGACY_BUILD_KEY)), now)] };
        changed = true;
    } else {
        index = rebuildIndex(local, now);
        changed = true;
    }
    if (index.builds.length === 0) {
        index = { ...index, builds: [newMeta(LEGACY_BUILD_ID, recipeOfSavedText(readItem(local, LEGACY_BUILD_KEY)), now)] };
        changed = true;
    }
    if (changed && writable) {
        try {
            local.setItem(LIBRARY_KEY, JSON.stringify(index));
        } catch {
            // kept in memory: the next load writes it
        }
    }
    const tabId = readItem(session, TAB_BUILD_KEY);
    const activeId = index.builds.some((build) => build.id === tabId) ? tabId! : mostRecent(index)!.id;
    return { index, activeId, writable };
}

// ---- edits of the index: each gives a new index, or the same one when nothing changes

const sameMeta = (a: BuildMeta, b: BuildMeta) =>
    a.id === b.id && a.name === b.name && a.recipe === b.recipe && a.createdAt === b.createdAt && a.openedAt === b.openedAt;

/** Adds the build, or replaces the row with its id */
export function upsertBuild(index: LibraryIndex, meta: BuildMeta): LibraryIndex {
    const at = index.builds.findIndex((build) => build.id === meta.id);
    if (at === -1) return { ...index, builds: [...index.builds, meta] };
    if (sameMeta(index.builds[at], meta)) return index;
    return { ...index, builds: index.builds.map((build, i) => (i === at ? meta : build)) };
}

export function removeBuild(index: LibraryIndex, id: string): LibraryIndex {
    return index.builds.some((build) => build.id === id) ? { ...index, builds: index.builds.filter((build) => build.id !== id) } : index;
}

function updateBuild(index: LibraryIndex, id: string, change: Partial<Omit<BuildMeta, 'id'>>): LibraryIndex {
    const build = index.builds.find((row) => row.id === id);
    return build ? upsertBuild(index, { ...build, ...change }) : index;
}

/** Null names it after its target recipe */
export function renameBuild(index: LibraryIndex, id: string, name: string | null): LibraryIndex {
    return updateBuild(index, id, { name });
}

/** Marks it as opened now */
export function touchBuild(index: LibraryIndex, id: string, now: number): LibraryIndex {
    return updateBuild(index, id, { openedAt: now });
}

export function setBuildRecipe(index: LibraryIndex, id: string, recipe: string): LibraryIndex {
    return updateBuild(index, id, { recipe });
}

// ---- names

/**
 * A name the player typed, as kept: trimmed, without control characters, and at most 60 characters; null (named after
 * its target recipe) when nothing is left
 */
export function cleanName(input: string): string | null {
    // eslint-disable-next-line no-control-regex
    const plain = input.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
    const cut = Array.from(plain).slice(0, NAME_MAX_LENGTH).join('').trim();
    return cut === '' ? null : cut;
}

/** "Logistic science pack": the game's name of the recipe, given by `recipeLabel`, or the id in sentence case */
export function recipeTitle(recipe: string, recipeLabel: (id: string) => string): string {
    return exampleTitle({ recipe }, recipeLabel);
}

/** What a build is called before two of them are told apart: its name, its recipe's name, or "Untitled build" */
function baseTitle(build: BuildMeta, recipeLabel: (id: string) => string): string {
    if (build.name !== null) return build.name;
    return build.recipe === '' ? UNTITLED_BUILD : recipeTitle(build.recipe, recipeLabel);
}

/**
 * Each build's title, by id. Of builds that would show the same title, the later-made one gets " (2)", then " (3)",
 * so every title in the menu is different.
 */
export function buildTitles(builds: readonly BuildMeta[], recipeLabel: (id: string) => string = (id) => id): Map<string, string> {
    const titles = new Map<string, string>();
    const used = new Set<string>();
    const byAge = [...builds].sort((a, b) => a.createdAt - b.createdAt);
    for (const build of byAge) {
        const base = baseTitle(build, recipeLabel);
        let title = base;
        for (let n = 2; used.has(title); n++) {
            title = `${base} (${n})`;
        }
        used.add(title);
        titles.set(build.id, title);
    }
    return titles;
}

/** "logistic-science-pack.json": the title in lower case, with every run of other characters as one "-" */
export function buildFileName(title: string): string {
    const slug = title
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, FILE_NAME_MAX_LENGTH)
        .replace(/-+$/, '');
    return `${slug === '' ? 'build' : slug}.json`;
}

// ---- other tabs

type StorageChange = 'ignore' | 'index' | 'changed-elsewhere' | 'deleted-elsewhere';

/**
 * What a `storage` event (another tab of this site wrote) means for this tab, open on `activeId`:
 *  - its build saved with other text than this tab last wrote or loaded: changed elsewhere;
 *  - its build removed, or an index without it: deleted elsewhere;
 *  - another index: the list of builds changed;
 *  - storage cleared (`key` null): `index` is the index as now saved, which tells which of the two;
 *  - anything else, such as another build or a backup: nothing for this tab.
 */
export function classifyStorageEvent(
    event: { key: string | null; newValue: string | null },
    context: { activeId: string; lastText: string | null; index: LibraryIndex },
): StorageChange {
    const listed = (index: LibraryIndex) => index.builds.some((build) => build.id === context.activeId);
    if (event.key === null) {
        return listed(context.index) ? 'index' : 'deleted-elsewhere';
    }
    if (event.key === buildKey(context.activeId)) {
        if (event.newValue === null) return 'deleted-elsewhere';
        return event.newValue === context.lastText ? 'ignore' : 'changed-elsewhere';
    }
    if (event.key === LIBRARY_KEY) {
        const read = readIndex(event.newValue);
        return read.kind === 'ok' && !listed(read.index) ? 'deleted-elsewhere' : 'index';
    }
    return 'ignore';
}

/** Another tab saving this tab's build: `raised` when the warning shows, then `quiet` while the other tab goes on */
export type ConflictState =
    | { status: 'none' }
    | { status: 'raised'; text: string }
    | { status: 'quiet'; text: string };

export const NO_CONFLICT: ConflictState = { status: 'none' };

/**
 * One warning per episode: the first save of the other tab raises it, and later ones only keep its text, which Load
 * the other tab's version loads. The episode ends when the warning is closed, its action is used, this tab saves an
 * edit, or this tab opens another build.
 */
export function nextConflict(
    state: ConflictState,
    input: { kind: 'event'; text: string } | { kind: 'closed' | 'loaded' | 'saved-here' | 'switched' },
): ConflictState {
    if (input.kind === 'event') {
        return { status: state.status === 'none' ? 'raised' : 'quiet', text: input.text };
    }
    return state.status === 'none' ? state : NO_CONFLICT;
}

// ---- the words, in one place

export const BUILDS_HEADING = 'Your builds';
export const CHANGED_ELSEWHERE_MESSAGE = 'This build was changed in another tab. Your next edit here will save over that change.';
export const LOAD_OTHER_TAB_LABEL = "Load the other tab's version";
export const LOADED_OTHER_TAB_MESSAGE = 'Loaded the version from the other tab.';
export const DELETED_ELSEWHERE_MESSAGE = 'This build was deleted in another tab. It is still open here, and your next edit saves it again.';
export const STORAGE_FULL_MESSAGE = "This browser's storage is full, so your latest changes are not saved. Delete builds you no longer need, or save this one to a file.";
export const NEW_BUILD_ANNOUNCEMENT = 'New build made.';

export function otherTabProblemMessage(problem: string): string {
    return `The other tab's version could not be loaded, so nothing changed: ${problem}`;
}

export function deletedBuildMessage(name: string): string {
    return `Build deleted: ${name}.`;
}

export function openedBuildAnnouncement(name: string): string {
    return `Opened build: ${name}.`;
}

export function duplicatedAnnouncement(name: string): string {
    return `Build copied. Opened ${name}.`;
}

export function renamedAnnouncement(name: string): string {
    return `Build renamed: ${name}.`;
}

/** "Gear test (copy)", cut to the longest name kept */
export function copyName(name: string): string {
    return cleanName(`${Array.from(name).slice(0, NAME_MAX_LENGTH - ' (copy)'.length).join('')} (copy)`) ?? name;
}
