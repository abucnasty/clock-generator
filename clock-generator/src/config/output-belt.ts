import { z } from "zod";
import { withoutOutletWords } from "./infinite-end";

/**
 * The output belt of a build: the belts from the copies' output inserters to the infinite end, stated in tiles. A config states
 * it in `output_belt`; this file holds its schema, the checks that refuse what the generator does not model, and the
 * geometry derived from it. The run of the copies moves the output on it (crafting/output-belt-run.ts), on the lines that
 * entities/belt/join/output-belt-join.ts makes from this geometry.
 *
 * The section, in its words:
 * - The **side belt** is the belt that a copy's output inserter drops on. It side-loads onto the output belt. Every output
 *   inserter that has one has the same, so it is stated once in `side_belt`, unless `side_belts` states the side belt of
 *   some output inserters by their numbers.
 * - A **group** of stretches is the stretches that join (by a side load or by the splitter). Each group has one infinite
 *   end. Where `stretch_groups` is not stated, all stretches are one group. A splitter has two input lines and two output
 *   lines whether or not a stretch ends in each input: an input that no stretch ends in carries nothing.
 * - A **stretch** is a run of the output belt from where items first come onto it to where it ends, as a list of
 *   **points**, upstream first. Stretch 1 is the first in the list.
 * - A point is a tile where something happens: a side load onto it, a copy's drop, the splitter, the infinite end. Its
 *   `tiles` are the steps from the previous point's tile to its own, as the sidecar's walk counts them (clock-generator-
 *   sidecar/scripts/drop-merge.lua, `merge.tiles`): one step a piece, an underground pair the tiles between its ends,
 *   and the tile a stretch side-loads onto, the splitter and the infinite end one step each. After a point that lists copies,
 *   the steps are counted from the last copy of the list.
 * - A **join** is a belt lane going onto another belt, by a side load or by the splitter. No field names it.
 * - A **number** in `side_load` and `drop` names an output inserter. Where a copy has one, it is the copy's number. Where
 *   a copy has k, the j-th of them in the config (from 1) of copy c is number (c - 1) k + j: the output inserters of
 *   a whole build of one copy are 1 to k. A list of several numbers steps by `copy_offset`, so with several output
 *   inserters a copy each side load is stated at a point of its own.
 *
 * Lengths are in 1/256 tile, the game's unit of a belt position, and each is the length of a belt lane as the game has
 * it (`line_length` of a transport line, read on the automation science scaffold, Factorio 2.1.24).
 */

/** A straight tile, an underground tile and a tile of an underground pair's tunnel */
export const STRAIGHT_TILE = 256;
/** A curve's outer lane: on a left curve the right lane, on a right curve the left lane */
export const CURVE_OUTER_LANE = 295;
/** A curve's inner lane */
export const CURVE_INNER_LANE = 106;
/** An underground exit with nothing before it: only the open half of its tile carries items */
export const LONE_EXIT_LANE = 128;
/** Each of the splitter's input lines (one a lane of each input side) */
export const SPLITTER_INPUT_LANE = 179;
/** Each of the splitter's output lines */
export const SPLITTER_OUTPUT_LANE = 128;
/**
 * Where a side-loaded stack lands on the lane that takes it, as its distance to the end of the receiving tile's lane
 * (recorded on the sample and on the test scaffolds): onto an underground exit 67, onto an entrance 60; onto a straight
 * belt 67 for the sender's lane on the downstream side and 188 for the other.
 */
export const SIDE_LOAD_POINT = { exit: 67, entrance: 60, straight_downstream: 67, straight_upstream: 188 } as const;

const BELT_LANES = ["left", "right"] as const;
export type BeltLane = typeof BELT_LANES[number];
const SIDE_LOAD_LAYOUTS = ["side-straight", "side-entrance", "side-exit"] as const;
type SideLoadLayout = typeof SIDE_LOAD_LAYOUTS[number];

const laneSchema = (what: string) => z.enum(BELT_LANES).describe(`${what}: "left" or "right" in the direction of travel.`);
const curvesSchema = () => z.number().int().nonnegative();
const priorityError = (which: string) => `State the splitter's ${which} priority as "left" or "right", as it is set in the game. `
    + "The generator does not model a splitter without a priority (\"none\").";

const SideBeltSchema = z.strictObject({
    lane: laneSchema("The lane of the side belt that the output inserter drops on"),
    tiles: z.number().int().positive().describe("The steps from the drop tile to the tile that the side belt side-loads onto, as the sidecar's walk "
        + "counts them. This is the number that `drop_capture.tiles` holds. On a drop tile and one curve, it is 2."),
    left_curves: curvesSchema().optional().describe("The left curves of the side belt after its drop tile."),
    right_curves: curvesSchema().optional().describe("The right curves of the side belt after its drop tile."),
});

const PointSchema = z.strictObject({
    tiles: z.number().int().positive().optional().describe("The steps from the previous point to this point, as the sidecar's walk counts them. "
        + "Each belt entity is one step. An underground pair is the tiles between its ends. "
        + "The tile that a stretch side-loads onto, the splitter and the infinite end are one step each. "
        + "After a point that lists copies, count from the last copy of the list. The first point of a stretch has no tiles."),
    left_curves: curvesSchema().optional().describe("The left curves between the previous point and this point."),
    right_curves: curvesSchema().optional().describe("The right curves between the previous point and this point."),
    side_load: z.union([
        z.array(z.number().int().positive()).min(1).describe("The copies whose side belts side-load onto this stretch, upstream first. "
            + "The first copy side-loads at this point, and each next copy `setpoint.copy_offset` further along the stretch. "
            + "Where a copy has several output inserters, a number names one of them (see `drop`): state one at a point."),
        z.strictObject({
            stretch: z.number().int().positive().describe("The stretch, from 1, that side-loads onto this point from its last point."),
        }),
    ]).optional().describe("What side-loads onto this point: a list of copies, or another stretch. A side load is stated once, at the point that takes it. "
        + "The first copy of a list side-loads at this point, and each next copy `setpoint.copy_offset` further along the stretch."),
    lane: laneSchema("The lane that takes the side load or the drop").optional(),
    layout: z.enum(SIDE_LOAD_LAYOUTS).optional().describe("The belt piece that takes the side load, as `pickup_layout` names it: "
        + "side-straight (a straight belt), side-entrance (an underground entrance) or side-exit (an underground exit)."),
    drop: z.number().int().positive().describe("The copy, from 1, with the output inserter that drops onto this point. "
        + "Where a copy has k output inserters, number (c - 1) k + j is the j-th of them in the config of copy c.").optional(),
    splitter_input: laneSchema("The splitter's input that this stretch ends in").optional(),
    splitter_output: laneSchema("The splitter's output that this stretch starts at").optional(),
    lane_end: withoutOutletWords(z.strictObject({
        kind: z.literal("infinite").describe("infinite: the items leave the build here, at the capacity of the lane."),
    })).optional().describe("The infinite end of the output belt, on the last point of its stretch."),
});

