/**
 * The numbers of the per-tick model of belt lines at a join (join-model.ts), each with where it is measured. Positions and
 * lengths are in 1/256 tile; a position is the distance to the downstream end of the stack's line, as the game gives it.
 * The model is of turbo belts with stacks of 4: the recordings of the belt join family are of that belt only
 * (tests/game/mechanics/belt-join/, "the family" below, which names its copies).
 */

/** How far a turbo belt moves a stack in a tick: 0.125 tile. Every moving stack of every copy of the family. */
export const STEP = 32;

/** How close a stack comes to the stack ahead of it on its lane: a quarter tile. Every closed-up stack of the family. */
export const GAP = 64;

/**
 * An end loader takes a stack in the tick its new position on the loader's line would be below this. The copy
 * `curve-loader` of the family (its loader's rows).
 */
export const LOADER_TAKE_POSITION = 32;

/** Which side of the receiving belt a sender lane comes onto it from */
export type SideLoadLane = "downstream" | "upstream";

/** The entity of the receiving lane that a side load goes onto */
export type ReceivingEntity = "belt" | "underground-exit" | "underground-entrance";

/**
 * The side-load point S on the receiving line: the head of a sender lane lands at S - STEP + p, p its position before the
 * tick, when nothing of the receiving lane is in the way. Measured on the empty copies of the family: onto a straight belt
 * 67 from the downstream side and 188 from the upstream side (`belt-free-1`, `belt-free-2`), onto an underground exit 67
 * from the downstream side (`exit-free-1`, `exit-free-2`), onto an underground entrance 60 from the upstream side
 * (`entrance-free-1`, `entrance-free-2`). The boundary copies: a stack of the receiving lane at S goes first, one behind
 * it yields (`belt-downstream-at-point`, `boundary-belt-68`, `belt-upstream-at-point`, `boundary-belt-189`,
 * `boundary-exit-67`). The hood shuts the other lane onto an exit or an entrance: null.
 */
export const SIDE_LOAD_POINT: Record<ReceivingEntity, Record<SideLoadLane, number | null>> = {
    "belt": { downstream: 67, upstream: 188 },
    "underground-exit": { downstream: 67, upstream: null },
    "underground-entrance": { downstream: null, upstream: 60 },
};

/**
 * The game's line lengths (LuaTransportLine.line_length) of the entities of the family, as its probe logs them: a straight
 * belt, an underground end, a tunnel a tile, the outer and the inner lane of a turned belt, a loader, and a splitter's
 * input and output lines. Every kept copy's recording holds its lines' lengths, and its offline replay checks them.
 */
export const STRAIGHT_LINE_LENGTH = 256;
export const UNDERGROUND_END_LINE_LENGTH = 128;
export const TUNNEL_LINE_LENGTH_A_TILE = 256;
export const CURVE_OUTER_LINE_LENGTH = 295;
export const CURVE_INNER_LINE_LENGTH = 106;
export const LOADER_LINE_LENGTH = 128;
export const SPLITTER_INPUT_LINE_LENGTH = 179;
export const SPLITTER_OUTPUT_LINE_LENGTH = 128;

/**
 * A lane crosses a splitter in one tile: a stack that leaves the end of an input line of length L comes onto the output
 * line at SPLITTER_LANE_LENGTH - L less the rest of its step (77 - 14 = 63 from 18). The copies `splitter-cross-lane-1`
 * and `splitter-cross-lane-2` of the family.
 */
export const SPLITTER_LANE_LENGTH = 256;
