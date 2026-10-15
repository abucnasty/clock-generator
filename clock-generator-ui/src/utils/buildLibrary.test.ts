import { describe, expect, it } from 'vitest';
import {
    backupKey,
    buildFileName,
    buildKey,
    buildTitles,
    classifyStorageEvent,
    cleanName,
    copyName,
    LEGACY_BUILD_KEY,
    LIBRARY_KEY,
    mostRecent,
    nextConflict,
    NO_CONFLICT,
    openLibrary,
    readIndex,
    removeBuild,
    renameBuild,
    setBuildRecipe,
    TAB_BUILD_KEY,
    touchBuild,
    upsertBuild,
    type BuildMeta,
    type ConflictState,
    type LibraryIndex,
    type StorageLike,
} from './buildLibrary';

/** A Map-backed storage that records its writes; `setItem` throws when `full` */
function fakeStorage(entries: Record<string, string> = {}, { full = false } = {}) {
    const map = new Map(Object.entries(entries));
    const writes: string[] = [];
    const storage: StorageLike = {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => {
            if (full) throw new Error('QuotaExceededError');
            writes.push(key);
            map.set(key, value);
        },
        removeItem: (key) => {
            writes.push(key);
            map.delete(key);
        },
        key: (i) => [...map.keys()][i] ?? null,
        get length() {
            return map.size;
        },
    };
    return { storage, map, writes };
}

const savedForm = (recipe: string) => JSON.stringify({
    target_output: { recipe, items_per_second: 1, copies: 1 },
    machines: [{ id: 1, recipe, productivity: 0, crafting_speed: 1 }],
    inserters: [],
    belts: [],
    chests: [],
});

const meta = (id: string, more: Partial<BuildMeta> = {}): BuildMeta => ({ id, name: null, recipe: '', createdAt: 1, openedAt: 1, ...more });
const indexOf = (...builds: BuildMeta[]): LibraryIndex => ({ version: 1, builds });

