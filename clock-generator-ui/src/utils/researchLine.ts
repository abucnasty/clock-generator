import type { ResearchChoice, ResearchEdit, ResearchOutside } from 'clock-generator/browser';
import type { StorageLike } from './buildLibrary';
import { entityLabel } from './entityLabel';
import { formatNumberText } from './numberText';
import type { openProfileStore, TemplateId } from './researchProfiles';

/** The page's localStorage, reached only inside the calls: in some browsers merely reading `localStorage` throws */
export const pageStorage: StorageLike = {
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: key => window.localStorage.removeItem(key),
    key: i => window.localStorage.key(i),
    get length() {
        return window.localStorage.length;
    },
};

type ProfileEntry = NonNullable<ReturnType<ReturnType<typeof openProfileStore>['find']>>;

/** What the engine is given of a stored profile or a template: its name, the template it came from and its numbers */
export function researchChoiceOf(entry: ProfileEntry): ResearchChoice {
    return { profile: entry.name, template: entry.isTemplate ? entry.id as TemplateId : entry.template, bonuses: entry.bonuses };
}

export const RESEARCH_LINE = {
    label: 'Research',
    notRecorded: 'Research numbers not recorded: this build was not made from a blueprint.',
    numbersUsed: 'numbers used:',
    edited: (count: number) => `${count} ${count === 1 ? 'value' : 'values'} changed by hand:`,
    outside: 'Not from the blueprint:',
    outsideNote: '(a profile does not change them)',
    notStored: (name: string) => `"${name}" is not one of your profiles.`,
    questionTitle: 'Change the research profile',
    question: (count: number, name: string) => `${count} ${count === 1 ? 'value was' : 'values were'} changed by hand. The profile "${name}" gives:`,
    cancel: 'Cancel',
    keepMine: 'Keep mine',
    useProfile: "Use the profile's",
    undo: (name: string) => `Research profile set to "${name}".`,
} as const;

const EDIT_KINDS = { machine: 'machine', drill: 'drill', silo: 'chest', inserter: 'inserter', lane: 'belt' } as const;
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** "machine 3 productivity 250 %", "inserter 7 hand 8", "belt 2 lane 1 stack 4" */
export function editText(edit: Pick<ResearchEdit, 'kind' | 'id' | 'lane'>, value: number): string {
    const who = lower(entityLabel(EDIT_KINDS[edit.kind], edit.id));
    if (edit.kind === 'inserter') return `${who} hand ${formatNumberText(value)}`;
    if (edit.kind === 'lane') return `${who} lane ${edit.lane} stack ${formatNumberText(value)}`;
    return `${who} productivity ${formatNumberText(value)} %`;
}

/** What the user had: "250 %", or a hand or stack with no unit */
export function yoursText(edit: Pick<ResearchEdit, 'kind' | 'actual'>): string {
    return `(yours ${formatNumberText(edit.actual)}${edit.kind === 'inserter' || edit.kind === 'lane' ? '' : ' %'})`;
}

const OUTSIDE_KINDS = { machine: 'machine', drill: 'drill', silo: 'chest', inserter: 'inserter', belt: 'belt' } as const;

/** "machine 10", or an inserter with no number */
export function outsideText(row: ResearchOutside): string {
    return row.id === undefined ? `an ${row.kind} with no number` : lower(entityLabel(OUTSIDE_KINDS[row.kind], row.id));
}