const SideBeltOfOutputsSchema = SideBeltSchema.extend({
    outputs: z.array(z.number().int().positive()).min(1).describe("The numbers of the output inserters that drop on this side belt "
        + "(see `drop`). Each number is in one entry."),
});

const PrioritySchema = (which: string) => z.enum(BELT_LANES, { error: priorityError(which) });

/** The `output_belt` section of a config */
export const OutputBeltSchema = z.strictObject({
    side_belt: SideBeltSchema.optional().describe("The side belt that each copy's output inserter drops on, the same for every copy that has one. "
        + "An output inserter that `side_belts` names has the side belt of its entry instead."),
    side_belts: z.array(SideBeltOfOutputsSchema).min(1).optional().describe("Side belts of some output inserters, each by their numbers, "
        + "for a copy whose output inserters do not drop on side belts of one shape. An output inserter that no entry names has `side_belt`."),
    stretch_groups: z.array(z.array(z.number().int().positive()).min(1).describe("The numbers of the stretches of one group, from 1.")).min(1).optional()
        .describe("The groups of stretches that join: a side load of a stretch or the splitter joins stretches of one group only. "
            + "Each group has exactly one infinite end. State it where the output belt has several infinite ends that do not join. "
            + "Without it, all stretches are one group, with one infinite end."),
    stretches: z.array(z.strictObject({
        points: z.array(PointSchema).min(1).describe("The points of the stretch, upstream first."),
    })).min(1).describe("The stretches of the output belt, each from where items first come onto it to where it ends. Stretch 1 is the first."),
    splitter: z.strictObject({
        input_priority: PrioritySchema("input").describe("The input priority of the splitter: \"left\" or \"right\". The generator does not accept \"none\"."),
        output_priority: PrioritySchema("output").describe("The output priority of the splitter: \"left\" or \"right\". The generator does not accept \"none\"."),
    }).optional().describe("The splitter of the output belt, with its priorities. Its inputs and outputs are the points that name them."),
});

export type OutputBelt = z.infer<typeof OutputBeltSchema>;
type Point = OutputBelt["stretches"][number]["points"][number];
type Lanes = Record<BeltLane, number>;
type SideBeltShape = z.infer<typeof SideBeltSchema>;

/** The side belt of an output inserter, by its number: that of its entry in `side_belts`, else `side_belt` */
const sideBeltOf = (belt: OutputBelt, number: number): SideBeltShape | undefined =>
    belt.side_belts?.find(entry => entry.outputs.includes(number)) ?? belt.side_belt;

export interface OutputBeltProblem {
    /** Below `output_belt` */
    path: (string | number)[];
    message: string;
}

/** The tiles between two copies along a stretch: the steps of `copy_offset` */
export const copySpacingOf = (copy_offset: { x: number; y: number } | undefined): number | undefined =>
    copy_offset === undefined ? undefined : Math.abs(copy_offset.x) + Math.abs(copy_offset.y);

const KINDS = ["side_load", "drop", "splitter_input", "splitter_output", "lane_end"] as const;
const kindsOf = (point: Point) => KINDS.filter(kind => point[kind] !== undefined);
const curvesOf = (point: { left_curves?: number; right_curves?: number }) => (point.left_curves ?? 0) + (point.right_curves ?? 0);
const isRunOnly = (point: Point) => kindsOf(point).length === 0 && point.lane === undefined && point.layout === undefined;
const words = (items: (string | number)[]) => items.length < 2 ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
const LAYOUT_NAME: Record<SideLoadLayout, string> = { "side-straight": "a straight belt", "side-entrance": "an underground entrance",
    "side-exit": "an underground exit" };

/**
 * The lanes of a sender that pass onto the tile of a side load, and where each lands. The sender comes from the side of
 * the receiving lane. An underground exit's hood is on its upstream half, so it passes the sender's lane on the
 * downstream side, which is the lane named as the receiving lane; an entrance's hood is on its downstream half, so it
 * passes the other lane. A straight belt passes both, onto the receiving lane. Measured in the game for each of the
 * four cases of an underground end (Factorio 2.1.24).
 */
function sideLoadLanes(layout: SideLoadLayout, receiving: BeltLane): { sender_lane: BeltLane; passes: boolean; side_load_point?: number }[] {
    return BELT_LANES.map(sender_lane => {
        const downstream = sender_lane === receiving;
        if (layout === "side-straight") {
            return { sender_lane, passes: true, side_load_point: downstream ? SIDE_LOAD_POINT.straight_downstream : SIDE_LOAD_POINT.straight_upstream };
        }
        const passes = layout === "side-exit" ? downstream : !downstream;
        return passes ? { sender_lane, passes, side_load_point: layout === "side-exit" ? SIDE_LOAD_POINT.exit : SIDE_LOAD_POINT.entrance }
            : { sender_lane, passes };
    });
}