describe('openLibrary: migration', () => {
    it('gives one default build on empty storage, and writes only the index', () => {
        const { storage, map, writes } = fakeStorage();
        const library = openLibrary(storage, null, 100);
        expect(library.activeId).toBe('default');
        expect(library.index.builds).toEqual([{ id: 'default', name: null, recipe: '', createdAt: 100, openedAt: 100 }]);
        expect(writes).toEqual([LIBRARY_KEY]);
        expect(JSON.parse(map.get(LIBRARY_KEY)!)).toEqual(library.index);
    });

    it('makes the single saved build the default one with its recipe, and leaves its text as it was', () => {
        const text = savedForm('logistic-science-pack');
        const { storage, map, writes } = fakeStorage({ [LEGACY_BUILD_KEY]: text });
        const library = openLibrary(storage, null, 100);
        expect(library.index.builds).toEqual([{ id: 'default', name: null, recipe: 'logistic-science-pack', createdAt: 100, openedAt: 100 }]);
        expect(map.get(LEGACY_BUILD_KEY)).toBe(text);
        expect(writes).toEqual([LIBRARY_KEY]);
        expect([...map.keys()].some((key) => key.startsWith('clock-generator-build:'))).toBe(false);
    });

    it('still gives the default build when the saved text cannot be read, with no recipe', () => {
        const { storage, map } = fakeStorage({ [LEGACY_BUILD_KEY]: '{broken' });
        const library = openLibrary(storage, null, 100);
        expect(library.index.builds).toEqual([meta('default', { createdAt: 100, openedAt: 100 })]);
        expect(map.get(LEGACY_BUILD_KEY)).toBe('{broken');
    });

    it('leaves an index that exists alone', () => {
        const index = indexOf(meta('default', { recipe: 'iron-gear-wheel' }), meta('abc', { openedAt: 5 }));
        const { storage, writes } = fakeStorage({ [LIBRARY_KEY]: JSON.stringify(index) });
        const library = openLibrary(storage, null, 100);
        expect(library.index).toEqual(index);
        expect(library.writable).toBe(true);
        expect(writes).toEqual([]);
    });

    it('rebuilds a corrupt index from the builds, leaving out backups, and removes nothing', () => {
        const { storage, map, writes } = fakeStorage({
            [LIBRARY_KEY]: '{broken',
            [LEGACY_BUILD_KEY]: savedForm('iron-gear-wheel'),
            'clock-generator-build:abc': savedForm('electronic-circuit'),
            'clock-generator-build:def': savedForm('logistic-science-pack'),
            'clock-generator-build:abc.backup': '{old',
            'clock-generator-config.backup': '{old',
        });
        const library = openLibrary(storage, null, 100);
        expect(library.index.builds.map((build) => [build.id, build.recipe])).toEqual([
            ['default', 'iron-gear-wheel'],
            ['abc', 'electronic-circuit'],
            ['def', 'logistic-science-pack'],
        ]);
        expect(writes).toEqual([LIBRARY_KEY]);
        expect(map.size).toBe(6);
    });

    it('rebuilds an index of the wrong shape as well', () => {
        for (const text of ['[]', '{"version": 1}', '{"version": "1", "builds": []}', 'null', '{"version": 0, "builds": []}']) {
            const { storage } = fakeStorage({ [LIBRARY_KEY]: text, 'clock-generator-build:abc': savedForm('iron-gear-wheel') });
            expect(openLibrary(storage, null, 100).index.builds.map((build) => build.id)).toEqual(['abc']);
        }
    });

    it('reads an index of a newer version for what it knows, and never writes it', () => {
        const text = JSON.stringify({ version: 2, builds: [{ ...meta('abc', { recipe: 'iron-gear-wheel' }), colour: 'red' }], folders: [] });
        const { storage, writes } = fakeStorage({ [LIBRARY_KEY]: text });
        const library = openLibrary(storage, null, 100);
        expect(library.writable).toBe(false);
        expect(library.index.builds).toEqual([meta('abc', { recipe: 'iron-gear-wheel' })]);
        expect(writes).toEqual([]);
    });

    it('keeps the library in memory when the index cannot be written, and loses nothing', () => {
        const text = savedForm('iron-gear-wheel');
        const { storage, map } = fakeStorage({ [LEGACY_BUILD_KEY]: text }, { full: true });
        const library = openLibrary(storage, null, 100);
        expect(library.index.builds.map((build) => build.id)).toEqual(['default']);
        expect(map.get(LEGACY_BUILD_KEY)).toBe(text);
        expect(map.has(LIBRARY_KEY)).toBe(false);
    });

    it('drops rows of the wrong type and keeps the first of two with one id', () => {
        const read = readIndex(JSON.stringify({ version: 1, builds: [meta('a'), { id: 'b', name: 3 }, meta('a', { name: 'Second' }), meta('c')] }));
        expect(read).toEqual({ kind: 'ok', writable: true, index: indexOf(meta('a'), meta('c')) });
    });
});

describe('openLibrary: which build a tab opens', () => {
    const index = indexOf(meta('default', { openedAt: 1 }), meta('abc', { openedAt: 9 }), meta('def', { openedAt: 5 }));
    const stored = { [LIBRARY_KEY]: JSON.stringify(index) };

    it("opens the tab's own build while the index still has it", () => {
        const { storage: session } = fakeStorage({ [TAB_BUILD_KEY]: 'def' });
        expect(openLibrary(fakeStorage(stored).storage, session, 100).activeId).toBe('def');
    });

    it('opens the most recently opened build in a new tab', () => {
        expect(openLibrary(fakeStorage(stored).storage, fakeStorage().storage, 100).activeId).toBe('abc');
        expect(openLibrary(fakeStorage(stored).storage, null, 100).activeId).toBe('abc');
    });

    it('falls back to the most recent when the tab build is gone', () => {
        const { storage: session } = fakeStorage({ [TAB_BUILD_KEY]: 'gone' });
        expect(openLibrary(fakeStorage(stored).storage, session, 100).activeId).toBe('abc');
    });
});

describe('keys', () => {
    it('keeps the default build under the old key, and every other under its own', () => {
        expect(buildKey('default')).toBe('clock-generator-config');
        expect(backupKey('default')).toBe('clock-generator-config.backup');
        expect(buildKey('3f2b-11')).toBe('clock-generator-build:3f2b-11');
        expect(backupKey('3f2b-11')).toBe('clock-generator-build:3f2b-11.backup');
    });
});

