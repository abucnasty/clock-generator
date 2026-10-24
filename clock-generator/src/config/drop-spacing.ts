import { Belt, BeltSpeed } from "../entities/belt";
import { Entity, handSizeFor } from "../entities";
import { createEntityRegistryFromConfig } from "../crafting/sequence/simulation-context";
import { LaneTraffic } from "../state/lane-traffic";
import type { Config } from "./schema";

// ============================================================================
// Where the drops of output inserters land on a shared belt
// ============================================================================
//
// The output inserters of a build, with the copies of it, can drop onto one stretch of belt. A hand of a stack
// inserter takes a stretch of the lane (a quarter tile for each stack of it) and lands where the belt has room:
// where items already lie it waits until they have moved on. The simulator's lane model (LaneTraffic) says how a hand
// lands; this module asks it of the hands of all the copies together, which a config of one unit does not do.
//
// Seen from the moving belt a hand that starts at tick t at place p (tiles downstream along the row of its inserters)
// lies at (p - v t) mod L, with v the tiles the belt moves in a tick and L = v P the tiles it moves in a period. Two
// hands collide when their stretches overlap there. This test is exact against the lane model (drop-spacing.test.ts
// replays it); the replay is used for the ticks a colliding hand waits.
//
// Taken from the config: the places and facings of the inserters (Sidecar 0.12.0), the way the belt runs at the drop
// (Sidecar 0.14.0) and `target_output.copy_offset`. Taken from the clock: the ticks at which each inserter starts a hand.
// Nothing here changes a clock or its ranking.

/** The text added to the insight: the check follows no bend of the belt */
export const DROP_SPACING_STRAIGHT_BELT = "The belt is taken to run straight past these inserters.";

/** The text said where drops are left out of the check: the ones marked as side-loaded (Sidecar 0.13.0) */
export const DROP_SPACING_UNCHECKED = "Drops that are side-loaded or go through a splitter are not checked here.";

/** The text said wherever copies share a belt: the config describes one copy and the check repeats it */
export const DROP_SPACING_COPIES_ALIKE = "This assumes every copy drops onto the belt the way this one does.";

const EPSILON = 1e-9;
const QUARTER_TILE = 0.25;
/** The most periods a replay runs, and the periods it runs after the lane is full of the line's hands */
const MAX_REPLAY_PERIODS = 60;
const SETTLE_PERIODS = 4;

/** A cardinal direction of the game: 0 north, 4 east, 8 south, 12 west */
type Cardinal = 0 | 4 | 8 | 12;
const cardinal = (direction: number | undefined): Cardinal | null =>
    direction === 0 || direction === 4 || direction === 8 || direction === 12 ? direction : null;

/** One output inserter of a line, before any clock */
interface LineInserter {
    id: number;
    /** Where it stands along the line, in tiles of the exported coordinates */
    along: number;
    /** Items a hand of it holds, and the stacks of the lane they make */
    stacks: number;
}

/** The output inserters that drop onto one stretch of one lane of a belt: the same side, the same row */
export interface DropLine {
    belt_id: number;
    /** The side the inserters drop on, as the direction they face (the side they take from) */
    facing: Cardinal;
    axis: "x" | "y";
    /** +1 when the belt runs toward larger coordinates along the axis, -1 toward smaller, null when it is not known */
    flow: 1 | -1 | null;
    inserters: LineInserter[];
    /** Tiles the belt moves in a tick */
    tiles_per_tick: number;
    /** Items in a hand, and in a stack of the lane */
    hand: number;
    lane_stack: number;
}

/** Where the next copy stands relative to a line: along it (shared), or across it (the copies have rows of their own) */
interface CopyStep {
    along: number;
    shared: boolean;
}

const pair = (a: number, b: number) => a - b;

