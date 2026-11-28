/** The types of the import's one interface, and the codes of its questions and notes */
import type { BeltConfig, ChestConfig, InserterConfig, MachineConfiguration, MiningDrillConfig } from "../config/schema";
import type { ResearchBlock } from "../config/research-block";
import type { SuggestedTarget } from "../config/suggested-target";
import type { DecodeOutcome } from "./decode";

/** Why a pasted text gives no build */
export type ImportProblem = Extract<DecodeOutcome, { kind: "problem" }>["problem"];

/** The research put on the build: a profile's name, its template, and its final numbers (percent and items) */
export type ImportResearch = Pick<ResearchBlock, "profile" | "template" | "bonuses">;

export interface ImportInputs {
    research: ImportResearch;
    /** The answers so far, by question key; an answer to a key that is not asked is ignored */
    answers: Readonly<Record<string, string>>;
    /** The dialog's own setpoint fields: a drill's ore can settle through the item; the sharing of a belt is asked when copies is above 1 */
    setpoint?: { item?: string; copies?: number };
}

export type QuestionKind = "drill-ore" | "lane-item" | "lane-sharing";

export interface ImportQuestion {
    /** `drill-ore:<drill>`, `lane-item:<line>:<lane>`, `lane-sharing:<line>`: entity numbers of the blueprint, never an id */
    key: string;
    kind: QuestionKind;
    /**
     * The entity asked about and its lane. `label` names it by its place in a list that only the blueprint fixes, from 1:
     * "Drill 2" among the drills, "Belt 3" among the belt lines that inserters reach. It is never a config id.
     */
    subject: { label: string; entity_number: number; lane?: 1 | 2 };
    /** Sorted; for a sharing question the two ways */
    candidates: string[];
}

/** The answers of a sharing question */
export const SHARING_ANSWERS = ["shared", "per_copy"] as const;

/** The fields of the geometry whose value carries a basis, as a note names them */
export const GEOMETRY_NOTE_FIELDS = [
    "inserter-ends", "pickup", "drop-line", "belt-direction", "side-load-tiles", "belt-type", "lane-end", "flow-direction", "sharing", "copy-offset",
] as const;
export type GeometryNoteField = (typeof GEOMETRY_NOTE_FIELDS)[number];

/** Every code a note can have. The words are the dialog's. */
export const NOTE_CODES = [
    // the world's problems with an entity (a name with no data row is also counted in `ignored`)
    "world:unknown-name", "world:bad-entity", "world:duplicate-number", "world:no-size", "world:bad-direction", "world:bad-type", "world:no-reach", "world:off-grid", "world:overlap",
    // the geometry's problems, and its values with no game read (unread) or that the blueprint cannot show (default)
    "geometry:no-vectors", "geometry:bad-direction", "geometry:no-box", "geometry:bad-orientation",
    ...GEOMETRY_NOTE_FIELDS.map(field => `unread:${field}` as const),
    ...GEOMETRY_NOTE_FIELDS.map(field => `default:${field}` as const),
    // the flows: values with no game read, what a circuit sets, the drills and recyclers left out
    "flows:mirrored-recycler", "flows:infinity-loader", "flows:drop-lane-outside-pin",
    "circuit:recipe", "circuit:filters",
    "drill:no-target", "drill:two-targets", "drill:onto-belt", "drill:no-ore-item", "drill:no-data",
    "recycler:no-target", "recycler:two-targets", "recycler:no-data",
    // the speeds: values with no game read, and its problems
    "speeds:beacon-mix", "speeds:quality", "speeds:rounding-tie", "speeds:effect-limit", "speeds:receiver-flags", "speeds:allowed-effects",
    "speeds:module-request", "speeds:consumption-not-read",
    "speeds-problem:not-placed", "speeds-problem:no-data", "speeds-problem:beacon-not-square", "speeds-problem:unknown-quality",
    // the ids: where the import differs from the Sidecar's export, what is left out, and its problems
    "ids:crusher", "ids:splitter-drop", "ids:splitter-or-loader-lane",
    "inserter-left-out:pickup", "inserter-left-out:drop", "inserter-left-out:throttle", "drill-left-out:no-ore", "drill-left-out:target-has-no-id",
    "ids-problem:bad-input", "ids-problem:bad-entry", "ids-problem:no-machine-data",
    // the belt pickups the generator refuses, and the drops whose items side-load onto another belt
    "pickup:bend", "pickup:splitter", "pickup:unsupported", "pickup:inline", "pickup:side-loaded",
    "drop:side-loaded",
    // a filter row the blueprint holds with no item: an inserter's or a loader's filters, a wagon's or car's slots, a splitter's filter
    "filter-no-item:filters", "filter-no-item:inventory", "filter-no-item:splitter",
    // a chest whose limit leaves it no slot: it is left out, with the inserters at it; a voiding chest that only throttles drop into: left out with them
    "chest:no-slots", "chest:throttle",
] as const;
export type NoteCode = (typeof NOTE_CODES)[number];

/** The codes of a value that rests on no read of the game, or that the blueprint cannot show: the dialog marks them "please check" */
export function isPleaseCheck(code: NoteCode): boolean {
    return ["unread:", "default:", "flows:", "speeds:", "filter-no-item:"].some((prefix) => code.startsWith(prefix));
}