describe('edits of the index', () => {
    const index = indexOf(meta('a', { openedAt: 3 }), meta('b', { name: 'Gears', openedAt: 7 }));

    it('gives a new index for a change', () => {
        expect(upsertBuild(index, meta('c')).builds.map((build) => build.id)).toEqual(['a', 'b', 'c']);
        expect(upsertBuild(index, meta('a', { name: 'Renamed', openedAt: 3 })).builds[0].name).toBe('Renamed');
        expect(removeBuild(index, 'a').builds.map((build) => build.id)).toEqual(['b']);
        expect(renameBuild(index, 'b', null).builds[1].name).toBeNull();
        expect(touchBuild(index, 'a', 50).builds[0].openedAt).toBe(50);
        expect(setBuildRecipe(index, 'a', 'iron-gear-wheel').builds[0].recipe).toBe('iron-gear-wheel');
    });

    it('gives the same object when nothing changes', () => {
        expect(upsertBuild(index, meta('a', { openedAt: 3 }))).toBe(index);
        expect(removeBuild(index, 'zzz')).toBe(index);
        expect(renameBuild(index, 'b', 'Gears')).toBe(index);
        expect(renameBuild(index, 'zzz', 'Gears')).toBe(index);
        expect(touchBuild(index, 'a', 3)).toBe(index);
        expect(setBuildRecipe(index, 'a', '')).toBe(index);
    });

    it('finds the most recently opened build, leaving one out', () => {
        expect(mostRecent(index)?.id).toBe('b');
        expect(mostRecent(index, 'b')?.id).toBe('a');
        expect(mostRecent(indexOf(meta('a')), 'a')).toBeNull();
    });
});

describe('cleanName', () => {
    it('trims, drops control characters and cuts at 60 characters', () => {
        expect(cleanName('  Gear test  ')).toBe('Gear test');
        expect(cleanName('Gear\u0007 test\n')).toBe('Gear test');
        expect(cleanName('x'.repeat(80))).toBe('x'.repeat(60));
        expect(cleanName('⚙'.repeat(70))).toBe('⚙'.repeat(60));
    });

    it('gives null for nothing', () => {
        expect(cleanName('')).toBeNull();
        expect(cleanName('   \t ')).toBeNull();
        expect(cleanName('\u0000')).toBeNull();
    });

    it('names a copy, kept within 60 characters', () => {
        expect(copyName('Gear test')).toBe('Gear test (copy)');
        expect(copyName('y'.repeat(60))).toBe(`${'y'.repeat(53)} (copy)`);
    });
});

describe('buildTitles', () => {
    it('names a build after its recipe in sentence case, or its own name, or Untitled build', () => {
        const titles = buildTitles([
            meta('a', { recipe: 'logistic-science-pack' }),
            meta('b', { name: 'Gear test', recipe: 'iron-gear-wheel' }),
            meta('c'),
        ]);
        expect([...titles.values()]).toEqual(['Logistic science pack', 'Gear test', 'Untitled build']);
    });

    it("uses the game's names when given", () => {
        const titles = buildTitles([meta('a', { recipe: 'logistic-science-pack' })], (id) => (id === 'logistic-science-pack' ? 'Logistic Science Pack' : id));
        expect(titles.get('a')).toBe('Logistic Science Pack');
    });

    it('tells apart builds with one title, in the order they were made', () => {
        const titles = buildTitles([
            meta('later', { createdAt: 30 }),
            meta('first', { createdAt: 10 }),
            meta('middle', { createdAt: 20 }),
            meta('gear', { recipe: 'iron-gear-wheel', createdAt: 5 }),
            meta('named', { name: 'Iron gear wheel', createdAt: 6 }),
        ]);
        expect(titles.get('first')).toBe('Untitled build');
        expect(titles.get('middle')).toBe('Untitled build (2)');
        expect(titles.get('later')).toBe('Untitled build (3)');
        expect(titles.get('gear')).toBe('Iron gear wheel');
        expect(titles.get('named')).toBe('Iron gear wheel (2)');
    });
});

