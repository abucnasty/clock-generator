import * as O from 'fp-ts/Option';
import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import type { PastedBlueprint } from '../worker/types';
import { createDefaultConfig } from './configForm/formData';
import { applyPaste } from './pastePreview';

/** The five lists that the layout view draws */
interface LayoutFeed {
    machines: MachineFormData[];
    inserters: InserterFormData[];
    belts: BeltFormData[];
    chests: ChestFormData[];
    drills: DrillFormData[];
}

/** What the feed reads of a pasted blueprint */
export type FeedSource = Pick<PastedBlueprint, 'machines' | 'drills' | 'inserters' | 'belts' | 'chests' | 'layout'>;

const EVERY_LIST = { machines: true, drills: true, inserters: true, belts: true, chests: true, target: false } as const;

/**
 * The lists the layout view is given while a pasted blueprint is asked about. They share one numbering, the one the questions
 * use: a belt is its line's place and a drill is its drill's place, so a belt that a question names is the belt that is drawn.
 * Each line has a belt row of its own (a belt of the lists that spans lines is copied for each), the inserters' belt ends are
 * on the place of their line, and the rows that the open questions keep out of the lists come in as they are. The lists are
 * made on an empty form, never on the open build, so no row of the open build is drawn. They go to the view only.
 */
export function questionLayoutFeed(pasted: FeedSource): LayoutFeed {
    const { lines, drills: drillPlaces, inserter_lines, held_back } = pasted.layout;
    const placeOfLine = new Map(lines.map(line => [line.first, line.place]));
    const beltById = new Map(pasted.belts.map(belt => [belt.id, belt]));
    const belts = lines.flatMap(line => {
        const row = line.belt === null ? undefined : beltById.get(line.belt);
        return row === undefined ? [] : [{ ...row, id: line.place }];
    });
    const placeOfDrill = new Map(drillPlaces.flatMap(drill => drill.drill === null ? [] : [[drill.drill, drill.place] as const]));
    const linesOfInserter = new Map(inserter_lines.filter(row => !row.held_back).map(row => [row.id, row]));
    const inserters = pasted.inserters.map(inserter => {
        const row = linesOfInserter.get(inserter.id ?? 0);
        const pointed = <End extends { type: string; id: number }>(end: End, first: number | null | undefined): End => {
            const place = first === null || first === undefined ? undefined : placeOfLine.get(first);
            return end.type === 'belt' && place !== undefined ? { ...end, id: place } : end;
        };
        return { ...inserter, source: pointed(inserter.source, row?.source_line), sink: pointed(inserter.sink, row?.sink_line) };
    });
    const emptyForm = { ...createDefaultConfig(), machines: [] };
    const made = applyPaste(emptyForm, {
        machines: pasted.machines,
        drills: pasted.drills.map(drill => ({ ...drill, id: placeOfDrill.get(drill.id) ?? drill.id })).concat(held_back.drills),
        inserters: [...inserters, ...held_back.inserters],
        belts: [...belts, ...held_back.belts],
        chests: pasted.chests,
        guidance: O.none,
        suggested_target: O.none,
    }, EVERY_LIST);
    return { machines: made.machines, inserters: made.inserters, belts: made.belts, chests: made.chests, drills: made.drills?.configs ?? [] };
}
