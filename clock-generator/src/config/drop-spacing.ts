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
// (Sidecar 0.13.1) and `target_output.copy_offset`. Taken from the clock: the ticks at which each inserter starts a hand.
// Nothing here changes a clock or its ranking.

/** The text added to the insight: the check follows no bend of the belt */
export const DROP_SPACING_STRAIGHT_BELT = "The belt is taken to run straight past these inserters.";

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
    /** Spacings (tiles) that nearest to the gap below and above make every line fit; empty when none or when the gap is not given */
    fitting_gaps: number[];
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
        fitting_gaps: [],
    };
    if (!results.every(it => it.result.fits)) {
        if (shared) spacing.fitting_gaps = fittingGaps(config, results.map(it => it.line), starts, period, spacing.gap!);
        const failing = results.find(it => !it.result.fits)!;
        spacing.fitting_start = fittingStart(config, failing.line, failing.step, failing.sense, starts, period);
    }
    return spacing;
}

/** The spacings, a whole number of tiles, nearest to `gap` below and above at which the hands of every line fit */
function fittingGaps(config: Config, lines: DropLine[], starts: ReadonlyMap<number, readonly number[]>, period: number, gap: number): number[] {
    const offset = config.target_output.copy_offset!;
    const fits = (spacing: number): boolean => lines.every(line => {
        const axis_sign = (line.axis === "x" ? offset.x : offset.y) < 0 ? -1 : 1;
        const step: CopyStep = { along: axis_sign * spacing, shared: true };
        const senses: (1 | -1)[] = line.flow === null ? [1, -1] : [line.flow];
        return senses.every(sense => checkLine(config, line, starts, period, step, sense).pairs.length === 0);
    });
    const found: number[] = [];
    const below = Math.ceil(gap) - 1;
    for (let spacing = Math.max(1, below); spacing >= 1; spacing--) if (spacing !== gap && fits(spacing)) { found.push(spacing); break; }
    const reach = Math.ceil(2 * gap + 2 * lines[0].tiles_per_tick * period + 2);
    for (let spacing = Math.floor(gap) + 1; spacing <= reach; spacing++) if (fits(spacing)) { found.push(spacing); break; }
    return found.sort(pair);
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
    if (fits) {
        return {
            fits, title: `Drops onto ${belt} fit between each other`, what: `${sentences.join(" ")} ${closing}`, why,
            explanation: "This holds for this spacing and these start ticks. Moving one inserter by a tile, or starting one group of inserters at another tick, "
                + `puts hands on top of each other. ${DROP_SPACING_STRAIGHT_BELT}`,
        };
    }
    const parts: string[] = [];
    if (spacing.fitting_gaps.length > 0) parts.push(`the copies ${listed(spacing.fitting_gaps, "or")} tiles apart`);
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
            + `were worked out without it.${fit} ${DROP_SPACING_STRAIGHT_BELT}`,
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