export interface ImportNote {
    code: NoteCode;
    /** The entity the note is about; 0 for the build as a whole */
    entity_number: number;
    lane?: 1 | 2;
    /** The field of a speeds note: crafting_speed, speed_bonus, productivity or energy_consumption_bonus */
    field?: string;
    /** A number the words show: the tiles of a side-loading drop */
    value?: number;
    please_check: boolean;
}

/** The kinds the import reads, as `read` counts them; belts are counted by physical line */
export const READ_KINDS = ["machine", "rocket-silo", "drill", "inserter", "belt", "chest", "vehicle", "beacon"] as const;
export type ReadKind = (typeof READ_KINDS)[number];

/** The belt piece an inserter drops onto, and the transport line it lands on (null where none is read) */
export type DropLane = { inserter: number; piece: number; line: number | null };
/** The point an inserter drops at, in the blueprint's own coordinates */
export type DropPosition = { inserter: number; x: number; y: number };
/** A belt line that inserters drop onto: its first piece and its pieces, by entity number */
export type OutputLine = { first: number; pieces: number[] };

/** A belt piece that an inserter end reaches, as the blueprint places it: `shape` is a belt's, null for the other pieces */
export type LayoutPiece = { entity_number: number; x: number; y: number; direction: number; shape: "straight" | "left" | "right" | null };
/**
 * A belt line with the number the questions call it by (`place`, from 1) and the belt id the configuration gives it, null
 * where it has none. `lane_lines` is the transport line of each entry of that belt's `lanes` (null where the lanes are not
 * by line); a line with no belt id has the two lines, 1 and 2. `pieces` are the pieces that an inserter end reaches.
 */
export type LayoutLine = { first: number; place: number; belt: number | null; lane_lines: (1 | 2)[] | null; pieces: LayoutPiece[] };
/** A drill with the number its question calls it by, and its id in the configuration (null where it has none) */
export type LayoutDrill = { entity_number: number; place: number; drill: number | null };
/**
 * An inserter of the lists, or one held back, with the first piece of the line at each of its belt ends (null at an end that
 * is not a belt). The id of a held-back inserter follows the largest id of the inserters of the lists.
 */
export type LayoutInserterLines = { entity_number: number; id: number; held_back: boolean; source_line: number | null; sink_line: number | null };
/**
 * Rows that the open questions keep out of the lists, in the configuration's own types and in the layout view's numbers: a
 * belt for each line with an open lane (its id is the line's place, an asked lane has no item), an inserter at such a line
 * (its belt ends are the places of their lines), and a drill whose ore is asked (its id is its place).
 */
export interface LayoutHeldBack {
    belts: BeltConfig[];
    inserters: InserterConfig[];
    drills: MiningDrillConfig[];
}

/** What the layout view can draw; nothing of it is written into the configuration */
export interface ImportLayout {
    /** By inserter */
    drop_lanes: DropLane[];
    /** By inserter */
    drop_positions: DropPosition[];
    /** By first piece */
    output_lines: OutputLine[];
    /** By first piece: every belt line */
    lines: LayoutLine[];
    /** By entity number */
    drills: LayoutDrill[];
    /** By id */
    inserter_lines: LayoutInserterLines[];
    held_back: LayoutHeldBack;
}

/** The lists of the configuration that an entity of the blueprint can be a row of */
export type ImportList = "machines" | "drills" | "inserters" | "belts" | "chests";

/** An entity of the blueprint by its number: its prototype, and the row of the lists it is, where it is one */
export interface ImportEntity {
    entity_number: number;
    name: string;
    /** Absent for an entity that is in no list: a beacon, a pole, an inserter left out. Each piece of a belt line names the belt. */
    row?: { list: ImportList; id: number };
}

/**
 * What a machine's, a drill's or a rocket silo's values are made of, for the dialog to show beside them. Productivity is in
 * percent: the prototype's own effect, what its modules and the beacons in reach give, and what the research gives; the
 * value written is their sum, held to `cap` (null for a drill, which has none).
 */
export interface ImportSpeed {
    list: "machines" | "drills" | "chests";
    id: number;
    /** The beacons in reach that count for it */
    beacons: number;
    /** The modules in its own slots */
    modules: number;
    productivity: { base: number; modules: number; research: number; cap: number | null };
}

export interface ImportBuild {
    kind: "build";
    /** The five lists, in the configuration's own types, each sorted by id */
    machines: MachineConfiguration[];
    drills: MiningDrillConfig[];
    inserters: InserterConfig[];
    belts: BeltConfig[];
    chests: ChestConfig[];
    /** The setpoint the machines suggest; null where they have no final product */
    suggested_target: SuggestedTarget | null;
    /** The step from one copy to the next, where the paste shows copies at one spacing */
    copy_offset: { x: number; y: number } | null;
    research: ResearchBlock;
    /** By kind, then entity number, then lane */
    questions: ImportQuestion[];
    /** By entity number, then code, then lane, then field */
    notes: ImportNote[];
    /** What the blueprint holds that the import reads, by kind in the order of `READ_KINDS`; no answer changes it */
    read: { name: ReadKind; count: number }[];
    /** The entities the import does not read, by prototype name */
    ignored: { name: string; count: number }[];
    layout: ImportLayout;
    /** Every entity of the blueprint, by entity number: what the notes and questions name it by */
    entities: ImportEntity[];
    /** By list (machines, drills, chests), then id */
    speeds: ImportSpeed[];
}

export type ImportOutcome = { kind: "problem"; problem: ImportProblem } | ImportBuild;