/** The length of a run of tiles on each lane, `left` and `right` curves among them */
function runLength(tiles: number, left: number, right: number): Lanes {
    const straight = (tiles - left - right) * STRAIGHT_TILE;
    return {
        left: straight + left * CURVE_INNER_LANE + right * CURVE_OUTER_LANE,
        right: straight + left * CURVE_OUTER_LANE + right * CURVE_INNER_LANE,
    };
}
const plus = (a: Lanes, b: Lanes): Lanes => ({ left: a.left + b.left, right: a.right + b.right });

export interface StretchPlace {
    /** "side load of copy 3", "drop of copy 5", "side load of stretch 1", "the splitter's left output" */
    name: string;
    /** The index of the point in the stretch's `points` */
    point: number;
    /** The steps from the stretch's first point */
    tile: number;
    /** The length of each lane from the start of the stretch to the end of this place's tile */
    end_at: Lanes;
}

export interface StretchGeometry {
    stretch: number;
    places: StretchPlace[];
    /** Where the stretch ends: the tile after its last belt tile, and the length of each lane to it */
    end: { kind: "side_load" | "splitter_input" | "infinite" | "none"; tile: number; line_end: Lanes };
    /** The lanes that carry items: each drop's and side load's lane, and at a splitter output the lanes of its inputs */
    carried: BeltLane[];
}

export interface LaneLine {
    name: string;
    lane: BeltLane;
    length: number;
    /** The names of the lines that this one feeds */
    feeds: string[];
}

export interface SideLoadGeometry {
    sender: { side_belt_of_copy: number } | { stretch: number };
    /** The stretch that takes the side load, its lane and its tile */
    stretch: number;
    lane: BeltLane;
    layout: SideLoadLayout;
    tile: number;
    /** Each lane of the sender: whether it passes, and its side-load point on the receiving lane */
    lanes: { sender_lane: BeltLane; passes: boolean; side_load_point?: number }[];
    /** Where the side load is stated */
    path: (string | number)[];
    /** The line of the receiving lane whose tile takes the side load: it ends at the end of that tile */
    receiver_line?: string;
    /** The sender's last line on each lane: a side belt's line, or the line of the stretch to its side load */
    sender_lines?: Record<BeltLane, string>;
}

export interface OutputBeltGeometry {
    /** The side belt of `side_belt`: the end of its drop tile and of its last tile, on each lane, from the start of its drop tile */
    side_belt?: { lane: BeltLane; drop_tile_end: number; line_end: Lanes };
    /** The side belt of each output inserter that side-loads, by its number: that of its entry in `side_belts`, else `side_belt` */
    side_belts: { number: number; lane: BeltLane; drop_tile_end: number; line_end: Lanes }[];
    /** The groups of stretches, each with the stretch that holds its infinite end; one group of all stretches where none is stated */
    groups: { group: number; stretches: number[]; infinite_end_stretch?: number }[];
    stretches: StretchGeometry[];
    lines: LaneLine[];
    side_loads: SideLoadGeometry[];
    /** Each drop onto a stretch, with the line that ends at the end of the drop's tile */
    drops: { copy: number; stretch: number; lane: BeltLane; tile: number; end_at: Lanes; line?: string }[];
    splitter?: { input_priority: BeltLane; output_priority: BeltLane; inputs: { side: BeltLane; stretch: number }[]; outputs: { side: BeltLane; stretch: number }[] };
    /** The infinite end, with the line of each lane that ends at it */
    infinite_ends: { stretch: number; tile: number; end_at: Lanes; lines?: Record<BeltLane, string> }[];
}

/** The length of a stretch's first tile, which its first point is on */
function firstTile(point: Point): number {
    if (point.splitter_output !== undefined) return 0; // the splitter's output line is the splitter's
    if (point.side_load !== undefined && point.layout === "side-exit") return LONE_EXIT_LANE;
    return STRAIGHT_TILE;
}

/**
 * The geometry of an output belt: every line of each lane with its length, which line feeds which, each side load with
 * its receiving lane, layout and side-load point, each drop, the splitter and the infinite end. Pure: it reads the section and
 * the steps between two copies (`copySpacingOf`), and no engine rule. Run it on a section that `outputBeltProblems`
 * accepts.
 *
 * A run between two points is the `tiles` tiles after the first point's tile, up to and including the second point's
 * tile; its curves are among the tiles before the second point's, which is straight. A stretch's last point is not one of
 * its belt tiles (the tile it side-loads onto, the splitter, the infinite end), so its run is the `tiles` - 1 tiles before it.
 */
