import factorioData from '../../../clock-generator/resources/data-filtered.json?raw';
import { describe, expect, it, vi } from 'vitest';
import { FactorioDataService } from 'clock-generator/browser';
import { copyName, type StorageLike } from './buildLibrary';
import { effectiveInserterStackSize } from './inserterMetadata';
import {
    INSERTER_HANDS,
    PROFILES_KEY,
    TEMPLATES,
    checkBonuses,
    inserterHand,
    laneStack,
    openProfileStore,
    type Bonuses,
} from './researchProfiles';

FactorioDataService.initialize(JSON.parse(factorioData));

const BACKUP_KEY = `${PROFILES_KEY}.backup`;
const PROTOTYPES = ['stack-inserter', 'bulk-inserter', 'fast-inserter', 'long-handed-inserter', 'inserter'];

/** A storage in memory, with every write counted */
function memoryStorage(initial: Record<string, string> = {}) {
    const items = new Map(Object.entries(initial));
    const setItem = vi.fn((key: string, value: string) => { items.set(key, value); });
    const storage: StorageLike = {
        getItem: key => items.get(key) ?? null,
        setItem,
        removeItem: key => { items.delete(key); },
        key: i => [...items.keys()][i] ?? null,
        get length() { return items.size; },
    };
    return { storage, items, setItem };
}

function counter() {
    let n = 0;
    return () => `id-${++n}`;
}

function open(initial: Record<string, string> = {}) {
    const memory = memoryStorage(initial);
    return { ...memory, store: openProfileStore(memory.storage, counter()) };
}

const zero = (): Bonuses => ({
    mining_drill_productivity_bonus: 0, inserter_stack_size_bonus: 0, bulk_inserter_capacity_bonus: 0, belt_stack_size_bonus: 0, recipes: {},
});

