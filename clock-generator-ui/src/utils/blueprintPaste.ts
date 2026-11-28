import type { ImportEntity, ImportNote, ImportProblem, ImportQuestion, ImportSpeed, NoteCode, ResearchBonuses } from 'clock-generator/browser';
import { entityLabel } from './entityLabel';
import { formatNumberText } from './numberText';
import { inserterHand, laneStack } from './researchProfiles';
import type { PastePrompt } from './sidecarGuide';

/**
 * The words of the blueprint paste: its prompts, its questions, the notes on what the import read and what it did not,
 * and the steps that copy a blueprint in the game. In one place, so the copy changes together. An entity is named by its
 * row in the build and its icon, never by where it stands.
 */

/** A text whose first character that is not a space opens JSON: an export of the Sidecar mod or a build file. Anything else is read as a blueprint. */
export function isJsonText(text: string): boolean {
    const first = text.trimStart().charAt(0);
    return first === '{' || first === '[';
}

/** What the Paste from Factorio dialog says when the text gives no build, one line per reason */
export const BLUEPRINT_PROMPTS: Record<ImportProblem, PastePrompt> = {
    'not-a-blueprint': {
        severity: 'warning',
        text: 'Your clipboard does not hold a blueprint. Copy a blueprint of your build in Factorio as below, then paste it again.',
    },
    book: {
        severity: 'warning',
        text: 'That is a blueprint book. Open it in Factorio, copy one blueprint of it, and paste that one.',
    },
    planner: {
        severity: 'warning',
        text: 'That is a planner, not a blueprint. Copy a blueprint of your build in Factorio, then paste it again.',
    },
    'no-entities': {
        severity: 'warning',
        text: 'That blueprint is empty. Make a blueprint of one complete copy of your build, or of all its copies, then paste it again.',
    },
    'game-version': {
        severity: 'warning',
        text: 'That blueprint is from a game before Factorio 2.0. This site reads blueprints of Factorio 2.0 and later.',
    },
};

/** The blueprint was read, but the site could not use what it gave; never the engine's own words */
export const BLUEPRINT_FAILED_PROMPT: PastePrompt = {
    severity: 'error',
    text: 'The site could not read this blueprint. Copy it again from Factorio. If it keeps happening, report it with the blueprint.',
};

/** How to copy a blueprint in the game, for the Paste from Factorio dialog and the intro card */
export const BLUEPRINT_COPY_STEPS = [
    'In Factorio, make a blueprint of your build: one complete copy, or all its copies with their beacons.',
    'Open the blueprint and click Export to string. The game copies it as text.',
] as const;

/** The intro card's and the dialog's words for the blueprint way in */
export const BLUEPRINT_WAY_IN = {
    lead: 'Copy a blueprint of your build:',
    then: 'Then click Paste from Factorio here.',
    orSidecar: 'Or copy your build with the',
} as const;

// ---- the questions

/** The question's words, with the name of what it is about; a rate question names its item by `itemLabel`, and says "items" while the lane's item is asked */
export function questionText(question: ImportQuestion, itemLabel: (item: string) => string = item => item): string {
    switch (question.kind) {
        case 'drill-ore': return `${question.subject.label} mines`;
        case 'lane-item': return `${question.subject.label}, lane ${question.subject.lane} holds`;
        case 'lane-export': return `How many ${question.subject.item ? itemLabel(question.subject.item) : 'items'} a second leave ${question.subject.label}, lane ${question.subject.lane}?`;
        case 'lane-sharing': return `${question.subject.label}: do all copies use this belt?`;
    }
}

/** The two answers of a sharing question */
export const SHARING_ANSWER_TEXT: Record<'shared' | 'per_copy', string> = {
    shared: 'Yes, one belt for all copies',
    per_copy: 'No, each copy has its own',
};

export const ANOTHER_ITEM = 'Another item';
/** The mark of a lane row whose question is answered, and stays in the list while the dialog is open */
export const ANSWERED = 'Answered';
export const FOUND_IN_BLUEPRINT = 'Found in the blueprint';

// ---- what was read

/** "Read: 9 machines, 21 inserters, 5 belts, 50 beacons." The kinds as the import counts them; belts by line */
const READ_NAMES: Record<string, [string, string]> = {
    machine: ['machine', 'machines'],
    'rocket-silo': ['rocket silo', 'rocket silos'],
    drill: ['mining drill', 'mining drills'],
    inserter: ['inserter', 'inserters'],
    belt: ['belt', 'belts'],
    chest: ['chest', 'chests'],
    vehicle: ['car or wagon', 'cars and wagons'],
    beacon: ['beacon', 'beacons'],
};

const counted = (count: number, [one, many]: [string, string]) => `${count} ${count === 1 ? one : many}`;

export function readText(read: readonly { name: string; count: number }[]): string {
    return read.length === 0 ? 'Read: nothing.' : `Read: ${read.map(row => counted(row.count, READ_NAMES[row.name] ?? [row.name, row.name])).join(', ')}.`;
}