export function outputBeltGeometry(belt: OutputBelt, copy_spacing: number): OutputBeltGeometry {
    const lines: LaneLine[] = [];
    const side_loads: SideLoadGeometry[] = [];
    const drops: OutputBeltGeometry["drops"] = [];
    const infinite_ends: OutputBeltGeometry["infinite_ends"] = [];
    const stretches: StretchGeometry[] = belt.stretches.map((stretch, index) => {
        const n = index + 1;
        const places: StretchPlace[] = [];
        const first = stretch.points[0];
        let tile = 0;
        let end_at: Lanes = { left: firstTile(first), right: firstTile(first) };
        let end: StretchGeometry["end"] = { kind: "none", tile: 0, line_end: end_at };
        stretch.points.forEach((point, at) => {
            const last = at === stretch.points.length - 1 && at > 0;
            if (at > 0) {
                const tiles = point.tiles ?? 0;
                if (last && (isRunOnly(point) || point.splitter_input !== undefined || point.lane_end !== undefined)) {
                    const line_end = plus(end_at, runLength(tiles - 1, point.left_curves ?? 0, point.right_curves ?? 0));
                    end = { kind: isRunOnly(point) ? "side_load" : point.splitter_input !== undefined ? "splitter_input" : "infinite",
                        tile: tile + tiles, line_end };
                    if (point.lane_end !== undefined) infinite_ends.push({ stretch: n, tile: tile + tiles, end_at: line_end });
                    return;
                }
                tile += tiles;
                end_at = plus(end_at, plus(runLength(tiles - 1, point.left_curves ?? 0, point.right_curves ?? 0), runLength(1, 0, 0)));
            }
            const path = ["stretches", index, "points", at];
            if (Array.isArray(point.side_load)) {
                const copies = point.side_load;
                const head = copies[0];
                copies.forEach((copy, k) => {
                    const steps = Math.abs(copy - head) * copy_spacing;
                    const copy_tile = tile + steps;
                    const copy_end = plus(end_at, runLength(steps, 0, 0));
                    places.push({ name: `side load of copy ${copy}`, point: at, tile: copy_tile, end_at: copy_end });
                    side_loads.push({ sender: { side_belt_of_copy: copy }, stretch: n, lane: point.lane!, layout: point.layout!,
                        tile: copy_tile, lanes: sideLoadLanes(point.layout!, point.lane!), path });
                    if (k === copies.length - 1) {
                        tile = copy_tile;
                        end_at = copy_end;
                    }
                });
            } else if (point.side_load !== undefined) {
                places.push({ name: `side load of stretch ${point.side_load.stretch}`, point: at, tile, end_at });
                side_loads.push({ sender: { stretch: point.side_load.stretch }, stretch: n, lane: point.lane!, layout: point.layout!,
                    tile, lanes: sideLoadLanes(point.layout!, point.lane!), path });
            } else if (point.drop !== undefined) {
                places.push({ name: `drop of copy ${point.drop}`, point: at, tile, end_at });
                drops.push({ copy: point.drop, stretch: n, lane: point.lane!, tile, end_at });
            } else if (point.splitter_output !== undefined) {
                places.push({ name: `the splitter's ${point.splitter_output} output`, point: at, tile, end_at });
            } else {
                places.push({ name: `point ${at + 1}`, point: at, tile, end_at });
            }
        });
        if (end.kind === "none") end = { kind: "none", tile, line_end: end_at };
        return { stretch: n, places, end, carried: [] };
    });

    // the lanes that carry items, to a fixed point through the splitter
    const splitterInputs = belt.stretches.flatMap((stretch, index) => {
        const side = stretch.points[stretch.points.length - 1].splitter_input;
        return side !== undefined && stretch.points.length > 1 ? [{ side, stretch: index + 1 }] : [];
    });
    const splitterOutputs = belt.stretches.flatMap((stretch, index) => {
        const side = stretch.points[0].splitter_output;
        return side !== undefined ? [{ side, stretch: index + 1 }] : [];
    });
    const carried = belt.stretches.map(stretch => new Set<BeltLane>(stretch.points.flatMap(point =>
        (point.side_load !== undefined || point.drop !== undefined) && point.lane !== undefined ? [point.lane] : [])));
    for (let changed = true; changed;) {
        changed = false;
        const through = new Set(splitterInputs.flatMap(input => [...carried[input.stretch - 1]]));
        for (const output of splitterOutputs) {
            for (const lane of through) {
                if (!carried[output.stretch - 1].has(lane)) {
                    carried[output.stretch - 1].add(lane);
                    changed = true;
                }
            }
        }
    }
    stretches.forEach((stretch, index) => { stretch.carried = BELT_LANES.filter(lane => carried[index].has(lane)); });

    // the lines of each lane: a stretch's first tile, a run between two places, the run to its end
    const lineName = (n: number, lane: BeltLane, from: string, to: string) => `stretch ${n} ${lane} lane: ${from} to ${to}`;
    const firstLineName = (n: number, lane: BeltLane) => `stretch ${n} ${lane} lane: the tile of the ${stretches[n - 1].places[0].name}`;
    const endName = (n: number) => {
        const stretch = belt.stretches[n - 1];
        const last = stretch.points[stretch.points.length - 1];
        if (last.splitter_input !== undefined) return `the splitter's ${last.splitter_input} input`;
        if (last.lane_end !== undefined) return "the infinite end";
        const receiver = side_loads.find(load => "stretch" in load.sender && load.sender.stretch === n);
        return receiver ? `its side load onto stretch ${receiver.stretch}` : "its end";
    };
    /** The line of a lane that holds a place's tile: the run that ends at it, or the stretch's first tile */
    const lineAt = (n: number, lane: BeltLane, place_index: number): string | undefined => {
        const places = stretches[n - 1].places;
        if (place_index > 0) return lineName(n, lane, places[place_index - 1].name, places[place_index].name);
        return places[0].end_at[lane] > 0 ? firstLineName(n, lane) : undefined;
    };
    const splitterIn = (side: BeltLane, lane: BeltLane) => `the splitter's ${side} input, ${lane} lane`;
    const splitterOut = (side: BeltLane, lane: BeltLane) => `the splitter's ${side} output, ${lane} lane`;
    /** The line that a side load of `sender` feeds on its receiving lane */
    const receivingLine = (sender: SideLoadGeometry["sender"]): { load: SideLoadGeometry; line?: string } | undefined => {
        const load = side_loads.find(each => JSON.stringify(each.sender) === JSON.stringify(sender));
        if (!load) return undefined;
        const places = stretches[load.stretch - 1].places;
        const index = places.findIndex(place => place.tile === load.tile && place.name === ("side_belt_of_copy" in sender
            ? `side load of copy ${sender.side_belt_of_copy}` : `side load of stretch ${sender.stretch}`));
        return { load, line: lineAt(load.stretch, load.lane, index) };
    };
    const feedsOfEnd = (n: number, lane: BeltLane): string[] => {
        const stretch = belt.stretches[n - 1];
        const last = stretch.points[stretch.points.length - 1];
        if (last.splitter_input !== undefined) return [splitterIn(last.splitter_input, lane)];
        if (last.lane_end !== undefined) return [];
        const receiving = receivingLine({ stretch: n });
        if (!receiving?.line) return [];
        return receiving.load.lanes.some(each => each.sender_lane === lane && each.passes) ? [receiving.line] : [];
    };

    // the side belts: a drop tile, then the tiles to the tile each side-loads onto
    const sideBeltEndOf = (shape: SideBeltShape): Lanes => plus(runLength(1, 0, 0), runLength(shape.tiles - 1, shape.left_curves ?? 0, shape.right_curves ?? 0));
    const sideBeltEnd = belt.side_belt === undefined ? undefined : sideBeltEndOf(belt.side_belt);
    const side_belts: OutputBeltGeometry["side_belts"] = [];
    {
        const copies = side_loads.flatMap(load => "side_belt_of_copy" in load.sender ? [load.sender.side_belt_of_copy] : []);
        for (const copy of copies) {
            const shape = sideBeltOf(belt, copy);
            if (shape === undefined) continue;
            const length = sideBeltEndOf(shape);
            if (!side_belts.some(each => each.number === copy)) {
                side_belts.push({ number: copy, lane: shape.lane, drop_tile_end: STRAIGHT_TILE, line_end: length });
            }
            const receiving = receivingLine({ side_belt_of_copy: copy })!;
            for (const lane of BELT_LANES) {
                // a lane that the hood of the receiving tile shuts feeds nothing: its items stop there
                const passes = receiving.load.lanes.some(each => each.sender_lane === lane && each.passes);
                lines.push({ name: `side belt of copy ${copy} ${lane} lane`, lane, length: length[lane], feeds: passes && receiving.line ? [receiving.line] : [] });
            }
        }
    }
    stretches.forEach(stretch => {
        const n = stretch.stretch;
        for (const lane of BELT_LANES) {
            const { places } = stretch;
            places.forEach((place, index) => {
                const name = lineAt(n, lane, index);
                if (name === undefined) return;
                const length = index > 0 ? place.end_at[lane] - places[index - 1].end_at[lane] : place.end_at[lane];
                const next = index + 1 < places.length ? lineName(n, lane, place.name, places[index + 1].name)
                    : stretch.end.kind === "none" ? undefined : lineName(n, lane, place.name, endName(n));
                lines.push({ name, lane, length, feeds: next ? [next] : [] });
            });
            if (stretch.end.kind !== "none" && places.length > 0) {
                const lastPlace = places[places.length - 1];
                lines.push({ name: lineName(n, lane, lastPlace.name, endName(n)), lane,
                    length: stretch.end.line_end[lane] - lastPlace.end_at[lane], feeds: feedsOfEnd(n, lane) });
            }
        }
    });
    if (belt.splitter !== undefined) {
        const outputs = [...splitterOutputs].sort((a, b) => a.side.localeCompare(b.side));
        // each side of the splitter has its input lines, also a side that no stretch ends in: the lines of that input are fed by nothing
        const sides = [...splitterInputs.map(input => input.side), ...BELT_LANES.filter(side => !splitterInputs.some(input => input.side === side))];
        for (const side of sides) {
            for (const lane of BELT_LANES) {
                lines.push({ name: splitterIn(side, lane), lane, length: SPLITTER_INPUT_LANE, feeds: outputs.map(output => splitterOut(output.side, lane)) });
            }
        }
        for (const output of splitterOutputs) {
            const places = stretches[output.stretch - 1].places;
            for (const lane of BELT_LANES) {
                const first = places.length > 1 ? lineName(output.stretch, lane, places[0].name, places[1].name)
                    : lineName(output.stretch, lane, places[0].name, endName(output.stretch));
                lines.push({ name: splitterOut(output.side, lane), lane, length: SPLITTER_OUTPUT_LANE, feeds: [first] });
            }
        }
    }

    const side_belt = belt.side_belt === undefined || sideBeltEnd === undefined ? undefined
        : { lane: belt.side_belt.lane, drop_tile_end: STRAIGHT_TILE, line_end: sideBeltEnd };
    // the lines each join, drop and infinite end is at, by the names above
    const lastLineOf = (n: number, lane: BeltLane) => {
        const places = stretches[n - 1].places;
        return lineName(n, lane, places[places.length - 1].name, endName(n));
    };
    const byLane = (name: (lane: BeltLane) => string) => ({ left: name("left"), right: name("right") });
    const named_loads = side_loads.map(load => ({
        ...load,
        receiver_line: receivingLine(load.sender)?.line,
        sender_lines: byLane(lane => "side_belt_of_copy" in load.sender ? `side belt of copy ${load.sender.side_belt_of_copy} ${lane} lane`
            : lastLineOf((load.sender as { stretch: number }).stretch, lane)),
    }));
    const named_drops = drops.map(drop => ({ ...drop,
        line: lineAt(drop.stretch, drop.lane, stretches[drop.stretch - 1].places.findIndex(place => place.name === `drop of copy ${drop.copy}`)) }));
    const named_infinite_ends = infinite_ends.map(end => ({ ...end, lines: byLane(lane => lastLineOf(end.stretch, lane)) }));
    const groups = (belt.stretch_groups ?? [belt.stretches.map((_, index) => index + 1)]).map((numbers, index) => ({
        group: index + 1, stretches: numbers,
        infinite_end_stretch: named_infinite_ends.find(end => numbers.includes(end.stretch))?.stretch,
    }));
    return {
        ...(side_belt && { side_belt }),
        side_belts, groups,
        stretches, lines, side_loads: named_loads, drops: named_drops,
        ...(belt.splitter && { splitter: { ...belt.splitter, inputs: splitterInputs, outputs: splitterOutputs } }),
        infinite_ends: named_infinite_ends,
    };
}

