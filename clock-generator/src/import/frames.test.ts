import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { decodeBlueprint } from "./decode";
import { FrameBlueprintEntity, FrameRead, TRANSFORMS, TransformName, candidateFrames, frameOf, turnedDirection } from "./frames";

const ENGINE = path.resolve(__dirname, "../..");
const SAMPLES = path.join(ENGINE, "resources", "config-samples");
const READS = path.join(__dirname, "fixtures", "assemble", "reads");
const read = (file: string) => fs.readFileSync(file, "utf8");

type FixtureRow = {
    build: string;
    scaffold: string;
    read: string;
    transform: TransformName;
    translation: { x: number; y: number };
    placed: number;
    reads: number;
    tie_count: number;
    mirrored: boolean;
};
const FIXTURE = JSON.parse(read(path.join(__dirname, "fixtures", "ids", "frames.json"))) as { rows: FixtureRow[] };

type Position = { x: number; y: number };
type ReadFile = {
    machines?: { prototype?: string; position?: Position }[];
    drills?: { configs?: { type: string; position?: Position }[] };
    chests?: { type: string; prototype?: string; position?: Position }[];
    inserters?: { prototype?: string; position?: Position; direction?: number }[];
};

/** The drills of a read: a read with none holds an empty record where the list would be */
const drillsOf = (file: ReadFile) => (Array.isArray(file.drills?.configs) ? file.drills!.configs : []);

/** The entities of a read that have a position: machines and inserters by their prototype, drills by their type, chests by their prototype else their type */
function readsOf(file: ReadFile): FrameRead[] {
    const out: FrameRead[] = [];
    for (const r of file.machines ?? []) if (r.position) out.push({ kind: "machine", name: r.prototype as string, position: r.position });
    for (const r of drillsOf(file)) if (r.position) out.push({ kind: "drill", name: r.type, position: r.position });
    for (const r of file.chests ?? []) if (r.position) out.push({ kind: "chest", name: (r.prototype || r.type) as string, position: r.position });
    for (const r of file.inserters ?? []) if (r.position) out.push({ kind: "inserter", name: r.prototype as string, position: r.position, direction: r.direction });
    return out;
}

function blueprintOf(file: string): FrameBlueprintEntity[] {
    const outcome = decodeBlueprint(read(file).trim());
    if (outcome.kind !== "blueprint") throw new Error(`not a blueprint: ${file}`);
    return outcome.entities;
}

describe("the frame of each of the 10 repository builds", () => {
    for (const row of FIXTURE.rows) {
        it(`gives ${row.build} the fixture's transform, translation, placed count, tie count and mirror`, () => {
            const blueprint = blueprintOf(path.join(SAMPLES, row.scaffold));
            const reads = readsOf(JSON.parse(read(row.read.endsWith(".sidecar-export.json") ? path.join(READS, `${row.build}.json`) : path.join(SAMPLES, row.read))) as ReadFile);
            const frame = frameOf(blueprint, reads);
            expect(frame).not.toBeNull();
            expect({ transform: frame!.transform, translation: frame!.translation, placed: frame!.placed, reads: frame!.reads, tie_count: frame!.tie_count, mirrored: frame!.mirrored }).toEqual({
                transform: row.transform,
                translation: row.translation,
                placed: row.placed,
                reads: row.reads,
                tie_count: row.tie_count,
                mirrored: row.mirrored,
            });
        });
    }

    it("turns processing unit 80 by 270 degrees and utility 320 by a transpose", () => {
        const byName = new Map(FIXTURE.rows.map((r) => [r.build, r]));
        expect(byName.get("processing-unit-80")).toMatchObject({ transform: "rotate 270", mirrored: false });
        expect(byName.get("utility-320")).toMatchObject({ transform: "transpose", mirrored: true, placed: 24, reads: 30 });
        expect(FIXTURE.rows).toHaveLength(10);
    });
});

describe("directions under the 8 transforms", () => {
    // the blueprint's 16-way codes for north, east, south and west, each turned by the transform
    const EXPECTED: Record<TransformName, number[]> = {
        identity: [0, 4, 8, 12],
        transpose: [12, 8, 4, 0],
        "rotate 90": [4, 8, 12, 0],
        "rotate 180": [8, 12, 0, 4],
        "rotate 270": [12, 0, 4, 8],
        "mirror x": [0, 12, 8, 4],
        "mirror y": [8, 4, 0, 12],
        "anti-transpose": [4, 0, 12, 8],
    };

    for (const { name, matrix } of TRANSFORMS) {
        it(`turns north, east, south and west by ${name}`, () => {
            expect([0, 4, 8, 12].map((d) => turnedDirection(matrix, d))).toEqual(EXPECTED[name]);
        });
    }

    it("gives no direction for a code between the four", () => {
        expect(turnedDirection(TRANSFORMS[0].matrix, 2)).toBeNull();
    });
});

