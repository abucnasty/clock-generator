/**
 * The import at its one interface: the 8 builds that a read of the game holds, each pasted as its blueprint and held to
 * that read, then the outcomes for texts that are no blueprint, and the cases that the builds do not reach.
 *
 * Each build's read is what the Sidecar wrote for it (fixtures/assemble/reads/), and tier1.json gives the frame that lays
 * the read on the blueprint (read = blueprint + translation), the research numbers of the force it was read with, and the
 * setpoint. A question is answered with the value of the build's configuration in the repository (the read where the
 * build is an export). Then each read entity lies on one import entity, and each field the read holds is equal, within
 * 1e-9 relative for a speed, or is a row of allowed-differences.tsv. A field that the read's version did not write, or
 * that a hand set in the configuration, is not compared (tier1.json `not_held`).
 */
import fs from "fs";
import path from "path";
import pako from "pako";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../config/loader";
import { ConfigSchema } from "../config/schema";
import { beltPickupSinkRefusal } from "../config/inserter-scope";
import { pickupCaptureProblem } from "../config/pickup-capture";
import type { FactorioData } from "../data/factorio-data-types";
import { applyResearch } from "./apply-research";
import * as assemble from "./assemble";
import { geometryDataOf, worldDataOf } from "./assemble";
import { decodeBlueprint } from "./decode";
import { geometryOf } from "./geometry";
import { importBlueprint, NOTE_CODES, type ImportBuild, type ImportInputs, type ImportOutcome, type NoteCode } from "./index";
import { drillsOf, pasteConfigOf, pasteSetpointOf, samePoint, settleAnswers, type Asked, type End, type Point, type Raw, type ReadFile, type ReadLane } from "./paste-clock/paste-clock-helpers";
import { worldOf } from "./world";

const ENGINE = path.resolve(__dirname, "../..");
const FIXTURES = path.join(__dirname, "fixtures", "assemble");
const read = (file: string) => fs.readFileSync(file, "utf8");
const DATA = JSON.parse(read(path.join(ENGINE, "resources", "data-filtered.json"))) as FactorioData;

type Bonuses = ImportInputs["research"]["bonuses"];
type NotHeld = { kind: "inserter" | "belt"; entity_number?: number; read_belt?: number; line?: number; lane?: number; field: string; class: string; source: string };
type Tier1Build = {
    name: string;
    blueprint: string;
    read: string;
    read_kind: "export" | "config" | "capture";
    frame: { transform: "identity"; translation: Point };
    research: { profile: string; template: null; bonuses: Bonuses };
    setpoint: { item: string; copies: number };
    not_held: NotHeld[];
};
const TIER1 = (JSON.parse(read(path.join(FIXTURES, "tier1.json"))) as { builds: Tier1Build[] }).builds;

/** A row where a read holds a value and the import is expected to give another */
type Allowed = { build: string; kind: string; entity_number: string; read_belt: string; line: string; lane: string; field: string; class: string; source: string };
const ALLOWED: Allowed[] = (() => {
    const lines = read(path.join(FIXTURES, "allowed-differences.tsv")).split("\n").filter((l) => l !== "" && !l.startsWith("#"));
    const header = lines[0].split("\t");
    return lines.slice(1).map((l) => Object.fromEntries(l.split("\t").map((v, i) => [header[i], v])) as Allowed);
})();

// ---------------------------------------------------------------- one build: paste, answer, compare

type Run = {
    build: Tier1Build;
    text: string;
    outcome: ImportBuild;
    first: ImportBuild;
    answers: Record<string, string>;
    asked: Asked[];
    unanswered: string[];
};

const inputsOf = (build: Tier1Build, answers: Record<string, string>): ImportInputs => ({ research: build.research, answers, setpoint: build.setpoint });

function buildOf(outcome: ImportOutcome, what: string): ImportBuild {
    if (outcome.kind !== "build") throw new Error(`${what}: the problem ${outcome.problem}`);
    return outcome;
}

/** The answers the build's configuration (or its export) gives, asked again until no question is open */
function settle(build: Tier1Build): Run {
    const text = read(path.join(ENGINE, build.blueprint)).trim();
    const source = JSON.parse(read(build.read_kind === "config" ? path.join(ENGINE, build.blueprint.replace(/\.scaffold$/, ".json")) : path.join(FIXTURES, build.read))) as ReadFile;
    const settled = settleAnswers({ name: build.name, text, data: DATA, source, translation: build.frame.translation, research: build.research, setpoint: build.setpoint });
    return { build, text, ...settled };
}

/** The class of a closed-list row where the read's export gave one belt id to two or more physical lines */
const JOINED_BY_EXPORT = "joined by the Sidecar export";

/** The physical lines (first pieces) whose pieces the import gives each belt id */
function beltLinesOf(run: Pick<Run, "text" | "outcome">): Map<number, number[]> {
    const decoded = decodeBlueprint(run.text);
    if (decoded.kind !== "blueprint") throw new Error("not a blueprint");
    const geometry = geometryOf(worldOf(decoded.entities, worldDataOf(DATA)), decoded.entities, geometryDataOf(DATA));
    const beltOf = new Map(run.outcome.entities.flatMap((e) => (e.row?.list === "belts" ? [[e.entity_number, e.row.id] as const] : [])));
    const out = new Map<number, number[]>();
    for (const line of geometry.lines) {
        for (const id of new Set(line.pieces.flatMap((p) => (beltOf.has(p) ? [beltOf.get(p)!] : [])))) out.set(id, [...(out.get(id) ?? []), line.first]);
    }
    return out;
}

type Compared = { differences: string[]; allowedUsed: string[]; compared: number; notHeldSkipped: number; pairs: Record<string, number> };