/** "Not read: 14 constant combinators, 6 medium electric poles." With the game's names; null when all was read */
export function notReadText(ignored: readonly { name: string; count: number }[], nameOf: (id: string) => string): string | null {
    return ignored.length === 0 ? null : `Not read: ${ignored.map(row => `${row.count} × ${nameOf(row.name)}`).join(', ')}.`;
}

// ---- the research numbers

/** "mining +79990 %, stack inserter 16, bulk inserter 12, inserter 4, belt stacks 4" */
export function numbersUsedText(bonuses: ResearchBonuses): string {
    const recipes = Object.keys(bonuses.recipes).length;
    return [
        `mining +${formatNumberText(bonuses.mining_drill_productivity_bonus)} %`,
        `stack inserter ${inserterHand('stack-inserter', bonuses)}`,
        `bulk inserter ${inserterHand('bulk-inserter', bonuses)}`,
        `inserter ${inserterHand('inserter', bonuses)}`,
        `belt stacks ${laneStack(bonuses)}`,
        ...(recipes > 0 ? [`${recipes} ${recipes === 1 ? 'recipe' : 'recipes'} with research productivity`] : []),
    ].join(', ');
}

// ---- the entities and their values

const LIST_KINDS = { machines: 'machine', drills: 'drill', inserters: 'inserter', belts: 'belt', chests: 'chest' } as const;

/** What the dialog names an entity by: its row in the build ("Inserter 7"), else its game name; "The build" for none */
export function entityName(entity: ImportEntity | undefined, nameOf: (id: string) => string): string {
    if (entity === undefined) return 'The build';
    return entity.row ? entityLabel(LIST_KINDS[entity.row.list], entity.row.id) : nameOf(entity.name);
}

/** "speed 199.75 (8 beacons, 4 modules)" */
export function speedText(speed: number, row: ImportSpeed | undefined, field: 'speed' | 'speed bonus' = 'speed'): string {
    const parts = row ? ` (${counted(row.beacons, ['beacon', 'beacons'])}, ${counted(row.modules, ['module', 'modules'])})` : '';
    return `${field} ${formatNumberText(speed)}${parts}`;
}

/** "productivity 300 % = base 50 + modules 0 + research 250, at most 300" */
export function productivityText(productivity: number, row: ImportSpeed | undefined): string {
    const total = `productivity ${formatNumberText(productivity)} %`;
    if (!row) return total;
    const { base, modules, research, cap } = row.productivity;
    const parts = `base ${formatNumberText(base)} + modules ${formatNumberText(modules)} + research ${formatNumberText(research)}`;
    return `${total} = ${parts}${cap === null ? '' : `, at most ${formatNumberText(cap)}`}`;
}

// ---- the notes

export const PLEASE_CHECK = 'please check';
export const NOTES_HEADING = 'Notes';

/** What a value rests on, for the notes of a value that has no read of the game or that the blueprint cannot show */
const FIELD_WORDS: Record<string, string> = {
    'inserter-ends': 'what its arm takes from and drops into',
    pickup: 'its pickup on the belt',
    'drop-line': 'the belt lane it drops onto',
    'belt-direction': 'the way the belt runs where it drops',
    'side-load-tiles': 'the belt tiles before a side load',
    'belt-type': 'its belt type',
    'lane-end': 'what is at the end of its lane',
    'flow-direction': 'the way its items flow',
    sharing: 'whether the copies share it',
    'copy-offset': 'the step from one copy to the next',
};