describe('buildFileName', () => {
    it('makes a file name of the title', () => {
        expect(buildFileName('Logistic science pack')).toBe('logistic-science-pack.json');
        expect(buildFileName('Gear test (copy) #2!')).toBe('gear-test-copy-2.json');
        expect(buildFileName('Grüne Schaltkreise ⚙')).toBe('grune-schaltkreise.json');
        expect(buildFileName('⚙⚙')).toBe('build.json');
        expect(buildFileName('')).toBe('build.json');
    });

    it('cuts it at 60 characters', () => {
        const name = buildFileName(`${'a'.repeat(59)} b`);
        expect(name).toBe(`${'a'.repeat(59)}.json`);
        expect(buildFileName('c'.repeat(100))).toBe(`${'c'.repeat(60)}.json`);
    });
});

describe('classifyStorageEvent', () => {
    const index = indexOf(meta('abc'), meta('def'));
    const context = { activeId: 'abc', lastText: 'mine', index };
    const ownKey = 'clock-generator-build:abc';

    it("sees this tab's build saved elsewhere, unless it is the text this tab wrote", () => {
        expect(classifyStorageEvent({ key: ownKey, newValue: 'theirs' }, context)).toBe('changed-elsewhere');
        expect(classifyStorageEvent({ key: ownKey, newValue: 'mine' }, context)).toBe('ignore');
    });

    it("sees this tab's build deleted elsewhere", () => {
        expect(classifyStorageEvent({ key: ownKey, newValue: null }, context)).toBe('deleted-elsewhere');
        expect(classifyStorageEvent({ key: LIBRARY_KEY, newValue: JSON.stringify(indexOf(meta('def'))) }, context)).toBe('deleted-elsewhere');
    });

    it('sees any other index as a change to the list', () => {
        expect(classifyStorageEvent({ key: LIBRARY_KEY, newValue: JSON.stringify(indexOf(meta('abc', { name: 'X' }))) }, context)).toBe('index');
        expect(classifyStorageEvent({ key: LIBRARY_KEY, newValue: '{broken' }, context)).toBe('index');
    });

    it('ignores other builds, backups and the tab key', () => {
        expect(classifyStorageEvent({ key: 'clock-generator-build:def', newValue: 'x' }, context)).toBe('ignore');
        expect(classifyStorageEvent({ key: `${ownKey}.backup`, newValue: 'x' }, context)).toBe('ignore');
        expect(classifyStorageEvent({ key: TAB_BUILD_KEY, newValue: 'def' }, context)).toBe('ignore');
        expect(classifyStorageEvent({ key: 'clock-generator-intro-dismissed', newValue: 'true' }, context)).toBe('ignore');
    });

    it('reads a cleared storage from the index as saved now', () => {
        expect(classifyStorageEvent({ key: null, newValue: null }, context)).toBe('index');
        expect(classifyStorageEvent({ key: null, newValue: null }, { ...context, index: indexOf() })).toBe('deleted-elsewhere');
    });

    it('watches the old key for the default build', () => {
        const legacy = { ...context, activeId: 'default' };
        expect(classifyStorageEvent({ key: LEGACY_BUILD_KEY, newValue: 'theirs' }, legacy)).toBe('changed-elsewhere');
        expect(classifyStorageEvent({ key: ownKey, newValue: 'theirs' }, legacy)).toBe('ignore');
    });
});

describe('nextConflict', () => {
    it('raises the warning once, then keeps the latest text quietly', () => {
        const raised = nextConflict(NO_CONFLICT, { kind: 'event', text: 'one' });
        expect(raised).toEqual({ status: 'raised', text: 'one' });
        const quiet = nextConflict(raised, { kind: 'event', text: 'two' });
        expect(quiet).toEqual({ status: 'quiet', text: 'two' });
        expect(nextConflict(quiet, { kind: 'event', text: 'three' })).toEqual({ status: 'quiet', text: 'three' });
    });

    it('ends the episode when the warning is closed or used, this tab saves, or it opens another build', () => {
        const states: ConflictState[] = [{ status: 'raised', text: 'one' }, { status: 'quiet', text: 'two' }];
        for (const state of states) {
            for (const kind of ['closed', 'loaded', 'saved-here', 'switched'] as const) {
                expect(nextConflict(state, { kind })).toEqual(NO_CONFLICT);
            }
        }
        expect(nextConflict(NO_CONFLICT, { kind: 'saved-here' })).toBe(NO_CONFLICT);
    });
});