/** Holds the import of one build to its read, under its frame */
function compare(run: Run): Compared {
    const { build, outcome } = run;
    const file = JSON.parse(read(path.join(FIXTURES, build.read))) as ReadFile;
    const t = build.frame.translation;
    const differences: string[] = [];
    const allowedUsed: string[] = [];
    let compared = 0;
    let notHeldSkipped = 0;
    const pairs: Record<string, number> = {};

    const decoded = decodeBlueprint(run.text);
    if (decoded.kind !== "blueprint") throw new Error("not a blueprint");
    const entityAt = (p: Point | undefined, what: string) => {
        const found = decoded.entities.find((e) => samePoint(p, e.position, t));
        // a read entity that lies on no blueprint entity would match every row of the closed list and of not_held
        if (!found) differences.push(`${build.name} ${what}: no blueprint entity at its place`);
        return found;
    };

    const allowed = (where: { kind: string; entity_number?: number; read_belt?: number; line?: number; lane?: number }, field: string): Allowed | undefined =>
        ALLOWED.find((a) => a.build === build.name && a.kind === where.kind && a.field === field
            && (where.entity_number === undefined || a.entity_number === String(where.entity_number))
            && (where.read_belt === undefined || a.read_belt === String(where.read_belt))
            && (a.line === "" || a.line === String(where.line)) && (a.lane === "" || a.lane === String(where.lane)));
    const notHeld = (where: { kind: string; entity_number?: number; read_belt?: number; line?: number; lane?: number }, field: string): boolean =>
        build.not_held.some((n) => n.kind === where.kind && n.field === field
            && (where.entity_number === undefined || n.entity_number === where.entity_number)
            && (where.read_belt === undefined || n.read_belt === where.read_belt)
            && (n.line === undefined || n.line === where.line) && (n.lane === undefined || n.lane === where.lane));

    /** One compared field: equal, within 1e-9 relative for a speed, or on the closed list */
    const check = (what: string, where: Parameters<typeof allowed>[0], field: string, expected: unknown, actual: unknown, speed = false) => {
        compared += 1;
        const equal = speed && typeof expected === "number" && typeof actual === "number"
            ? Math.abs(actual - expected) <= 1e-9 * Math.max(Math.abs(expected), Math.abs(actual))
            : JSON.stringify(expected) === JSON.stringify(actual);
        if (equal) return;
        const row = allowed(where, field);
        if (row) allowedUsed.push(`${build.name} ${what} ${field}: ${row.source}`);
        else differences.push(`${build.name} ${what} ${field}: read ${JSON.stringify(expected)}, import ${JSON.stringify(actual)}`);
    };

    // the maps from a read id to an import id, made by the match only
    const maps = { machine: new Map<number, number>(), chest: new Map<number, number>(), belt: new Map<number, number>() };
    // a read belt that the read's export joined over two or more lines maps to one import belt per line, only on a
    // row of the closed list of class "joined by the Sidecar export" (its entity_number lists the lines' first pieces)
    const moreBelts = new Map<number, number[]>();
    const linesOfBelt = beltLinesOf(run);
    const joinedRows = new Set<Allowed>();
    const joinedBy = (readBelt: number, importBelts: number[]): boolean => {
        const row = ALLOWED.find((a) => a.build === build.name && a.kind === "belt" && a.class === JOINED_BY_EXPORT && a.read_belt === String(readBelt));
        if (!row) return false;
        const lines = row.entity_number.split(" ");
        if (!importBelts.every((id) => (linesOfBelt.get(id) ?? []).length === 1 && lines.includes(String(linesOfBelt.get(id)![0])))) return false;
        if (!joinedRows.has(row)) allowedUsed.push(`${build.name} belt ${readBelt} ${row.field}: ${row.source}`);
        joinedRows.add(row);
        return true;
    };
    const endOf = (what: string, where: Parameters<typeof allowed>[0], field: string, readEnd: End | undefined, importEnd: Raw | undefined) => {
        check(what, where, `${field}.type`, readEnd?.type, importEnd?.type);
        if (readEnd === undefined || importEnd === undefined || readEnd.type !== importEnd.type) return;
        const map = maps[readEnd.type as keyof typeof maps];
        let expected = map.get(readEnd.id);
        if (readEnd.type === "belt") {
            const id = importEnd.id as number;
            const more = moreBelts.get(readEnd.id) ?? [];
            if (expected === undefined) map.set(readEnd.id, (expected = id));
            else if (id !== expected && (more.includes(id) || joinedBy(readEnd.id, [expected, ...more, id]))) {
                if (!more.includes(id)) moreBelts.set(readEnd.id, [...more, id]);
                expected = id;
            }
        }
        check(what, where, `${field}.id (through the match)`, expected, importEnd.id);
    };
    /** Every key the read holds, but ids, positions, the version stamp and the ends (compared through the maps) */
    const SKIP = new Set(["id", "position", "sidecar_version", "source", "sink", "target", "result_target"]);
    const SPEEDS = new Set(["crafting_speed", "speed_bonus"]);
    const fields = (what: string, where: Parameters<typeof allowed>[0], readRow: Raw, importRow: Raw) => {
        for (const [key, value] of Object.entries(readRow)) {
            if (SKIP.has(key)) continue;
            // an empty list in the read is the same as none
            const expected = Array.isArray(value) && value.length === 0 ? undefined : value;
            const actual = Array.isArray(importRow[key]) && (importRow[key] as unknown[]).length === 0 ? undefined : importRow[key];
            check(what, where, key, expected, actual, SPEEDS.has(key));
        }
    };

    const importAt = <T extends Raw>(list: readonly T[], p: Point | undefined) => list.find((x) => samePoint(p, x.position as Point | undefined, t));

    // machines, chests, drills: each read entity on one import entity, then its fields
    const lists = [
        ["machine", file.machines ?? [], outcome.machines],
        ["chest", file.chests ?? [], outcome.chests],
    ] as const;
    for (const [kind, readList, importList] of lists) {
        pairs[kind] = 0;
        for (const r of readList) {
            const mine = importAt(importList as unknown as Raw[], r.position);
            if (!mine) {
                differences.push(`${build.name} ${kind} ${r.id}: no import entity at its place`);
                continue;
            }
            pairs[kind] += 1;
            maps[kind].set(r.id, mine.id as number);
        }
    }
    for (const r of file.machines ?? []) {
        const mine = importAt(outcome.machines as unknown as Raw[], r.position);
        if (!mine) continue;
        const where = { kind: "machine", entity_number: entityAt(r.position, `machine ${r.id}`)?.entity_number ?? -1 };
        fields(`machine ${r.id}`, where, r, mine);
        if (r.result_target || mine.result_target) endOf(`machine ${r.id}`, where, "result_target", r.result_target, mine.result_target as Raw | undefined);
    }
    for (const r of file.chests ?? []) {
        const mine = importAt(outcome.chests as unknown as Raw[], r.position);
        if (mine) fields(`chest ${r.id}`, { kind: "chest", entity_number: entityAt(r.position, `chest ${r.id}`)?.entity_number ?? -1 }, r, mine);
    }
    pairs.drill = 0;
    for (const r of drillsOf(file)) {
        const mine = importAt(outcome.drills as unknown as Raw[], r.position);
        if (!mine) {
            differences.push(`${build.name} drill ${r.id}: no import entity at its place`);
            continue;
        }
        pairs.drill += 1;
        const where = { kind: "drill", entity_number: entityAt(r.position, `drill ${r.id}`)?.entity_number ?? -1 };
        fields(`drill ${r.id}`, where, r, mine);
        endOf(`drill ${r.id}`, where, "target", r.target, mine.target as Raw | undefined);
    }

    // inserters: their fields, their ends through the maps, and a drop onto a belt where the read holds none
    pairs.inserter = 0;
    for (const [index, r] of (file.inserters ?? []).entries()) {
        const mine = importAt(outcome.inserters as unknown as Raw[], r.position);
        if (!mine) {
            differences.push(`${build.name} inserter ${index + 1}: no import entity at its place`);
            continue;
        }
        pairs.inserter += 1;
        const entity_number = entityAt(r.position, `inserter ${index + 1}`)?.entity_number ?? -1;
        const where = { kind: "inserter", entity_number };
        const what = `inserter ${index + 1} (entity ${entity_number})`;
        fields(what, where, r, mine);
        for (const side of ["source", "sink"] as const) {
            const readEnd = r[side];
            const importEnd = mine[side] as Raw;
            endOf(what, where, side, readEnd, importEnd);
            const { type: _type, id: _id, pickup_capture: readCapture, drop_capture: _drop, belt_direction: _direction, ...rest } = readEnd as Raw;
            fields(what, where, rest, importEnd);
            if (readCapture !== undefined) {
                const { sidecar_version: _stamp, ...capture } = readCapture as Raw;
                const importCapture = (importEnd.pickup_capture ?? {}) as Raw;
                for (const [key, value] of Object.entries(capture)) check(what, where, `pickup_capture.${key}`, value, importCapture[key]);
            }
            // on a read drop onto a belt, the drop's side load and the belt's way there: absent is none
            if (side === "sink" && readEnd.type === "belt" && importEnd.type === "belt") {
                for (const [field, expected, actual] of [
                    ["drop_capture.tiles", (readEnd.drop_capture as Raw | undefined)?.tiles, (importEnd.drop_capture as Raw | undefined)?.tiles],
                    ["belt_direction", readEnd.belt_direction, importEnd.belt_direction],
                ] as const) {
                    if (notHeld(where, field)) notHeldSkipped += 1;
                    else check(what, where, field, expected ?? null, actual ?? null);
                }
                const capture = readEnd.drop_capture as Raw | undefined;
                if (capture !== undefined && importEnd.drop_capture !== undefined) check(what, where, "drop_capture.status", capture.status, (importEnd.drop_capture as Raw).status);
            }
        }
    }

    // belts, paired through the inserter ends: type, lanes, the end of each lane and the way the items pass the copies
    pairs.belt = 0;
    for (const r of file.belts ?? []) for (const id of [maps.belt.get(r.id), ...(moreBelts.get(r.id) ?? [])]) {
        const mine = outcome.belts.find((b) => b.id === id) as unknown as (Raw & { lanes: ReadLane[]; flow_direction?: number }) | undefined;
        if (!mine) {
            differences.push(`${build.name} belt ${r.id}: no import belt through the inserter ends`);
            continue;
        }
        pairs.belt += 1;
        const what = `belt ${r.id}`;
        const where = { kind: "belt", read_belt: r.id };
        if (r.type !== undefined) check(what, where, "type", r.type, mine.type);
        const lanes = r.lanes ?? [];
        check(what, where, "lanes (count)", lanes.length, mine.lanes.length);
        const lines = lanes.length === 2 ? [1, 2] : [2];
        lanes.forEach((lane, place) => {
            const theirs = mine.lanes[place] ?? {};
            const at = { ...where, line: lines[place], lane: place + 1 };
            if (lane.ingredient !== undefined) check(`${what} lane ${place + 1}`, at, "ingredient", lane.ingredient, theirs.ingredient);
            if (lane.stack_size !== undefined) check(`${what} lane ${place + 1}`, at, "stack_size", lane.stack_size, theirs.stack_size);
            if (notHeld(at, "lane_end")) notHeldSkipped += 1;
            else check(`${what} lane ${place + 1}`, at, "lane_end", lane.lane_end?.kind ?? null, theirs.lane_end?.kind ?? null);
        });
        if (notHeld(where, "flow_direction")) notHeldSkipped += 1;
        else check(what, where, "flow_direction", r.flow_direction ?? null, mine.flow_direction ?? null);
    }
    for (const [kind, map] of Object.entries(maps)) {
        const values = [...map.values(), ...(kind === "belt" ? [...moreBelts.values()].flat() : [])];
        if (new Set(values).size !== values.length) differences.push(`${build.name}: the map from read ${kind} ids to import ids is not one to one`);
    }
    return { differences, allowedUsed, compared, notHeldSkipped, pairs };
}