const listed = (values: readonly (string | number)[], word = "and"): string =>
    values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} ${word} ${values[values.length - 1]}`;
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const tiles = (value: number) => String(Number(value.toFixed(2)));
const inserterWords = (ids: readonly number[]) => `${ids.length === 1 ? "inserter" : "inserters"} ${listed(ids)}`;

/** The step from one copy to the next along a line */
function copyStepOf(config: Config, axis: "x" | "y"): CopyStep | null {
    const offset = config.target_output.copy_offset;
    if (config.target_output.copies <= 1 || offset === undefined) return null;
    const across = axis === "x" ? offset.y : offset.x;
    const along = axis === "x" ? offset.x : offset.y;
    return { along, shared: Math.abs(across) < EPSILON };
}

/**
 * The lines of a config: output inserters that drop straight onto a belt, with a position and a cardinal facing, grouped by
 * belt, side and row. An inserter whose drop is marked as side-loading onto another belt is left to the merge, and a
 * line with an inserter that has no position is not a line.
 */
export function dropLines(config: Config): DropLine[] {
    const registry = createEntityRegistryFromConfig(config);
    const groups = new Map<string, { line: Omit<DropLine, "inserters">; inserters: LineInserter[]; complete: boolean; flows: Set<1 | -1 | null> }>();
    // a belt with a straight drop whose place, facing or hand is not known is not checked at all: the drops of its other
    // inserters are not all there
    const unknown = new Set<number>();
    config.inserters.forEach((inserter, index) => {
        const sink = inserter.sink;
        if (sink.type !== "belt" || sink.drop_capture !== undefined) return;
        const belt = config.belts.find(it => it.id === sink.id);
        if (belt === undefined) return;
        const id = inserter.id ?? index + 1;
        const facing = cardinal(inserter.direction);
        const lane_stacks = [...new Set(belt.lanes.map(lane => lane.stack_size))];
        const entity = registry.getAll().find(it => Entity.isInserter(it) && it.entity_id.number === id);
        if (facing === null || inserter.position === undefined || entity === undefined || !Entity.isInserter(entity) || lane_stacks.length !== 1) {
            unknown.add(sink.id);
            return;
        }
        const axis = facing === 0 || facing === 8 ? "x" : "y";
        // the row of the drop tile: one tile to the side opposite the one the inserter takes from
        const step = facing === 0 || facing === 12 ? 1 : -1;
        const row = (axis === "x" ? inserter.position.y : inserter.position.x) + step;
        const key = `${sink.id}|${facing}|${row}`;
        const item = belt.lanes.map(lane => lane.ingredient).find(name => entity.hand_sizes?.has(name));
        const hand = item !== undefined ? handSizeFor(entity, item) : entity.metadata.stack_size;
        const direction = cardinal(sink.belt_direction);
        const along_axis = direction === null || (axis === "x" ? direction === 4 || direction === 12 : direction === 0 || direction === 8);
        const flow = direction === null ? null : axis === "x" ? (direction === 4 ? 1 : -1) : (direction === 8 ? 1 : -1);
        const group = groups.get(key) ?? {
            line: { belt_id: sink.id, facing, axis, flow: null, tiles_per_tick: 1 / Belt.ticksPerTile(Belt.fromConfig(belt).belt_speed).toDecimal(),
                hand, lane_stack: lane_stacks[0] },
            inserters: [], complete: true, flows: new Set<1 | -1 | null>(),
        };
        if (!along_axis) group.complete = false;
        group.flows.add(flow);
        group.inserters.push({ id, along: axis === "x" ? inserter.position.x : inserter.position.y, stacks: Math.max(1, Math.ceil(hand / lane_stacks[0])) });
        groups.set(key, group);
    });
    const lines: DropLine[] = [];
    for (const group of groups.values()) {
        if (!group.complete || unknown.has(group.line.belt_id) || group.flows.size !== 1) continue;
        lines.push({ ...group.line, flow: [...group.flows][0], inserters: group.inserters.sort((a, b) => a.id - b.id) });
    }
    return lines.sort((a, b) => a.inserters[0].id - b.inserters[0].id);
}

/** The output inserters whose drop onto a belt is marked as side-loaded: the merge decides where those land, and the check does not cover them */
export function uncheckedDrops(config: Config): number[] {
    return config.inserters.flatMap((inserter, index) =>
        inserter.sink.type === "belt" && inserter.sink.drop_capture !== undefined ? [inserter.id ?? index + 1] : []);
}

/** A hand of a line: where it starts, when, and how much of the lane it takes */
interface Hand {
    inserter_id: number;
    copy: number;
    place: number;
    tick: number;
    stacks: number;
}

/** The hands of a line, for the ticks at which each inserter starts one */
function handsOf(line: DropLine, starts: ReadonlyMap<number, readonly number[]>, copies: number, step: CopyStep | null, sense: 1 | -1): Hand[] {
    const hands: Hand[] = [];
    const shared = copies > 1 && step !== null && step.shared;
    const count = shared ? Math.ceil(copies) : 1;
    for (let copy = 0; copy < count; copy++) {
        for (const inserter of line.inserters) {
            for (const tick of starts.get(inserter.id) ?? []) {
                const along = inserter.along + (shared ? copy * step.along : 0);
                hands.push({ inserter_id: inserter.id, copy, place: sense * along, tick, stacks: inserter.stacks });
            }
        }
    }
    return hands;
}

/** Pairs of hands whose stretches of the lane overlap, seen from the moving belt */
function collidingPairs(hands: readonly Hand[], tiles_per_tick: number, period: number): [number, number][] {
    const cycle = tiles_per_tick * period;
    const mod = (value: number) => ((value % cycle) + cycle) % cycle;
    const frame = hands.map(hand => mod(hand.place - tiles_per_tick * hand.tick));
    const width = hands.map(hand => QUARTER_TILE * hand.stacks);
    const found: [number, number][] = [];
    for (let i = 0; i < hands.length; i++) {
        for (let j = i + 1; j < hands.length; j++) {
            const behind_i = mod(frame[i] - frame[j]), behind_j = mod(frame[j] - frame[i]);
            if (behind_i < width[i] - EPSILON || behind_j < width[j] - EPSILON) found.push([i, j]);
        }
    }
    return found;
}

/**
 * The ticks each hand waits for room, by the lane model of the simulator replayed on the line for enough periods that
 * the lane is full of its hands. A hand that is not down by the end of its period counts as waiting for the rest of it.
 */
function waitsOf(hands: readonly Hand[], speed: BeltSpeed, tiles_per_tick: number, period: number): number[] {
    const lane = new LaneTraffic(speed);
    const lowest = Math.min(...hands.map(hand => hand.place));
    const spots = hands.map(hand => (hand.place - lowest) / tiles_per_tick);
    spots.forEach(spot => lane.registerSpot(spot));
    const span = Math.max(...hands.map(hand => hand.place)) - lowest;
    const periods = Math.min(MAX_REPLAY_PERIODS, Math.ceil(span / (tiles_per_tick * period)) + SETTLE_PERIODS);
    const alone_ticks = new Map<number, number>();
    const free = (stacks: number): number => {
        if (!alone_ticks.has(stacks)) {
            const alone = new LaneTraffic(speed);
            alone.registerSpot(0);
            for (let tick = 0, placed = 0; ; tick++) if (alone.tryPlace(tick, 0) && ++placed === stacks) { alone_ticks.set(stacks, tick); break; }
        }
        return alone_ticks.get(stacks)!;
    };
    const waits = hands.map(() => 0);
    const active: { hand: number; start: number; placed: number }[] = [];
    const last = (periods - 1) * period;
    for (let tick = 0; tick < periods * period + period; tick++) {
        const n = Math.floor(tick / period);
        if (n < periods) hands.forEach((hand, index) => { if (tick === Math.round(n * period + hand.tick)) active.push({ hand: index, start: tick, placed: 0 }); });
        for (const entry of [...active]) {
            if (lane.tryPlace(tick, spots[entry.hand]) && ++entry.placed === hands[entry.hand].stacks) {
                active.splice(active.indexOf(entry), 1);
                if (entry.start >= last - period && entry.start < last) waits[entry.hand] = Math.max(0, tick - entry.start - free(hands[entry.hand].stacks));
            }
        }
    }
    for (const entry of active) if (entry.start >= last - period && entry.start < last) waits[entry.hand] = period;
    return waits;
}

/** What the check says of one line */
export interface DropSpacingLine {
    belt_id: number;
    inserter_ids: number[];
    facing: Cardinal;
    /** Hands the line takes in a period, all the copies together */
    hands: number;
    /** Ticks at which each inserter of the line starts a hand */
    starts: { inserter_id: number; ticks: number[] }[];
    fits: boolean;
    /** Pairs of hands that land on each other */
    pairs: number;
    /** The most ticks a hand waits for room (0 when they fit) */
    longest_wait: number;
}

export interface DropSpacing {
    period: number;
    copies: number;
    /** Tiles from one copy to the next along the lines, null for one copy or a gap not given */
    gap: number | null;
    /** Tiles the belt moves in a period */
    belt_tiles: number;
    /** Items in a hand, and in a stack of the lane, of the first line */
    hand: number;
    lane_stack: number;
    lines: DropSpacingLine[];
    /** Output inserters whose drops are marked as side-loaded and so left out of the lines */
    unchecked: number[];
    /** The spacings of the copies, and the offsets between a copy's inserters, at which the lines fit; none when the gap is not given or the lines are not all shared */
    room?: DropRoom;
    /** For the first line that does not fit: the inserter to start at another tick, the ticks that fit nearest to its own, and the inserter whose tick it could share */
    fitting_start?: { inserter_id: number; ticks: number[]; same_as?: number };
}

const speedOf = (config: Config, belt_id: number): BeltSpeed =>
    Belt.fromConfig(config.belts.find(it => it.id === belt_id)!).belt_speed;

/** Whether every line fits with the hands of all copies, for a verdict of one sense of the belt */
function checkLine(config: Config, line: DropLine, starts: ReadonlyMap<number, readonly number[]>, period: number, step: CopyStep | null, sense: 1 | -1) {
    const hands = handsOf(line, starts, config.target_output.copies, step, sense);
    return { hands, pairs: hands.length > 0 ? collidingPairs(hands, line.tiles_per_tick, period) : [] };
}

/**
 * Where the drops of the output inserters land on the shared belt, for a clock that starts the inserters' hands at
 * `starts` (ticks in a period of `period`). None when no line can be checked: no positions, copies whose gap is not
 * given, hands of different ticks on a line whose belt direction is not known and whose answer depends on it.
 */
export function dropSpacing(config: Config, starts: ReadonlyMap<number, readonly number[]>, period: number): DropSpacing | null {
    if (!(period > 0)) return null;
    const copies = config.target_output.copies;
    const results: { line: DropLine; step: CopyStep | null; sense: 1 | -1; result: DropSpacingLine }[] = [];
    for (const line of dropLines(config)) {
        const step = copyStepOf(config, line.axis);
        if (copies > 1 && step === null) continue;
        const ticks = line.inserters.map(inserter => starts.get(inserter.id) ?? []).filter(it => it.length > 0);
        if (ticks.length === 0) continue;
        const senses: (1 | -1)[] = line.flow === null ? [1, -1] : [line.flow];
        const checks = senses.map(sense => ({ sense, ...checkLine(config, line, starts, period, step, sense) }));
        if (new Set(checks.map(check => check.pairs.length > 0)).size > 1) continue;
        const check = checks[0];
        const waits = check.pairs.length > 0 ? waitsOf(check.hands, speedOf(config, line.belt_id), line.tiles_per_tick, period) : [];
        results.push({
            line, step, sense: check.sense,
            result: {
                belt_id: line.belt_id,
                inserter_ids: line.inserters.filter(inserter => (starts.get(inserter.id) ?? []).length > 0).map(inserter => inserter.id),
                facing: line.facing, hands: check.hands.length,
                starts: line.inserters.filter(inserter => (starts.get(inserter.id) ?? []).length > 0).map(inserter => ({ inserter_id: inserter.id, ticks: [...starts.get(inserter.id)!].sort(pair) })),
                fits: check.pairs.length === 0, pairs: check.pairs.length, longest_wait: waits.length === 0 ? 0 : Math.max(...waits),
            },
        });
    }
    if (results.length === 0) return null;
    const first = results[0];
    const shared = first.step !== null && first.step.shared && copies > 1;
    const spacing: DropSpacing = {
        period, copies,
        gap: shared ? Math.abs(first.step!.along) : null,
        belt_tiles: first.line.tiles_per_tick * period,
        hand: first.line.hand, lane_stack: first.line.lane_stack,
        lines: results.map(it => it.result),
        unchecked: uncheckedDrops(config),
    };
    if (shared) spacing.room = dropRoom(config, results.map(it => it.line), period) ?? undefined;
    if (!results.every(it => it.result.fits)) {
        const failing = results.find(it => !it.result.fits)!;
        spacing.fitting_start = fittingStart(config, failing.line, failing.step, failing.sense, starts, period);
    }
    return spacing;
}

/**
 * What a rule that chooses which output inserters start together needs of the drop check: where each output inserter that
 * drops straight onto a belt stands in its line, and how many pairs of hands land on each other for the ticks at which
 * the inserters start (the colliding pairs of every line, counted as dropSpacing does). Null where no line can be checked,
 * so there is nothing to choose by.
 */
export interface DropTieBreak {
    /** The line of an output inserter and its place along it, by inserter number */
    places: ReadonlyMap<number, { line: number; along: number }>;
    /** Pairs of hands that land on each other when each inserter starts a hand at the ticks given */
    collisions: (starts: ReadonlyMap<number, readonly number[]>) => number;
}

export function dropTieBreak(config: Config, period: number): DropTieBreak | null {
    if (!(period > 0)) return null;
    const lines = dropLines(config);
    if (lines.length === 0) return null;
    const places = new Map<number, { line: number; along: number }>();
    lines.forEach((line, index) => line.inserters.forEach(inserter => places.set(inserter.id, { line: index, along: inserter.along })));
    // a check that can be made for no clock (copies whose gap is not given) leaves nothing to choose by
    const probe = new Map(Array.from(places.keys(), id => [id, [0]] as const));
    if (dropSpacing(config, probe, period) === null) return null;
    return {
        places,
        collisions: starts => dropSpacing(config, starts, period)?.lines.reduce((sum, line) => sum + line.pairs, 0) ?? 0,
    };
}

/** The widest a pitch or an offset scan lists, and the longest start delay it tries */
const MAX_LISTED = 8;
const MAX_OFFSET_TILES = 64;
const MAX_DELAY_TICKS = 1000;
/** The narrowest machine or drill of the game is 3 tiles across: the span of the positions of a copy, plus one such entity */
const NARROWEST_ENTITY_TILES = 3;
/** How near a whole number the tiles the belt moves in a period must be to count as one */
const LOOP_SLACK = 1e-9;

/** Whether no two hands overlap on the circle of the belt's tiles in a period: the test of collidingPairs, sorted */
function handsFit(hands: readonly Hand[], tiles_per_tick: number, period: number): boolean {
    if (hands.length < 2) return true;
    const cycle = tiles_per_tick * period;
    const mod = (value: number) => ((value % cycle) + cycle) % cycle;
    const placed = hands.map(hand => ({ at: mod(hand.place - tiles_per_tick * hand.tick), width: QUARTER_TILE * hand.stacks })).sort((a, b) => a.at - b.at);
    for (let i = 1; i < placed.length; i++) if (placed[i].at - placed[i - 1].at < placed[i].width - EPSILON) return false;
    return placed[0].at + cycle - placed[placed.length - 1].at >= placed[0].width - EPSILON;
}

/** What the scan of the spacings of the copies finds, at the period it was made for, for inserters that start in the same tick */
export interface DropRoom {
    /** The spacings tried, whole tiles from `low` to `high`: the width of a copy, and on to one full loop of the belt's tiles where that is a whole number */
    low: number;
    high: number;
    /**
     * The tiles the belt moves in a period when that is a whole number the same on every shared line: whether the hands fit then depends on
     * the spacing less a whole number of loops only, so a spacing fits when the spacing plus this much does. Null otherwise.
     */
    loop: number | null;
    /** The copies, and the hands they drop on a lane in a period when these take more of the lane than the belt moves in it: no spacing fits then. Null otherwise */
    copies: number;
    crowded: { hands: number; belt_tiles: number; hand_tiles: number } | null;
    /** The spacings at which the lines fit with the inserters where they stand */
    fits: number[];
    /** Spacings at which they fit only with another distance between the two inserters of a copy: the distances (whole tiles) */
    only_with: { spacings: number[]; apart: number[] }[];
    /** Spacings at which they fit with no distance. Both this and `only_with` are empty for a line with other than two inserters in a copy */
    never: number[];
    /** The two inserters of a copy (of the first line) and the tiles between them; null for other lines */
    pair: { first: number; second: number; apart: number } | null;
    /** The first ticks after the first inserter at which the second starting makes the lines fit, at the spacing the config has */
    starts_after: number[];
    /** Tiles the belt moves in a period, ticks it takes for a tile, and tiles a hand takes */
    belt_tiles: number;
    ticks_per_tile: number;
    hand_tiles: number;
    /** The spacing the config has, and the spacing in the scan that fits as it does (the same unless it lies beyond one loop of the scan) */
    gap: number;
    gap_in_scan: number;
}

/** The span of the copy's positions along an axis, plus the narrowest entity; null when an entity has no position */
function copyWidth(config: Config, axis: "x" | "y"): number | null {
    const entities = [...config.machines, ...config.inserters, ...(config.chests ?? []), ...(config.drills?.configs ?? [])];
    const places = entities.map(entity => entity.position === undefined ? null : entity.position[axis]);
    if (places.length === 0 || places.some(place => place === null)) return null;
    return Math.ceil(Math.max(...(places as number[])) - Math.min(...(places as number[])) - EPSILON) + NARROWEST_ENTITY_TILES;
}

/**
 * The spacings of the copies, from the width of a copy for one full loop of the belt's tiles in a period (the same list whatever
 * spacing the config has; where that is not a whole number, a fixed range), at which every shared line fits when its
 * inserters start in the same tick, or none when the hands of a lane take more of it than the belt moves in a period; for a line of two inserters in a copy, the distances between them that fit at the spacings that
 * do not, and the start delays of the second one that fit. Arithmetic on the places alone: no run of the build. Null where
 * the copies' gap is not given or no line is shared.
 */
export function dropRoom(config: Config, lines: readonly DropLine[], period: number): DropRoom | null {
    const copies = config.target_output.copies;
    const offset = config.target_output.copy_offset;
    const shared = lines.filter(line => copyStepOf(config, line.axis)?.shared === true);
    if (!(period > 0) || !(copies > 1) || offset === undefined || shared.length === 0) return null;
    const signs = shared.map(line => ((line.axis === "x" ? offset.x : offset.y) < 0 ? -1 : 1) as 1 | -1);
    const gap = Math.abs(shared[0].axis === "x" ? offset.x : offset.y);
    const first = shared[0];
    const tiles_per_tick = first.tiles_per_tick;
    const width = copyWidth(config, first.axis);
    const low = Math.max(1, width ?? 1);
    const together = new Map<number, readonly number[]>(shared.flatMap(line => line.inserters.map(inserter => [inserter.id, [0]] as const)));
    const loops = shared.map(line => line.tiles_per_tick * period);
    const whole = Math.round(loops[0]);
    const loop = whole >= 1 && loops.every(it => Math.abs(it - whole) < LOOP_SLACK) ? whole : null;
    const crowded = shared.map((line, index) => {
        const hands = handsOf(line, together, copies, { along: gap, shared: true }, 1);
        return { hands: hands.length, belt_tiles: loops[index], hand_tiles: QUARTER_TILE * line.inserters[0].stacks, taken: hands.reduce((sum, hand) => sum + QUARTER_TILE * hand.stacks, 0) };
    }).find(it => it.taken > it.belt_tiles + EPSILON);
    const high = crowded !== undefined ? low - 1 : loop !== null ? low + loop - 1 : low + 2 * Math.ceil(loops[0]);
    const gap_in_scan = loop !== null ? low + (((Math.round(gap) - low) % loop) + loop) % loop : gap;
    const fitsWith = (candidates: readonly DropLine[], pitch: number, starts: ReadonlyMap<number, readonly number[]>): boolean =>
        candidates.every((line, index) => (line.flow === null ? [1, -1] as const : [line.flow] as const)
            .every(sense => handsFit(handsOf(line, starts, copies, { along: signs[index] * pitch, shared: true }, sense), line.tiles_per_tick, period)));
    const pairable = shared.every(line => line.inserters.length === 2);
    // the line with the second inserter of each copy `apart` tiles from the first, in the direction it has
    const withApart = (apart: number): DropLine[] => shared.map(line => {
        const [one, two] = line.inserters;
        return { ...line, inserters: [one, { ...two, along: one.along + (two.along < one.along ? -apart : apart) }] };
    });
    const fits: number[] = [], never: number[] = [];
    const only = new Map<string, { spacings: number[]; apart: number[] }>();
    const reach = Math.min(MAX_OFFSET_TILES, Math.ceil(tiles_per_tick * period) - 1);
    for (let pitch = low; pitch <= high; pitch++) {
        if (fitsWith(shared, pitch, together)) {
            fits.push(pitch);
        } else if (pairable) {
            const apart: number[] = [];
            for (let each = 1; each <= reach; each++) if (fitsWith(withApart(each), pitch, together)) apart.push(each);
            if (apart.length === 0) never.push(pitch);
            else {
                const group = only.get(apart.join()) ?? { spacings: [], apart };
                group.spacings.push(pitch);
                only.set(apart.join(), group);
            }
        }
    }
    const starts_after: number[] = [];
    if (pairable && crowded === undefined) {
        for (let delay = 1; delay <= Math.min(period - 1, MAX_DELAY_TICKS) && starts_after.length < 3; delay++) {
            const later = new Map(together);
            shared.forEach(line => later.set(line.inserters[1].id, [delay]));
            if (fitsWith(shared, gap, later)) starts_after.push(delay);
        }
    }
    return {
        low, high, loop, copies, crowded: crowded === undefined ? null : { hands: crowded.hands, belt_tiles: crowded.belt_tiles, hand_tiles: crowded.hand_tiles },
        fits, only_with: [...only.values()], never,
        pair: pairable ? { first: first.inserters[0].id, second: first.inserters[1].id, apart: Math.abs(first.inserters[1].along - first.inserters[0].along) } : null,
        starts_after, belt_tiles: tiles_per_tick * period, ticks_per_tile: 1 / tiles_per_tick, hand_tiles: first.inserters[0].stacks * QUARTER_TILE, gap, gap_in_scan,
    };
}

/**
 * For a line that does not fit: the inserter that starts last, the ticks nearest to its own below and above at which
 * the line fits when it starts there, and the inserter that starts first if starting together fits.
 */
function fittingStart(config: Config, line: DropLine, step: CopyStep | null, sense: 1 | -1, starts: ReadonlyMap<number, readonly number[]>, period: number): DropSpacing["fitting_start"] {
    const started = line.inserters.filter(inserter => (starts.get(inserter.id) ?? []).length > 0);
    const first_tick = (id: number) => Math.min(...starts.get(id)!);
    const ordered = [...started].sort((a, b) => first_tick(a.id) - first_tick(b.id) || a.id - b.id);
    if (ordered.length < 2) return undefined;
    const reference = ordered[0], mover = ordered[ordered.length - 1];
    if (first_tick(mover.id) === first_tick(reference.id)) return undefined;
    const senses: (1 | -1)[] = line.flow === null ? [1, -1] : [line.flow];
    const fitsAt = (tick: number): boolean => {
        const shifted = new Map(starts);
        const shift = tick - first_tick(mover.id);
        shifted.set(mover.id, starts.get(mover.id)!.map(it => it + shift));
        return senses.every(each => checkLine(config, line, shifted, period, step, each).pairs.length === 0);
    };
    const own = first_tick(mover.id);
    const ticks: number[] = [];
    for (let tick = Math.ceil(own) - 1; tick >= 0; tick--) if (fitsAt(tick)) { ticks.push(tick); break; }
    for (let tick = Math.floor(own) + 1; tick < period; tick++) if (fitsAt(tick)) { ticks.push(tick); break; }
    const same = fitsAt(first_tick(reference.id));
    if (ticks.length === 0 && !same) return undefined;
    return { inserter_id: mover.id, ticks, ...(same && { same_as: reference.id }) };
}

// ----------------------------------------------------------------------------
// What the result says
// ----------------------------------------------------------------------------

/** The sentence about where the inserters of the clock start their hands: "Inserter 1 starts at tick 6 and inserter 2 at tick 62." */
function startsSentence(line: DropSpacingLine): string {
    const ticksText = (ticks: number[]) => `${ticks.length === 1 ? "tick" : "ticks"} ${listed(ticks.map(tick => tiles(tick)))}`;
    const same = line.starts.every(it => it.ticks.join() === line.starts[0].ticks.join());
    if (same) return `${capital(inserterWords(line.starts.map(it => it.inserter_id)))} start at ${ticksText(line.starts[0].ticks)}.`;
    const pieces = line.starts.map((it, index) => `inserter ${it.inserter_id}${index === 0 ? " starts" : ""} at ${ticksText(it.ticks)}`);
    return `${capital(listed(pieces))}.`;
}

const handsWord = (count: number) => `${count} ${count === 1 ? "hand" : "hands"}`;

/** "Inserters 1 and 2 of the 7 copies" or, for one copy, "Inserters 1 and 2" */
const whoOf = (line: DropSpacingLine, copies: number) =>
    `${inserterWords(line.inserter_ids)}${copies > 1 ? ` of the ${copies} copies` : ""}`;

/** A list of at most MAX_LISTED numbers, "12, 16 or 24", with "and others" where there are more */
const listedSpacings = (values: readonly number[], word = "or"): string =>
    values.length > MAX_LISTED ? `${values.slice(0, MAX_LISTED).join(", ")} and others` : listed(values, word);

/** Why no spacing fits: "The belt moves 4.5 tiles a period, but the 9 copies drop 9 hands on it, so no spacing of the copies fits: some hands always wait for room." */
export function crowdedText(crowded: { hands: number; belt_tiles: number; hand_tiles: number }, copies: number): string {
    const hands = crowded.hand_tiles === 1 ? `${crowded.hands} hands` : `${crowded.hands} hands of ${tiles(crowded.hand_tiles)} of a tile`;
    return `The belt moves ${tiles(crowded.belt_tiles)} tiles a period, but the ${copies} copies drop ${hands} on it, so no spacing of the copies fits: some hands always wait for room.`;
}

/**
 * What the scan of the spacings says, as a paragraph: "The belt moves 14 tiles a period, so each hand lands on one of 14 tiles. With
 * inserters 1 and 2 as they stand (3 tiles apart), the copies fit 12, 16 or 24 tiles apart; 13 or 15 apart only with a copy's
 * inserters 7 tiles apart; 14 or 21 apart never. The same holds at any of these spacings plus 14. Starting inserter 2 16, 32 or 48 ticks
 * after inserter 1 also fits (a tile every 8 ticks)."
 */
export function describeDropRoom(room: DropRoom): string {
    if (room.crowded !== null) return crowdedText(room.crowded, room.copies);
    const lead = Number.isInteger(room.belt_tiles) && room.hand_tiles === 1
        ? `The belt moves ${tiles(room.belt_tiles)} tiles a period, so each hand lands on one of ${tiles(room.belt_tiles)} tiles.`
        : `The belt moves ${tiles(room.belt_tiles)} tiles a period, and a hand takes ${tiles(room.hand_tiles)} of a tile.`;
    const stand = room.pair !== null ? `With inserters ${room.pair.first} and ${room.pair.second} as they stand (${tiles(room.pair.apart)} tiles apart)` : "With the inserters as they stand";
    const clauses: string[] = [room.fits.length > 0 ? `the copies fit ${listedSpacings(room.fits)} tiles apart`
        : `the copies fit at no spacing from ${room.low} to ${room.high} tiles`];
    for (const group of room.only_with) clauses.push(`${listedSpacings(group.spacings)} apart only with a copy's inserters ${listedSpacings(group.apart)} tiles apart`);
    if (room.never.length > 0) clauses.push(`${listedSpacings(room.never)} apart never`);
    const later = room.pair !== null && room.starts_after.length > 0
        ? ` Starting inserter ${room.pair.second} ${listed(room.starts_after.map(tick => String(tick)), "or")} ticks after inserter ${room.pair.first} also fits (a tile every ${tiles(room.ticks_per_tile)} ticks).`
        : "";
    const plus = room.loop !== null ? ` The same holds at any of these spacings plus ${room.loop}.` : "";
    return `${lead} ${stand}, ${clauses.join("; ")}.${plus}${later}`;
}