describe('the store', () => {
    it('lists the two templates for empty storage and writes nothing', () => {
        const { store, setItem, items } = open();
        expect(store.entries().map(entry => [entry.name, entry.isTemplate])).toEqual([['No research', true], ['All finite research', true]]);
        expect(store.snapshot().profiles).toEqual([]);
        expect(store.saved).toBe(true);
        expect(setItem).not.toHaveBeenCalled();
        expect(items.size).toBe(0);
    });

    it.each(TEMPLATES.map(template => [template.name, template] as const))('makes a new profile from the template %s with its numbers', (_name, template) => {
        const { store } = open();
        const made = store.create('My megabase', template.id);
        expect(made).toMatchObject({ ok: true });
        const profile = store.snapshot().profiles[0];
        expect(profile).toMatchObject({ name: 'My megabase', template: template.id, bonuses: template.bonuses });
        // a copy of the numbers, not the template's own object
        expect(profile.bonuses).not.toBe(template.bonuses);
        expect(profile.bonuses.recipes).not.toBe(template.bonuses.recipes);
    });

    it('copies a profile in one step, with its numbers and its template, named as the builds are', () => {
        const { store } = open();
        store.create('Base', 'all-finite-research');
        const id = store.snapshot().profiles[0].id;
        store.setBonuses(id, { ...store.find(id)!.bonuses, recipes: { 'plastic-bar': { productivity_bonus: 300 } } });
        const copied = store.copy(id);
        expect(copied).toMatchObject({ ok: true });
        const [source, copy] = store.snapshot().profiles;
        expect(copy.name).toBe(copyName('Base'));
        expect(copy.name).toBe('Base (copy)');
        expect(copy.id).not.toBe(source.id);
        expect(copy.template).toBe('all-finite-research');
        expect(copy.bonuses).toEqual(source.bonuses);
        expect(copy.bonuses.recipes).not.toBe(source.bonuses.recipes);
    });

    it('names the copies of one profile the first free of (copy), (copy 2), (copy 3)', () => {
        const { store } = open();
        store.create('X', 'no-research');
        const id = store.snapshot().profiles[0].id;
        store.copy(id);
        store.copy(id);
        store.copy(id);
        expect(store.snapshot().profiles.map(profile => profile.name)).toEqual(['X', 'X (copy)', 'X (copy 2)', 'X (copy 3)']);
        // a free name left by a removed copy is the first free again
        store.remove(store.snapshot().profiles[2].id);
        store.copy(id);
        expect(store.snapshot().profiles.map(profile => profile.name)).toContain('X (copy 2)');
    });

    it('takes a name in use in any letter case as in use when it names a copy', () => {
        const { store } = open();
        store.create('X', 'no-research');
        store.create('x (COPY)', 'no-research');
        store.copy(store.snapshot().profiles[0].id);
        expect(store.snapshot().profiles.map(profile => profile.name)).toEqual(['X', 'x (COPY)', 'X (copy 2)']);
    });

    it('keeps a copy of a 60 character name within 60 characters, twice', () => {
        const { store } = open();
        const long = 'L'.repeat(60);
        store.create(long, 'no-research');
        const id = store.snapshot().profiles[0].id;
        store.copy(id);
        store.copy(id);
        const names = store.snapshot().profiles.map(profile => profile.name);
        expect(names).toHaveLength(3);
        expect(names.every(name => Array.from(name).length <= 60)).toBe(true);
        expect(new Set(names.map(name => name.toLowerCase())).size).toBe(3);
        expect(names[1]).toBe(copyName(long));
        expect(names[2].endsWith(' (copy 2)')).toBe(true);
    });

    it('renames a profile with the builds\' cleaning of a name', () => {
        const { store } = open();
        store.create('Old', 'no-research');
        const id = store.snapshot().profiles[0].id;
        expect(store.rename(id, `  New\u0007 name ${'z'.repeat(80)}  `)).toMatchObject({ ok: true });
        const name = store.find(id)!.name;
        expect(name.startsWith('New name z')).toBe(true);
        expect(Array.from(name)).toHaveLength(60);
        // only the letter case of its own name changes
        expect(store.rename(id, name.toUpperCase())).toMatchObject({ ok: true });
    });

    it.each([
        ['an empty name', '   ', 'empty-name'],
        ['a name in use', 'Taken', 'name-in-use'],
        ['a name in use in other letters', 'tAKEN', 'name-in-use'],
        ['the name of a template', 'No research', 'template-name'],
        ['the name of a template in other letters', 'all FINITE research', 'template-name'],
    ] as const)('refuses New and Rename with %s', (_what, name, reason) => {
        const { store } = open();
        store.create('Taken', 'no-research');
        store.create('Other', 'no-research');
        const before = store.snapshot();
        expect(store.create(name, 'no-research')).toEqual({ ok: false, reason });
        expect(store.rename(store.snapshot().profiles[1].id, name)).toEqual({ ok: false, reason });
        expect(store.snapshot()).toBe(before);
    });

    it('removes a profile, and forgets it as the last used', () => {
        const { store } = open();
        store.create('A', 'no-research');
        store.create('B', 'no-research');
        const [a, b] = store.snapshot().profiles;
        store.select(a.id);
        expect(store.snapshot().lastUsed).toBe(a.id);
        expect(store.remove(a.id)).toMatchObject({ ok: true });
        expect(store.snapshot().profiles.map(profile => profile.id)).toEqual([b.id]);
        expect(store.snapshot().lastUsed).toBeNull();
        expect(store.remove(a.id)).toEqual({ ok: false, reason: 'not-found' });
    });

    it('reverts the numbers of a profile to its template\'s, and not those of one with no template', () => {
        const { store } = open();
        store.create('Mine', 'all-finite-research');
        const id = store.snapshot().profiles[0].id;
        store.setBonuses(id, { ...zero(), mining_drill_productivity_bonus: 79990, belt_stack_size_bonus: 1, recipes: { 'plastic-bar': { productivity_bonus: 300 } } });
        expect(store.revert(id)).toMatchObject({ ok: true });
        expect(store.find(id)!.bonuses).toEqual(TEMPLATES[1].bonuses);
        expect(store.find(id)!.name).toBe('Mine');
        // a profile whose template is null (stored so) has nothing to revert to
        const stored = JSON.stringify({ version: 1, profiles: [{ id: 'p', name: 'Own', template: null, bonuses: zero() }], lastUsed: null });
        const other = open({ [PROFILES_KEY]: stored });
        expect(other.store.revert('p')).toEqual({ ok: false, reason: 'no-template' });
    });

    it('cannot edit, rename, remove, copy or revert a template', () => {
        const { store, setItem } = open();
        for (const template of TEMPLATES) {
            expect(store.setBonuses(template.id, zero())).toEqual({ ok: false, reason: 'read-only' });
            expect(store.rename(template.id, 'Mine')).toEqual({ ok: false, reason: 'read-only' });
            expect(store.remove(template.id)).toEqual({ ok: false, reason: 'read-only' });
            expect(store.copy(template.id)).toEqual({ ok: false, reason: 'read-only' });
            expect(store.revert(template.id)).toEqual({ ok: false, reason: 'read-only' });
        }
        expect(setItem).not.toHaveBeenCalled();
        expect(TEMPLATES[1].bonuses.mining_drill_productivity_bonus).toBe(20);
    });

    it('remembers the last used profile or template, and drops one that is gone', () => {
        const { store, storage } = open();
        store.select('all-finite-research');
        expect(store.snapshot().lastUsed).toBe('all-finite-research');
        store.select('no-such-id');
        expect(store.snapshot().lastUsed).toBe('all-finite-research');
        expect(openProfileStore(storage).snapshot().lastUsed).toBe('all-finite-research');
    });
});