const RUNS = TIER1.map(settle);
const COMPARED = new Map(RUNS.map((run) => [run.build.name, compare(run)]));

/** The build's configuration with a setpoint, as the dialog would make it */
const configOf = (run: Run) => ({
    setpoint: { item: run.build.setpoint.item, items_per_second: 1, copies: run.build.setpoint.copies },
    machines: run.outcome.machines,
    drills: { configs: run.outcome.drills },
    inserters: run.outcome.inserters,
    belts: run.outcome.belts,
    chests: run.outcome.chests,
    research: run.outcome.research,
});

describe("the 8 builds with reads, each held to its read", () => {
    it.each(RUNS.map((run) => [run.build.name, run] as const))("%s: every question answered, every read entity on an import entity, every compared field equal or allowed", (_name, run) => {
        expect(run.unanswered).toEqual([]);
        expect(run.outcome.questions).toEqual([]);
        const result = COMPARED.get(run.build.name)!;
        expect(result.differences).toEqual([]);
        expect(result.compared).toBeGreaterThan(0);
    });

    it("uses each row of the closed list, and no other", () => {
        const used = [...COMPARED.values()].flatMap((c) => c.allowedUsed);
        expect(used.length).toBe(ALLOWED.length);
        for (const row of ALLOWED) expect(used.some((u) => u.endsWith(row.source)), row.source).toBe(true);
    });

    it("gives each build a suggested target that the machines infer", () => {
        for (const run of RUNS) {
            expect(run.outcome.suggested_target, run.build.name).not.toBeNull();
            expect(run.outcome.suggested_target!.source, run.build.name).toBe("inferred");
        }
    });

    it("gives the same outcome on a second call, and sorts every list by its key", () => {
        for (const run of RUNS) {
            const again = importBlueprint(run.text, inputsOf(run.build, run.answers), DATA);
            expect(again, run.build.name).toStrictEqual(run.outcome);
            for (const list of [run.outcome.machines, run.outcome.drills, run.outcome.belts, run.outcome.chests, run.outcome.inserters] as { id?: number }[][]) {
                const ids = list.map((x) => x.id as number);
                expect(ids, run.build.name).toEqual([...ids].sort((a, b) => a - b));
            }
            const notes = run.outcome.notes.map((n) => [n.entity_number, n.code, n.lane ?? 0, n.field ?? ""] as const);
            const sortedNotes = [...notes].sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || a[2] - b[2] || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0));
            expect(notes, run.build.name).toEqual(sortedNotes);
            const names = run.outcome.ignored.map((x) => x.name);
            expect(names).toEqual([...names].sort());
            const numbers = run.outcome.entities.map((e) => e.entity_number);
            expect(numbers, run.build.name).toEqual([...numbers].sort((a, b) => a - b));
            const speeds = run.outcome.speeds.map((x) => [["machines", "drills", "chests"].indexOf(x.list), x.id] as const);
            expect(speeds, run.build.name).toEqual([...speeds].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
        }
    });

    it("names the entity of every note and question, and the row each listed entity is", () => {
        for (const run of RUNS) {
            const { outcome } = run;
            const known = new Set(outcome.entities.map((e) => e.entity_number));
            for (const note of outcome.notes) if (note.entity_number !== 0) expect(known.has(note.entity_number), `${run.build.name} note ${note.code}`).toBe(true);
            for (const list of ["machines", "drills", "inserters", "chests"] as const) {
                const rows = outcome.entities.flatMap((e) => (e.row?.list === list ? [e.row.id] : []));
                expect(rows.sort((a, b) => a - b), `${run.build.name} ${list}`).toEqual(outcome[list].map((x) => x.id));
            }
            const belts = new Set(outcome.entities.flatMap((e) => (e.row?.list === "belts" ? [e.row.id] : [])));
            expect([...belts].sort((a, b) => a - b), run.build.name).toEqual(outcome.belts.map((b) => b.id));
        }
    });

    it("gives what each productivity is made of, and their sum held to the cap is the value written", () => {
        for (const run of RUNS) {
            const { outcome } = run;
            const written = (list: string, id: number) => list === "machines" ? outcome.machines.find((m) => m.id === id)!.productivity
                : list === "drills" ? outcome.drills.find((d) => d.id === id)!.productivity : (outcome.chests.find((c) => c.id === id) as { productivity?: number }).productivity ?? 0;
            const silos = outcome.chests.filter((c) => c.type === "rocket-silo").length;
            expect(outcome.speeds.length, run.build.name).toBe(outcome.machines.length + outcome.drills.length + silos);
            for (const row of outcome.speeds) {
                const { base, modules, research, cap } = row.productivity;
                const sum = Math.max(0, base + modules + research);
                expect(written(row.list, row.id), `${run.build.name} ${row.list} ${row.id}`).toBeCloseTo(cap === null ? sum : Math.min(cap, sum), 9);
                expect(row.beacons).toBeGreaterThanOrEqual(0);
            }
            for (const m of outcome.machines) {
                const base = 100 * (DATA.crafting_machine[m.prototype!]?.effect_receiver?.base_effect?.productivity ?? 0);
                expect(outcome.speeds.find((x) => x.list === "machines" && x.id === m.id)!.productivity.base, run.build.name).toBe(base);
            }
        }
        expect(RUNS.some((run) => run.outcome.speeds.some((x) => x.beacons > 0 && x.modules > 0))).toBe(true);
        expect(RUNS.some((run) => run.outcome.speeds.some((x) => x.productivity.base > 0))).toBe(true);
    });

    it("gives a configuration that parses, and a supported capture on a belt pickup that the generator takes", () => {
        for (const run of RUNS) {
            const parsed = ConfigSchema.safeParse(configOf(run));
            expect(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), run.build.name).toEqual([]);
            for (const inserter of run.outcome.inserters) {
                const source = inserter.source as Parameters<typeof pickupCaptureProblem>[0];
                if (source.type === "belt" && source.pickup_capture?.status === "supported") expect(pickupCaptureProblem(source), run.build.name).toBeNull();
            }
            const text = JSON.stringify(configOf(run));
            for (const key of ["sidecar_version", "pickup_warnings", "output_belt", "\"drop\""]) expect(text.includes(key), `${run.build.name} ${key}`).toBe(false);
        }
    });

    it("puts no research on the base: each value is the build's own", () => {
        const none: Bonuses = { mining_drill_productivity_bonus: 0, inserter_stack_size_bonus: 0, bulk_inserter_capacity_bonus: 0, belt_stack_size_bonus: 0, recipes: {} };
        const run = RUNS.find((r) => r.build.name === "utility-320")!;
        const { research, ...lists } = run.outcome;
        const plain = applyResearch({ machines: lists.machines, drills: { configs: lists.drills }, inserters: lists.inserters, belts: lists.belts, chests: lists.chests }, research.base, { profile: "No research", template: "no-research", bonuses: none }, DATA);
        for (const m of plain.build.machines) expect(m.productivity).toBe(research.base.machines.find((b) => b.id === m.id)!.productivity);
        for (const b of plain.build.belts) for (const lane of b.lanes) expect(lane.stack_size).toBe(1);
        for (const i of plain.build.inserters) {
            const override = research.base.inserters.find((b) => b.id === i.id)!.stack_size;
            const prototype = DATA.inserter[i.prototype ?? "stack-inserter"];
            expect(i.stack_size).toBe(override ?? 1 + (prototype.stack_size_bonus ?? 0));
        }
        expect(plain.block.bonuses).toEqual(none);
        // the build's own research gives the read's values back
        expect(research.bonuses).toEqual(run.build.research.bonuses);
    });
});

// ---------------------------------------------------------------- a belt for each separate belt line

