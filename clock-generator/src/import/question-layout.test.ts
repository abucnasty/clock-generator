/**
 * The numbers of the questions and what the layout view draws of them: each belt line and each drill has the place its
 * question names it by, each inserter has the lines at its belt ends, and the rows that an open question holds back come
 * in the same numbers. Held over every build of the import's fixtures, pasted with two copies so that the sharing
 * questions come too.
 */
import fs from "fs";
import pako from "pako";
import path from "path";
import { describe, expect, it } from "vitest";
import type { FactorioData } from "../data/factorio-data-types";
import { geometryDataOf, worldDataOf } from "./assemble";
import { decodeBlueprint } from "./decode";
import { geometryOf } from "./geometry";
import { importBlueprint, type ImportBuild, type ImportInputs, type ImportOutcome } from "./index";
import { worldOf } from "./world";

const ENGINE = path.resolve(__dirname, "../..");
const FIXTURES = path.join(__dirname, "fixtures", "assemble");
const read = (file: string) => fs.readFileSync(file, "utf8");
const DATA = JSON.parse(read(path.join(ENGINE, "resources", "data-filtered.json"))) as FactorioData;

type Point = { x: number; y: number };
type Tier1Build = {
    name: string;
    blueprint: string;
    read: string;
    read_kind: "export" | "config" | "capture";
    frame: { transform: "identity"; translation: Point };
    research: ImportInputs["research"];
    setpoint: { item: string; copies: number };
};
const TIER1 = (JSON.parse(read(path.join(FIXTURES, "tier1.json"))) as { builds: Tier1Build[] }).builds;

type Raw = Record<string, unknown>;
type End = { type: string; id: number };
type ReadLane = { ingredient?: string; sharing?: string };
type ReadBelt = { id: number; lanes?: ReadLane[] };
type ReadFile = {
    drills?: { configs?: (Raw & { position?: Point; mined_item_name?: string })[] };
    inserters?: (Raw & { position?: Point; source: End; sink: End })[];
    belts?: ReadBelt[];
};

const COPIES = 2;
const inputsOf = (build: Tier1Build, answers: Record<string, string>): ImportInputs => ({
    research: build.research,
    answers,
    setpoint: { ...build.setpoint, copies: COPIES },
});

function buildOf(outcome: ImportOutcome, what: string): ImportBuild {
    if (outcome.kind !== "build") throw new Error(`${what}: the problem ${outcome.problem}`);
    return outcome;
}

const samePoint = (a: Point | undefined, b: Point | undefined, translation: Point) =>
    a !== undefined && b !== undefined && a.x - translation.x === b.x && a.y - translation.y === b.y;

/** Every outcome of a build as its questions are answered with the values of its read (the rule of the import's own test), and the keys left unanswered */
type Asked = { build: { name: string }; text: string; rounds: ImportBuild[]; settled: ImportBuild; unanswered: string[] };

/** Asks a text again with the answers so far, until no question is left that the rule can answer */
function settleText(build: { name: string }, text: string, inputsOf: (answers: Record<string, string>) => ImportInputs, answerOf: (q: ImportBuild["questions"][number]) => string | undefined): Asked {
    const answers: Record<string, string> = {};
    const unanswered = new Set<string>();
    let outcome = buildOf(importBlueprint(text, inputsOf({}), DATA), build.name);
    const rounds = [outcome];
    for (let round = 0; round < 12; round += 1) {
        const fresh = outcome.questions.filter((q) => answers[q.key] === undefined && !unanswered.has(q.key));
        if (fresh.length === 0) return { build, text, rounds, settled: outcome, unanswered: [...unanswered] };
        for (const q of fresh) {
            const answer = answerOf(q);
            if (answer === undefined) unanswered.add(q.key);
            else answers[q.key] = answer;
        }
        outcome = buildOf(importBlueprint(text, inputsOf(answers), DATA), build.name);
        rounds.push(outcome);
    }
    throw new Error(`${build.name}: the answers did not settle`);
}

