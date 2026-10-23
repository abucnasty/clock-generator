import type { Config } from 'clock-generator/browser';
import type { InserterFormData } from './configForm/formData';
import { effectiveInserterStackSize } from './inserterMetadata';
import { usesAutomaticFilters, usesBlacklist } from './inserterFilters';

/** What a player calls a chest of each type in the paste preview, singular and plural */
const CHEST_KINDS: Record<string, [string, string]> = {
    'buffer-chest': ['chest', 'chests'],
    'infinity-chest': ['infinity chest', 'infinity chests'],
    car: ['car', 'cars'],
    tank: ['tank', 'tanks'],
    'cargo-wagon': ['cargo wagon', 'cargo wagons'],
    'rocket-silo': ['rocket silo', 'rocket silos'],
};

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** The name of one chest's type, "car"; a chest without a type (an older export) is a chest */
function chestKindName(type: string | undefined): string {
    return type !== undefined && own(CHEST_KINDS, type) ? CHEST_KINDS[type][0] : 'chest';
}

const withArticle = (name: string) => `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`;

/** The chests of an import by type, in the order they first appear: "1 car and 1 infinity chest" */
export function chestTypesText(chests: readonly { type?: string }[]): string {
    const counts = new Map<string, number>();
    for (const chest of chests) {
        const key = chest.type !== undefined && own(CHEST_KINDS, chest.type) ? chest.type : 'buffer-chest';
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return joinAnd([...counts].map(([type, count]) => `${count} ${CHEST_KINDS[type][count === 1 ? 0 : 1]}`));
}

/** "a", "a and b", "a, b and c" */
function joinAnd(parts: readonly string[]): string {
    return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Ids as a player counts them: runs of three or more as "1 to 4", the rest one by one: "1 and 4" */
export function idsText(ids: readonly number[]): string {
    const sorted = [...ids].sort((a, b) => a - b);
    const parts: string[] = [];
    for (let i = 0; i < sorted.length;) {
        let end = i;
        while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
        if (end - i >= 2) parts.push(`${sorted[i]} to ${sorted[end]}`);
        else for (let k = i; k <= end; k++) parts.push(String(sorted[k]));
        i = end + 1;
    }
    return joinAnd(parts);
}

interface DetailedInserter extends Pick<InserterFormData, 'prototype' | 'quality' | 'stack_size' | 'filters' | 'overrides'> {
    id?: number;
    filter_mode?: string;
}
type Labeler = (id: string) => string;

const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What one inserter is, as a player would say it: "Legendary stack inserter, 16 items at a time, no filter" */
function inserterDescription(inserter: DetailedInserter, itemLabel: Labeler, plural: boolean): string {
    const type = inserter.prototype ?? 'stack-inserter';
    const quality = (inserter.quality ?? 'legendary').replaceAll('-', ' ');
    const name = itemLabel(type).toLowerCase();
    const missing = [inserter.prototype === undefined && 'type', inserter.quality === undefined && 'quality'].filter(Boolean);
    const assumed = missing.length ? ` (${missing.join(' and ')} not in the export; assumed)` : '';
    const capacity = effectiveInserterStackSize(inserter);
    const capacityText = !Number.isFinite(capacity) ? 'capacity not known for this type'
        : `${capacity} items at a time${inserter.stack_size === undefined ? ' (assumes all inserter capacity research)' : ''}`;
    const filters = usesBlacklist(inserter) ? 'a blacklist, which is not supported'
        : usesAutomaticFilters(inserter.filters) ? 'no filter'
            : `${inserter.filters!.length === 1 ? 'filter' : 'filters'} ${inserter.filters!.map(itemLabel).join(', ')}`;
    const mode = inserter.overrides?.enable_control?.mode;
    const rule = mode !== undefined && mode !== 'AUTO' ? `, enable rule ${mode}` : '';
    return `${sentenceCase(quality)} ${name}${plural ? 's' : ''}${assumed}, ${capacityText}, ${filters}${rule}`;
}

/** The import details' inserter lines: inserters with the same settings together, "Inserters 1 to 4: ..." */
export function inserterDetailLines(inserters: readonly DetailedInserter[], itemLabel: Labeler): string[] {
    const groups = new Map<string, { ids: number[]; sample: DetailedInserter }>();
    inserters.forEach((inserter, index) => {
        const key = inserterDescription(inserter, itemLabel, false);
        const group = groups.get(key) ?? { ids: [], sample: inserter };
        group.ids.push(inserter.id ?? index + 1);
        groups.set(key, group);
    });
    return [...groups.values()].map(({ ids, sample }) =>
        `${ids.length === 1 ? 'Inserter' : 'Inserters'} ${idsText(ids)}: ${inserterDescription(sample, itemLabel, ids.length > 1)}.`);
}

/** The refusal the box gives for an export that holds several copies, what the conversion check answered */
interface UnavailableConversion {
    stage: 'proof' | 'check';
    reason: { code: string; message: string };
    repeatedGroups: number;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
const withoutPeriod = (text: string) => text.trim().replace(/\.$/, '');

/** Why the copies cannot be split, as the end of "They can't be split into copies yet ...": the clause, or null for the groups that only look alike */
function cannotSplitBecause(checked: UnavailableConversion, config: Config): string | null {
    const { code, message } = checked.reason;
    if (checked.stage === 'check') return `because one copy would not pass Check (${withoutPeriod(message)})`;
    if (code === 'nonuniform-units' || code === 'candidate-still-repeated') return null;
    const into = config.drills?.configs.find(drill => drill.target.type === 'chest');
    if (code === 'unsupported-boundary' && into) {
        const chest = config.chests?.find(row => row.id === into.target.id);
        return `because a drill drops into ${withArticle(chestKindName(chest?.type))}`;
    }
    return `because ${lowerFirst(withoutPeriod(message))}`;
}

/** The two paragraphs of the "Imported as one unit" box; the box shows only for an export of several copies */
export function importedAsOneUnitText(checked: UnavailableConversion, config: Config): { what: string; next: string } {
    const because = cannotSplitBecause(checked, config);
    return {
        what: because === null
            ? `This export holds ${checked.repeatedGroups} groups that look alike. We couldn't prove they are identical, so it comes in as one unit.`
            : `This export holds ${checked.repeatedGroups} identical copies of a build. They can't be split into copies yet ${because}, so it comes in as one unit.`,
        next: `Check will not run on it like this. Select one complete group in Factorio, export it again, and set Copies to ${checked.repeatedGroups}.`,
    };
}