describe("a belt for each separate belt line", () => {
    it("gives each belt id of every build one physical line", () => {
        for (const run of RUNS) {
            const lines = beltLinesOf(run);
            expect([...lines.keys()].sort((a, b) => a - b), run.build.name).toEqual(run.outcome.belts.map((b) => b.id));
            for (const [id, of] of lines) expect(of, `${run.build.name} belt ${id}`).toHaveLength(1);
        }
    });

    describe("logistic 240: two rows of 11 copies, whose input and output belts pass splitters", () => {
        const run = RUNS.find((r) => r.build.name === "logistic-240")!;
        const { outcome } = run;
        const belts = (ends: ImportBuild["inserters"][number]["source"][]) => {
            const count = new Map<number, number>();
            for (const end of ends) if (end.type === "belt") count.set(end.id, (count.get(end.id) ?? 0) + 1);
            return count;
        };

        it("gives a belt for each of the 8 lines that inserters touch", () => {
            const touched = new Set(outcome.inserters.flatMap((i) => [i.source, i.sink]).flatMap((end) => (end.type === "belt" ? [end.id] : [])));
            expect(outcome.belts).toHaveLength(8);
            expect(touched.size).toBe(8);
            expect([...beltLinesOf(run).values()].every((of) => of.length === 1)).toBe(true);
        });

        it("puts the 22 pickups on two belts of 11, with transport belts on lane 1 and inserters on lane 2 of the top row, mirrored on the bottom row", () => {
            const pickups = outcome.inserters.filter((i) => i.source.type === "belt");
            expect(pickups).toHaveLength(22);
            const count = belts(pickups.map((i) => i.source));
            expect([...count.values()]).toEqual([11, 11]);
            const rowY = (id: number) => Math.min(...pickups.filter((i) => i.source.id === id).map((i) => i.position!.y));
            const [top, bottom] = [...count.keys()].sort((a, b) => rowY(a) - rowY(b));
            const lanes = (id: number) => outcome.belts.find((b) => b.id === id)!.lanes.map((l) => l.ingredient);
            expect(lanes(top)).toEqual(["transport-belt", "inserter"]);
            expect(lanes(bottom)).toEqual(["inserter", "transport-belt"]);
        });

        it("puts the 22 output drops on four belts: 10, 10 and the two 11th copies' 1 each", () => {
            const drops = outcome.inserters.filter((i) => i.sink.type === "belt" && i.source.type === "machine");
            expect(drops).toHaveLength(22);
            expect([...belts(drops.map((i) => i.sink)).values()].sort((a, b) => a - b)).toEqual([1, 1, 10, 10]);
        });
    });
});

// ---------------------------------------------------------------- texts that are no build

/** A blueprint string for a JSON text, as the game writes them: a zero, then base64 of the deflated text */
const pack = (json: unknown): string => "0" + Buffer.from(pako.deflate(new TextEncoder().encode(JSON.stringify(json)))).toString("base64");
const unpack = (text: string): { blueprint: { entities: Raw[] } & Raw } => JSON.parse(new TextDecoder().decode(pako.inflate(Buffer.from(text.slice(1), "base64"))));
const VERSION_2 = 2 * 2 ** 48 + 1 * 2 ** 32 + 25 * 2 ** 16 + 10;
const NO_RESEARCH: ImportInputs = { research: { profile: "No research", template: "no-research", bonuses: { mining_drill_productivity_bonus: 0, inserter_stack_size_bonus: 0, bulk_inserter_capacity_bonus: 0, belt_stack_size_bonus: 0, recipes: {} } }, answers: {} };

describe("a text that gives no build", () => {
    it.each([
        ["book", pack({ blueprint_book: { blueprints: [{ index: 0, blueprint: { item: "blueprint", entities: [], version: VERSION_2 } }], item: "blueprint-book", version: VERSION_2 } })],
        ["planner", pack({ deconstruction_planner: { settings: {}, item: "deconstruction-planner" } })],
        ["no-entities", pack({ blueprint: { item: "blueprint", entities: [], version: VERSION_2 } })],
        ["game-version", pack({ blueprint: { item: "blueprint", entities: [{ entity_number: 1, name: "stack-inserter", position: { x: 0.5, y: 0.5 } }], version: 1 * 2 ** 48 + 1 * 2 ** 32 } })],
        ["not-a-blueprint", "0eNotABlueprint"],
        ["not-a-blueprint", "{\"machines\": []}"],
        ["not-a-blueprint", ""],
    ])("is the problem %s, with no throw", (problem, text) => {
        expect(importBlueprint(text, NO_RESEARCH, DATA)).toStrictEqual({ kind: "problem", problem });
    });
});

// ---------------------------------------------------------------- what the 8 builds do not reach, on a build changed by hand

const runOf = (name: string) => RUNS.find((r) => r.build.name === name)!;

/** A build's blueprint with its entities changed, imported with the build's own inputs and answers */
function changed(name: string, change: (entities: Raw[]) => void, answers?: Record<string, string>): ImportBuild {
    const run = runOf(name);
    const json = unpack(run.text);
    change(json.blueprint.entities);
    return buildOf(importBlueprint(pack(json), inputsOf(run.build, answers ?? run.answers), DATA), name);
}
const entity = (entities: Raw[], n: number) => entities.find((e) => e.entity_number === n)!;
const insertersAt = (build: ImportBuild, entities: ReturnType<typeof unpack>["blueprint"]["entities"], n: number) => {
    const e = entity(entities, n);
    return build.inserters.find((i) => i.position!.x === (e.position as Point).x && i.position!.y === (e.position as Point).y)!;
};
const notesOf = (build: ImportBuild, code: NoteCode) => build.notes.filter((n) => n.code === code).map((n) => n.entity_number);