/** The text a result gives of the drops onto the shared belt, as an insight's pieces */
export function describeDropSpacing(spacing: DropSpacing): { fits: boolean; title: string; what: string; why: string; explanation: string } {
    const fits = spacing.lines.every(line => line.fits);
    const belts = [...new Set(spacing.lines.map(line => line.belt_id))];
    const belt = belts.length === 1 ? `belt ${belts[0]}` : `belts ${listed(belts)}`;
    const period = `In every period of ${tiles(spacing.period)} ticks`;
    const sentences: string[] = [];
    spacing.lines.forEach((line, index) => {
        const first = spacing.lines[0];
        if (line.fits) {
            if (index === 0) {
                sentences.push(`${period}, ${whoOf(line, spacing.copies)} drop ${handsWord(line.hands)} onto ${belt}, and each hand lands on a stretch of belt of its own, so none waits.`);
            } else if (first.fits && line.hands === first.hands) {
                sentences.push(`${capital(inserterWords(line.inserter_ids))} do the same${line.facing === (first.facing + 8) % 16 ? " on the other side of the belt" : ""}.`);
            } else {
                sentences.push(`${capital(whoOf(line, spacing.copies))} drop ${handsWord(line.hands)} onto ${belt}, and each hand lands on a stretch of belt of its own.`);
            }
        } else {
            const lead = index === 0 || spacing.lines[index - 1].fits ? `${period}, ` : "";
            const who = lead === "" ? capital(whoOf(line, spacing.copies)) : whoOf(line, spacing.copies);
            sentences.push(`${lead}${who} drop ${handsWord(line.hands)} onto ${belt}. ${line.pairs} ${line.pairs === 1 ? "pair" : "pairs"} of them land on each other, `
                + `and the later hand of each pair waits, the longest ${tiles(line.longest_wait)} ticks. ${startsSentence(line)}`);
        }
    });
    const closing = spacing.gap !== null
        ? `The copies stand ${tiles(spacing.gap)} tiles apart and the belt moves ${tiles(spacing.belt_tiles)} tiles in a period.`
        : `The belt moves ${tiles(spacing.belt_tiles)} tiles in a period.`;
    const hand_tiles = spacing.hand / (4 * spacing.lane_stack);
    const tile = hand_tiles === 1 ? `A tile of a belt lane holds one hand of ${spacing.hand} at stack size ${spacing.lane_stack}.`
        : `A tile of a belt lane holds ${4 * spacing.lane_stack} items at stack size ${spacing.lane_stack}, and a hand of ${spacing.hand} takes ${tiles(hand_tiles)} of a tile.`;
    const why = `${tile} A hand dropped where items already lie waits until they have moved on, so the hands of all the copies have to land in the gaps the others leave.`;
    const uncheckedText = `${spacing.gap !== null ? ` ${DROP_SPACING_COPIES_ALIKE}` : ""}${spacing.unchecked.length > 0 ? ` ${DROP_SPACING_UNCHECKED}` : ""}`;
    const roomText = spacing.room === undefined ? "" : ` ${describeDropRoom(spacing.room)}`;
    if (fits) {
        return {
            fits, title: `Drops onto ${belt} fit between each other`, what: `${sentences.join(" ")} ${closing}`, why,
            explanation: "This holds for this spacing and these start ticks. Moving one inserter by a tile, or starting one group of inserters at another tick, "
                + `puts hands on top of each other.${roomText} ${DROP_SPACING_STRAIGHT_BELT}${uncheckedText}`,
        };
    }
    const parts: string[] = [];
    if (spacing.fitting_start !== undefined) {
        const start = spacing.fitting_start;
        const moves = start.ticks.length > 0 ? `inserter ${start.inserter_id} starting at tick ${listed(start.ticks, "or")}` : "";
        const together = start.same_as !== undefined ? `at the same tick as inserter ${start.same_as}` : "";
        parts.push([moves, together].filter(it => it !== "").join(", or "));
    }
    const fit = parts.length > 0 ? ` The hands would fit with ${parts.join(", or with ")}.` : "";
    return {
        fits, title: `Drops onto ${belt} land on each other`, what: `${sentences.join(" ")} ${closing}`, why,
        explanation: "The simulator does not count this wait: it drops each inserter's hand on a belt of its own, so the rate and stability shown for this clock "
            + `were worked out without it.${fit}${roomText} ${DROP_SPACING_STRAIGHT_BELT}${uncheckedText}`,
    };
}

