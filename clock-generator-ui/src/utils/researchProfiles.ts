import { cleanName, type StorageLike } from './buildLibrary';

/**
 * Research profiles: the final research numbers of a game's force, kept in this browser under a name.
 *
 * A profile holds numbers, not technologies and levels. The keys are the game's names for the force's fields; the units
 * are not always the game's (see `Bonuses`). Two templates ship with the page and cannot be changed; a profile is made
 * from one of them, or from another profile, and the user sets its numbers. Nothing here reads or writes a build.
 */

/** Where the profiles are saved: `{ version, profiles, lastUsed }` */
export const PROFILES_KEY = 'clock-generator-research-profiles';
const BACKUP_SUFFIX = '.backup';
const STORE_VERSION = 1;
const NAME_MAX_LENGTH = 60;
/** The most the game keeps of a bulk inserter's capacity bonus */
const BULK_MAX = 254;
/** The most a belt holds in one stack, whatever the bonus */
const BELT_STACK_MAX = 4;

/**
 * The numbers of a force, by the game's names. The units are the build's, not the game's: productivity is in percent,
 * as a machine's `productivity` in a configuration (where the game's force and recipe fields are fractions, so 0.2 in
 * the game is 20 here); the stack bonuses are in items, as the game has them.
 */
export interface Bonuses {
    /** Percent: mining productivity of every drill, from research */
    mining_drill_productivity_bonus: number;
    /** Items, whole: the capacity bonus of an inserter that is not a bulk inserter */
    inserter_stack_size_bonus: number;
    /** Items, whole, 0 to 254: the capacity bonus of a bulk inserter */
    bulk_inserter_capacity_bonus: number;
    /** Items, whole: the belt stack size bonus; a stack holds at most 4 whatever it is */
    belt_stack_size_bonus: number;
    /** Percent, by recipe name; a recipe that is absent has 0 */
    recipes: Record<string, { productivity_bonus: number }>;
}

export type TemplateId = 'no-research' | 'all-finite-research';

export interface ResearchProfile {
    id: string;
    name: string;
    /** The template it was made from, which Revert goes back to; null when it has none */
    template: TemplateId | null;
    bonuses: Bonuses;
}

interface ProfileStoreData {
    version: number;
    profiles: ResearchProfile[];
    /** The id of the profile or template the user chose last */
    lastUsed: string | null;
}

interface Template {
    id: TemplateId;
    name: string;
    bonuses: Bonuses;
    /** The numbers that depend on the user's own game, which the template can only guess */
    setYours: { mining: boolean; recipes: boolean };
}

export const TEMPLATES: readonly Template[] = [
    {
        id: 'no-research',
        name: 'No research',
        bonuses: { mining_drill_productivity_bonus: 0, inserter_stack_size_bonus: 0, bulk_inserter_capacity_bonus: 0, belt_stack_size_bonus: 0, recipes: {} },
        setYours: { mining: false, recipes: false },
    },
    {
        // every research that has a last level: two levels of mining productivity, the inserter and bulk capacity, the belt
        // stack size; every recipe productivity research is endless, so it adds none
        id: 'all-finite-research',
        name: 'All finite research',
        bonuses: { mining_drill_productivity_bonus: 20, inserter_stack_size_bonus: 3, bulk_inserter_capacity_bonus: 11, belt_stack_size_bonus: 3, recipes: {} },
        setYours: { mining: true, recipes: true },
    },
];

export function templateOf(id: string): Template | undefined {
    return TEMPLATES.find(template => template.id === id);
}

export const cloneBonuses = (bonuses: Bonuses): Bonuses => ({
    ...bonuses,
    recipes: Object.fromEntries(Object.entries(bonuses.recipes).map(([recipe, value]) => [recipe, { productivity_bonus: value.productivity_bonus }])),
});

// ---- the two rules a profile gives

/** The bonus and the kind of each inserter prototype that has a hand */
export const INSERTER_HANDS: Readonly<Record<string, { bonus: number; bulk: boolean }>> = {
    'stack-inserter': { bonus: 4, bulk: true },
    'bulk-inserter': { bonus: 0, bulk: true },
    'fast-inserter': { bonus: 0, bulk: false },
    'long-handed-inserter': { bonus: 0, bulk: false },
    inserter: { bonus: 0, bulk: false },
};