/**
 * The phase of a stream at the end of a sender's line: where its stacks stand there, in 1/256 tile modulo the belt's
 * step in a tick (32 on a turbo belt). `put_on_spot` is where a stack was put on, as its distance to the end of its
 * tile (a drop 96, 128 or 160; a side-loaded stack where it lands): an engine fact, not a field of the section.
 * `length_after` is the sender's lane after that tile, from `outputBeltGeometry`.
 */
export const streamPhase = (put_on_spot: number, length_after: number, belt_step: number): number =>
    (((put_on_spot + length_after) % belt_step) + belt_step) % belt_step;

/**
 * What the generator refuses in an output belt, each with what to state instead. The shape checks come first; the rules
 * that need the geometry (two side loads onto one tile, a lane that an underground's hood shuts) run when they pass.
 */
export function outputBeltProblems(belt: OutputBelt, copy_offset: { x: number; y: number } | undefined, outputs_a_copy = 1): OutputBeltProblem[] {
    const shape: OutputBeltProblem[] = [];
    const rules: OutputBeltProblem[] = [];
    const count = belt.stretches.length;
    const at = (stretch: number, point: number) => ["stretches", stretch, "points", point];
    const spacing = copySpacingOf(copy_offset);
    const named = new Map<number, number[]>(); // a stretch, and the stretches whose side loads name it
    const stretch_loads: { sender: number; receiver: number; path: (string | number)[] }[] = [];

    belt.stretches.forEach((stretch, s) => {
        stretch.points.forEach((point, p) => {
            const path = at(s, p);
            const kinds = kindsOf(point);
            if (p === 0 && (point.tiles !== undefined || curvesOf(point) > 0)) {
                shape.push({ path, message: "The first point of a stretch is where it starts: state `tiles` and curves on the later points only." });
            }
            if (p > 0 && point.tiles === undefined) {
                shape.push({ path, message: "State `tiles` on this point: the steps from the previous point, as the sidecar's walk counts them." });
            }
            if (kinds.length > 1) {
                shape.push({ path, message: `A point states one of \`side_load\`, \`drop\`, \`splitter_input\`, \`splitter_output\` and \`lane_end\`; `
                    + `this one states ${words(kinds)}. State the others at points of their own.` });
            }
            const takes = point.side_load !== undefined || point.drop !== undefined;
            if (takes && point.lane === undefined) {
                shape.push({ path, message: "State the `lane` that takes the drop or the side load: \"left\" or \"right\" in the direction of travel." });
            }
            if (!takes && point.lane !== undefined) {
                shape.push({ path, message: "`lane` is the lane that takes a drop or a side load: state it with `drop` or `side_load` only." });
            }
            if (point.side_load !== undefined && point.layout === undefined) {
                shape.push({ path, message: "State the `layout` of the tile that takes the side load: side-straight, side-entrance or side-exit." });
            }
            if (point.side_load === undefined && point.layout !== undefined) {
                shape.push({ path, message: "`layout` is the tile that takes a side load: state it with `side_load` only." });
            }
            if (point.splitter_output !== undefined && p > 0) {
                shape.push({ path, message: "A stretch starts at a splitter output: state `splitter_output` on its first point only." });
            }
            if ((point.splitter_input !== undefined || point.lane_end !== undefined) && (p === 0 || p < stretch.points.length - 1)) {
                shape.push({ path, message: "A stretch ends in a splitter input or in the infinite end: state `splitter_input` or `lane_end` on its last point, after its first." });
            }
            if (p > 0) {
                const before = (point.tiles ?? 1) - 1;
                if (curvesOf(point) > before) {
                    shape.push({ path, message: `This run holds ${curvesOf(point)} curves in ${before} tile${before === 1 ? "" : "s"} before its point; `
                        + "a curve takes a tile of its own." });
                }
            }
            if (Array.isArray(point.side_load)) {
                const copies = point.side_load;
                const head = copies[0];
                const ordered = copies.every((copy, k) => k === 0
                    || (Math.abs(copy - head) > Math.abs(copies[k - 1] - head) && Math.sign(copy - head) === Math.sign(copies[1] - head)));
                if (!ordered) {
                    shape.push({ path, message: "List the copies of a side load in the order they stand along the stretch, upstream first, each once." });
                }
                if (copies.length > 1 && outputs_a_copy > 1) {
                    shape.push({ path, message: `A copy has ${outputs_a_copy} output inserters, and a list of side loads steps by \`setpoint.copy_offset\`, `
                        + "one copy a step. State each output inserter's side load at a point of its own, with its `tiles`." });
                } else if (copies.length > 1 && (spacing === undefined || !Number.isInteger(spacing))) {
                    shape.push({ path, message: "State `setpoint.copy_offset` in whole tiles: the side loads of a list stand that far apart along the stretch." });
                }
            } else if (point.side_load !== undefined) {
                const target = point.side_load.stretch;
                if (target > count || target === s + 1) {
                    shape.push({ path, message: `\`side_load\` names stretch ${target}, which is not in \`stretches\` (1 to ${count}), or this stretch itself.` });
                } else {
                    named.set(target, [...(named.get(target) ?? []), s + 1]);
                    stretch_loads.push({ sender: target, receiver: s + 1, path });
                }
            }
        });
    });
    const lists = belt.stretches.some(stretch => stretch.points.some(point => Array.isArray(point.side_load)));
    if (lists && belt.side_belt === undefined && belt.side_belts === undefined) {
        shape.push({ path: [], message: "State `side_belt`: the belt that each copy's output inserter drops on, up to its side load." });
    }
    if (belt.side_belt !== undefined && curvesOf(belt.side_belt) > belt.side_belt.tiles - 1) {
        shape.push({ path: ["side_belt"], message: `The side belt holds ${curvesOf(belt.side_belt)} curves in ${belt.side_belt.tiles - 1} tiles after its drop tile; `
            + "a curve takes a tile of its own." });
    }

    // the side belts of single outputs: each number in one entry, and each a number that side-loads
    if (belt.side_belts !== undefined) {
        const loaded = new Set(belt.stretches.flatMap(stretch => stretch.points.flatMap(point => Array.isArray(point.side_load) ? point.side_load : [])));
        const entered = new Set<number>();
        belt.side_belts.forEach((entry, e) => {
            entry.outputs.forEach((number, j) => {
                const path = ["side_belts", e, "outputs", j];
                if (entered.has(number)) {
                    shape.push({ path, message: `Output ${number} is named by two entries of \`side_belts\`. State the side belt of each output once.` });
                } else if (!loaded.has(number)) {
                    shape.push({ path, message: `\`side_belts\` states a side belt for output ${number}, but no \`side_load\` names it. `
                        + "Remove the number, or state its side load." });
                }
                entered.add(number);
            });
            if (curvesOf(entry) > entry.tiles - 1) {
                const after = entry.tiles - 1;
                shape.push({ path: ["side_belts", e], message: `The side belt of outputs ${words(entry.outputs)} holds ${curvesOf(entry)} curves in `
                    + `${after} tile${after === 1 ? "" : "s"} after its drop tile; a curve takes a tile of its own.` });
            }
        });
        const bare = [...loaded].filter(number => !entered.has(number));
        if (belt.side_belt === undefined && bare.length > 0) {
            shape.push({ path: ["side_belts"], message: `${bare.length === 1 ? `Output ${bare[0]} side-loads and has` : `Outputs ${words(bare)} side-load and have`} no side belt. `
                + "State `side_belt` for every output that `side_belts` does not name, or name "
                + `${bare.length === 1 ? "it" : "them"} in \`side_belts\`.` });
        }
    }

    // the groups of stretches: each stretch in one group
    const groupsOf = new Map<number, number[]>(); // a stretch, and the groups that name it
    belt.stretch_groups?.forEach((group, g) => {
        group.forEach((number, i) => {
            if (number > count) {
                shape.push({ path: ["stretch_groups", g, i], message: `\`stretch_groups\` names stretch ${number}, which is not in \`stretches\` (1 to ${count}). `
                    + "State the number of a stretch of the output belt." });
                return;
            }
            const before = groupsOf.get(number) ?? [];
            if (before.length > 0 && !before.includes(g + 1)) {
                shape.push({ path: ["stretch_groups", g, i], message: `Stretch ${number} is in groups ${words([...before, g + 1])} of \`stretch_groups\`. State each stretch in one group.` });
            } else if (before.includes(g + 1)) {
                shape.push({ path: ["stretch_groups", g, i], message: `Stretch ${number} is twice in group ${g + 1} of \`stretch_groups\`. State each stretch once.` });
            }
            groupsOf.set(number, [...before, g + 1]);
        });
    });
    if (belt.stretch_groups !== undefined) {
        const left_out = belt.stretches.flatMap((_, s) => groupsOf.has(s + 1) ? [] : [s + 1]);
        if (left_out.length > 0) {
            shape.push({ path: ["stretch_groups"], message: `${left_out.length === 1 ? `Stretch ${left_out[0]} is` : `Stretches ${words(left_out)} are`} in no group of \`stretch_groups\`. `
                + "State every stretch in the group whose infinite end its items reach, or remove `stretch_groups` when the output belt has one infinite end." });
        }
    }

    // the splitter: its points and its priorities
    const inputs = belt.stretches.flatMap((stretch, s) => {
        const p = stretch.points.length - 1;
        const side = stretch.points[p].splitter_input;
        return side !== undefined && p > 0 ? [{ side, stretch: s + 1, path: at(s, p) }] : [];
    });
    const outputs = belt.stretches.flatMap((stretch, s) => {
        const side = stretch.points[0].splitter_output;
        return side !== undefined ? [{ side, stretch: s + 1, path: at(s, 0) }] : [];
    });
    for (const [ends, kind] of [[inputs, "input"], [outputs, "output"]] as const) {
        for (const side of BELT_LANES) {
            const same = ends.filter(end => end.side === side);
            if (same.length > 1) {
                shape.push({ path: same[1].path, message: `The splitter's ${side} ${kind} is stated twice (stretches ${words(same.map(end => end.stretch))}). `
                    + "State one stretch for each input and each output." });
            }
        }
    }
    if ((inputs.length > 0 || outputs.length > 0) && belt.splitter === undefined) {
        shape.push({ path: [], message: "State `splitter` with its `input_priority` and `output_priority`: "
            + `stretches ${words(inputs.map(end => end.stretch))} end at its inputs, and stretches ${words(outputs.map(end => end.stretch))} start at its outputs.` });
    }
    if (belt.splitter !== undefined && (inputs.length === 0 || outputs.length === 0)) {
        shape.push({ path: ["splitter"], message: "No stretch ends in an input of the splitter, or none starts at an output. "
            + "State `splitter_input` and `splitter_output` on the stretches at the splitter, or remove `splitter`." });
    }

    // a stretch starts where something feeds it
    belt.stretches.forEach((stretch, s) => {
        const first = stretch.points[0];
        if (first.side_load === undefined && first.drop === undefined && first.splitter_output === undefined) {
            rules.push({ path: at(s, 0), message: `Stretch ${s + 1} starts with nothing that feeds it. Its first point must be where items come onto it: `
                + "a copy's drop (`drop`), a side load (`side_load`) or a splitter output (`splitter_output`). "
                + "The generator does not model a belt that comes onto the output belt from outside the build." });
        }
    });
    // a stretch ends once: in the splitter, the infinite end, or a side load that a point names
    belt.stretches.forEach((stretch, s) => {
        const p = stretch.points.length - 1;
        const last = stretch.points[p];
        const by = named.get(s + 1) ?? [];
        if (p > 0 && isRunOnly(last) && by.length === 0) {
            rules.push({ path: at(s, p), message: `The last point of stretch ${s + 1} holds only its run, but no \`side_load\` names stretch ${s + 1}. `
                + `State where its items go: \`side_load: {"stretch": ${s + 1}}\` at the point that takes them, \`splitter_input\`, or the infinite end.` });
        } else if (!(p > 0 && (isRunOnly(last) || last.splitter_input !== undefined || last.lane_end !== undefined))) {
            rules.push({ path: at(s, p), message: `Stretch ${s + 1} does not end. Its last point must hold only the run to where it side-loads, `
                + "end in a splitter input, or be the infinite end." });
        } else if (by.length > 0 && !isRunOnly(last)) {
            rules.push({ path: at(s, p), message: `Stretch ${s + 1} ends ${last.splitter_input !== undefined ? "in the splitter" : "at the infinite end"}, `
                + `so it cannot also side-load onto stretch ${by[0]}. State its last point as the run to that side load only.` });
        }
        if (by.length > 1) {
            rules.push({ path: at(s, p), message: `Stretch ${s + 1} side-loads onto stretches ${words(by)}. A stretch ends once: state one side load of it.` });
        }
    });
    // one infinite end: of the output belt, or of each group of stretches
    const endsIn = (numbers: number[]) => numbers.reduce((sum, number) => sum
        + (belt.stretches[number - 1]?.points.filter(point => point.lane_end !== undefined).length ?? 0), 0);
    const ENDS_FIX = "State exactly one: `lane_end: {\"kind\": \"infinite\"}` on the last point of the stretch whose items leave the build.";
    const endsStated = (ends: number) => ends === 0 ? "no infinite end" : `${ends} infinite ends`;
    if (belt.stretch_groups === undefined) {
        const infinite_end_count = endsIn(belt.stretches.map((_, s) => s + 1));
        if (infinite_end_count !== 1) {
            rules.push({ path: [], message: `The output belt states ${endsStated(infinite_end_count)}. ${ENDS_FIX}` });
        }
    } else {
        belt.stretch_groups.forEach((group, g) => {
            const numbers = group.filter(number => number <= count);
            if (endsIn(numbers) !== 1) {
                rules.push({ path: ["stretch_groups", g], message: `Group ${g + 1} (${numbers.length === 1 ? "stretch" : "stretches"} ${words(numbers)}) states ${endsStated(endsIn(numbers))}. ${ENDS_FIX}` });
            }
        });
        // a side load of a stretch and the splitter join stretches of one group only
        const group_of = (stretch: number) => groupsOf.get(stretch)?.[0];
        for (const load of stretch_loads) {
            const from = group_of(load.sender);
            const onto = group_of(load.receiver);
            if (from !== undefined && onto !== undefined && from !== onto) {
                rules.push({ path: load.path, message: `Stretch ${load.sender} (group ${from}) side-loads onto stretch ${load.receiver} (group ${onto}). `
                    + `A group holds the stretches that join: state both stretches in one group, or end stretch ${load.sender} in an infinite end of its own.` });
            }
        }
        const at_splitter = [...inputs, ...outputs];
        const splitter_groups = [...new Set(at_splitter.flatMap(end => group_of(end.stretch) ?? []))].sort((a, b) => a - b);
        if (splitter_groups.length > 1) {
            rules.push({ path: ["splitter"], message: `The splitter joins stretches of groups ${words(splitter_groups)} (its inputs are stretches ${words(inputs.map(end => end.stretch))}, `
                + `its outputs are stretches ${words(outputs.map(end => end.stretch))}). State them in one group.` });
        }
    }
    if (shape.length > 0) return [...shape, ...rules];

    const geometry = outputBeltGeometry(belt, spacing ?? 0);
    // two side loads onto one tile
    geometry.stretches.forEach((stretch, s) => {
        const loads = geometry.side_loads.filter(load => load.stretch === stretch.stretch);
        for (const tile of new Set(loads.map(load => load.tile))) {
            const same = loads.filter(load => load.tile === tile);
            if (same.length < 2) continue;
            const senders = same.map(each => "side_belt_of_copy" in each.sender ? each.sender.side_belt_of_copy : `stretch ${each.sender.stretch}`);
            const what = senders.every(sender => typeof sender === "number") ? `the side belts of copies ${words(senders)}` : `the side loads of ${words(senders)}`;
            rules.push({ path: same[1].path, message: `Stretch ${s + 1} takes ${same.length} side loads on one tile (${what}). `
                + "The generator does not model a tile that takes two side loads. State each side load at a tile of its own, "
                + "and the distance between the copies in `setpoint.copy_offset`." });
        }
    });
    // a side load onto the lane that an underground's hood shuts: the sender's stream would stop there
    // the lanes of the sender that its hood shuts: a side belt's lane is the lane of the side belt of that output inserter
    const shutBy = (load: SideLoadGeometry): BeltLane[] => {
        if (load.layout === "side-straight") return [];
        const carried = "side_belt_of_copy" in load.sender ? [sideBeltOf(belt, load.sender.side_belt_of_copy)!.lane]
            : geometry.stretches[load.sender.stretch - 1].carried;
        return carried.filter(lane => !load.lanes.find(each => each.sender_lane === lane)!.passes);
    };
    const reported = new Set<string>();
    for (const load of geometry.side_loads) {
        const shut = shutBy(load);
        if (shut.length === 0) continue;
        const key = `${JSON.stringify(load.path)} ${shut.join()}`;
        if (reported.has(key)) continue;
        reported.add(key);
        const sender = "side_belt_of_copy" in load.sender
            ? `The side belts of copies ${words(geometry.side_loads.filter(each => JSON.stringify(each.path) === JSON.stringify(load.path)
                && shutBy(each).join() === shut.join()).map(each => (each.sender as { side_belt_of_copy: number }).side_belt_of_copy))} side-load their`
            : `Stretch ${load.sender.stretch} side-loads its`;
        const end = load.layout === "side-exit" ? "exit" : "entrance";
        const passing = load.lanes.find(each => each.passes)!.sender_lane;
        rules.push({ path: load.path, message: `${sender} ${words(shut)} lane onto ${LAYOUT_NAME[load.layout]} (${load.layout}) from the ${load.lane} `
            + `of stretch ${load.stretch}, and the ${end}'s hood shuts that lane: its items stop there. On an ${end}, only the ${passing} lane passes `
            + `from the ${load.lane}. State the lane that the items move on, or the layout of the tile that takes them.` });
    }
    return rules;
}
