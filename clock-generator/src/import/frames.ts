/**
 * The frame of a pasted blueprint on a read: which of the 8 turns and mirrors of the plane, and which translation,
 * lays the blueprint's entities on the read's. A test tool, not a step of the import: it lets a test pair the entities
 * of a blueprint with those of a read of the same build (a configuration that a game export wrote), whose ids come in
 * another order.
 *
 * Convention: read = M x blueprint + translation, where the matrix `[a, b, c, d]` takes `(x, y)` to
 * `(a x + b y, c x + d y)`, x pointing east and y south. Positions are compared exactly.
 */

export type FramePoint = { x: number; y: number };

/** The entities of a blueprint that a frame reads: a name, a position and the direction as the blueprint writes it */
export type FrameBlueprintEntity = { name: string; position: FramePoint; direction?: number };

export type FrameReadKind = "machine" | "drill" | "chest" | "inserter";

/** An entity of a read that has a position. The name is the prototype name; `kind` tells an inserter, whose direction counts */
export type FrameRead = { kind: FrameReadKind; name: string; position: FramePoint; direction?: number };

export type TransformName = "identity" | "transpose" | "rotate 90" | "rotate 180" | "rotate 270" | "mirror x" | "mirror y" | "anti-transpose";
export type Matrix = readonly [number, number, number, number];

/** The 8 transforms in the order that ties are broken in */
export const TRANSFORMS: readonly { name: TransformName; matrix: Matrix }[] = [
    { name: "identity", matrix: [1, 0, 0, 1] },
    { name: "transpose", matrix: [0, 1, 1, 0] },
    { name: "rotate 90", matrix: [0, -1, 1, 0] },
    { name: "rotate 180", matrix: [-1, 0, 0, -1] },
    { name: "rotate 270", matrix: [0, 1, -1, 0] },
    { name: "mirror x", matrix: [-1, 0, 0, 1] },
    { name: "mirror y", matrix: [1, 0, 0, -1] },
    { name: "anti-transpose", matrix: [0, -1, -1, 0] },
];

export type Frame = {
    transform: TransformName;
    matrix: [number, number, number, number];
    translation: FramePoint;
    /** The reads that stand on a blueprint entity of their name under this frame */
    placed: number;
    /** All the reads */
    reads: number;
    /** The candidates equal to this one on the number placed and the number of inserter directions that agree */
    tie_count: number;
    /** True where the transform turns the plane over: `a d - b c < 0` */
    mirrored: boolean;
};

/** A direction as the blueprint writes it (0 north, 4 east, 8 south, 12 west), by the unit step it points along */
const STEP: Record<number, [number, number]> = { 0: [0, -1], 4: [1, 0], 8: [0, 1], 12: [-1, 0] };
const DIRECTION_OF = new Map<string, number>(Object.entries(STEP).map(([direction, [x, y]]) => [`${x},${y}`, Number(direction)]));

/** A direction after a transform, or null for one of the 16-way codes between the four */
export function turnedDirection(matrix: Matrix, direction: number): number | null {
    const step = STEP[direction];
    if (step === undefined) return null;
    const [a, b, c, d] = matrix;
    const x = a * step[0] + b * step[1] + 0;
    const y = c * step[0] + d * step[1] + 0;
    return DIRECTION_OF.get(`${x},${y}`) ?? null;
}

const spot = (name: string, x: number, y: number) => `${name}@${x + 0},${y + 0}`;

type Candidate = {
    transform: TransformName;
    place: number;
    matrix: Matrix;
    tx: number;
    ty: number;
    placed: number;
    equal: number;
};

/**
 * Every frame that puts at least one read on a blueprint entity of its name, best first. The keys, in order:
 * the most reads placed; the most placed inserters whose direction, turned by the transform, is the read's; the
 * transform's place in `TRANSFORMS`; the smallest translation by x, then by y.
 */
export function candidateFrames(blueprint: readonly FrameBlueprintEntity[], reads: readonly FrameRead[]): Frame[] {
    const candidates: Candidate[] = [];
    TRANSFORMS.forEach(({ name, matrix }, place) => {
        const [a, b, c, d] = matrix;
        const at = new Map<string, FrameBlueprintEntity>();
        const byName = new Map<string, { x: number; y: number }[]>();
        for (const e of blueprint) {
            const x = a * e.position.x + b * e.position.y;
            const y = c * e.position.x + d * e.position.y;
            at.set(spot(e.name, x, y), e);
            const list = byName.get(e.name);
            if (list) list.push({ x, y });
            else byName.set(e.name, [{ x, y }]);
        }
        const seen = new Set<string>();
        for (const read of reads) {
            for (const q of byName.get(read.name) ?? []) {
                const tx = read.position.x - q.x;
                const ty = read.position.y - q.y;
                const key = `${tx + 0},${ty + 0}`;
                if (seen.has(key)) continue;
                seen.add(key);
                let placed = 0;
                let equal = 0;
                for (const r of reads) {
                    const e = at.get(spot(r.name, r.position.x - tx, r.position.y - ty));
                    if (e === undefined) continue;
                    placed += 1;
                    if (r.kind === "inserter" && r.direction !== undefined && turnedDirection(matrix, e.direction ?? 0) === r.direction) equal += 1;
                }
                candidates.push({ transform: name, place, matrix, tx: tx + 0, ty: ty + 0, placed, equal });
            }
        }
    });
    candidates.sort((p, q) => q.placed - p.placed || q.equal - p.equal || p.place - q.place || p.tx - q.tx || p.ty - q.ty);
    const ties = new Map<string, number>();
    for (const cand of candidates) ties.set(`${cand.placed},${cand.equal}`, (ties.get(`${cand.placed},${cand.equal}`) ?? 0) + 1);
    return candidates.map((cand) => {
        const [a, b, c, d] = cand.matrix;
        const tie = ties.get(`${cand.placed},${cand.equal}`) ?? 1;
        return {
            transform: cand.transform,
            matrix: [a, b, c, d],
            translation: { x: cand.tx, y: cand.ty },
            placed: cand.placed,
            reads: reads.length,
            tie_count: tie,
            mirrored: a * d - b * c < 0,
        };
    });
}

/** The frame that the tie rule chooses, or null where no read stands on a blueprint entity of its name under any frame */
export function frameOf(blueprint: readonly FrameBlueprintEntity[], reads: readonly FrameRead[]): Frame | null {
    return candidateFrames(blueprint, reads)[0] ?? null;
}

/** The blueprint entity under a read, by name and position, or undefined */
export function entityUnderRead<T extends FrameBlueprintEntity>(blueprint: readonly T[], frame: Frame, read: FrameRead): T | undefined {
    const [a, b, c, d] = frame.matrix;
    return blueprint.find((e) => e.name === read.name && a * e.position.x + b * e.position.y + frame.translation.x === read.position.x && c * e.position.x + d * e.position.y + frame.translation.y === read.position.y);
}