/** What an inserter of the prototype carries in one swing with these numbers; NaN for a prototype that is not in the table */
export function inserterHand(prototype: string, bonuses: Bonuses): number {
    if (!Object.hasOwn(INSERTER_HANDS, prototype)) return Number.NaN;
    const { bonus, bulk } = INSERTER_HANDS[prototype];
    return 1 + bonus + (bulk ? bonuses.bulk_inserter_capacity_bonus : bonuses.inserter_stack_size_bonus);
}

/** What a belt lane holds in one stack with these numbers: 1 and the belt bonus, at most 4 */
export function laneStack(bonuses: Bonuses): number {
    return Math.min(BELT_STACK_MAX, 1 + bonuses.belt_stack_size_bonus);
}

// ---- what a store refuses

type BonusField = Exclude<keyof Bonuses, 'recipes'>;

export interface BonusProblem {
    field: BonusField | 'recipes';
    /** The recipe, for a problem of `recipes` */
    recipe?: string;
    kind: 'not-finite' | 'negative' | 'not-whole' | 'above-254';
}

function numberProblem(value: unknown, whole: boolean, max?: number): BonusProblem['kind'] | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'not-finite';
    if (value < 0) return 'negative';
    if (whole && !Number.isInteger(value)) return 'not-whole';
    if (max !== undefined && value > max) return 'above-254';
    return null;
}

/** The first thing wrong with the numbers, or null. A belt bonus above 3 is kept: a force set by a script can hold it. */
export function checkBonuses(bonuses: Bonuses): BonusProblem | null {
    const fields: [BonusField, boolean, number?][] = [
        ['mining_drill_productivity_bonus', false],
        ['inserter_stack_size_bonus', true],
        ['bulk_inserter_capacity_bonus', true, BULK_MAX],
        ['belt_stack_size_bonus', true],
    ];
    for (const [field, whole, max] of fields) {
        const kind = numberProblem(bonuses[field], whole, max);
        if (kind) return { field, kind };
    }
    for (const [recipe, value] of Object.entries(bonuses.recipes)) {
        const kind = numberProblem(value?.productivity_bonus, false);
        if (kind) return { field: 'recipes', recipe, kind };
    }
    return null;
}

export type Refusal = 'empty-name' | 'name-in-use' | 'template-name' | 'read-only' | 'no-template' | 'not-found';

export type Outcome =
    | { ok: true; profile: ResearchProfile }
    | { ok: false; reason: Refusal }
    | { ok: false; reason: 'invalid'; problem: BonusProblem };

/** A row of the list the user chooses from: the templates, then the profiles */
interface ProfileEntry {
    id: string;
    name: string;
    isTemplate: boolean;
    /** For a profile, the template it was made from */
    template: TemplateId | null;
    bonuses: Bonuses;
}

interface ProfileStore {
    /** False while the profiles live in this page only: the storage is blocked, full or written by a newer page */
    readonly saved: boolean;
    /** The profiles as they are now; a new object after each change, the same one when nothing changed */
    snapshot(): ProfileStoreData;
    entries(): ProfileEntry[];
    find(id: string): ProfileEntry | undefined;
    /** Reads the storage again, after another tab wrote or cleared it */
    reload(): void;
    create(name: string, template: TemplateId): Outcome;
    copy(id: string): Outcome;
    rename(id: string, name: string): Outcome;
    remove(id: string): Outcome;
    revert(id: string): Outcome;
    setBonuses(id: string, bonuses: Bonuses): Outcome;
    /** Remembers the profile or template the user chose */
    select(id: string): void;
}

// ---- reading what is saved

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBonuses(value: unknown): Bonuses | null {
    if (!isRecord(value) || !isRecord(value.recipes)) return null;
    const recipes: Bonuses['recipes'] = {};
    for (const [recipe, row] of Object.entries(value.recipes)) {
        if (!isRecord(row) || typeof row.productivity_bonus !== 'number') return null;
        recipes[recipe] = { productivity_bonus: row.productivity_bonus };
    }
    const { mining_drill_productivity_bonus, inserter_stack_size_bonus, bulk_inserter_capacity_bonus, belt_stack_size_bonus } = value;
    if ([mining_drill_productivity_bonus, inserter_stack_size_bonus, bulk_inserter_capacity_bonus, belt_stack_size_bonus].some(number => typeof number !== 'number')) {
        return null;
    }
    const bonuses = {
        mining_drill_productivity_bonus: mining_drill_productivity_bonus as number,
        inserter_stack_size_bonus: inserter_stack_size_bonus as number,
        bulk_inserter_capacity_bonus: bulk_inserter_capacity_bonus as number,
        belt_stack_size_bonus: belt_stack_size_bonus as number,
        recipes,
    };
    return checkBonuses(bonuses) === null ? bonuses : null;
}