describe("filters", () => {
    const steel = unpack(runOf("steel").text).blueprint.entities;

    it("writes an inserter's filters only while it uses them, and a blacklist as its mode", () => {
        const off = changed("steel", (es) => { entity(es, 8).use_filters = false; });
        expect(insertersAt(off, steel, 8).filters).toBeUndefined();
        const black = changed("steel", (es) => { entity(es, 8).filter_mode = "blacklist"; });
        expect(insertersAt(black, steel, 8)).toMatchObject({ filters: ["iron-plate"], filter_mode: "blacklist" });
        expect(insertersAt(runOf("steel").outcome, steel, 8).filter_mode).toBeUndefined();
    });

    it("writes a wagon's blocking filter as a blocked slot", () => {
        const wagon = (build: ImportBuild) => build.chests.find((c) => c.type === "cargo-wagon") as { slot_filters?: Raw[] };
        expect(wagon(runOf("steel").outcome).slot_filters!.filter((s) => s.blocked === true).map((s) => s.slot)).toEqual([31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
        const noItem = changed("steel", (es) => {
            const filters = (entity(es, 5).inventory as { filters: Raw[] }).filters;
            filters[0] = { ...filters[0], name: "no-item" };
        });
        expect(wagon(noItem).slot_filters![0]).toEqual({ slot: 1, blocked: true });
    });

    it("leaves out a filter row with no item, with a note to check it: an inserter's, a wagon's slot, a splitter's", () => {
        const build = changed("steel", (es) => {
            (entity(es, 8).filters as Raw[]).push({ index: 2, quality: "normal", comparator: "=" });
            (entity(es, 5).inventory as { filters: Raw[] }).filters.push({ index: 41, quality: "normal", comparator: "=" });
            es.push({ entity_number: 900, name: "turbo-splitter", position: { x: -300, y: -600.5 }, filter: { quality: "normal", comparator: "=" }, output_priority: "left" });
        });
        expect(insertersAt(build, steel, 8).filters).toEqual(["iron-plate"]);
        expect(notesOf(build, "filter-no-item:filters")).toEqual([8]);
        expect(notesOf(build, "filter-no-item:inventory")).toEqual([5]);
        expect(notesOf(build, "filter-no-item:splitter")).toEqual([900]);
        for (const code of ["filter-no-item:filters", "filter-no-item:inventory", "filter-no-item:splitter"] as const) expect(build.notes.find((n) => n.code === code)!.please_check).toBe(true);
    });
});

/** Two belt lines that inserters take from into infinity chests: line A ends, line B is a loop; and a side load where asked */
function twoLines(sideLoad = false): string {
    const belt = (n: number, x: number, y: number, direction: number) => ({ entity_number: n, name: "transport-belt", position: { x, y }, direction });
    const entities: Raw[] = [
        // line A: three belts east, an inserter taking from its middle into a chest below
        belt(1, 0.5, 0.5, 4), belt(2, 1.5, 0.5, 4), belt(3, 2.5, 0.5, 4),
        { entity_number: 4, name: "stack-inserter", position: { x: 1.5, y: 1.5 }, direction: 0 },
        { entity_number: 5, name: "infinity-chest", position: { x: 1.5, y: 2.5 } },
        // line B: a ring of eight belts, an inserter taking from its top into a chest above
        belt(11, 0.5, 10.5, 4), belt(12, 1.5, 10.5, 4), belt(13, 2.5, 10.5, 8), belt(14, 2.5, 11.5, 8),
        belt(15, 2.5, 12.5, 12), belt(16, 1.5, 12.5, 12), belt(17, 0.5, 12.5, 0), belt(18, 0.5, 11.5, 0),
        { entity_number: 19, name: "stack-inserter", position: { x: 1.5, y: 9.5 }, direction: 8 },
        { entity_number: 20, name: "infinity-chest", position: { x: 1.5, y: 8.5 } },
    ];
    // a belt that side-loads onto line A at the pickup
    if (sideLoad) entities.push(belt(30, 1.5, -0.5, 8));
    return pack({ blueprint: { item: "blueprint", version: VERSION_2, entities } });
}
const plates = (b: string) => ({ "lane-item:1:1": "iron-plate", "lane-item:1:2": "iron-plate", "lane-item:11:1": b, "lane-item:11:2": b });

describe("a belt for each line, also of the same items", () => {
    it("asks each line's lanes, then gives each line a belt", () => {
        const first = buildOf(importBlueprint(twoLines(), NO_RESEARCH, DATA), "two lines");
        expect(first.questions.map((q) => q.key)).toEqual(["lane-item:1:1", "lane-item:1:2", "lane-item:11:1", "lane-item:11:2"]);
        expect(first.belts).toEqual([]);
        const apart = buildOf(importBlueprint(twoLines(), { ...NO_RESEARCH, answers: plates("copper-plate") }, DATA), "two lines");
        expect(apart.belts.map((b) => [b.lanes.map((l) => l.lane_end?.kind), b.flow_direction])).toEqual([[["dead_end", "dead_end"], 4], [["unknown", "unknown"], undefined]]);
    });

    it("keeps two lines of the same items on the same lanes two belts, each with its own lane ends and way", () => {
        const same = buildOf(importBlueprint(twoLines(), { ...NO_RESEARCH, answers: plates("iron-plate") }, DATA), "two lines");
        expect(same.belts.map((b) => [b.id, b.type, b.lanes.map((l) => [l.ingredient, l.lane_end?.kind]), b.flow_direction])).toEqual([
            [1, "transport-belt", [["iron-plate", "dead_end"], ["iron-plate", "dead_end"]], 4],
            [2, "transport-belt", [["iron-plate", "unknown"], ["iron-plate", "unknown"]], undefined],
        ]);
        expect(same.inserters.map((i) => i.source)).toEqual([expect.objectContaining({ type: "belt", id: 1 }), expect.objectContaining({ type: "belt", id: 2 })]);
    });
});

describe("captures", () => {
    it("gives a supported capture with the belt's type and name and no version stamp", () => {
        const build = buildOf(importBlueprint(twoLines(), { ...NO_RESEARCH, answers: plates("copper-plate") }, DATA), "two lines");
        const lineA = build.inserters.find((i) => i.position!.y === 1.5)!;
        expect(lineA.source).toEqual({ type: "belt", id: 1, near_lane: expect.any(Number), pickup_length: 1, pickup_layout: "side-straight", pickup_capture: { status: "supported", model: "belt", model_version: 2, entity_type: "transport-belt", entity_name: "transport-belt" } });
    });

    it("gives a refused pickup its unsupported capture with the reason, and a note", () => {
        const build = buildOf(importBlueprint(twoLines(true), { ...NO_RESEARCH, answers: plates("copper-plate") }, DATA), "side load");
        const lineA = build.inserters.find((i) => i.position!.y === 1.5)!;
        const capture = (lineA.source as { pickup_capture?: { status: string; reason?: string } }).pickup_capture!;
        expect(capture.status).toBe("unsupported");
        expect(build.notes.filter((n) => n.code.startsWith("pickup:")).map((n) => [n.code, n.entity_number])).toEqual([[`pickup:${capture.reason}`, 4]]);
        expect(pickupCaptureProblem(lineA.source as Parameters<typeof pickupCaptureProblem>[0])).not.toBeNull();
    });
});

describe("the sharing of a line", () => {
    it("asks only with more than one copy, and each answer sets both lanes of the belt", () => {
        const run = runOf("stone-brick-120");
        const ask = (copies: number, answers: Record<string, string>) => buildOf(importBlueprint(run.text, { research: run.build.research, answers, setpoint: { ...run.build.setpoint, copies } }, DATA), "stone-brick-120");
        expect(ask(1, {}).questions.filter((q) => q.kind === "lane-sharing")).toEqual([]);
        expect(ask(3, {}).questions.filter((q) => q.kind === "lane-sharing").map((q) => [q.key, q.subject.label, q.candidates])).toEqual([["lane-sharing:10", "Belt 1", ["shared", "per_copy"]]]);
        for (const answer of ["shared", "per_copy"]) {
            const build = ask(3, { "lane-sharing:10": answer });
            expect(build.questions).toEqual([]);
            expect(build.belts.flatMap((b) => b.lanes.map((l) => l.sharing))).toEqual(build.belts.flatMap((b) => b.lanes.map(() => answer)));
        }
    });
});

describe("the other lane of a line that no drop or loader feeds", () => {
    /** A belt line of four pieces with a taker into a machine that makes logistic science packs and a taker into a chest */
    function oneLeft(): string {
        const belt = (n: number, y: number) => ({ entity_number: n, name: "transport-belt", position: { x: 0.5, y }, direction: 8 });
        const entities: Raw[] = [
            belt(1, 0.5), belt(2, 1.5), belt(3, 2.5), belt(4, 3.5),
            { entity_number: 5, name: "stack-inserter", position: { x: 1.5, y: 0.5 }, direction: 12 },
            { entity_number: 6, name: "assembling-machine-3", position: { x: 3.5, y: 0.5 }, recipe: "logistic-science-pack" },
            { entity_number: 7, name: "stack-inserter", position: { x: 1.5, y: 3.5 }, direction: 12 },
            { entity_number: 8, name: "steel-chest", position: { x: 2.5, y: 3.5 } },
        ];
        return pack({ blueprint: { item: "blueprint", version: VERSION_2, entities } });
    }
    const at = (answers: Record<string, string>) => buildOf(importBlueprint(oneLeft(), { ...NO_RESEARCH, answers }, DATA), "one item left");

    it("gives the belt both items after the first lane is answered, as the dialog asks the import again with the answers so far", () => {
        const none = at({});
        expect(none.questions.map((q) => [q.key, q.candidates])).toEqual([["lane-item:1:1", ["inserter", "transport-belt"]], ["lane-item:1:2", ["inserter", "transport-belt"]]]);
        const one = at({ "lane-item:1:1": "inserter" });
        expect(one.questions).toEqual([]);
        expect(one.belts.map((b) => b.lanes.map((l) => l.ingredient))).toEqual([["inserter", "transport-belt"]]);
        // the outcome holds no field that only repeats the answers given
        expect(one).toEqual(at({ "lane-item:1:1": "inserter", "lane-item:1:2": "transport-belt" }));
    });
});

describe("notes", () => {
    it("lists an entity off the grid as a note, and still gives the build", () => {
        const build = changed("steel", (es) => { (entity(es, 8).position as Point).x += 0.25; });
        expect(build.kind).toBe("build");
        expect(notesOf(build, "world:off-grid")).toEqual([8]);
    });

    it("lists an entity the data has no row for as a note, and counts it as not read", () => {
        const steel = runOf("steel");
        const rails = unpack(steel.text).blueprint.entities.filter((e) => e.name === "straight-rail").map((e) => e.entity_number as number);
        expect(rails.length).toBeGreaterThan(0);
        expect(notesOf(steel.outcome, "world:unknown-name")).toEqual(rails);
        expect(steel.outcome.ignored).toContainEqual({ name: "straight-rail", count: rails.length });
    });

    it("leaves out a buffer chest whose limit leaves it no slot, and the inserters at it, each with a note", () => {
        const run = RUNS.find((r) => r.outcome.chests.some((c) => c.type === "buffer-chest" && r.outcome.inserters.some((i) => (i.sink.type === "chest" && i.sink.id === c.id) || (i.source.type === "chest" && i.source.id === c.id))))!;
        expect(run).toBeDefined();
        const chest = run.outcome.chests.find((c) => c.type === "buffer-chest" && run.outcome.inserters.some((i) => i.sink.type === "chest" && i.sink.id === c.id || i.source.type === "chest" && i.source.id === c.id))!;
        const n = run.outcome.entities.find((e) => e.row?.list === "chests" && e.row.id === chest.id)!.entity_number;
        const build = changed(run.build.name, (es) => { entity(es, n).bar = 0; });
        expect(build.chests.map((c) => c.position)).not.toContainEqual(chest.position);
        expect(notesOf(build, "chest:no-slots")).toEqual([n]);
        const chestIds = new Set(build.chests.map((c) => c.id));
        for (const i of build.inserters) for (const end of [i.source, i.sink]) if (end.type === "chest") expect(chestIds.has(end.id)).toBe(true);
        expect([...notesOf(build, "inserter-left-out:drop"), ...notesOf(build, "inserter-left-out:pickup")].length).toBeGreaterThan(0);
        const parsed = ConfigSchema.safeParse({ setpoint: { item: run.build.setpoint.item, items_per_second: 1, copies: 1 }, machines: build.machines, drills: { configs: build.drills },
            inserters: build.inserters, belts: build.belts, chests: build.chests, research: build.research });
        expect(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
    });

    it("has a code for every note a step can give", () => {
        const mapped = [
            assemble.WORLD_NOTES, assemble.GEOMETRY_NOTES, assemble.FLOWS_UNREAD_NOTES, assemble.CIRCUIT_NOTES, assemble.LEFT_OUT_DRILL_NOTES, assemble.RECYCLER_NOTES,
            assemble.SPEED_UNREAD_NOTES, assemble.SPEED_PROBLEM_NOTES, assemble.ID_DIFFERENCE_NOTES, assemble.LEFT_OUT_INSERTER_NOTES, assemble.LEFT_OUT_DRILL_ID_NOTES,
            assemble.ID_PROBLEM_NOTES, assemble.PICKUP_NOTES,
        ].flatMap((record) => Object.values(record));
        for (const code of mapped) expect(NOTE_CODES).toContain(code);
        expect(new Set(NOTE_CODES).size).toBe(NOTE_CODES.length);
    });
});

// ---------------------------------------------------------------- witnesses, written where a folder is named

const WITNESS = process.env.IMPORT_WITNESS_DIRECTORY;
describe("witnesses", () => {
    it.skipIf(!WITNESS)("writes the suggested targets, the questions and the comparison counts", () => {
        const suggested = ["build\timport item\timport items per second\timport source\texport item\texport items per second\texport copies"];
        for (const run of RUNS) {
            const s = run.outcome.suggested_target;
            const file = JSON.parse(read(path.join(FIXTURES, run.build.read))) as { suggested_target?: { recipe?: string; item?: string; items_per_second?: number; copies?: number } };
            const theirs = run.build.read_kind === "export" ? file.suggested_target : undefined;
            suggested.push([run.build.name, s?.target.item ?? "-", s?.target.items_per_second ?? "-", s?.source ?? "-", theirs ? theirs.recipe ?? theirs.item : "-", theirs?.items_per_second ?? "-", theirs?.copies ?? "-"].join("\t"));
        }
        fs.writeFileSync(path.join(WITNESS!, "suggested.tsv"), suggested.join("\n") + "\n");
        const questions = ["build\tkey\tlabel\tcandidates\tanswer"];
        for (const run of RUNS) {
            if (run.asked.length === 0) questions.push([run.build.name, "-", "-", "-", "none asked"].join("\t"));
            for (const q of run.asked) questions.push([run.build.name, q.key, q.label, q.candidates.join(" "), q.answer ?? "(none)"].join("\t"));
        }
        fs.writeFileSync(path.join(WITNESS!, "questions.tsv"), questions.join("\n") + "\n");
        const counts = ["build\tmachines\tchests\tdrills\tinserters\tbelts\tfields compared\tnot held\tallowed used\tdifferences\tone call (ms)\tnotes\tread\tignored"];
        for (const run of RUNS) {
            const c = COMPARED.get(run.build.name)!;
            const start = performance.now();
            importBlueprint(run.text, inputsOf(run.build, run.answers), DATA);
            const ms = (performance.now() - start).toFixed(1);
            counts.push([run.build.name, c.pairs.machine, c.pairs.chest, c.pairs.drill, c.pairs.inserter, c.pairs.belt, c.compared, c.notHeldSkipped, c.allowedUsed.length, c.differences.length, ms,
                run.outcome.notes.map((n) => n.code).join(" ") || "-", run.outcome.read.map((r) => `${r.count} ${r.name}`).join(", "), run.outcome.ignored.map((r) => `${r.count} ${r.name}`).join(", ") || "-"].join("\t"));
        }
        fs.writeFileSync(path.join(WITNESS!, "comparison.tsv"), counts.join("\n") + "\n");
        expect(counts.length).toBe(RUNS.length + 1);
    });
});

// ---------------------------------------------------------------- a throttle: the belt moving on

describe("a throttle: an inserter from a belt into an infinity chest that removes every item", () => {
    type Part = Raw;
    /** Six belts going east on y 0.5, entities 1 to 6 */
    const beltRow = (): Part[] => [1, 2, 3, 4, 5, 6].map((n) => ({ entity_number: n, name: "transport-belt", position: { x: n - 0.5, y: 0.5 }, direction: 4 }));
    /** A second line above it, entities 21 to 26 */
    const upperRow = (): Part[] => [21, 22, 23, 24, 25, 26].map((n) => ({ entity_number: n, name: "transport-belt", position: { x: n - 20.5, y: -3.5 }, direction: 4 }));
    /** A stack inserter beside the belt at tile `x`: north of it takes from lane 1, south of it from lane 2 */
    const arm = (n: number, x: number, lane: 1 | 2, extra: Part = {}): Part =>
        lane === 1
            ? { entity_number: n, name: "stack-inserter", position: { x: x + 0.5, y: -0.5 }, direction: 8, ...extra }
            : { entity_number: n, name: "stack-inserter", position: { x: x + 0.5, y: 1.5 }, direction: 0, ...extra };
    const chestAt = (n: number, x: number, lane: 1 | 2, name = "infinity-chest", settings: Part = { remove_unfiltered_items: true }): Part => ({
        entity_number: n, name, position: { x: x + 0.5, y: lane === 1 ? -1.5 : 2.5 }, ...(name === "infinity-chest" ? { infinity_settings: settings } : {}),
    });
    const throttle = (n: number, x: number, lane: 1 | 2): Part[] => [arm(n, x, lane), chestAt(n + 1, x, lane)];
    const taker = (n: number, x: number, lane: 1 | 2): Part[] => [arm(n, x, lane), chestAt(n + 1, x, lane, "steel-chest")];
    const FILTER = [{ index: 1, name: "iron-plate", quality: "normal", comparator: "=" }];
    const ANSWERS = { "lane-item:1:1": "iron-plate", "lane-item:1:2": "iron-plate", "lane-item:21:1": "iron-plate", "lane-item:21:2": "iron-plate" };

    const importOf = (entities: Part[]): ImportBuild =>
        buildOf(importBlueprint(pack({ blueprint: { item: "blueprint", version: VERSION_2, entities } }), { ...NO_RESEARCH, answers: ANSWERS }, DATA), "throttles");

    /** What an outcome holds of the lists, the lanes' ends, the notes and the entities' rows, one line each */
    function sketch(build: ImportBuild): string[] {
        const sourceLane = (end: object) => ("near_lane" in end ? ` lane ${end.near_lane}` : "");
        return [
            ...build.inserters.map((i) => `inserter ${i.id}: ${i.source.type} ${i.source.id}${sourceLane(i.source)} to ${i.sink.type} ${i.sink.id}${i.filters ? ` filters ${i.filters.join(" ")}` : ""}`),
            ...build.chests.map((c) => `chest ${c.id}: ${c.type}${c.type === "infinity-chest" ? ` removes ${c.remove_unfiltered_items}${c.item_filter ? ` filter ${JSON.stringify(c.item_filter)}` : ""}` : ""} at ${c.position?.x},${c.position?.y}`),
            ...build.belts.map((b) => `belt ${b.id}: ${b.lanes.map((l) => `${l.ingredient} ${l.lane_end?.kind ?? "none"}`).join(", ")}`),
            ...build.notes.map((n) => `note ${n.code} ${n.entity_number}${n.lane ? ` lane ${n.lane}` : ""}`),
            `rows ${build.entities.filter((e) => e.row).map((e) => `${e.entity_number}=${e.row!.list[0]}${e.row!.id}`).join(" ")}`,
        ];
    }
    const noRows = (build: ImportBuild, numbers: number[]) => numbers.every((n) => build.entities.find((e) => e.entity_number === n)!.row === undefined);

    const EXPORT = (n: number, lane: 1 | 2) => `lane-export:${n}:${lane}`;
    const keyed = (build: ImportBuild) => build.questions.map((q) => [q.key, q.kind, q.subject, q.candidates]);

    it("leaves out a throttle on lane 1 and its chest, and asks the rate of lane 1 with no end written for it", () => {
        const build = importOf([...beltRow(), ...throttle(10, 5, 1)]);
        expect(keyed(build)).toEqual([[EXPORT(1, 1), "lane-export", { label: "Belt 1", entity_number: 1, lane: 1, item: "iron-plate" }, []]]);
        expect(build.inserters).toEqual([]);
        expect(build.chests).toEqual([]);
        expect(build.belts.map((b) => [b.strategy, b.lanes.map((l) => l.lane_end)])).toEqual([[undefined, [undefined, { kind: "dead_end" }]]]);
        expect(build.notes.map((n) => [n.code, n.entity_number, n.lane ?? 0, n.please_check])).toEqual([
            ["default:lane-end", 1, 2, true],
            ["inserter-left-out:throttle", 10, 0, false],
            ["chest:throttle", 11, 0, false],
        ]);
        expect(noRows(build, [10, 11])).toBe(true);
    });

    it("leaves out a throttle on each lane, as the scaffold has them, and asks the rate of both lanes", () => {
        const build = importOf([...beltRow(), ...throttle(10, 5, 1), ...throttle(12, 5, 2)]);
        expect(build.questions.map((q) => q.key)).toEqual([EXPORT(1, 1), EXPORT(1, 2)]);
        expect(build.inserters).toEqual([]);
        expect(build.chests).toEqual([]);
        expect(build.belts.map((b) => b.lanes.map((l) => l.lane_end))).toEqual([[undefined, undefined]]);
        expect(build.notes.map((n) => [n.code, n.entity_number, n.lane ?? 0])).toEqual([
            ["inserter-left-out:throttle", 10, 0], ["chest:throttle", 11, 0], ["inserter-left-out:throttle", 12, 0], ["chest:throttle", 13, 0],
        ]);
    });

    it("leaves out two throttles that drop into one chest, each on the lane of its own line, and asks a lane of each line", () => {
        const build = importOf([...beltRow(), ...upperRow(), ...throttle(10, 5, 1), arm(20, 5, 1, { position: { x: 5.5, y: -2.5 }, direction: 0 })]);
        expect(keyed(build).map(([key, , subject]) => [key, (subject as { label: string }).label])).toEqual([[EXPORT(1, 1), "Belt 1"], [EXPORT(21, 2), "Belt 2"]]);
        expect(build.inserters).toEqual([]);
        expect(build.chests).toEqual([]);
        expect(build.belts.map((b) => b.lanes.map((l) => l.lane_end?.kind))).toEqual([[undefined, "dead_end"], ["dead_end", undefined]]);
        expect(build.notes.filter((n) => n.code.endsWith(":throttle")).map((n) => [n.code, n.entity_number])).toEqual([
            ["inserter-left-out:throttle", 10], ["chest:throttle", 11], ["inserter-left-out:throttle", 20],
        ]);
    });

    it("leaves out two throttles one after the other on one lane, and asks that lane once", () => {
        const build = importOf([...beltRow(), ...throttle(10, 3, 1), ...throttle(12, 5, 1)]);
        expect(build.questions.map((q) => q.key)).toEqual([EXPORT(1, 1)]);
        expect(build.inserters).toEqual([]);
        expect(build.chests).toEqual([]);
        expect(build.notes.filter((n) => n.code.endsWith(":throttle")).map((n) => [n.code, n.entity_number])).toEqual([
            ["inserter-left-out:throttle", 10], ["chest:throttle", 11], ["inserter-left-out:throttle", 12], ["chest:throttle", 13],
        ]);
    });

    it("keeps a real taker upstream of a throttle, with its id after the gap, and asks the lane's rate", () => {
        const build = importOf([...beltRow(), ...throttle(10, 5, 1), ...taker(30, 1, 1)]);
        expect(build.questions.map((q) => q.key)).toEqual([EXPORT(1, 1)]);
        expect(sketch(build)).toEqual([
            "inserter 2: belt 1 lane 1 to chest 2",
            "chest 2: buffer-chest at 1.5,-1.5",
            "belt 1: iron-plate none, iron-plate dead_end",
            "note default:lane-end 1 lane 2",
            "note inserter-left-out:throttle 10",
            "note chest:throttle 11",
            "rows 1=b1 2=b1 3=b1 4=b1 5=b1 6=b1 30=i2 31=c2",
        ]);
    });

    describe("the rate", () => {
        const withRate = (answers: Record<string, string>, entities: Part[] = [...beltRow(), ...throttle(10, 5, 1)]) =>
            buildOf(importBlueprint(pack({ blueprint: { item: "blueprint", version: VERSION_2, entities } }), { ...NO_RESEARCH, answers: { ...ANSWERS, ...answers } }, DATA), "throttles");

        it("writes the answered lane as an export at that rate with no end, the belt as an export belt, and leaves the other lane as it was", () => {
            const build = withRate({ [EXPORT(1, 1)]: "40" });
            expect(build.questions).toEqual([]);
            expect(build.belts).toEqual([expect.objectContaining({ strategy: "export", lanes: [{ ingredient: "iron-plate", stack_size: 1, consumption_per_second: 40 }, { ingredient: "iron-plate", stack_size: 1, lane_end: { kind: "dead_end" } }] })]);
            // the answered lane has no note; the other lane keeps its own
            expect(build.notes.filter((n) => n.code.endsWith("lane-end")).map((n) => [n.code, n.lane])).toEqual([["default:lane-end", 2]]);
        });

        it("takes a decimal and an exponent, as the number the text spells", () => {
            expect(withRate({ [EXPORT(1, 1)]: "2.5" }).belts[0].lanes[0]).toMatchObject({ consumption_per_second: 2.5 });
            expect(withRate({ [EXPORT(1, 1)]: "1e1" }).belts[0].lanes[0]).toMatchObject({ consumption_per_second: 10 });
        });

        it.each(["0", "-5", "abc", "", "Infinity", "40abc", " "])("leaves the question asked and writes nothing for the answer %j", (text) => {
            const build = withRate({ [EXPORT(1, 1)]: text });
            expect(build.questions.map((q) => q.key)).toEqual([EXPORT(1, 1)]);
            expect(build.belts[0].strategy).toBeUndefined();
            expect(build.belts[0].lanes[0]).toEqual({ ingredient: "iron-plate", stack_size: 1 });
        });

        it("asks the lane while its item is asked, with no item", () => {
            const asked = buildOf(importBlueprint(pack({ blueprint: { item: "blueprint", version: VERSION_2, entities: [...beltRow(), ...throttle(10, 5, 1)] } }), { ...NO_RESEARCH, answers: {} }, DATA), "throttles");
            expect(asked.questions.map((q) => [q.key, q.subject.item])).toEqual([["lane-item:1:1", undefined], ["lane-item:1:2", undefined], [EXPORT(1, 1), ""]]);
        });

        it("gives a belt with one answered throttle lane and one dead-end lane that the configuration reads", () => {
            const build = withRate({ [EXPORT(1, 1)]: "40" }, [...beltRow(), ...throttle(10, 5, 1), ...taker(30, 1, 2)]);
            const parsed = ConfigSchema.safeParse({ setpoint: { item: "iron-plate", items_per_second: 1, copies: 1 }, machines: build.machines, drills: { configs: build.drills },
                inserters: build.inserters, belts: build.belts, chests: build.chests, research: build.research });
            expect(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
        });
    });

    describe("the processing unit circuit export scaffold", () => {
        const text = () => read(path.join(ENGINE, "resources", "config-samples", "intermediates", "processing-unit", "processing-unit-80-circuit-export.scaffold")).trim();
        const research: ImportInputs["research"] = {
            profile: "save force", template: null,
            bonuses: { mining_drill_productivity_bonus: 79990.00000001134, inserter_stack_size_bonus: 3, bulk_inserter_capacity_bonus: 11, belt_stack_size_bonus: 3, recipes: { "processing-unit": { productivity_bonus: 250 } } },
        };
        const asked = (answers: Record<string, string>) => buildOf(importBlueprint(text(), { research, answers, setpoint: { item: "processing-unit", copies: 1 } }, DATA), "circuit export");
        const BOTH = { "lane-export:30:1": "40", "lane-export:30:2": "40" };

        it("asks the rate of each lane of the circuit belt, and leaves out its four throttles and their chests", () => {
            const build = asked({});
            expect(keyed(build)).toEqual([
                ["lane-export:30:1", "lane-export", { label: "Belt 3", entity_number: 30, lane: 1, item: "electronic-circuit" }, []],
                ["lane-export:30:2", "lane-export", { label: "Belt 3", entity_number: 30, lane: 2, item: "electronic-circuit" }, []],
            ]);
            // the four throttles (97, 99, 107 and 109) and their chests (96, 100, 106 and 110) are in no row
            for (const n of [96, 97, 99, 100, 106, 107, 109, 110]) expect(build.entities.find((e) => e.entity_number === n)!.row, `entity ${n}`).toBeUndefined();
            expect(build.notes.filter((n) => n.code.endsWith("lane-end") && n.entity_number === 30)).toEqual([]);
        });

        it("with 40 for each lane, gives the sample's export belt, and a build the generator takes", async () => {
            const build = asked(BOTH);
            expect(build.questions).toEqual([]);
            // belt 3 of the sample's export, with the saved force's belt stack size
            expect(build.belts.find((b) => b.id === 3)).toEqual({
                id: 3, type: "turbo-transport-belt", flow_direction: 4, strategy: "export",
                lanes: [{ ingredient: "electronic-circuit", stack_size: 4, consumption_per_second: 40 }, { ingredient: "electronic-circuit", stack_size: 4, consumption_per_second: 40 }],
            });
            expect(beltPickupSinkRefusal({ inserters: build.inserters, chests: build.chests, belts: build.belts })).toBeNull();
            const config = pasteConfigOf(build, pasteSetpointOf({ item: "processing-unit", items_per_second: 80, copies: 1 }, 1));
            await expect(parseConfig(JSON.stringify(config))).resolves.toBeDefined();
        });
    });

    describe("keeps the inserter and the chest, with today's outcome, where", () => {
        const unchanged = (entities: Part[]) => {
            const build = importOf(entities);
            expect(build.questions).toEqual([]);
            return sketch(build);
        };
        it("the chest has a filter", () => {
            expect(unchanged([...beltRow(), arm(10, 5, 1), chestAt(11, 5, 1, "infinity-chest", { remove_unfiltered_items: true, filters: [{ index: 1, name: "iron-plate", count: 50 }] })])).toMatchInlineSnapshot(`
              [
                "inserter 1: belt 1 lane 1 to chest 1",
                "chest 1: infinity-chest removes true filter [{"item_name":"iron-plate","request_count":50}] at 5.5,-1.5",
                "belt 1: iron-plate dead_end, iron-plate dead_end",
                "note default:lane-end 1 lane 1",
                "note default:lane-end 1 lane 2",
                "rows 1=b1 2=b1 3=b1 4=b1 5=b1 6=b1 10=i1 11=c1",
              ]
            `);
        });
        it("the chest does not remove unfiltered items", () => {
            expect(unchanged([...beltRow(), arm(10, 5, 1), chestAt(11, 5, 1, "infinity-chest", { remove_unfiltered_items: false })])).toMatchInlineSnapshot(`
              [
                "inserter 1: belt 1 lane 1 to chest 1",
                "chest 1: infinity-chest removes false at 5.5,-1.5",
                "belt 1: iron-plate dead_end, iron-plate dead_end",
                "note default:lane-end 1 lane 1",
                "note default:lane-end 1 lane 2",
                "rows 1=b1 2=b1 3=b1 4=b1 5=b1 6=b1 10=i1 11=c1",
              ]
            `);
        });
        it("an inserter takes from the chest", () => {
            expect(unchanged([...beltRow(), ...throttle(10, 5, 1), { entity_number: 30, name: "stack-inserter", position: { x: 6.5, y: -1.5 }, direction: 12 }, { entity_number: 31, name: "steel-chest", position: { x: 7.5, y: -1.5 } }])).toMatchInlineSnapshot(`
              [
                "inserter 1: belt 1 lane 1 to chest 1",
                "chest 1: infinity-chest removes true at 5.5,-1.5",
                "belt 1: iron-plate dead_end, iron-plate dead_end",
                "note default:lane-end 1 lane 1",
                "note default:lane-end 1 lane 2",
                "note inserter-left-out:drop 30",
                "rows 1=b1 2=b1 3=b1 4=b1 5=b1 6=b1 10=i1 11=c1",
              ]
            `);
        });
        it("a machine's output inserter also drops into the chest", () => {
            expect(unchanged([...beltRow(), ...throttle(10, 5, 1), { entity_number: 30, name: "assembling-machine-3", position: { x: 5.5, y: -4.5 }, recipe: "iron-gear-wheel" }, { entity_number: 31, name: "stack-inserter", position: { x: 5.5, y: -2.5 }, direction: 0 }])).toMatchInlineSnapshot(`
              [
                "inserter 1: belt 1 lane 1 to chest 1",
                "inserter 2: machine 1 to chest 1",
                "chest 1: infinity-chest removes true at 5.5,-1.5",
                "belt 1: iron-plate dead_end, iron-plate dead_end",
                "note default:lane-end 1 lane 1",
                "note default:lane-end 1 lane 2",
                "rows 1=b1 2=b1 3=b1 4=b1 5=b1 6=b1 10=i1 11=c1 30=m1 31=i2",
              ]
            `);
        });
        it("the inserter has a filter", () => {
            expect(unchanged([...beltRow(), arm(10, 5, 1, { use_filters: true, filters: FILTER }), chestAt(11, 5, 1)])).toMatchInlineSnapshot(`
              [
                "inserter 1: belt 1 lane 1 to chest 1 filters iron-plate",
                "chest 1: infinity-chest removes true at 5.5,-1.5",
                "belt 1: iron-plate dead_end, iron-plate dead_end",
                "note default:lane-end 1 lane 1",
                "note default:lane-end 1 lane 2",
                "rows 1=b1 2=b1 3=b1 4=b1 5=b1 6=b1 10=i1 11=c1",
              ]
            `);
        });
        it("the pickup has no near lane", () => {
            expect(unchanged([...beltRow(), { entity_number: 10, name: "stack-inserter", position: { x: 6.5, y: 0.5 }, direction: 12 }, { entity_number: 11, name: "infinity-chest", position: { x: 7.5, y: 0.5 }, infinity_settings: { remove_unfiltered_items: true } }])).toMatchInlineSnapshot(`
              [
                "inserter 1: belt 1 to chest 1",
                "chest 1: infinity-chest removes true at 7.5,0.5",
                "belt 1: iron-plate dead_end, iron-plate dead_end",
                "note default:lane-end 1 lane 1",
                "note default:lane-end 1 lane 2",
                "note pickup:inline 10",
                "rows 1=b1 2=b1 3=b1 4=b1 5=b1 6=b1 10=i1 11=c1",
              ]
            `);
        });
        it("a taker of the lane that is not a throttle is downstream", () => {
            expect(unchanged([...beltRow(), ...throttle(10, 3, 1), ...taker(30, 5, 1)])).toMatchInlineSnapshot(`
              [
                "inserter 1: belt 1 lane 1 to chest 1",
                "inserter 2: belt 1 lane 1 to chest 2",
                "chest 1: infinity-chest removes true at 3.5,-1.5",
                "chest 2: buffer-chest at 5.5,-1.5",
                "belt 1: iron-plate dead_end, iron-plate dead_end",
                "note default:lane-end 1 lane 1",
                "note default:lane-end 1 lane 2",
                "rows 1=b1 2=b1 3=b1 4=b1 5=b1 6=b1 10=i1 11=c1 30=i2 31=c2",
              ]
            `);
        });
        it("the chest is a steel chest", () => {
            expect(unchanged([...beltRow(), arm(10, 5, 1), chestAt(11, 5, 1, "steel-chest")])).toMatchInlineSnapshot(`
              [
                "inserter 1: belt 1 lane 1 to chest 1",
                "chest 1: buffer-chest at 5.5,-1.5",
                "belt 1: iron-plate dead_end, iron-plate dead_end",
                "note default:lane-end 1 lane 1",
                "note default:lane-end 1 lane 2",
                "rows 1=b1 2=b1 3=b1 4=b1 5=b1 6=b1 10=i1 11=c1",
              ]
            `);
        });
    });
});