describe('what is saved', () => {
    it('gives back what it wrote', () => {
        const first = open();
        first.store.create('Mine', 'all-finite-research');
        const id = first.store.snapshot().profiles[0].id;
        first.store.setBonuses(id, { ...first.store.find(id)!.bonuses, mining_drill_productivity_bonus: 79990.5, recipes: { 'plastic-bar': { productivity_bonus: 300 } } });
        first.store.select(id);
        const second = openProfileStore(first.storage);
        expect(second.snapshot()).toEqual(first.store.snapshot());
        expect(JSON.parse(first.items.get(PROFILES_KEY)!)).toMatchObject({ version: 1, lastUsed: id });
        expect(first.items.has(BACKUP_KEY)).toBe(false);
    });

    it('copies unreadable text to the backup key before the first write, and only then', () => {
        const { store, items, setItem } = open({ [PROFILES_KEY]: '{not json' });
        expect(store.snapshot().profiles).toEqual([]);
        expect(setItem).not.toHaveBeenCalled();
        store.create('First', 'no-research');
        expect(setItem.mock.calls[0]).toEqual([BACKUP_KEY, '{not json']);
        expect(setItem.mock.calls[1][0]).toBe(PROFILES_KEY);
        expect(items.get(BACKUP_KEY)).toBe('{not json');
        store.create('Second', 'no-research');
        expect(setItem.mock.calls.filter(call => call[0] === BACKUP_KEY)).toHaveLength(1);
    });

    it('copies a store with a row it cannot read to the backup, and keeps the other rows', () => {
        const text = JSON.stringify({
            version: 1,
            profiles: [{ id: 'good', name: 'Good', template: null, bonuses: zero() }, { id: 'bad', name: 'Bad', template: null, bonuses: { ...zero(), belt_stack_size_bonus: -1 } }],
            lastUsed: 'bad',
        });
        const { store, items } = open({ [PROFILES_KEY]: text });
        expect(store.snapshot().profiles.map(profile => profile.id)).toEqual(['good']);
        expect(store.snapshot().lastUsed).toBeNull();
        store.select('good');
        expect(items.get(BACKUP_KEY)).toBe(text);
    });

    it('works in memory when the storage throws, and says it is not saved', () => {
        const blocked: StorageLike = {
            getItem: () => { throw new Error('blocked'); },
            setItem: () => { throw new Error('blocked'); },
            removeItem: () => { throw new Error('blocked'); },
            key: () => { throw new Error('blocked'); },
            get length(): number { throw new Error('blocked'); },
        };
        const store = openProfileStore(blocked, counter());
        expect(store.saved).toBe(false);
        expect(store.create('Mine', 'all-finite-research')).toMatchObject({ ok: true });
        expect(store.copy(store.snapshot().profiles[0].id)).toMatchObject({ ok: true });
        expect(store.snapshot().profiles.map(profile => profile.name)).toEqual(['Mine', 'Mine (copy)']);
        expect(store.saved).toBe(false);
        expect(openProfileStore(null).saved).toBe(false);
    });

    it('says it is not saved when a write throws, and is saved again when one works', () => {
        const memory = memoryStorage();
        let full = true;
        memory.setItem.mockImplementation((key: string, value: string) => {
            if (full) throw new Error('quota');
            memory.items.set(key, value);
        });
        const store = openProfileStore(memory.storage, counter());
        expect(store.saved).toBe(true);
        store.create('A', 'no-research');
        expect(store.saved).toBe(false);
        full = false;
        store.create('B', 'no-research');
        expect(store.saved).toBe(true);
        expect(JSON.parse(memory.items.get(PROFILES_KEY)!).profiles.map((profile: { name: string }) => profile.name)).toEqual(['A', 'B']);
    });

    it('does not write over a store a newer page wrote', () => {
        const text = JSON.stringify({ version: 2, profiles: [{ id: 'p', name: 'Newer', template: null, bonuses: zero() }], lastUsed: null });
        const { store, setItem } = open({ [PROFILES_KEY]: text });
        expect(store.snapshot().profiles.map(profile => profile.name)).toEqual(['Newer']);
        expect(store.saved).toBe(false);
        store.create('Mine', 'no-research');
        expect(setItem).not.toHaveBeenCalled();
    });

    it('reads another tab\'s write again, and one that cleared the storage', () => {
        const { store, storage, items } = open();
        const other = openProfileStore(storage, () => 'other-id');
        other.create('From the other tab', 'no-research');
        expect(store.snapshot().profiles).toEqual([]);
        store.reload();
        expect(store.snapshot().profiles.map(profile => profile.name)).toEqual(['From the other tab']);
        items.clear();
        store.reload();
        expect(store.snapshot().profiles).toEqual([]);
    });

    it('adds to what another tab wrote since it was opened, rather than over it', () => {
        const { store, storage } = open();
        const other = openProfileStore(storage, () => 'other-id');
        other.create('Other', 'no-research');
        store.create('Mine', 'no-research');
        expect(openProfileStore(storage).snapshot().profiles.map(profile => profile.name)).toEqual(['Other', 'Mine']);
    });
});