function askedOf(build: Tier1Build): Asked {
    const text = read(path.join(ENGINE, build.blueprint)).trim();
    const decoded = decodeBlueprint(text);
    if (decoded.kind !== "blueprint") throw new Error(`${build.name}: not a blueprint`);
    const entities = decoded.entities;
    const world = worldOf(entities, worldDataOf(DATA));
    const geometry = geometryOf(world, entities, geometryDataOf(DATA));
    const source = JSON.parse(read(build.read_kind === "config" ? path.join(ENGINE, build.blueprint.replace(/\.scaffold$/, ".json")) : path.join(FIXTURES, build.read))) as ReadFile;
    const t = build.frame.translation;
    const at = (n: number) => entities.find((e) => e.entity_number === n)?.position;
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
        if (q.kind === "drill-ore") return (source.drills?.configs ?? []).find((d) => samePoint(d.position, at(q.subject.entity_number), t))?.mined_item_name;
        const belt = beltAtLine(q.subject.entity_number);
        if (q.kind === "lane-item") {
            const lanes = belt?.lanes ?? [];
            if (lanes.length === 2) return lanes[(q.subject.lane as number) - 1].ingredient;
            return lanes.length === 1 && q.subject.lane === 2 ? lanes[0].ingredient : undefined;
        }
        return (belt?.lanes ?? []).find((l) => l.sharing !== undefined)?.sharing ?? "shared";
    };

    return settleText(build, text, (answers) => inputsOf(build, answers), answerOf);
}

/** A blueprint string for a JSON text, as the game writes them: a zero, then base64 of the deflated text */
const pack = (json: unknown): string => "0" + Buffer.from(pako.deflate(new TextEncoder().encode(JSON.stringify(json)))).toString("base64");
const VERSION_2 = 2 * 2 ** 48 + 1 * 2 ** 32 + 25 * 2 ** 16 + 10;

/**
 * A belt of four pieces that nothing puts items on, with a taker into a machine that makes logistic science packs and a
 * taker into a chest: both lanes are asked, and an answer to one lane fills the other. No public build asks a lane question.
 */
function twoLanesAsked(): string {
    const belt = (entity_number: number, y: number) => ({ entity_number, name: "transport-belt", position: { x: 0.5, y }, direction: 8 });
    const entities = [
        belt(1, 0.5), belt(2, 1.5), belt(3, 2.5), belt(4, 3.5),
        { entity_number: 5, name: "stack-inserter", position: { x: 1.5, y: 0.5 }, direction: 12 },
        { entity_number: 6, name: "assembling-machine-3", position: { x: 3.5, y: 0.5 }, recipe: "logistic-science-pack" },
        { entity_number: 7, name: "stack-inserter", position: { x: 1.5, y: 3.5 }, direction: 12 },
        { entity_number: 8, name: "steel-chest", position: { x: 2.5, y: 3.5 } },
    ];
    return pack({ blueprint: { item: "blueprint", version: VERSION_2, entities } });
}
const HAND_LANES: Record<string, string> = { "lane-item:1:1": "inserter", "lane-item:1:2": "transport-belt" };
const byHand = (answers: Record<string, string>): ImportInputs => ({ research: TIER1[0].research, answers, setpoint: { copies: COPIES } });

const ASKED = [
    ...TIER1.map(askedOf),
    settleText({ name: "two lanes asked" }, twoLanesAsked(), byHand, (q) => HAND_LANES[q.key] ?? (q.kind === "lane-sharing" ? "shared" : undefined)),
];
const ROUNDS = ASKED.flatMap((a) => a.rounds.map((outcome, round) => ({ name: `${a.build.name} round ${round}`, build: a.build, outcome, asked: a })));

const decodedOf = (asked: Asked) => {
    const decoded = decodeBlueprint(asked.text);
    if (decoded.kind !== "blueprint") throw new Error("not a blueprint");
    return decoded.entities;
};

describe("the numbers of the questions", () => {
    it("each question's label number is the place of its line or of its drill, and some belt question is seen", () => {
        let beltQuestions = 0;
        for (const { name, outcome } of ROUNDS) {
            const { lines, drills } = outcome.layout;
            for (const q of outcome.questions) {
                const number = Number(/^(?:Belt|Drill) (\d+)$/.exec(q.subject.label)?.[1]);
                const place = q.kind === "drill-ore"
                    ? drills.find((d) => d.entity_number === q.subject.entity_number)?.place
                    : lines.find((l) => l.first === q.subject.entity_number)?.place;
                expect(number, `${name} ${q.key}`).toBe(place);
                if (q.kind !== "drill-ore") beltQuestions += 1;
            }
        }
        expect(beltQuestions).toBeGreaterThan(0);
    });

    it("no two lines share a place and no two drills share one", () => {
        for (const { name, outcome } of ROUNDS) {
            const linePlaces = outcome.layout.lines.map((l) => l.place);
            const drillPlaces = outcome.layout.drills.map((d) => d.place);
            expect(new Set(linePlaces).size, name).toBe(linePlaces.length);
            expect(new Set(drillPlaces).size, name).toBe(drillPlaces.length);
            expect(linePlaces.every((p) => Number.isInteger(p) && p >= 1), name).toBe(true);
        }
        expect(ROUNDS.some(({ outcome }) => outcome.layout.lines.length > 0)).toBe(true);
        expect(ROUNDS.some(({ outcome }) => outcome.layout.drills.length > 0)).toBe(true);
    });

    it("a line's belt id is a belt of the list, with one lane line for each of its lanes", () => {
        for (const { name, outcome } of ROUNDS) {
            for (const line of outcome.layout.lines) {
                if (line.belt === null) {
                    expect(line.lane_lines, `${name} line ${line.first}`).toEqual([1, 2]);
                    continue;
                }
                const belt = outcome.belts.find((b) => b.id === line.belt);
                expect(belt, `${name} line ${line.first}`).toBeDefined();
                if (line.lane_lines !== null) expect(line.lane_lines.length, `${name} line ${line.first}`).toBe(belt!.lanes.length);
            }
        }
    });
});