function readProfile(value: unknown): ResearchProfile | null {
    if (!isRecord(value) || typeof value.id !== 'string' || value.id === '' || typeof value.name !== 'string') return null;
    const name = cleanName(value.name);
    const template = value.template === null ? null : typeof value.template === 'string' ? templateOf(value.template)?.id ?? undefined : undefined;
    const bonuses = readBonuses(value.bonuses);
    if (name === null || template === undefined || bonuses === null) return null;
    return { id: value.id, name, template, bonuses };
}

type Read =
    | { kind: 'blocked' }
    | { kind: 'missing' }
    | { kind: 'unreadable'; text: string }
    /** `dropped`: rows of it could not be read and are left out; `writable`: no newer page wrote it */
    | { kind: 'ok'; data: ProfileStoreData; dropped: boolean; writable: boolean; text: string };

function parse(text: string): Read {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { kind: 'unreadable', text };
    }
    if (!isRecord(parsed) || typeof parsed.version !== 'number' || !Number.isInteger(parsed.version) || parsed.version < 1 || !Array.isArray(parsed.profiles)) {
        return { kind: 'unreadable', text };
    }
    const profiles: ResearchProfile[] = [];
    const seen = new Set<string>();
    let dropped = false;
    for (const row of parsed.profiles) {
        const profile = readProfile(row);
        if (profile === null || seen.has(profile.id)) {
            dropped = true;
            continue;
        }
        seen.add(profile.id);
        profiles.push(profile);
    }
    const lastUsed = typeof parsed.lastUsed === 'string' && (seen.has(parsed.lastUsed) || templateOf(parsed.lastUsed)) ? parsed.lastUsed : null;
    return { kind: 'ok', data: { version: STORE_VERSION, profiles, lastUsed }, dropped, writable: parsed.version <= STORE_VERSION, text };
}

const EMPTY: ProfileStoreData = { version: STORE_VERSION, profiles: [], lastUsed: null };

// ---- names

const lower = (name: string) => name.toLowerCase();

/** The first of "X (copy)", "X (copy 2)", … that is free, the name of X cut so that the whole fits the longest name kept */
function freeCopyName(name: string, taken: ReadonlySet<string>): string {
    for (let n = 1; ; n++) {
        const suffix = n === 1 ? ' (copy)' : ` (copy ${n})`;
        const head = Array.from(name).slice(0, NAME_MAX_LENGTH - suffix.length).join('').trimEnd();
        const candidate = `${head}${suffix}`;
        if (!taken.has(lower(candidate))) return candidate;
    }
}

const takenNames = (data: ProfileStoreData, exceptId?: string): Set<string> => new Set([
    ...TEMPLATES.map(template => lower(template.name)),
    ...data.profiles.filter(profile => profile.id !== exceptId).map(profile => lower(profile.name)),
]);

function checkName(data: ProfileStoreData, input: string, exceptId?: string): { name: string } | { reason: Refusal } {
    const name = cleanName(input);
    if (name === null) return { reason: 'empty-name' };
    if (TEMPLATES.some(template => lower(template.name) === lower(name))) return { reason: 'template-name' };
    if (takenNames(data, exceptId).has(lower(name))) return { reason: 'name-in-use' };
    return { name };
}

// ---- the store

/**
 * Opens the store on `storage` (null: none, so the profiles live in this page only). Opening writes nothing. A change
 * reads the storage again first, so that it adds to what another tab wrote, then writes. Text that cannot be read is
 * copied to `<key>.backup` before the first write; a storage that throws leaves the profiles in memory, and `saved` says so.
 */
