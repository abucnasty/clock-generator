/**
 * The numbers that the questions of a pasted blueprint call its belts and drills by, and what the layout view needs to
 * draw those belts and drills while a question is open: every belt line with the belt id it has, the pieces inserters
 * reach, the line at each belt end of an inserter, and the rows that an open question keeps out of the five lists.
 *
 * Pure and total, like the steps it reads. Nothing here is written into the configuration: the labels and the layout
 * read the same places, so a belt shows the number its question uses.
 */
import type { BuildFlows } from "./flows";
import type { BuildGeometry } from "./geometry";
import type { BuildIds, ChestId, DrillId, EndId, InserterId } from "./ids";
import type { LayoutDrill, LayoutInserterLines, LayoutLine, LayoutPiece } from "./outcome";
import type { BuildWorld, Point } from "./world";

const byNumber = (a: number, b: number) => a - b;

export type Places = {
    /** A drill's place among the drills of the blueprint, from 1, by entity number */
    drillPlaces: Map<number, number>;
    /** The lines that inserters reach, by first piece */
    armLines: number[];
    /** A line's place, from 1: the lines that inserters reach, then the others */
    beltPlaces: Map<number, number>;
    /** The first piece of the line each piece is on */
    lineOfPiece: Map<number, number>;
};

/** The places of the blueprint's drills and belt lines: the numbers of "Drill n" and "Belt n" */
export function placesOf(world: BuildWorld, geometry: BuildGeometry, drillTypes: readonly string[]): Places {
    const lineOfPiece = new Map<number, number>();
    for (const line of geometry.lines) for (const piece of line.pieces) lineOfPiece.set(piece, line.first);
    const drillPlaces = new Map(world.entities.filter((e) => e.prototype !== null && drillTypes.includes(e.prototype)).map((e, index) => [e.entity_number, index + 1]));
    const armLines = [...new Set([...geometry.pickups.map((p) => p.piece), ...geometry.drops.map((d) => d.piece)].map((piece) => lineOfPiece.get(piece)).filter((n): n is number => n !== undefined))].sort(byNumber);
    const otherLines = geometry.lines.map((l) => l.first).filter((n) => !armLines.includes(n));
    const beltPlaces = new Map([...armLines, ...otherLines].map((first, index) => [first, index + 1]));
    return { drillPlaces, armLines, beltPlaces, lineOfPiece };
}

/** What the layout reads of the blueprint's own entities */
export type PlacedRead = { position: Point; direction: number };

export type QuestionLayoutParts = {
    world: BuildWorld;
    geometry: BuildGeometry;
    flows: BuildFlows;
    ids: BuildIds;
    places: Places;
    /** The blueprint's entities by entity number */
    entityOf: ReadonlyMap<number, PlacedRead>;
    /** The inserters and chests that the lists hold, after the ones left out for a chest with no slot */
    keptInserters: readonly InserterId[];
    keptChests: readonly ChestId[];
};

/** A line with an open lane, as a belt row of its own: the item of each lane, empty where the lane is asked */
export type HeldBeltPlan = { first: number; place: number; items: [string, string] };

export type QuestionLayout = {
    lines: LayoutLine[];
    drills: LayoutDrill[];
    inserter_lines: LayoutInserterLines[];
    /** The rows to build, in the layout view's numbers: inserters and drills as the ids steps give their kept ones */
    held: { belts: HeldBeltPlan[]; inserters: InserterId[]; drills: DrillId[] };
};

