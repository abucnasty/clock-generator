/**
 * The pure parts of the tests that take a sample's blueprint as a paste, make a configuration of what the import gives,
 * generate its clocks and hold the selected clock to the record of the sample. This file reads no file and takes no path:
 * the test files read the blueprint, the answering file, the sample and the record, and pass them in.
 */
import type { FactorioData } from "../../data/factorio-data-types";
import type { SetpointRate } from "../../config/setpoint-rate";
import { withConfigFormat } from "../../config/format";
import { parseConfig } from "../../config/loader";
import { clockIdentity } from "../../crafting/clock-identity";
import { generateClockAlternatives } from "../../crafting/generate-blueprint";
import { createHash } from "crypto";
import { geometryDataOf, worldDataOf } from "../assemble";
import { decodeBlueprint } from "../decode";
import { geometryOf } from "../geometry";
import { importBlueprint, type ImportBuild, type ImportInputs, type ImportOutcome } from "../index";
import { worldOf } from "../world";

export type Point = { x: number; y: number };
export type Raw = Record<string, unknown>;

// ---------------------------------------------------------------- the shapes of an answering file

export type End = { type: string; id: number } & Raw;
export type ReadLane = { ingredient?: string; stack_size?: number; lane_end?: { kind: string }; sharing?: string };
export type ReadBelt = { id: number; type?: string; flow_direction?: number; lanes?: ReadLane[] };
/** A file that holds a build as the game wrote it (an export, a capture, a description) or as a person did (a configuration) */
export type ReadFile = {
    machines?: (Raw & { id: number; position?: Point; prototype?: string; result_target?: End })[];
    drills?: { configs?: (Raw & { id: number; position?: Point; type?: string; mined_item_name?: string; target?: End })[] };
    inserters?: (Raw & { id?: number; position?: Point; prototype?: string; source: End; sink: End })[];
    belts?: ReadBelt[];
    chests?: (Raw & { id: number; type: string; position?: Point })[];
};

/** The drills of a file: a file with none holds an empty record where the list would be */
export const drillsOf = (file: ReadFile) => (Array.isArray(file.drills?.configs) ? file.drills!.configs! : []);

/** True where a position of the file, less the translation of the frame, is the blueprint's position */
export const samePoint = (a: Point | undefined, b: Point | undefined, translation: Point) =>
    a !== undefined && b !== undefined && a.x - translation.x === b.x && a.y - translation.y === b.y;

// ---------------------------------------------------------------- the answers

export type Asked = { key: string; label: string; candidates: string[]; answer: string | undefined };
export type Settled = {
    /** The import before any answer */
    first: ImportBuild;
    /** The import with every answer that the file gave */
    outcome: ImportBuild;
    answers: Record<string, string>;
    asked: Asked[];
    /** The keys of the questions that the file gave no answer to */
    unanswered: string[];
};

export type SettleInput = {
    name: string;
    text: string;
    data: FactorioData;
    /** The file whose values answer the questions */
    source: ReadFile;
    /** Where the frame lays the blueprint on the file: file = blueprint + translation */
    translation: Point;
    research: ImportInputs["research"];
    /** The setpoint the import is called with: a drill's ore can settle through the item, and copies above 1 ask for a sharing */
    setpoint: { item?: string; copies?: number };
};

function buildOf(outcome: ImportOutcome, what: string): ImportBuild {
    if (outcome.kind !== "build") throw new Error(`${what}: the problem ${outcome.problem}`);
    return outcome;
}

/**
 * The answers that the file gives, asked again until no question is open. A drill's ore is the ore of the drill at the same
 * place, a lane's item is the item of that lane of the belt that an inserter's end reaches, and the sharing of a line is
 * the first sharing that one of the belt's lanes states, else shared.
 */