describe("the inserters of the layout", () => {
    it("each inserter whose two ends are a listed or held-back entity is in exactly one of the lists and the held-back rows, and its belt ends name lines", () => {
        let held = 0;
        for (const asked of ASKED) {
            const decoded = decodeBlueprint(asked.text);
            if (decoded.kind !== "blueprint") throw new Error("not a blueprint");
            const world = worldOf(decoded.entities, worldDataOf(DATA));
            const geometry = geometryOf(world, decoded.entities, geometryDataOf(DATA));
            for (const [round, outcome] of asked.rounds.entries()) {
                const name = `${asked.build.name} round ${round}`;
                const rowOf = new Map(outcome.entities.flatMap((e) => (e.row ? [[e.entity_number, e.row] as const] : [])));
                const lineOfPiece = new Map(outcome.layout.lines.flatMap((l) => geometry.lines.find((g) => g.first === l.first)!.pieces.map((p) => [p, l] as const)));
                const heldBeltIds = new Set(outcome.layout.held_back.belts.map((b) => b.id));
                const drawn = (end: (typeof geometry.ends)[number]["source"]): boolean => {
                    if (end === null || end === undefined) return false;
                    if (end.target === "belt") {
                        const line = lineOfPiece.get(end.entity_number);
                        return line !== undefined && (line.belt !== null || heldBeltIds.has(line.place));
                    }
                    return rowOf.get(end.entity_number)?.list === (end.target === "chest" ? "chests" : "machines");
                };
                const heldBack = outcome.layout.inserter_lines.filter((i) => i.held_back).map((i) => i.entity_number);
                held += heldBack.length;
                for (const end of geometry.ends) {
                    if (!drawn(end.source) || !drawn(end.sink)) continue;
                    const inList = rowOf.get(end.inserter)?.list === "inserters" ? 1 : 0;
                    const inHeld = heldBack.filter((n) => n === end.inserter).length;
                    expect(inList + inHeld, `${name} inserter ${end.inserter}`).toBe(1);
                }
                const lineFirsts = new Set(outcome.layout.lines.map((l) => l.first));
                for (const row of outcome.layout.inserter_lines) {
                    for (const first of [row.source_line, row.sink_line]) if (first !== null) expect(lineFirsts.has(first), `${name} inserter ${row.entity_number}`).toBe(true);
                }
                expect(outcome.layout.held_back.inserters.length, name).toBe(heldBack.length);
            }
        }
        expect(held).toBeGreaterThan(0);
    });

    it("each belt end of a kept inserter is on the line whose belt id the inserter's end holds", () => {
        for (const { name, outcome } of ROUNDS) {
            const byId = new Map(outcome.layout.inserter_lines.filter((i) => !i.held_back).map((i) => [i.id, i]));
            const lineOf = new Map(outcome.layout.lines.map((l) => [l.first, l]));
            for (const inserter of outcome.inserters) {
                const row = byId.get(inserter.id as number);
                expect(row, `${name} inserter ${inserter.id}`).toBeDefined();
                for (const [end, first] of [[inserter.source, row!.source_line], [inserter.sink, row!.sink_line]] as const) {
                    if (end.type !== "belt") expect(first, `${name} inserter ${inserter.id}`).toBeNull();
                    else expect(lineOf.get(first as number)?.belt, `${name} inserter ${inserter.id}`).toBe(end.id);
                }
            }
        }
    });
});