/** The layout keys of the import */
export function questionLayoutOf(parts: QuestionLayoutParts): QuestionLayout {
    const { world, geometry, flows, ids, places, entityOf, keptInserters, keptChests } = parts;
    const { beltPlaces, drillPlaces, lineOfPiece } = places;
    const lineIdOf = new Map(ids.lines.map((l) => [l.line, l]));
    const beltOf = new Map(ids.belts.map((b) => [b.id, b]));
    const placeOf = (first: number) => beltPlaces.get(first) as number;

    // every belt line, with the pieces that an inserter end reaches
    const reached = new Set<number>();
    for (const end of geometry.ends) for (const side of [end.source, end.sink]) if (side && side.target === "belt") reached.add(side.entity_number);
    const pieceOf = (n: number): LayoutPiece => {
        const placed = entityOf.get(n) as PlacedRead;
        return { entity_number: n, x: placed.position.x, y: placed.position.y, direction: placed.direction, shape: world.piece(n)?.shape ?? null };
    };
    const lines: LayoutLine[] = [...geometry.lines].sort((a, b) => a.first - b.first).map((line) => {
        const belt = lineIdOf.get(line.first)?.belt ?? null;
        return {
            first: line.first,
            place: placeOf(line.first),
            belt,
            lane_lines: belt === null ? [1, 2] : (beltOf.get(belt)?.lane_lines ?? null),
            pieces: line.pieces.filter((n) => reached.has(n) && entityOf.has(n)).sort(byNumber).map(pieceOf),
        };
    });

    // the drills and the drills whose ore is asked
    const drillIdOf = new Map(ids.drills.map((d) => [d.entity_number, d.id]));
    const drills: LayoutDrill[] = [...drillPlaces].map(([entity_number, place]) => ({ entity_number, place, drill: drillIdOf.get(entity_number) ?? null })).sort((a, b) => a.entity_number - b.entity_number);
    const machineIdOf = new Map(ids.machines.map((m) => [m.entity_number, m.id]));
    const chestIdOf = new Map(keptChests.map((c) => [c.entity_number, c.id]));
    const flowOf = new Map(flows.drills.map((d) => [d.entity_number, d]));
    const heldDrills: DrillId[] = ids.left_out_drills.filter((d) => d.reason === "no-ore").flatMap((d) => {
        const flow = flowOf.get(d.entity_number);
        if (flow === undefined) return [];
        const machine = machineIdOf.get(flow.target.entity_number);
        const chest = chestIdOf.get(flow.target.entity_number);
        const target = machine !== undefined ? { type: "machine" as const, id: machine } : chest !== undefined ? { type: "chest" as const, id: chest } : null;
        return target === null ? [] : [{ id: drillPlaces.get(d.entity_number) as number, entity_number: d.entity_number, name: d.name, target }];
    });

    // the lines with an open lane, as belt rows of their own
    const laneOf = new Map(flows.lanes.map((l) => [`${l.line}:${l.lane}`, l]));
    const itemOf = (first: number, lane: 1 | 2): string => {
        const flow = laneOf.get(`${first}:${lane}`);
        return flow !== undefined && !flow.waiting && flow.items.length === 1 ? flow.items[0] : "";
    };
    const isOpen = (first: number) => lineIdOf.get(first)?.why === "open";
    const heldBelts: HeldBeltPlan[] = lines.filter((l) => isOpen(l.first)).map((l) => ({ first: l.first, place: l.place, items: [itemOf(l.first, 1), itemOf(l.first, 2)] }));

    // each inserter by the line at its belt ends; the ones left out for an open line are held back, after the kept ids
    const endsOf = new Map(geometry.ends.map((e) => [e.inserter, e]));
    const lineAt = (end: { target: string; entity_number: number } | null | undefined): number | null => (end && end.target === "belt" ? (lineOfPiece.get(end.entity_number) ?? null) : null);
    const keptNumbers = new Set(keptInserters.map((i) => i.entity_number));
    const inserter_lines: LayoutInserterLines[] = keptInserters.map((i) => {
        const ends = endsOf.get(i.entity_number);
        return { entity_number: i.entity_number, id: i.id, held_back: false, source_line: lineAt(ends?.source), sink_line: lineAt(ends?.sink) };
    });
    const endOf = (end: (typeof geometry.ends)[number]["source"]): { id: EndId; open: boolean } | null => {
        if (end === null || end === undefined) return null;
        if (end.target === "belt") {
            const first = lineOfPiece.get(end.entity_number);
            const line = first === undefined ? undefined : lineIdOf.get(first);
            if (first === undefined || line === undefined || (line.belt === null && line.why !== "open")) return null;
            return { id: { type: "belt", id: placeOf(first) }, open: line.belt === null };
        }
        const id = end.target === "chest" ? chestIdOf.get(end.entity_number) : machineIdOf.get(end.entity_number);
        return id === undefined ? null : { id: { type: end.target === "chest" ? "chest" : "machine", id }, open: false };
    };
    let nextId = keptInserters.reduce((most, i) => Math.max(most, i.id), 0);
    const heldInserters: InserterId[] = [];
    for (const end of [...geometry.ends].sort((a, b) => a.inserter - b.inserter)) {
        if (keptNumbers.has(end.inserter)) continue;
        const source = endOf(end.source);
        const sink = endOf(end.sink);
        if (source === null || sink === null || !(source.open || sink.open)) continue;
        nextId += 1;
        heldInserters.push({ id: nextId, entity_number: end.inserter, source: source.id, sink: sink.id });
        inserter_lines.push({ entity_number: end.inserter, id: nextId, held_back: true, source_line: lineAt(end.source), sink_line: lineAt(end.sink) });
    }
    inserter_lines.sort((a, b) => a.id - b.id);

    return { lines, drills, inserter_lines, held: { belts: heldBelts, inserters: heldInserters, drills: heldDrills } };
}