const NOTE_WORDS: Record<Exclude<NoteCode, `unread:${string}` | `default:${string}` | 'drop:side-loaded'>, string> = {
    'world:unknown-name': 'not read: the site has no data for it.',
    'world:bad-entity': 'not read: the blueprint gives it no place or direction the site can use.',
    'world:duplicate-number': 'not read: another entity of the blueprint has its number.',
    'world:no-size': 'not read: the site has no size for it.',
    'world:bad-direction': 'not read: its direction is not one the game uses.',
    'world:bad-type': 'not read: it is of a kind the site cannot place.',
    'world:no-reach': 'the site has no reach for this underground belt, so its other end is not found.',
    'world:off-grid': 'it is not on the tile grid. The site puts it on the nearest tiles.',
    'world:overlap': 'it stands on the tiles of another entity.',
    'geometry:no-vectors': 'the site has no data for where its arm takes and drops.',
    'geometry:bad-direction': 'its direction is not one the site can turn.',
    'geometry:no-box': 'the site has no size for it.',
    'geometry:bad-orientation': 'its direction on the rails is not one the site reads.',
    'flows:mirrored-recycler': 'a mirrored recycler: where each result goes is not checked in the game yet.',
    'flows:infinity-loader': 'a loader at an infinity chest: what it carries is not checked in the game yet.',
    'flows:drop-lane-outside-pin': 'a drop on a curve or an underground end: its lane is not checked in the game yet.',
    'circuit:recipe': 'a circuit sets its recipe. The site uses the recipe the blueprint holds.',
    'circuit:filters': 'a circuit sets its filters. The site uses the filters the blueprint holds.',
    'drill:no-target': 'left out: it drops into nothing the site reads.',
    'drill:two-targets': 'left out: it drops where two entities stand.',
    'drill:onto-belt': 'left out: it drops onto a belt, which the site does not take from a mining drill.',
    'drill:no-ore-item': 'left out: its ore gives no item.',
    'drill:no-data': 'left out: the site has no data for it.',
    'recycler:no-target': 'its results go into nothing the site reads.',
    'recycler:two-targets': 'its results go where two entities stand.',
    'recycler:no-data': 'the site has no data for where its results go.',
    'speeds:beacon-mix': 'beacons of different kinds reach it: its speed is not checked in the game yet.',
    'speeds:quality': 'a quality between normal and legendary: its value is not checked in the game yet.',
    'speeds:rounding-tie': 'its speed is on a rounding step: the last digit can differ from the game\'s.',
    'speeds:effect-limit': 'its effects reach a limit of the game: the value is not checked in the game yet.',
    'speeds:receiver-flags': 'its data says it takes no effect from modules or beacons: the value is not checked in the game yet.',
    'speeds:allowed-effects': 'a module gives an effect it does not take: the value is not checked in the game yet.',
    'speeds:module-request': 'the blueprint asks for modules it cannot hold as written.',
    'speeds:consumption-not-read': 'its energy use is not read from the game.',
    'speeds-problem:not-placed': 'its speed is not worked out: it is not placed.',
    'speeds-problem:no-data': 'its speed is not worked out: the site has no data for it.',
    'speeds-problem:beacon-not-square': 'a beacon that is not square: what it reaches is not worked out.',
    'speeds-problem:unknown-quality': 'its quality is not one the site knows.',
    'ids:crusher': 'a crusher: left out, as the site makes no clock for it.',
    'ids:splitter-drop': 'it drops onto a splitter: the site reads the drop as onto a belt.',
    'ids:splitter-or-loader-lane': 'a lane through a splitter or a loader: the site reads it as one belt lane.',
    'inserter-left-out:pickup': 'left out: it takes from nothing the site reads.',
    'inserter-left-out:drop': 'left out: it drops into nothing the site reads.',
    'inserter-left-out:throttle': 'left out: it takes from a belt into an infinity chest that removes every item. The site asks how many items a second leave that lane, and makes the lane an export at that rate.',
    'drill-left-out:no-ore': 'left out: its ore is not known.',
    'drill-left-out:target-has-no-id': 'left out: what it drops into is left out.',
    'ids-problem:bad-input': 'the site could not give it a number.',
    'ids-problem:bad-entry': 'the site could not give it a number.',
    'ids-problem:no-machine-data': 'the site has no data for this machine.',
    'pickup:bend': 'it picks up on a belt bend, which the clock generator does not take.',
    'pickup:splitter': 'it picks up from a splitter, which the clock generator does not take.',
    'pickup:unsupported': 'its pickup is of a kind the clock generator does not take.',
    'pickup:inline': 'it picks up in line with the belt, which the clock generator does not take.',
    'pickup:side-loaded': 'another belt side-loads onto its pickup tile, which the clock generator does not take.',
    'filter-no-item:filters': 'a filter with no item is left out.',
    'filter-no-item:inventory': 'a slot filter with no item is left out.',
    'filter-no-item:splitter': 'a filter with no item is left out.',
    'chest:no-slots': 'left out, with the inserters at it: its limit leaves it no slot.',
    'chest:throttle': 'left out: it removes every item, and only inserters the site leaves out drop into it.',
};

/** The words of a note, after the name of its entity */
export function noteText(note: Pick<ImportNote, 'code' | 'lane' | 'value'>): string {
    const lane = note.lane === undefined ? '' : ` (lane ${note.lane})`;
    if (note.code === 'drop:side-loaded') {
        return `it drops onto a ${note.value ?? '?'} tile belt buffer that side-loads onto another belt. Imported as an ordinary drop: where the other belt is busy, the game has less room than the clock generator assumes.`;
    }
    const based = /^(unread|default):(.+)$/.exec(note.code);
    if (based) {
        const field = FIELD_WORDS[based[2]] ?? based[2];
        return based[1] === 'unread'
            ? `${field}${lane}: worked out by a rule that is not checked in the game yet.`
            : `${field}${lane}: the blueprint cannot show it, so the site took the usual value.`;
    }
    return `${NOTE_WORDS[note.code as keyof typeof NOTE_WORDS]}${lane === '' ? '' : ` Lane ${note.lane}.`}`;
}

/** The notes the dialog groups in one line: the entities the site has no data for */
export const GROUPED_NOTE: NoteCode = 'world:unknown-name';