describe("a blueprint laid on a read by each transform", () => {
    // a build with no symmetry: three machines, a drill, a chest and two inserters that face two ways
    const blueprint: FrameBlueprintEntity[] = [
        { name: "assembling-machine-2", position: { x: 0.5, y: 0.5 } },
        { name: "assembling-machine-2", position: { x: 6.5, y: 0.5 } },
        { name: "electric-furnace", position: { x: 6.5, y: 5.5 } },
        { name: "big-mining-drill", position: { x: -4.5, y: 3.5 }, direction: 4 },
        { name: "steel-chest", position: { x: 10.5, y: 9.5 } },
        { name: "stack-inserter", position: { x: 3.5, y: 0.5 }, direction: 4 },
        { name: "stack-inserter", position: { x: 6.5, y: 3.5 }, direction: 8 },
    ];
    const kindOf = (name: string): FrameRead["kind"] => (name === "stack-inserter" ? "inserter" : name === "big-mining-drill" ? "drill" : name === "steel-chest" ? "chest" : "machine");

    for (const { name, matrix } of TRANSFORMS) {
        it(`finds ${name}, its translation and whether it mirrors`, () => {
            const [a, b, c, d] = matrix;
            const reads: FrameRead[] = blueprint.map((e) => ({
                kind: kindOf(e.name),
                name: e.name,
                position: { x: a * e.position.x + b * e.position.y + 100, y: c * e.position.x + d * e.position.y - 40 },
                ...(e.direction === undefined ? {} : { direction: turnedDirection(matrix, e.direction) as number }),
            }));
            const frame = frameOf(blueprint, reads);
            expect(frame).toMatchObject({ transform: name, translation: { x: 100, y: -40 }, placed: 7, reads: 7, tie_count: 1, mirrored: a * d - b * c < 0 });
        });
    }

    it("reports a mirroring transform as mirrored and a turn as not", () => {
        const mirrored = TRANSFORMS.filter(({ matrix }) => matrix[0] * matrix[3] - matrix[1] * matrix[2] < 0).map((t) => t.name);
        expect(mirrored).toEqual(["transpose", "mirror x", "mirror y", "anti-transpose"]);
    });
});

describe("the tie rule", () => {
    const blueprint: FrameBlueprintEntity[] = [
        { name: "steel-chest", position: { x: 0.5, y: 0.5 } },
        { name: "steel-chest", position: { x: 4.5, y: 0.5 } },
    ];

    it("takes, among frames that place the same reads, the first transform in the list, then the smallest translation by x, then y", () => {
        // one read chest: it lies on either blueprint chest, under each of the 8 transforms
        const reads: FrameRead[] = [{ kind: "chest", name: "steel-chest", position: { x: 10.5, y: 10.5 } }];
        const all = candidateFrames(blueprint, reads);
        expect(all.every((f) => f.placed === 1 && f.tie_count === all.length)).toBe(true);
        expect(all[0]).toMatchObject({ transform: "identity", translation: { x: 6, y: 10 } });
        const second = all.find((f) => f.transform === "identity" && f.translation.x === 10)!;
        expect(second.translation).toEqual({ x: 10, y: 10 });
        expect(all.map((f) => f.transform).slice(0, 4)).toEqual(["identity", "identity", "transpose", "transpose"]);
    });

    it("prefers the frame that places more reads, then the one that agrees on more inserter directions", () => {
        const withInserters: FrameBlueprintEntity[] = [
            { name: "stack-inserter", position: { x: 0.5, y: 0.5 }, direction: 4 },
            { name: "stack-inserter", position: { x: 4.5, y: 0.5 }, direction: 8 },
        ];
        const reads: FrameRead[] = [
            { kind: "inserter", name: "stack-inserter", position: { x: 14.5, y: 0.5 }, direction: 8 },
            { kind: "inserter", name: "stack-inserter", position: { x: 10.5, y: 0.5 }, direction: 4 },
        ];
        const frame = frameOf(withInserters, reads)!;
        expect(frame).toMatchObject({ transform: "identity", translation: { x: 10, y: 0 }, placed: 2, tie_count: 1 });
        // a read that matches nothing is not placed, and gives no frame where no name matches
        expect(frameOf(withInserters, [{ kind: "chest", name: "unknown", position: { x: 0, y: 0 } }])).toBeNull();
        expect(frameOf(withInserters, [])).toBeNull();
    });
});