/** The numbers behind the text, a row for each line */
export function dropSpacingTable(spacing: DropSpacing): { columns: string[]; rows: string[][] } {
    return {
        columns: ["Inserters", "Hands a period", "Tiles between copies", "Belt tiles in a period", "Pairs landing on each other", "Longest wait (ticks)"],
        rows: spacing.lines.map(line => [listed(line.inserter_ids), String(line.hands), spacing.gap === null ? "-" : tiles(spacing.gap),
            tiles(spacing.belt_tiles), String(line.pairs), tiles(line.longest_wait)]),
    };
}

/**
 * The note that asks for the gap between copies: copies drop onto a belt from inserters whose places are known, and the
 * config does not say where the next copy stands. None otherwise.
 */
export function copyGapNeededNote(config: Config): string | null {
    if (!(config.target_output.copies > 1) || config.target_output.copy_offset !== undefined) return null;
    let lines: DropLine[];
    try {
        lines = dropLines(config);
    } catch {
        return null;
    }
    if (lines.length === 0) return null;
    const belts = [...new Set(lines.map(line => line.belt_id))].sort(pair);
    return `The ${config.target_output.copies} copies may drop onto the same ${belts.length === 1 ? `belt ${belts[0]}` : `belts ${listed(belts)}`}. `
        + "Say how far apart they stand to check whether their drops fit between each other.";
}