describe('what the store refuses', () => {
    const bonuses = (change: Partial<Bonuses>): Bonuses => ({ ...zero(), ...change });
    it.each([
        ['mining productivity below 0', bonuses({ mining_drill_productivity_bonus: -1 })],
        ['mining productivity not finite', bonuses({ mining_drill_productivity_bonus: Number.POSITIVE_INFINITY })],
        ['mining productivity not a number', bonuses({ mining_drill_productivity_bonus: Number.NaN })],
        ['recipe productivity below 0', bonuses({ recipes: { 'plastic-bar': { productivity_bonus: -0.5 } } })],
        ['recipe productivity not finite', bonuses({ recipes: { 'plastic-bar': { productivity_bonus: Number.NaN } } })],
        ['an inserter bonus that is not whole', bonuses({ inserter_stack_size_bonus: 2.5 })],
        ['an inserter bonus below 0', bonuses({ inserter_stack_size_bonus: -1 })],
        ['a bulk bonus that is not whole', bonuses({ bulk_inserter_capacity_bonus: 0.5 })],
        ['a bulk bonus below 0', bonuses({ bulk_inserter_capacity_bonus: -1 })],
        ['a bulk bonus above 254', bonuses({ bulk_inserter_capacity_bonus: 255 })],
        ['a belt bonus that is not whole', bonuses({ belt_stack_size_bonus: 1.5 })],
        ['a belt bonus below 0', bonuses({ belt_stack_size_bonus: -1 })],
    ])('refuses %s', (_what, change) => {
        expect(checkBonuses(change)).not.toBeNull();
        const { store } = open();
        store.create('Mine', 'no-research');
        const id = store.snapshot().profiles[0].id;
        const before = store.snapshot();
        expect(store.setBonuses(id, change)).toMatchObject({ ok: false, reason: 'invalid' });
        expect(store.snapshot()).toBe(before);
    });

    it.each([
        ['a belt bonus above 3', bonuses({ belt_stack_size_bonus: 4 })],
        ['a bulk bonus of 254', bonuses({ bulk_inserter_capacity_bonus: 254 })],
        ['mining productivity with decimals', bonuses({ mining_drill_productivity_bonus: 79990.1234 })],
        ['no bonus at all', zero()],
    ])('keeps %s', (_what, change) => {
        expect(checkBonuses(change)).toBeNull();
        const { store } = open();
        store.create('Mine', 'no-research');
        const id = store.snapshot().profiles[0].id;
        expect(store.setBonuses(id, change)).toMatchObject({ ok: true });
        expect(store.find(id)!.bonuses).toEqual(change);
    });

    it('names the field that is refused', () => {
        expect(checkBonuses(bonuses({ bulk_inserter_capacity_bonus: 255 }))).toMatchObject({ field: 'bulk_inserter_capacity_bonus' });
        expect(checkBonuses(bonuses({ recipes: { 'plastic-bar': { productivity_bonus: -1 } } }))).toMatchObject({ field: 'recipes', recipe: 'plastic-bar' });
    });
});