describe("the pieces of the layout", () => {
    it("each piece an inserter end reaches is listed with the blueprint's own position and direction, north where it leaves the direction out", () => {
        let pieces = 0;
        for (const asked of ASKED) {
            const entities = decodedOf(asked);
            const world = worldOf(entities, worldDataOf(DATA));
            const geometry = geometryOf(world, entities, geometryDataOf(DATA));
            const reached = new Set(geometry.ends.flatMap((e) => [e.source, e.sink]).flatMap((end) => (end && end.target === "belt" ? [end.entity_number] : [])));
            const listed = new Set<number>();
            for (const line of asked.settled.layout.lines) {
                for (const piece of line.pieces) {
                    const entity = entities.find((e) => e.entity_number === piece.entity_number)!;
                    expect(piece.x, `${asked.build.name} piece ${piece.entity_number}`).toBe(entity.position.x);
                    expect(piece.y, `${asked.build.name} piece ${piece.entity_number}`).toBe(entity.position.y);
                    expect(piece.direction, `${asked.build.name} piece ${piece.entity_number}`).toBe(entity.direction ?? 0);
                    const placed = world.piece(piece.entity_number)!;
                    expect(piece.shape, `${asked.build.name} piece ${piece.entity_number}`).toBe(placed.shape);
                    listed.add(piece.entity_number);
                    pieces += 1;
                }
            }
            expect([...listed].sort((a, b) => a - b), asked.build.name).toEqual([...reached].sort((a, b) => a - b));
        }
        expect(pieces).toBeGreaterThan(0);
    });
});

describe("the rows the questions hold back", () => {
    it("a line whose other lane the import fills is a belt of the lists after one answer, with no row held back", () => {
        const text = twoLanesAsked();
        const asked = buildOf(importBlueprint(text, byHand({}), DATA), "two lanes asked");
        expect(asked.questions.map((q) => q.key)).toEqual(["lane-item:1:1", "lane-item:1:2", "lane-sharing:1"]);
        expect(asked.layout.held_back.belts.map((b) => b.id)).toEqual([1]);
        // the taker into the steel chest has no chest row to draw, so only the taker into the machine is held back
        expect(asked.layout.held_back.inserters.map((i) => i.id)).toEqual([1]);
        const filled = buildOf(importBlueprint(text, byHand({ "lane-item:1:1": "inserter" }), DATA), "two lanes asked");
        expect(filled.questions.map((q) => q.key)).toEqual(["lane-sharing:1"]);
        expect(filled.layout.held_back).toEqual({ belts: [], inserters: [], drills: [] });
        expect(filled.layout.lines.map((l) => [l.place, l.belt, l.lane_lines])).toEqual([[1, 1, [1, 2]]]);
        expect(filled.belts.map((b) => b.lanes.map((l) => l.ingredient))).toEqual([["inserter", "transport-belt"]]);
    });

    it("a line with an open lane question is a belt row with its place as id, its asked lane without an item", () => {
        let checked = 0;
        for (const { name, outcome } of ROUNDS) {
            for (const q of outcome.questions.filter((it) => it.kind === "lane-item")) {
                const line = outcome.layout.lines.find((l) => l.first === q.subject.entity_number)!;
                const row = outcome.layout.held_back.belts.find((b) => b.id === line.place);
                expect(row, `${name} ${q.key}`).toBeDefined();
                expect(row!.lanes[(q.subject.lane as number) - 1].ingredient, `${name} ${q.key}`).toBe("");
                expect(line.belt, `${name} ${q.key}`).toBeNull();
                checked += 1;
            }
        }
        expect(checked).toBeGreaterThan(0);
    });

    it("the held-back ids stay apart from the kept ones in their lists", () => {
        for (const { name, outcome } of ROUNDS) {
            const kept = new Set(outcome.inserters.map((i) => i.id));
            for (const row of outcome.layout.held_back.inserters) expect(kept.has(row.id), `${name} inserter ${row.id}`).toBe(false);
            const held = outcome.layout.held_back.inserters.map((i) => i.id);
            expect(new Set(held).size, name).toBe(held.length);
        }
    });

    it("with every question answered with the build's values, no row is held back", () => {
        for (const asked of ASKED) {
            // a build whose rule leaves a key unanswered is named in the report and left out here
            if (asked.unanswered.length > 0) continue;
            const { held_back } = asked.settled.layout;
            expect(held_back, asked.build.name).toEqual({ belts: [], inserters: [], drills: [] });
            expect(asked.settled.layout.inserter_lines.some((i) => i.held_back), asked.build.name).toBe(false);
        }
    });

    it("a drill whose ore is asked is a drill row with its place as id and no ore", () => {
        let checked = 0;
        for (const { name, outcome } of ROUNDS) {
            for (const q of outcome.questions.filter((it) => it.kind === "drill-ore")) {
                const drill = outcome.layout.drills.find((d) => d.entity_number === q.subject.entity_number)!;
                const row = outcome.layout.held_back.drills.find((d) => d.id === drill.place);
                expect(row, `${name} ${q.key}`).toBeDefined();
                expect(row!.mined_item_name, `${name} ${q.key}`).toBe("");
                expect(drill.drill, `${name} ${q.key}`).toBeNull();
                checked += 1;
            }
        }
        expect(checked).toBeGreaterThan(0);
    });
});