export function openProfileStore(storage: StorageLike | null, newId: () => string = () => crypto.randomUUID()): ProfileStore {
    let current: ProfileStoreData = EMPTY;
    let saved = true;
    let writable = true;
    let backupText: string | null = null;

    function readStorage(): Read {
        if (storage === null) return { kind: 'blocked' };
        let text: string | null;
        try {
            text = storage.getItem(PROFILES_KEY);
        } catch {
            return { kind: 'blocked' };
        }
        return text === null ? { kind: 'missing' } : parse(text);
    }

    function adopt(data: ProfileStoreData) {
        if (JSON.stringify(data) !== JSON.stringify(current)) current = data;
    }

    function load() {
        const read = readStorage();
        switch (read.kind) {
            case 'blocked':
                saved = false;
                break;
            case 'missing':
                adopt(EMPTY);
                saved = true;
                writable = true;
                break;
            case 'unreadable':
                // what is in memory stays; the text is kept before it is written over
                backupText = read.text;
                saved = true;
                writable = true;
                break;
            case 'ok':
                adopt(read.data);
                writable = read.writable;
                saved = read.writable;
                backupText = read.dropped ? read.text : null;
                break;
        }
    }

    function persist() {
        if (storage === null || !writable) {
            saved = false;
            return;
        }
        try {
            if (backupText !== null) {
                storage.setItem(`${PROFILES_KEY}${BACKUP_SUFFIX}`, backupText);
                backupText = null;
            }
            storage.setItem(PROFILES_KEY, JSON.stringify(current));
            saved = true;
        } catch {
            saved = false;
        }
    }

    /** `change` gives the new data and the profile it is about, or the reason it refuses */
    function edit(change: (data: ProfileStoreData) => { data: ProfileStoreData; profile: ResearchProfile } | Exclude<Outcome, { ok: true }>): Outcome {
        if (saved) load();
        const changed = change(current);
        if ('ok' in changed) return changed;
        current = changed.data;
        persist();
        return { ok: true, profile: changed.profile };
    }

    function ownProfile(data: ProfileStoreData, id: string): ResearchProfile | Exclude<Outcome, { ok: true }> {
        if (templateOf(id)) return { ok: false, reason: 'read-only' };
        return data.profiles.find(profile => profile.id === id) ?? { ok: false, reason: 'not-found' };
    }

    const replace = (data: ProfileStoreData, profile: ResearchProfile): ProfileStoreData => ({
        ...data, profiles: data.profiles.map(row => (row.id === profile.id ? profile : row)),
    });

    const entries = (): ProfileEntry[] => [
        ...TEMPLATES.map(template => ({ id: template.id, name: template.name, isTemplate: true, template: null, bonuses: template.bonuses })),
        ...current.profiles.map(profile => ({ id: profile.id, name: profile.name, isTemplate: false, template: profile.template, bonuses: profile.bonuses })),
    ];

    load();

    return {
        get saved() { return saved; },
        snapshot: () => current,
        entries,
        find: id => entries().find(entry => entry.id === id),
        reload: load,
        create(name, template) {
            return edit(data => {
                const checked = checkName(data, name);
                if ('reason' in checked) return { ok: false, reason: checked.reason };
                const profile: ResearchProfile = { id: newId(), name: checked.name, template, bonuses: cloneBonuses(templateOf(template)!.bonuses) };
                return { data: { ...data, profiles: [...data.profiles, profile] }, profile };
            });
        },
        copy(id) {
            return edit(data => {
                const source = ownProfile(data, id);
                if ('ok' in source) return source;
                const profile: ResearchProfile = {
                    id: newId(), name: freeCopyName(source.name, takenNames(data)), template: source.template, bonuses: cloneBonuses(source.bonuses),
                };
                return { data: { ...data, profiles: [...data.profiles, profile] }, profile };
            });
        },
        rename(id, name) {
            return edit(data => {
                const source = ownProfile(data, id);
                if ('ok' in source) return source;
                const checked = checkName(data, name, id);
                if ('reason' in checked) return { ok: false, reason: checked.reason };
                const profile = { ...source, name: checked.name };
                return { data: replace(data, profile), profile };
            });
        },
        remove(id) {
            return edit(data => {
                const source = ownProfile(data, id);
                if ('ok' in source) return source;
                return {
                    data: { ...data, profiles: data.profiles.filter(profile => profile.id !== id), lastUsed: data.lastUsed === id ? null : data.lastUsed },
                    profile: source,
                };
            });
        },
        revert(id) {
            return edit(data => {
                const source = ownProfile(data, id);
                if ('ok' in source) return source;
                const template = source.template === null ? undefined : templateOf(source.template);
                if (!template) return { ok: false, reason: 'no-template' };
                const profile = { ...source, bonuses: cloneBonuses(template.bonuses) };
                return { data: replace(data, profile), profile };
            });
        },
        setBonuses(id, bonuses) {
            return edit(data => {
                const source = ownProfile(data, id);
                if ('ok' in source) return source;
                const problem = checkBonuses(bonuses);
                if (problem) return { ok: false, reason: 'invalid', problem };
                const profile = { ...source, bonuses: cloneBonuses(bonuses) };
                return { data: replace(data, profile), profile };
            });
        },
        select(id) {
            if (saved) load();
            if (current.lastUsed === id || !(templateOf(id) || current.profiles.some(profile => profile.id === id))) return;
            current = { ...current, lastUsed: id };
            persist();
        },
    };
}