describe('the hand table', () => {
    it.each(PROTOTYPES)('holds the bonus and the bulk flag of %s to the engine data', prototype => {
        const spec = FactorioDataService.findInserterOrThrow(prototype);
        expect(INSERTER_HANDS[prototype]).toEqual({ bonus: spec.stack_size_bonus ?? 0, bulk: spec.bulk === true });
    });

    it('holds exactly the five prototypes', () => {
        expect(Object.keys(INSERTER_HANDS).sort()).toEqual([...PROTOTYPES].sort());
    });

    it('gives the hand from the numbers of a profile, and nothing for another prototype', () => {
        const bonuses: Bonuses = { ...zero(), inserter_stack_size_bonus: 3, bulk_inserter_capacity_bonus: 11 };
        expect(inserterHand('stack-inserter', bonuses)).toBe(16);
        expect(inserterHand('bulk-inserter', bonuses)).toBe(12);
        expect(inserterHand('fast-inserter', bonuses)).toBe(4);
        expect(inserterHand('inserter', zero())).toBe(1);
        expect(inserterHand('burner-inserter', bonuses)).toBeNaN();
    });
});

describe('the lane rule', () => {
    it.each([[0, 1], [3, 4], [4, 4], [254, 4]])('gives a stack of %s -> %s', (bonus, stack) => {
        expect(laneStack({ ...zero(), belt_stack_size_bonus: bonus })).toBe(stack);
    });
});

describe('the templates', () => {
    it('are the two named, the first with no research', () => {
        expect(TEMPLATES.map(template => template.name)).toEqual(['No research', 'All finite research']);
        expect(TEMPLATES[0].bonuses).toEqual(zero());
        expect(TEMPLATES[0].setYours).toEqual({ mining: false, recipes: false });
    });

    it('give a mining productivity of 20 in percent, not 0.2, and no recipe', () => {
        const all = TEMPLATES[1];
        expect(all.bonuses.mining_drill_productivity_bonus).toBe(20);
        expect(all.bonuses.recipes).toEqual({});
        expect(all.bonuses.belt_stack_size_bonus).toBe(3);
        expect(all.setYours).toEqual({ mining: true, recipes: true });
    });

    it('give the inserter bonuses the engine data gives with all research', () => {
        const research = FactorioDataService.inserterResearch();
        const all = TEMPLATES[1].bonuses;
        expect(all.inserter_stack_size_bonus).toBe(research.inserter_stack_size_bonus);
        expect(all.bulk_inserter_capacity_bonus).toBe(research.bulk_inserter_capacity_bonus);
    });

    it('give the hands the Automatic stack size gives, for the five prototypes, and lanes of 4', () => {
        for (const prototype of PROTOTYPES) {
            expect(inserterHand(prototype, TEMPLATES[1].bonuses)).toBe(effectiveInserterStackSize({ prototype }));
        }
        expect(PROTOTYPES.map(prototype => inserterHand(prototype, TEMPLATES[1].bonuses))).toEqual([16, 12, 4, 4, 4]);
        expect(laneStack(TEMPLATES[1].bonuses)).toBe(4);
        expect(laneStack(TEMPLATES[0].bonuses)).toBe(1);
    });
});
