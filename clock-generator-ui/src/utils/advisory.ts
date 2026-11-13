import type { MachinePrototypeIssue, UncalibratedBeltPickup } from 'clock-generator/browser';
import { entityLabel, nameInSentence } from './entityLabel';

/**
 * The advisories of the Build check, as the engine gives each kind: its data (the inserters and numbers), or its words with
 * the inserters or machines they are about. The site words each one: a line that says what it is and which entities, and
 * a window with the rest. Nothing on the line is said again in the window.
 */

/** A drop the Sidecar marked as side-loading: the inserter, and the belt tiles from its drop to the belt it side-loads onto */
export interface SideLoadedDropFact {
    inserter_id: number;
    tiles: number;
}

export type Advisory =
    | { kind: 'side-loaded-drop'; drops: readonly SideLoadedDropFact[] }
    | { kind: 'pickup-not-tested'; pickups: readonly UncalibratedBeltPickup[] }
    /** The engine's words, whole: they say what and what to do in one sentence for each lane */
    | { kind: 'lanes-shared-by-copies'; inserters: readonly number[]; text: string }
    | { kind: 'lanes-exactly-full'; inserters: readonly number[]; text: string }
    | { kind: 'copy-gap-needed'; text: string }
    /** The engine's words for each machine with one kind of prototype warning */
    | { kind: 'machine-prototype'; problem: MachinePrototypeIssue['kind']; machines: readonly { machine_id: number; message: string }[] };

/** Every string of the advisories, in one place for the glossary and for review */
export const ADVISORY_COPY = {
    details: 'Details',
    /** What the mark before a line says to a screen reader, by the issue's severity */
    marks: { warning: 'Advisory, does not block generation', info: 'Note, does not block generation' },
    lines: {
        'side-loaded-drop': 'Drops onto a belt that side-loads',
        'pickup-not-tested': 'Belt pickup not tested',
        'lanes-shared-by-copies': 'Copies drop more than a shared lane carries',
        'lanes-exactly-full': 'Lanes exactly full',
        'copy-gap-needed': 'Copies may drop onto the same belt',
        'recipe-not-made': "Machine can't craft its recipe",
        'unknown-prototype': 'Not a crafting machine of the game data',
    },
    chips: { inserters: 'Inserters', machines: 'Machines' },
    labels: { why: 'Why', cost: 'What it can cost', fix: 'What to do' },
    sideLoadedDrop: {
        tiles: (tiles: number) => `${tiles} ${tiles === 1 ? 'tile' : 'tiles'}`,
        otherBelt: 'Other belt',
        others: 'Other drops',
        /** The drawing's text alternative */
        drawing: (inserters: number[], tiles: number) => `${inserters.length === 1 ? 'Inserter' : 'Inserters'} ${listed(inserters)} `
            + `${inserters.length === 1 ? 'drops' : 'drop'} onto a belt of ${ADVISORY_COPY.sideLoadedDrop.tiles(tiles)} that side-loads onto another belt. `
            + 'Other inserters drop onto the other belt further on.',
        why: 'The simulator counts only the room on the short belt. In the game, the side-load waits for gaps in the other belt.',
        cost: 'The clock may make less in the game than shown here. It is worst when these inserters are switched on at the same time as others that drop onto the other belt.',
        fix: 'Give each drop a belt of its own, or check the clock in the game.',
    },
    pickupNotTested: {
        why: 'Belt pickup timing is calibrated with 16-item hands on 4-item belt stacks only. At other belt stack sizes and hand sizes it has not been compared with the game.',
        cost: 'The clock may not match the game.',
    },
};

/** "11", "11 and 12", "11, 12 and 13" */
function listed(ids: readonly number[]): string {
    return ids.length < 2 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
}

const inOrder = (ids: readonly number[]) => [...new Set(ids)].sort((a, b) => a - b);

/** The line of an advisory: what it is, at a glance */
export function advisoryLine(advisory: Advisory): string {
    return ADVISORY_COPY.lines[advisory.kind === 'machine-prototype' ? advisory.problem : advisory.kind];
}

/** The inserters an advisory is about, each once, in order: its chips */
export function advisoryInserters(advisory: Advisory): number[] {
    switch (advisory.kind) {
        case 'side-loaded-drop': return inOrder(advisory.drops.map(drop => drop.inserter_id));
        case 'pickup-not-tested': return inOrder(advisory.pickups.map(pickup => pickup.inserter_id));
        case 'lanes-shared-by-copies':
        case 'lanes-exactly-full': return inOrder(advisory.inserters);
        default: return [];
    }
}

/** The machines an advisory is about, each once, in order: its chips */
export function advisoryMachines(advisory: Advisory): number[] {
    return advisory.kind === 'machine-prototype' ? inOrder(advisory.machines.map(machine => machine.machine_id)) : [];
}

/** The drops of a side-loaded drop advisory grouped by the tiles to the side-load: one drawing for each length */
export function dropsByTiles(drops: readonly SideLoadedDropFact[]): { tiles: number; inserters: number[] }[] {
    const groups = new Map<number, number[]>();
    for (const drop of drops) groups.set(drop.tiles, [...(groups.get(drop.tiles) ?? []), drop.inserter_id]);
    return [...groups.entries()].sort(([a], [b]) => a - b).map(([tiles, inserters]) => ({ tiles, inserters: inOrder(inserters) }));
}

/** The inserters' numbers in the drawing, six to a line, so that a long list stays inside it */
export function idLines(ids: readonly number[], perLine = 6): string[] {
    const lines: string[] = [];
    for (let start = 0; start < ids.length; start += perLine) {
        const end = start + perLine;
        lines.push(`${ids.slice(start, end).join(', ')}${end < ids.length ? ',' : ''}`);
    }
    return lines;
}

const article = (count: number) => /^(8|1[18]$)/.test(String(count)) ? 'an' : 'a';

/** "Inserter 3 picks up iron plate from belt 2 in 2-item belt stacks with a 12-item hand.", as the log says it */
export function pickupFact(pickup: UncalibratedBeltPickup, itemLabel: (id: string) => string): string {
    const item = nameInSentence(itemLabel(pickup.item));
    const sizes = pickup.lane_stack_sizes;
    const stacks = sizes.length === 0 ? ''
        : ` in ${sizes.slice(0, -1).map(size => `${size}-`).join(', ')}${sizes.length > 1 ? ' and ' : ''}${sizes[sizes.length - 1]}-item belt stacks`;
    const hand = pickup.hand_size === null ? ''
        : ` with ${article(pickup.hand_size)} ${pickup.hand_size}-item hand${pickup.item_stack_size === null ? '' : ` (${item} stacks to ${pickup.item_stack_size})`}`;
    return `${entityLabel('inserter', pickup.inserter_id)} picks up ${item} from ${entityLabel('belt', pickup.belt_id).toLowerCase()}${stacks}${hand}.`;
}