export function settleAnswers(input: SettleInput): Settled {
    const { name, text, data, source, translation: t } = input;
    const decoded = decodeBlueprint(text);
    if (decoded.kind !== "blueprint") throw new Error(`${name}: not a blueprint`);
    const entities = decoded.entities;
    const world = worldOf(entities, worldDataOf(data));
    const geometry = geometryOf(world, entities, geometryDataOf(data));
    const at = (n: number) => entities.find((e) => e.entity_number === n)?.position;

    /** The belt of the answering file at a line: through an inserter whose end is on one of its pieces */
    const beltAtLine = (first: number): ReadBelt | undefined => {
        const line = geometry.lines.find((l) => l.first === first);
        for (const end of [...geometry.ends].sort((a, b) => a.inserter - b.inserter)) {
            for (const side of ["source", "sink"] as const) {
                const e = end[side];
                if (!e || e.target !== "belt" || !line?.pieces.includes(e.entity_number)) continue;
                const arm = source.inserters?.find((r) => samePoint(r.position, at(end.inserter), t));
                const readEnd = arm?.[side];
                if (readEnd?.type === "belt") return source.belts?.find((b) => b.id === readEnd.id);
            }
        }
        return undefined;
    };
    const answerOf = (q: ImportBuild["questions"][number]): string | undefined => {
        if (q.kind === "drill-ore") return drillsOf(source).find((d) => samePoint(d.position, at(q.subject.entity_number), t))?.mined_item_name;
        const belt = beltAtLine(q.subject.entity_number);
        if (q.kind === "lane-item") {
            const lanes = belt?.lanes ?? [];
            if (lanes.length === 2) return lanes[(q.subject.lane as number) - 1].ingredient;
            return lanes.length === 1 && q.subject.lane === 2 ? lanes[0].ingredient : undefined;
        }
        // a lane that states no sharing is shared, as is a line the file holds no belt for
        return (belt?.lanes ?? []).find((l) => l.sharing !== undefined)?.sharing ?? "shared";
    };

    const inputsOf = (answers: Record<string, string>): ImportInputs => ({ research: input.research, answers, setpoint: input.setpoint });
    const answers: Record<string, string> = {};
    const asked: Asked[] = [];
    const unanswered = new Set<string>();
    const first = buildOf(importBlueprint(text, inputsOf({}), data), name);
    let outcome = first;
    for (let round = 0; round < 12; round += 1) {
        const fresh = outcome.questions.filter((q) => answers[q.key] === undefined && !unanswered.has(q.key));
        if (fresh.length === 0) return { first, outcome, answers, asked, unanswered: [...unanswered] };
        for (const q of fresh) {
            const answer = answerOf(q);
            asked.push({ key: q.key, label: q.subject.label + (q.subject.lane ? ` lane ${q.subject.lane}` : ""), candidates: q.candidates, answer });
            if (answer === undefined) unanswered.add(q.key);
            else answers[q.key] = answer;
        }
        outcome = buildOf(importBlueprint(text, inputsOf(answers), data), name);
    }
    throw new Error(`${name}: the answers did not settle`);
}

// ---------------------------------------------------------------- the setpoint and the configuration

/** What the sample's setpoint gives: its item, what it counts, its copies and its rate for all copies */
export type SampleSetpoint = { item: string; counts?: "made" | "destroyed"; copies: number; items_per_second: SetpointRate };

export type PasteSetpoint = { item: string; counts?: "made" | "destroyed"; copies: number; items_per_second: SetpointRate; copy_offset?: Point };

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** A positive number of at most 6 decimals as a numerator and a denominator */
function fractionOf(value: number): [number, number] {
    for (let digits = 0; digits <= 6; digits += 1) {
        const scaled = Math.round(value * 10 ** digits);
        if (Math.abs(scaled / 10 ** digits - value) < 1e-12) return [scaled, 10 ** digits];
    }
    throw new Error(`${value} is not a short decimal`);
}

/**
 * How many units of the sample the blueprint holds: the import's machines over the sample's, or null where that is not a
 * whole number
 */
export function unitsOf(importMachines: number, sampleMachines: number): number | null {
    if (sampleMachines === 0 || importMachines % sampleMachines !== 0) return null;
    return importMachines / sampleMachines;
}

/**
 * The setpoint of the paste: with one unit of the sample in the blueprint, the sample's copies and rate; with k units, one
 * copy and the rate of the k units (the sample's rate times k over its copies), reduced where it is not whole
 */
