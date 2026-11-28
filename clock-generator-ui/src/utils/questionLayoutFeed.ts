import * as O from 'fp-ts/Option';
import type { ImportQuestion } from 'clock-generator/browser';
import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import type { PastedBlueprint } from '../worker/types';
import { createDefaultConfig } from './configForm/formData';
import { tileKey, type LaneEditorBelt, type LaneEditorLane } from './layoutLanes';
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

/** What the lanes read of a question */
export type FeedQuestion = Pick<ImportQuestion, 'key' | 'kind' | 'subject' | 'candidates'>;

/** The lanes of the lines of a pasted blueprint, for the layout view's lane editor */
interface QuestionLanes {
    /** By belt id of the lists of `questionLayoutFeed`, which is the place of the line */
    belts: ReadonlyMap<number, LaneEditorBelt>;
    /** The line, by its first piece, and the key of the question of a lane of a belt of the view; null for a belt that is none */
    keyOf(beltId: number, lane: number): { first: number; key: string } | null;
}

/** The tiles a piece covers: one at a whole tile's centre, and two across a tile's edge (a splitter, a loader) */
const tilesOf = (x: number, y: number): [number, number][] => {
    const around = (at: number) => Number.isInteger(at) ? [at - 0.5, at + 0.5] : [Math.floor(at) + 0.5];
    return around(x).flatMap(column => around(y).map((row): [number, number] => [column, row]));
};

/**
 * The lanes of each belt line that an inserter end reaches, as the layout view's lane editor reads them. Lane 1 of a line is
 * the left side of the way it runs, lane 2 the right. A lane is edited where the panel has shown its question and the
 * question is asked now or has an answer; the answer is its item then, else the item the import gives it. A lane that
 * has an item and no such question is fixed (the import filled it), and a lane with neither has no item and no control.
 */
export function questionLanes(pasted: FeedSource & Pick<PastedBlueprint, 'questions'>, shown: ReadonlyMap<string, FeedQuestion>, answers: Readonly<Record<string, string>>): QuestionLanes {
    const { lines, held_back } = pasted.layout;
    const asked = new Set(pasted.questions.map(question => question.key));
    const rowOf = (line: (typeof lines)[number]) => line.belt === null ? held_back.belts.find(belt => belt.id === line.place) : pasted.belts.find(belt => belt.id === line.belt);
    const keys = new Map<string, { first: number; key: string }>();
    const belts = new Map<number, LaneEditorBelt>();
    for (const line of lines) {
        if (line.pieces.length === 0) continue;
        const row = rowOf(line);
        const lanes = ([1, 2] as const).map((lane): LaneEditorLane => {
            const key = `lane-item:${line.first}:${lane}`;
            keys.set(`${line.place}:${lane}`, { first: line.first, key });
            const question = shown.get(key);
            const answer = answers[key];
            const edited = question !== undefined && (asked.has(key) || answer !== undefined);
            const at = line.lane_lines?.indexOf(lane) ?? -1;
            const given = at < 0 ? '' : (row?.lanes[at]?.ingredient ?? '');
            const item = edited && answer !== undefined ? answer : given;
            return { id: lane, side: lane === 1 ? 'left' : 'right', item: item === '' ? null : item, candidates: edited ? question.candidates : null };
        });
        const directions = new Map(line.pieces.flatMap(piece => tilesOf(piece.x, piece.y).map(([x, y]) => [tileKey(x, y), piece.direction] as const)));
        belts.set(line.place, { lanes, directions });
    }
    return { belts, keyOf: (beltId, lane) => keys.get(`${beltId}:${lane}`) ?? null };
}
