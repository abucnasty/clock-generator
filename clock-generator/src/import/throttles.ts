/**
 * The throttles of a pasted blueprint. A scaffold limits a belt with an inserter that takes from it into an infinity
 * chest that removes every item. The import leaves such an inserter and its chest out, and asks how many items a second
 * leave the lane the inserter takes from; an answer above 0 makes that lane an export at that rate.
 *
 * This reads the narrowest shape of a throttle. An inserter is a throttle when it takes from the lane next to it
 * (a near lane is read), has no filter, and drops into an infinity chest with no filter that removes every item; no
 * inserter takes from the chest and no loader reaches it; every inserter that drops into the chest is a throttle too;
 * and no inserter other than a throttle takes from that lane downstream of it, on the same line. Where the line
 * downstream cannot be followed to its end, the inserter is not a throttle.
 */
import type { BlueprintEntityRead } from "./blueprint-entities";
import type { BeltPickup, BuildGeometry } from "./geometry";
import type { BeltPiece, BuildWorld } from "./world";

/** An inserter that is a throttle, the chest it drops into, and the lane it empties */
export type Throttle = {
    inserter: number;
    chest: number;
    /** The belt piece the inserter takes from */
    piece: number;
    /** The first piece of that piece's line */
    line: number;
    lane: 1 | 2;
};

/** The pieces from `start` downstream to the end of the blueprint's belt, `start` included; null where the way is not one line to an end */
function downstreamOf(world: BuildWorld, start: BeltPiece): Set<number> | null {
    const seen = new Set<number>();
    let piece = start;
    while (true) {
        seen.add(piece.entity_number);
        const outputs = world.lineAfter(piece);
        if (outputs.length === 0) return seen;
        if (outputs.length > 1 || piece.side_loads.length > 0) return null;
        const next = outputs[0];
        if (next.kind !== "belt" && next.kind !== "underground") return null;
        if (seen.has(next.entity_number)) return null;
        // the pieces that feed `next` are this piece alone; an underground exit has none (its tunnel is not an input)
        const others = world.inputsOf(next).filter((input) => input.entity_number !== piece.entity_number);
        if (others.length > 0) return null;
        // a belt that does not carry on in the way it faces, entering an underground entrance from the side, is a side load
        if (next.kind === "underground" && next.end === "input" && next.direction !== piece.direction) return null;
        piece = next;
    }
}

/**
 * The throttles of a build, sorted by inserter. `laneLinesOf` gives, for the first piece of a line, the lanes (1 or 2)
 * whose end the build can write; an inserter on any other lane is not a throttle.
 */
export function throttlesOf(
    world: BuildWorld,
    geometry: BuildGeometry,
    entities: readonly BlueprintEntityRead[],
    laneLinesOf: (line: number) => readonly (1 | 2)[],
): Throttle[] {
    const read = new Map(entities.map((e) => [e.entity_number, e]));
    const lineOfPiece = new Map<number, number>();
    for (const line of geometry.lines) for (const piece of line.pieces) lineOfPiece.set(piece, line.first);
    const endsOf = new Map(geometry.ends.map((e) => [e.inserter, e]));

    // the chests that something else uses: an inserter takes from it, or a loader reaches it
    const used = new Set<number>();
    for (const end of geometry.ends) if (end.source?.target === "chest") used.add(end.source.entity_number);
    for (const piece of world.pieces) if (piece.kind === "loader" && piece.loader?.chest != null) used.add(piece.loader.chest);
    // every inserter that drops into a chest, whether or not it is a throttle
    const droppers = new Map<number, number[]>();
    for (const end of geometry.ends) {
        if (end.sink?.target !== "chest") continue;
        droppers.set(end.sink.entity_number, [...(droppers.get(end.sink.entity_number) ?? []), end.inserter]);
    }

    const voids = (chest: number): boolean => {
        const settings = read.get(chest)?.infinity;
        return world.entity(chest)?.prototype === "infinity-container" && settings !== undefined && settings.filters.length === 0 && settings.remove_unfiltered_items;
    };
    const unfiltered = (inserter: number): boolean => {
        const e = read.get(inserter);
        return e !== undefined && !e.use_filters && e.filters.length === 0;
    };

    type Candidate = { pickup: BeltPickup; chest: number; line: number; lane: 1 | 2; downstream: Set<number> };
    const candidates: Candidate[] = [];
    for (const pickup of geometry.pickups) {
        const lane = pickup.near_lane.value;
        const end = endsOf.get(pickup.inserter);
        const sink = end?.sink;
        const piece = world.piece(pickup.piece);
        const line = lineOfPiece.get(pickup.piece);
        if (lane === null || piece === undefined || line === undefined || sink == null || sink.target !== "chest") continue;
        if (world.entity(pickup.inserter)?.prototype !== "inserter" || !unfiltered(pickup.inserter)) continue;
        if (!voids(sink.entity_number) || used.has(sink.entity_number)) continue;
        if (!laneLinesOf(line).includes(lane)) continue;
        const downstream = downstreamOf(world, piece);
        if (downstream === null) continue;
        candidates.push({ pickup, chest: sink.entity_number, line, lane, downstream });
    }

    // a throttle that depends on others being throttles: take them out until the set holds still
    let kept = candidates;
    for (let changed = true; changed;) {
        const inserters = new Set(kept.map((c) => c.pickup.inserter));
        const next = kept.filter((c) => {
            if ((droppers.get(c.chest) ?? []).some((n) => !inserters.has(n))) return false;
            // a taker of its lane downstream, other than a throttle (a pickup with no near lane may take from either lane)
            return !geometry.pickups.some((p) => !inserters.has(p.inserter) && c.downstream.has(p.piece) && (p.near_lane.value === null || p.near_lane.value === c.lane));
        });
        changed = next.length !== kept.length;
        kept = next;
    }
    return kept.map((c) => ({ inserter: c.pickup.inserter, chest: c.chest, piece: c.pickup.piece, line: c.line, lane: c.lane })).sort((a, b) => a.inserter - b.inserter);
}