export function pasteSetpointOf(sample: SampleSetpoint, units: number): PasteSetpoint {
    const counts = sample.counts === undefined ? {} : { counts: sample.counts };
    if (units === 1) return { item: sample.item, ...counts, copies: sample.copies, items_per_second: sample.items_per_second };
    const rate: [number, number] = typeof sample.items_per_second === "number" ? fractionOf(sample.items_per_second) : [sample.items_per_second.numerator, sample.items_per_second.denominator];
    const copies = fractionOf(sample.copies);
    let numerator = rate[0] * units * copies[1];
    let denominator = rate[1] * copies[0];
    const divisor = gcd(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
    return { item: sample.item, ...counts, copies: 1, items_per_second: denominator === 1 ? numerator : { numerator, denominator } };
}

/** The configuration of a paste: the setpoint, the import's five lists and its research block, as the paste writes them */
export function pasteConfigOf(build: ImportBuild, setpoint: PasteSetpoint): Raw {
    return withConfigFormat({
        setpoint: { ...setpoint, ...(build.copy_offset !== null && { copy_offset: { ...build.copy_offset } }) },
        machines: build.machines,
        drills: { configs: build.drills },
        inserters: build.inserters,
        belts: build.belts,
        chests: build.chests,
        research: build.research,
    });
}

// ---------------------------------------------------------------- the pairing with the sample

type Row = Raw & { id?: number; position?: Point; prototype?: string; type?: string; source?: End; sink?: End };
export const KINDS = ["machine", "drill", "inserter", "chest"] as const;
export type Kind = (typeof KINDS)[number];

/** The rows of a file or of a configuration, by kind. An inserter that states no id has its 1-based place. */
function rowsOf(file: ReadFile): Record<Kind, Row[]> {
    return {
        machine: (file.machines ?? []) as Row[],
        drill: drillsOf(file) as Row[],
        inserter: (file.inserters ?? []).map((row, index) => ({ ...row, id: row.id ?? index + 1 })) as Row[],
        chest: (file.chests ?? []) as Row[],
    };
}

/** The prototype that makes a row the same kind of thing as another: a machine's and an inserter's prototype, a drill's and a chest's type */
const typeOf = (kind: Kind, row: Row): string | undefined => (kind === "machine" || kind === "inserter" ? row.prototype : row.type);

const endText = (end: End | undefined) => (end === undefined ? "none" : `${end.type} ${end.id}`);

export type PairFailure = { kind: Kind; id: number | null; step: 1 | 2; reason: string };

export type Pairing = {
    /** True where every entity pairs, one to one, in both steps */
    comparable: boolean;
    failures: PairFailure[];
    /** From an import id to the sample's id, by kind, for the entities that paired in both steps */
    ids: Record<Kind, Map<number, number>>;
    /** The number of entities by kind that paired in both steps */
    paired: Record<Kind, number>;
    /** The import entities that the caller named as outside the build and that the positioned file does not hold, by kind */
    leftOut: Record<Kind, number[]>;
};

/** The ids of the import's entities that stand outside the compared build (a supply or a sink of the scaffold), by kind */
export type LeftOut = Partial<Record<Kind, number[]>>;

/**
 * Pairs the import's machines, drills, inserters and chests with a sample's, in two steps. Step 1: each import entity with
 * the entity of the positioned file that stands at its place under the frame, one to one. Step 2: each such entity with the
 * sample's of the same id, the same type and, for an inserter, the same ends (type and id of source and sink). An import
 * entity that the caller lists in `leftOut` must have no entity of the positioned file at its place: it is then left out of the
 * pairing; a listed entity that the file holds, or that the import does not make, fails.
 */
export function pairWithSample(build: ImportBuild, translation: Point, positioned: ReadFile, sample: ReadFile, leftOut: LeftOut = {}): Pairing {
    const imported: Record<Kind, Row[]> = {
        machine: build.machines as unknown as Row[],
        drill: build.drills as unknown as Row[],
        inserter: build.inserters as unknown as Row[],
        chest: build.chests as unknown as Row[],
    };
    const file = rowsOf(positioned);
    const mine = rowsOf(sample);
    const failures: PairFailure[] = [];
    const ids = { machine: new Map<number, number>(), drill: new Map<number, number>(), inserter: new Map<number, number>(), chest: new Map<number, number>() };
    const paired = { machine: 0, drill: 0, inserter: 0, chest: 0 };
    const outside: Record<Kind, number[]> = { machine: [], drill: [], inserter: [], chest: [] };
    for (const kind of KINDS) {
        const taken = new Set<Row>();
        const onFile = new Map<Row, Row>();
        const listed = leftOut[kind] ?? [];
        for (const id of listed) if (!imported[kind].some((r) => r.id === id)) failures.push({ kind, id, step: 1, reason: "listed as left out, but the import makes no entity of this id" });
        for (const row of imported[kind]) {
            const found = file[kind].find((r) => samePoint(r.position, row.position, translation));
            const isListed = listed.includes(row.id as number);
            if (isListed && found !== undefined) failures.push({ kind, id: row.id as number, step: 1, reason: "listed as left out, but the positioned file holds an entity at its place" });
            else if (isListed) outside[kind].push(row.id as number);
            else if (found === undefined) failures.push({ kind, id: (row.id as number | undefined) ?? null, step: 1, reason: "no entity of the positioned file at its place" });
            else if (taken.has(found)) failures.push({ kind, id: (row.id as number | undefined) ?? null, step: 1, reason: "the entity of the positioned file at its place is paired already" });
            else {
                taken.add(found);
                onFile.set(row, found);
            }
        }
        for (const r of file[kind]) if (!taken.has(r)) failures.push({ kind, id: (r.id as number | undefined) ?? null, step: 1, reason: r.position === undefined ? "the positioned file gives no position" : "no import entity at its place" });
        const used = new Set<Row>();
        for (const [row, found] of onFile) {
            const other = mine[kind].find((s) => s.id === found.id);
            const id = (found.id as number | undefined) ?? null;
            if (other === undefined) failures.push({ kind, id, step: 2, reason: "the sample has no entity of this id" });
            else if (used.has(other)) failures.push({ kind, id, step: 2, reason: "the sample's entity of this id is paired already" });
            else if (typeOf(kind, found) !== typeOf(kind, other)) failures.push({ kind, id, step: 2, reason: `type ${typeOf(kind, found)} against the sample's ${typeOf(kind, other)}` });
            else if (kind === "inserter" && (endText(found.source) !== endText(other.source) || endText(found.sink) !== endText(other.sink))) {
                failures.push({ kind, id, step: 2, reason: `ends ${endText(found.source)} to ${endText(found.sink)} against the sample's ${endText(other.source)} to ${endText(other.sink)}` });
            } else {
                used.add(other);
                ids[kind].set(row.id as number, other.id as number);
                paired[kind] += 1;
            }
        }
        for (const s of mine[kind]) if (!used.has(s) && !failures.some((f) => f.kind === kind && f.step === 2 && f.id === s.id)) failures.push({ kind, id: (s.id as number | undefined) ?? null, step: 2, reason: "no entity of the positioned file of this id" });
    }
    return { comparable: failures.length === 0, failures, ids, paired, leftOut: outside };
}

/** From an import id to the sample's id, by kind, as a file states it (JSON keys are text) */
export type IdMap = Partial<Record<Kind, Record<string, number>>>;

/**
 * Pairs the import's entities with a sample's by an id map that the caller states, where the sample's ids are not the file's
 * (a sample whose ids are its author's own order). Every import entity that is not listed in `leftOut` must be in the map, to one
 * sample entity, one to one; a sample entity of no pair, a listed id the import does not make, and a type that the sample states
 * and the import does not share, fail. The ends of an inserter are not read: the map is the caller's statement.
 */
export function pairByIdMap(build: ImportBuild, sample: ReadFile, idMap: IdMap, leftOut: LeftOut = {}): Pairing {
    const imported: Record<Kind, Row[]> = {
        machine: build.machines as unknown as Row[],
        drill: build.drills as unknown as Row[],
        inserter: build.inserters as unknown as Row[],
        chest: build.chests as unknown as Row[],
    };
    const mine = rowsOf(sample);
    const failures: PairFailure[] = [];
    const ids = { machine: new Map<number, number>(), drill: new Map<number, number>(), inserter: new Map<number, number>(), chest: new Map<number, number>() };
    const paired = { machine: 0, drill: 0, inserter: 0, chest: 0 };
    const outside: Record<Kind, number[]> = { machine: [], drill: [], inserter: [], chest: [] };
    for (const kind of KINDS) {
        const listed = leftOut[kind] ?? [];
        const map = idMap[kind] ?? {};
        for (const id of listed) if (!imported[kind].some((r) => r.id === id)) failures.push({ kind, id, step: 1, reason: "listed as left out, but the import makes no entity of this id" });
        const used = new Set<Row>();
        for (const row of imported[kind]) {
            const id = row.id as number;
            if (listed.includes(id)) {
                outside[kind].push(id);
                continue;
            }
            const to = map[String(id)];
            const other = to === undefined ? undefined : mine[kind].find((r) => r.id === to);
            if (to === undefined) failures.push({ kind, id, step: 2, reason: "the id map has no sample entity for it" });
            else if (other === undefined) failures.push({ kind, id, step: 2, reason: `the sample has no entity of id ${to}` });
            else if (used.has(other)) failures.push({ kind, id, step: 2, reason: `the sample's entity ${to} is paired already` });
            else if (typeOf(kind, other) !== undefined && typeOf(kind, row) !== typeOf(kind, other)) failures.push({ kind, id, step: 2, reason: `type ${typeOf(kind, row)} against the sample's ${typeOf(kind, other)}` });
            else {
                used.add(other);
                ids[kind].set(id, to as number);
                paired[kind] += 1;
            }
        }
        for (const s of mine[kind]) if (!used.has(s)) failures.push({ kind, id: (s.id as number | undefined) ?? null, step: 2, reason: "no import entity is paired with it" });
    }
    return { comparable: failures.length === 0, failures, ids, paired, leftOut: outside };
}

// ---------------------------------------------------------------- the clock and the record

/** What a record job file keeps of a clock; the fields of the alternative that the comparison reads */
export type RecordedClock = {
    selected: string;
    selected_windows: Record<string, string>;
    alternatives: { id: string; verdict: string; rate: number; window_cycle_ticks: number | null; wake_ups: number | null; clock_sha256: string }[];
};

/** The selected clock as the record keeps it */
export type ClockSummary = {
    id: string;
    verdict: string;
    rate: number;
    window_cycle_ticks: number;
    wake_ups: number | null;
    windows: Record<string, string>;
    clock_sha256: string;
};

/** The parts of a generation that the summary reads */
type GeneratedAlternative = {
    id: string;
    verdict: string;
    assessment: { items_per_second: number };
    result: {
        clock_windows: Record<string, { start: number; end: number }[]>;
        simulation_duration: { ticks: number };
        subtick?: { clock: { window_cycle_ticks: number }; blueprint: never; schedule: never };
        stability_check?: unknown;
    };
};
type Generated = { alternatives: readonly unknown[]; selected_index: number };

/** A number rounded to 3 decimals, as the record rounds a wake-up count (ties to even) */
export function roundedWakeUps(value: number): number {
    const scaled = value * 1000;
    const tie = Math.abs(scaled - Math.trunc(scaled)) === 0.5;
    return tie ? (Math.round(scaled / 2) * 2) / 1000 : Number(value.toFixed(3));
}

/** The windows of a clock in the record's form: each window's start and end, in order, joined by commas */
export function compactWindows(windows: Record<string, { start: number; end: number }[]>): Record<string, string> {
    return Object.fromEntries(Object.entries(windows).map(([name, spans]) => [name, spans.map((s) => `${s.start}-${s.end}`).join(",")]));
}

/** The selected alternative of a generation, in the record's form; null where the generation selects none */
export function summaryOf(generated: Generated): ClockSummary | null {
    const a = generated.alternatives[generated.selected_index] as GeneratedAlternative | undefined;
    if (a === undefined) return null;
    const loose = a as unknown as {
        assessment: { wake_ups?: { wake_ups_per_minute?: number } };
        result: { stability_check?: { as_built?: { wake_ups?: { wake_ups_per_minute?: number } } }; subtick?: { blueprint: never; schedule: never } };
    };
    const wake_ups = loose.assessment.wake_ups?.wake_ups_per_minute ?? loose.result.stability_check?.as_built?.wake_ups?.wake_ups_per_minute ?? null;
    const exported = (a.result.subtick ?? a.result) as unknown as Parameters<typeof clockIdentity>[0];
    return {
        id: a.id,
        verdict: a.verdict,
        rate: a.assessment.items_per_second,
        window_cycle_ticks: a.result.subtick?.clock.window_cycle_ticks ?? a.result.simulation_duration.ticks,
        wake_ups: wake_ups === null ? null : roundedWakeUps(wake_ups),
        windows: compactWindows(a.result.clock_windows),
        clock_sha256: createHash("sha256").update(JSON.stringify(clockIdentity(exported))).digest("hex"),
    };
}

/** The windows with each `inserter:<id>` and `drill:<id>` key renamed by the pairing; a key with no pair keeps a name that no record has */
export function mappedWindows(windows: Record<string, string>, ids: Pairing["ids"]): Record<string, string> {
    return Object.fromEntries(Object.entries(windows).map(([key, value]) => {
        const [kind, id] = key.split(":");
        const to = (kind === "inserter" || kind === "drill") ? ids[kind].get(Number(id)) : undefined;
        return [to === undefined ? `unpaired ${key}` : `${kind}:${to}`, value];
    }));
}

const sortedEntries = (windows: Record<string, string>) => JSON.stringify(Object.entries(windows).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export type ClockComparison = { state: "equal" | "equal under the id map" | "moved"; differences: string[] };

/**
 * The selected clock against the record's: equal where its id and its clock hash are the record's; equal under the id map
 * where only the hash differs and its windows, with the ids of the sample, are the record's with the same verdict, rate,
 * wake-ups and window cycle; otherwise moved. No tolerance.
 */
export function compareToRecord(summary: ClockSummary, record: RecordedClock, ids: Pairing["ids"] | null): ClockComparison {
    const recorded = record.alternatives.find((a) => a.id === record.selected);
    if (recorded === undefined) return { state: "moved", differences: [`the record has no alternative ${record.selected}`] };
    if (summary.id === record.selected && summary.clock_sha256 === recorded.clock_sha256) return { state: "equal", differences: [] };
    const differences: string[] = [];
    const field = (name: string, own: unknown, theirs: unknown) => {
        if (JSON.stringify(own) !== JSON.stringify(theirs)) differences.push(`${name}: ${JSON.stringify(own)} against the record's ${JSON.stringify(theirs)}`);
    };
    field("selected", summary.id, record.selected);
    field("verdict", summary.verdict, recorded.verdict);
    field("rate", summary.rate, recorded.rate);
    field("window cycle ticks", summary.window_cycle_ticks, recorded.window_cycle_ticks);
    field("wake-ups a minute", summary.wake_ups, recorded.wake_ups);
    if (ids === null) differences.push("the windows cannot be mapped to the sample's ids");
    else if (sortedEntries(mappedWindows(summary.windows, ids)) !== sortedEntries(record.selected_windows)) {
        differences.push(`windows: ${sortedEntries(mappedWindows(summary.windows, ids))} against the record's ${sortedEntries(record.selected_windows)}`);
    }
    if (differences.length === 0) return { state: "equal under the id map", differences: [`the hash ${summary.clock_sha256} is not the record's ${recorded.clock_sha256}`] };
    return { state: "moved", differences };
}

/**
 * The way a clock differs from the record, in words that a person can read and a test can hold: the selected id, the verdict, the
 * rate, the window cycle and the wake-ups a minute where they differ, then "windows differ" where the windows, with the ids of
 * the sample, are not the record's. An empty text means none of them differs.
 */
export function directionOf(summary: ClockSummary, record: RecordedClock, ids: Pairing["ids"] | null): string {
    const recorded = record.alternatives.find((a) => a.id === record.selected);
    if (recorded === undefined) return `the record has no alternative ${record.selected}`;
    const parts: string[] = [];
    if (summary.id !== record.selected) parts.push(`selected ${record.selected} to ${summary.id}`);
    if (summary.verdict !== recorded.verdict) parts.push(`verdict ${recorded.verdict} to ${summary.verdict}`);
    if (summary.rate !== recorded.rate) parts.push(`rate ${recorded.rate} to ${summary.rate}`);
    if (summary.window_cycle_ticks !== recorded.window_cycle_ticks) parts.push(`window cycle ${recorded.window_cycle_ticks} to ${summary.window_cycle_ticks} ticks`);
    if (summary.wake_ups !== recorded.wake_ups) {
        const was = recorded.wake_ups;
        const change = was === null || was === 0 || summary.wake_ups === null ? "" : ` (${summary.wake_ups > was ? "+" : "-"}${Math.abs(((summary.wake_ups - was) / was) * 100).toFixed(1)} %)`;
        parts.push(`wake-ups a minute ${was} to ${summary.wake_ups}${change}`);
    }
    if (ids !== null && sortedEntries(mappedWindows(summary.windows, ids)) !== sortedEntries(record.selected_windows)) parts.push("windows differ");
    return parts.join("; ");
}

// ---------------------------------------------------------------- the whole run: paste, configure, generate, compare

/** A sample's configuration: the setpoint and the lists that the pairing reads */
export type SampleFile = ReadFile & { setpoint: SampleSetpoint };

export type PasteClockInput = {
    name: string;
    /** The blueprint string of the sample's scaffold */
    text: string;
    data: FactorioData;
    /** The file that answers the import's questions: the sample for a build that has a configuration, else the read of the game */
    source: ReadFile;
    /** The read of the game that holds positions, which the pairing's first step lays the import on */
    positioned: ReadFile;
    translation: Point;
    research: ImportInputs["research"];
    sample: SampleFile;
    /** How many units of the sample the blueprint holds */
    units: number;
    leftOut?: LeftOut;
    /** Where the sample's ids are not the file's: the id map that pairs the import with the sample, instead of the pairing by position */
    idMap?: IdMap;
    /** The record job of the sample */
    record: RecordedClock;
};

export type PasteClockRun = {
    settled: Settled;
    /** The units found: the import's machines over the sample's, or null */
    unitsFound: number | null;
    setpoint: PasteSetpoint | null;
    pairing: Pairing;
    /** The error that generating the configuration threw, else null */
    error: string | null;
    summary: ClockSummary | null;
    comparison: ClockComparison | null;
    /** How the selected clock differs from the record (`directionOf`); empty where it does not */
    direction: string | null;
    seconds: number;
};

const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };

/**
 * Pastes the blueprint with the sample's item and its copies (one copy per pasted unit where the blueprint holds more than
 * one), answers every question from the file, writes the configuration of the paste, generates its clocks and holds the
 * selected one to the sample's record. Where the blueprint does not hold the expected units, nothing is generated.
 */
export async function pasteClock(input: PasteClockInput): Promise<PasteClockRun> {
    const { sample, units } = input;
    const settled = settleAnswers({
        name: input.name, text: input.text, data: input.data, source: input.source, translation: input.translation, research: input.research,
        setpoint: { item: sample.setpoint.item, copies: units === 1 ? sample.setpoint.copies : 1 },
    });
    const pairing = input.idMap === undefined
        ? pairWithSample(settled.outcome, input.translation, input.positioned, sample, input.leftOut)
        : pairByIdMap(settled.outcome, sample, input.idMap, input.leftOut);
    const unitsFound = unitsOf(settled.outcome.machines.length, (sample.machines ?? []).length);
    const run: PasteClockRun = { settled, unitsFound, setpoint: null, pairing, error: null, summary: null, comparison: null, direction: null, seconds: 0 };
    if (unitsFound !== units || settled.unanswered.length > 0) return run;
    run.setpoint = pasteSetpointOf(sample.setpoint, units);
    const started = Date.now();
    try {
        const config = await parseConfig(JSON.stringify(pasteConfigOf(settled.outcome, run.setpoint)));
        run.summary = summaryOf(generateClockAlternatives(config, { logger: quiet }));
    } catch (error) {
        run.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    run.seconds = (Date.now() - started) / 1000;
    if (run.summary !== null) {
        run.comparison = compareToRecord(run.summary, input.record, pairing.comparable ? pairing.ids : null);
        run.direction = directionOf(run.summary, input.record, pairing.comparable ? pairing.ids : null);
    }
    return run;
}
