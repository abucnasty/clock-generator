import { Belt, BeltSpeed } from "../entities/belt";
import { Entity, EntityId, handSizeFor } from "../entities";
import { createEntityRegistryFromConfig } from "../crafting/sequence/simulation-context";
import { sharedLaneRunsOf } from "../crafting/shared-lane-verdict";
import { LaneTraffic } from "../state/lane-traffic";
import { copySpacingOf, outputBeltGeometry, STRAIGHT_TILE } from "./output-belt";
import type { Config } from "./schema";
import { buildToNameOf } from "../crafting/build-names";
import { beltNameInText, inserterNameInText, insertersInSentence, NO_BUILD, theName, type BuildToName } from "../crafting/entity-name";

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
// lies at (p - v t) mod L, with v the tiles the belt moves in a tick and L = v P the tiles it moves in a window cycle. Two
// hands collide when their stretches overlap there. This test is exact against the lane model (drop-spacing.test.ts
// replays it); the replay is used for the ticks a colliding hand waits.
//
// Taken from the config: the places and facings of the inserters (Sidecar 0.12.0), the way the belt runs at the drop
// (Sidecar 0.14.0) and `setpoint.copy_offset`. Taken from the clock: the ticks at which each inserter starts a hand.
// Nothing here changes a clock or its ranking.
//
// Where the config states its output belt (`output_belt`), the drops of its output inserters are those the section states:
// a copy whose output inserter side-loads is left to the merge (the run of the copies moves it on the output belt), and each
// stated drop is a hand of its copy on the line of its stretch and lane, at its tile, once: those lines are not repeated
// by `copy_offset`. A part copy (copies with a fraction) holds the inserters the shared-lane model gives it
// (`sharedLaneRunsOf`); where that model gives several part copies, a line fits only when it fits with each.

/** The text added to the insight: the check follows no bend of the belt */
export const DROP_SPACING_STRAIGHT_BELT = "The belt is taken to run straight past these inserters.";

/** The text said where drops are left out of the check: the ones marked as side-loaded (Sidecar 0.13.0) */
export const DROP_SPACING_UNCHECKED = "Drops that are side-loaded or go through a splitter are not checked here.";

/**
 * The text added to the insight for lines of the drops `output_belt` states, in place of the one about a straight belt: what was judged,
 * which is the hands of each stretch and lane on their own
 */
export const DROP_SPACING_STATED_LANES = "Each stretch and lane of the output belt is judged on its own, with the place of each hand measured along its lane from the output belt: "
    + "items that come from stretches upstream are not counted.";

/** The text said wherever copies share a belt: the config describes one copy and the check repeats it */
export const DROP_SPACING_COPIES_ALIKE = "This assumes every copy drops onto the belt the way this one does.";

const EPSILON = 1e-9;
const QUARTER_TILE = 0.25;
/** The most window cycles a replay runs, and the window cycles it runs after the lane is full of the line's hands */
const MAX_REPLAY_WINDOW_CYCLES = 60;
const SETTLE_WINDOW_CYCLES = 4;

/** A cardinal direction of the game: 0 north, 4 east, 8 south, 12 west */
type Cardinal = 0 | 4 | 8 | 12;
const cardinal = (direction: number | undefined): Cardinal | null =>
    direction === 0 || direction === 4 || direction === 8 || direction === 12 ? direction : null;

/** One output inserter of a line, before any clock */
interface LineInserter {
    id: number;
    /** Where it stands along the line, in tiles of the exported coordinates; on a line of stated drops, tiles downstream along the stretch */
    along: number;
    /** Items a hand of it holds, and the stacks of the lane they make */
    stacks: number;
    /** On a line of stated drops: the copy whose drop this is, from 0 (the config's own) */
    copy?: number;
    /** Whether its drop is at a spot of the config (`sink.drop`): the run puts the hands of one copy's such inserters on one lane */
    at_spot: boolean;
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
    /**
     * Whether the line is of the drops `output_belt` states: each copy's drop once, at the tile the section gives it, with
     * the belt's flow (`flow` 1, `along` downstream). Otherwise the line is the config's own copy, repeated by `copy_offset`.
     */
    stated: boolean;
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
/**
 * How the drop texts name the inserters and the belts: by their items (entity-name.ts), with their numbers always where
 * `numbered` (a note of the form); by their numbers with `NO_NAMES`
 */
export interface DropNames {
    build: BuildToName;
    numbered: boolean;
}

/** No names: the inserters and belts by their numbers */
const NO_NAMES: DropNames = { build: NO_BUILD, numbered: false };

/** "the inserters (1 and 2) that drop grenade", "inserters 1 and 2" without names */
const inserterWords = (ids: readonly number[], names: DropNames = NO_NAMES) =>
    insertersInSentence(ids, names.build, { numbered: names.numbered }).text;
/** "the inserter that drops grenade", "inserter 2" without names */
const inserterWord = (id: number, names: DropNames = NO_NAMES) => theName(inserterNameInText(id, names.build, { numbered: names.numbered }));
/** "the grenade belt", "belts 1 and 2" */
const beltWords = (ids: readonly number[], names: DropNames = NO_NAMES) => names.build === NO_BUILD
    ? (ids.length === 1 ? `belt ${ids[0]}` : `belts ${listed(ids)}`)
    : listed(ids.map(id => theName(beltNameInText(id, names.build, { numbered: names.numbered }))));

/**
 * The step from one copy to the next along a line. The copies do not share it where the next copy stands across it, or where
 * every lane of its belt states that each copy has a lane of its own (`sharing` "per_copy").
 */
function copyStepOf(config: Config, line: Pick<DropLine, "axis" | "belt_id" | "stated">): CopyStep | null {
    const offset = config.setpoint.copy_offset;
    if (line.stated || config.setpoint.copies <= 1 || offset === undefined) return null;
    const across = line.axis === "x" ? offset.y : offset.x;
    const along = line.axis === "x" ? offset.x : offset.y;
    const per_copy = config.belts.find(belt => belt.id === line.belt_id)?.lanes.every(lane => lane.sharing === "per_copy") === true;
    return { along, shared: Math.abs(across) < EPSILON && !per_copy };
}

/** What `output_belt` states of one output inserter's drops: its copy-1 drop side-loads, and the drops of its copies onto stretches */
interface StatedDrops {
    side_loaded: boolean;
    /** Each stated drop: its copy (from 0), the key of its stretch and lane, and its place in tiles downstream along the stretch */
    drops: { copy: number; key: string; along: number }[];
}

/**
 * The drops `output_belt` states, by output inserter (by its number in the config); null where the config states no output
 * belt. A number of the section names a copy's output inserter: with k output inserters a copy (those that drop the target
 * item onto a belt that carries it, in the config's order), number n is the ((n - 1) mod k + 1)-th of copy
 * floor((n - 1) / k) + 1 (output-belt.ts). An output inserter none of whose numbers the section states has no drops.
 */
function statedDropsOf(config: Config): Map<number, StatedDrops> | null {
    if (config.output_belt === undefined) return null;
    const outputs = config.inserters.flatMap((inserter, index) => inserter.sink.type === "belt" && config.belts.some(belt =>
        belt.id === inserter.sink.id && belt.lanes.some(lane => lane.ingredient === config.setpoint.item)) ? [inserter.id ?? index + 1] : []);
    const stated = new Map<number, StatedDrops>(outputs.map(id => [id, { side_loaded: false, drops: [] }]));
    if (outputs.length === 0) return stated;
    const geometry = outputBeltGeometry(config.output_belt, copySpacingOf(config.setpoint.copy_offset) ?? 0);
    const named = (number: number) => ({ copy: Math.floor((number - 1) / outputs.length), of: stated.get(outputs[(number - 1) % outputs.length])! });
    for (const load of geometry.side_loads) {
        if (!("side_belt_of_copy" in load.sender)) continue;
        const { copy, of } = named(load.sender.side_belt_of_copy);
        if (copy === 0) of.side_loaded = true;
    }
    for (const drop of geometry.drops) {
        const { copy, of } = named(drop.copy);
        // the tile of the drop, along its lane: the lane's length from the stretch's start to the drop tile's start
        of.drops.push({ copy, key: `stretch ${drop.stretch} ${drop.lane}`, along: drop.end_at[drop.lane] / STRAIGHT_TILE - 1 });
    }
    return stated;
}

/**
 * The lines of a config: output inserters that drop straight onto a belt, with a position and a cardinal facing, grouped by
 * belt, side and row. An inserter whose drop is marked as side-loading onto another belt is left to the merge, and a
 * line with an inserter that has no position is not a line. Where the config states its output belt, an output inserter's
 * drops are those the section states: each stated drop is on the line of its stretch and lane, and a side-loaded one on none.
 */
export function dropLines(config: Config): DropLine[] {
    const registry = createEntityRegistryFromConfig(config);
    const groups = new Map<string, { line: Omit<DropLine, "inserters">; inserters: LineInserter[]; complete: boolean; flows: Set<1 | -1 | null> }>();
    // a belt with a straight drop whose place, facing or hand is not known is not checked at all: the drops of its other
    // inserters are not all there
    const unknown = new Set<number>();
    const stated = statedDropsOf(config);
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
        const at_spot = sink.drop !== undefined;
        const tiles_per_tick = 1 / Belt.ticksPerTile(Belt.fromConfig(belt).belt_speed).toDecimal();
        const axis = facing === 0 || facing === 8 ? "x" : "y";
        const of_section = stated?.get(id);
        if (of_section !== undefined) {
            const item = belt.lanes.map(lane => lane.ingredient).find(name => entity.hand_sizes?.has(name));
            const hand = item !== undefined ? handSizeFor(entity, item) : entity.metadata.stack_size;
            const stacks = Math.max(1, Math.ceil(hand / lane_stacks[0]));
            for (const drop of of_section.drops) {
                const key = `${sink.id}|${drop.key}`;
                const group = groups.get(key) ?? {
                    line: { belt_id: sink.id, facing, axis, flow: 1, tiles_per_tick, hand, lane_stack: lane_stacks[0], stated: true },
                    inserters: [], complete: true, flows: new Set<1 | -1 | null>([1]),
                };
                group.inserters.push({ id, along: drop.along, stacks, copy: drop.copy, at_spot });
                groups.set(key, group);
            }
            return;
        }
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
            line: { belt_id: sink.id, facing, axis, flow: null, tiles_per_tick, hand, lane_stack: lane_stacks[0], stated: false },
            inserters: [], complete: true, flows: new Set<1 | -1 | null>(),
        };
        if (!along_axis) group.complete = false;
        group.flows.add(flow);
        group.inserters.push({ id, along: axis === "x" ? inserter.position.x : inserter.position.y, stacks: Math.max(1, Math.ceil(hand / lane_stacks[0])), at_spot });
        groups.set(key, group);
    });
    const lines: DropLine[] = [];
    for (const group of groups.values()) {
        if (!group.complete || unknown.has(group.line.belt_id) || group.flows.size !== 1) continue;
        lines.push({ ...group.line, flow: [...group.flows][0], inserters: group.inserters.sort((a, b) => a.id - b.id || (a.copy ?? 0) - (b.copy ?? 0)) });
    }
    return lines.sort((a, b) => a.inserters[0].id - b.inserters[0].id);
}

/**
 * The output inserters whose drop onto a belt is marked as side-loaded, or whose copy-1 drop `output_belt` states as a side
 * load: the merge decides where those land, and the check does not cover them
 */
export function uncheckedDrops(config: Config): number[] {
    const stated = statedDropsOf(config);
    return config.inserters.flatMap((inserter, index) => {
        const id = inserter.id ?? index + 1;
        return inserter.sink.type === "belt" && (inserter.sink.drop_capture !== undefined || stated?.get(id)?.side_loaded === true) ? [id] : [];
    });
}

/**
 * The output inserters of lines the check cannot judge because the copies have a fraction and the shared-lane model gives no part
 * copy: it cannot tell which inserters the part copy holds. Rounding the copies up is barred, so these lines are not checked.
 */
function partUncheckedOf(config: Config, lines: readonly DropLine[]): number[] {
    const copies = config.setpoint.copies;
    if (Number.isInteger(copies)) return [];
    const ids = lines.flatMap(line => {
        const step = copyStepOf(config, line);
        if (copies > 1 && step === null && !line.stated) return [];
        return partsFor(config, line, step).length === 0 ? line.inserters.map(inserter => inserter.id) : [];
    });
    return [...new Set(ids)].sort(pair);
}

/** The text said of those lines: "The drops of inserters 1 and 3 are not checked here: ..." */
export function partUncheckedText(ids: readonly number[], names: DropNames = NO_NAMES): string {
    return `The drops of ${inserterWords(ids, names)} are not checked here: the copies have a fraction, and the model of the lanes they share gives no partial copy for this build, `
        + "so the check cannot tell which inserters the partial copy holds.";
}

/** The same, for a config: the numbers of the output inserters of those lines */
export function uncheckedPartDrops(config: Config): number[] {
    if (Number.isInteger(config.setpoint.copies)) return [];
    try {
        return partUncheckedOf(config, dropLines(config));
    } catch {
        return [];
    }
}

/**
 * The part copies of a config: for each, the output inserters it holds, by their numbers in the config. A part copy holds
 * the entities the shared-lane model gives it (`sharedLaneRunsOf`, each later copy that is not whole), one for each
 * different part; null where the copies have no fraction. An empty list where the model gives no part copy: then the
 * check cannot tell which inserters the part copy holds.
 */
const part_copies = new WeakMap<Config, readonly ReadonlySet<number>[]>();
function partCopiesOfConfig(config: Config): readonly ReadonlySet<number>[] | null {
    const copies = config.setpoint.copies;
    if (Number.isInteger(copies)) return null;
    const known = part_copies.get(config);
    if (known !== undefined) return known;
    const parts = new Map<string, ReadonlySet<number>>();
    try {
        for (const reading of sharedLaneRunsOf(config).readings) {
            for (const layout of reading.layouts) {
                const part = layout.copies.later.find((later): later is ReadonlySet<string> => later !== "whole");
                if (part === undefined) continue;
                const ids = config.inserters.flatMap((inserter, index) => part.has(EntityId.forInserter(inserter.id ?? index + 1).id) ? [inserter.id ?? index + 1] : []);
                parts.set(ids.join(), new Set(ids));
            }
        }
    } catch {
        parts.clear();
    }
    const found = [...parts.values()];
    part_copies.set(config, found);
    return found;
}

/**
 * Whether copy `copy` (from 0) holds the inserter: every copy below the whole ones does, the part copy (with `part`, the
 * inserters it holds) only those of it, and no copy beyond
 */
function holds(copies: number, copy: number, inserter_id: number, part: ReadonlySet<number> | null): boolean {
    const whole = Math.floor(copies);
    if (copy < whole) return true;
    return copy === whole && copies > whole && part !== null && part.has(inserter_id);
}

/** Whether the hands of a line are of the part copy: then it is judged with each part copy the model gives */
function reachesPart(config: Config, line: DropLine, step: CopyStep | null): boolean {
    const copies = config.setpoint.copies;
    if (Number.isInteger(copies)) return false;
    if (line.stated) return line.inserters.some(inserter => inserter.copy === Math.floor(copies));
    return copies > 1 && step !== null && step.shared;
}

/** The part copies a line is judged with: [null] where it has no hand of a part copy, none where the model gives no part copy */
function partsFor(config: Config, line: DropLine, step: CopyStep | null): readonly (ReadonlySet<number> | null)[] {
    return reachesPart(config, line, step) ? partCopiesOfConfig(config) ?? [] : [null];
}

/** A hand of a line: where it starts, when, and how much of the lane it takes */
interface Hand {
    inserter_id: number;
    copy: number;
    place: number;
    tick: number;
    stacks: number;
}

/**
 * The hands of a line, for the ticks at which each inserter starts one: on a line of stated drops each drop once, of the
 * copies there are; else the config's own copy, repeated `copy_offset` apart for each copy where they share the line.
 * `part` is the part copy's inserters, where the copies have a fraction.
 */
function handsOf(line: DropLine, starts: ReadonlyMap<number, readonly number[]>, copies: number, step: CopyStep | null, sense: 1 | -1, part: ReadonlySet<number> | null = null): Hand[] {
    const hands: Hand[] = [];
    if (line.stated) {
        for (const inserter of line.inserters) {
            if (!holds(copies, inserter.copy ?? 0, inserter.id, part)) continue;
            for (const tick of starts.get(inserter.id) ?? []) {
                hands.push({ inserter_id: inserter.id, copy: inserter.copy ?? 0, place: sense * inserter.along, tick, stacks: inserter.stacks });
            }
        }
        return hands;
    }
    const shared = copies > 1 && step !== null && step.shared;
    const count = shared ? Math.ceil(copies) : 1;
    for (let copy = 0; copy < count; copy++) {
        for (const inserter of line.inserters) {
            if (shared && !holds(copies, copy, inserter.id, part)) continue;
            for (const tick of starts.get(inserter.id) ?? []) {
                const along = inserter.along + (shared ? copy * step.along : 0);
                hands.push({ inserter_id: inserter.id, copy, place: sense * along, tick, stacks: inserter.stacks });
            }
        }
    }
    return hands;
}

/** Pairs of hands whose stretches of the lane overlap, seen from the moving belt */
function collidingPairs(hands: readonly Hand[], tiles_per_tick: number, window_cycle_ticks: number): [number, number][] {
    const cycle = tiles_per_tick * window_cycle_ticks;
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
 * The ticks each hand waits for room, by the lane model of the simulator replayed on the line for enough window cycles that
 * the lane is full of its hands. A hand that is not down by the end of its window cycle counts as waiting for the rest of it.
 */
function waitsOf(hands: readonly Hand[], speed: BeltSpeed, tiles_per_tick: number, window_cycle_ticks: number): number[] {
    const lane = new LaneTraffic(speed);
    const lowest = Math.min(...hands.map(hand => hand.place));
    const spots = hands.map(hand => (hand.place - lowest) / tiles_per_tick);
    spots.forEach(spot => lane.registerSpot(spot));
    const span = Math.max(...hands.map(hand => hand.place)) - lowest;
    const window_cycles = Math.min(MAX_REPLAY_WINDOW_CYCLES, Math.ceil(span / (tiles_per_tick * window_cycle_ticks)) + SETTLE_WINDOW_CYCLES);
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
    const last = (window_cycles - 1) * window_cycle_ticks;
    for (let tick = 0; tick < window_cycles * window_cycle_ticks + window_cycle_ticks; tick++) {
        const n = Math.floor(tick / window_cycle_ticks);
        if (n < window_cycles) hands.forEach((hand, index) => { if (tick === Math.round(n * window_cycle_ticks + hand.tick)) active.push({ hand: index, start: tick, placed: 0 }); });
        for (const entry of [...active]) {
            if (lane.tryPlace(tick, spots[entry.hand]) && ++entry.placed === hands[entry.hand].stacks) {
                active.splice(active.indexOf(entry), 1);
                if (entry.start >= last - window_cycle_ticks && entry.start < last) waits[entry.hand] = Math.max(0, tick - entry.start - free(hands[entry.hand].stacks));
            }
        }
    }
    for (const entry of active) if (entry.start >= last - window_cycle_ticks && entry.start < last) waits[entry.hand] = window_cycle_ticks;
    return waits;
}

/** What the check says of one line */
export interface DropSpacingLine {
    belt_id: number;
    inserter_ids: number[];
    facing: Cardinal;
    /** Hands the line takes in a window cycle, all the copies together */
    hands: number;
    /** Ticks at which each inserter of the line starts a hand */
    starts: { inserter_id: number; ticks: number[] }[];
    fits: boolean;
    /**
     * For a line that fits and is repeated by the config's own copy: whether moving any one of its inserters a tile along the belt,
     * either way, puts hands on top of each other (with every way the belt may run and every part copy the line is judged with).
     * False for a line of stated drops and for a line that does not fit: nothing was tried.
     */
    tile_move_collides: boolean;
    /** Pairs of hands that land on each other */
    pairs: number;
    /** The most ticks a hand waits for room (0 when they fit) */
    longest_wait: number;
    /** On a line of the drops `output_belt` states: the copies (from 1) whose drops it holds. None on a line repeated by `copy_offset` */
    copies?: number[];
    /** Where the line holds hands of a part copy: the line's inserters that the part copy judged holds (the one with the most pairs) */
    part?: number[];
    /**
     * Whether the run that gives the rate and stability counts the waits of these hands: "counted" where it puts them on one lane
     * (one copy's drops at spots of the config), "counted_with_copies" where it does so in the run of the copies (the drops `output_belt`
     * states: that run is made only for some clocks), "between_copies" where it puts each copy's hands on a belt of its
     * own (drops at spots of the config), "none" where it puts each inserter's hand on a belt of its own
     */
    run_counts: "counted" | "counted_with_copies" | "between_copies" | "none";
}

export interface DropSpacing {
    window_cycle_ticks: number;
    copies: number;
    /** Tiles from one copy to the next along the lines, null for one copy or a gap not given */
    gap: number | null;
    /** Tiles the belt moves in a window cycle */
    belt_tiles: number;
    /** Items in a hand, and in a stack of the lane, of the first line */
    hand: number;
    lane_stack: number;
    lines: DropSpacingLine[];
    /** Output inserters whose drops are marked as side-loaded and so left out of the lines */
    unchecked: number[];
    /** Output inserters of lines that are not judged because the copies have a fraction and the shared-lane model gives no part copy */
    unchecked_part: number[];
    /** The spacings of the copies, and the offsets between a copy's inserters, at which the lines fit; none when the gap is not given or the lines are not all shared */
    room?: DropRoom;
    /** For the first line that does not fit: the inserter to start at another tick, the ticks that fit nearest to its own, and the inserter whose tick it could share */
    fitting_start?: { inserter_id: number; ticks: number[]; same_as?: number };
}

const speedOf = (config: Config, belt_id: number): BeltSpeed =>
    Belt.fromConfig(config.belts.find(it => it.id === belt_id)!).belt_speed;

/** Whether every line fits with the hands of all copies, for a verdict of one sense of the belt and one part copy */
function checkLine(config: Config, line: DropLine, starts: ReadonlyMap<number, readonly number[]>, window_cycle_ticks: number, step: CopyStep | null, sense: 1 | -1,
    part: ReadonlySet<number> | null = null) {
    const hands = handsOf(line, starts, config.setpoint.copies, step, sense, part);
    return { hands, pairs: hands.length > 0 ? collidingPairs(hands, line.tiles_per_tick, window_cycle_ticks) : [] };
}

/** Whether every move of one inserter of a line by a tile, either way, puts hands on top of each other */
function tileMoveCollides(config: Config, line: DropLine, starts: ReadonlyMap<number, readonly number[]>, window_cycle_ticks: number, step: CopyStep | null,
    senses: readonly (1 | -1)[], parts: readonly (ReadonlySet<number> | null)[]): boolean {
    const ids = [...new Set(line.inserters.filter(inserter => (starts.get(inserter.id) ?? []).length > 0).map(inserter => inserter.id))];
    return ids.every(id => ([1, -1] as const).every(shift => {
        const moved = { ...line, inserters: line.inserters.map(inserter => inserter.id === id ? { ...inserter, along: inserter.along + shift } : inserter) };
        return parts.every(part => senses.every(sense => checkLine(config, moved, starts, window_cycle_ticks, step, sense, part).pairs.length > 0));
    }));
}

/**
 * Whether the run counts the waits of a line's hands (as belt-hand-drop.ts, belt-lane.ts and output-belt-run.ts put them down): a
 * hand with a drop spot of the config shares its lane's traffic with the other such hands of its copy, and every copy has belts of
 * its own; a hand without one has a tile of its own; the run of the copies puts the drops `output_belt` states on the output belt,
 * in place of an own tile only (a hand with a drop spot keeps its copy's lane).
 */
function runCountsOf(line: DropLine, hands: readonly Hand[]): DropSpacingLine["run_counts"] {
    const ids = new Set(hands.map(hand => hand.inserter_id));
    const inserters = line.inserters.filter(inserter => ids.has(inserter.id));
    if (line.stated && inserters.every(inserter => !inserter.at_spot)) return "counted_with_copies";
    if (!inserters.every(inserter => inserter.at_spot)) return "none";
    return new Set(hands.map(hand => hand.copy)).size > 1 ? "between_copies" : "counted";
}

/**
 * Where the drops of the output inserters land on the shared belt, for a clock that starts the inserters' hands at
 * `starts` (ticks in a window cycle of `period`). None when no line can be checked: no positions, copies whose gap is not
 * given, hands of different ticks on a line whose belt direction is not known and whose answer depends on it.
 */
export function dropSpacing(config: Config, starts: ReadonlyMap<number, readonly number[]>, window_cycle_ticks: number): DropSpacing | null {
    if (!(window_cycle_ticks > 0)) return null;
    const copies = config.setpoint.copies;
    const results: { line: DropLine; step: CopyStep | null; sense: 1 | -1; result: DropSpacingLine }[] = [];
    const all_lines = dropLines(config);
    for (const line of all_lines) {
        const step = copyStepOf(config, line);
        if (copies > 1 && step === null && !line.stated) continue;
        const ticks = line.inserters.map(inserter => starts.get(inserter.id) ?? []).filter(it => it.length > 0);
        if (ticks.length === 0) continue;
        // a line with hands of a part copy is judged with each part copy the model gives, and not at all where it gives none (the result names it)
        const parts = partsFor(config, line, step);
        if (parts.length === 0) continue;
        const senses: (1 | -1)[] = line.flow === null ? [1, -1] : [line.flow];
        const judged = parts.map(part => {
            const checks = senses.map(sense => ({ sense, part, ...checkLine(config, line, starts, window_cycle_ticks, step, sense, part) }));
            return new Set(checks.map(check => check.pairs.length > 0)).size > 1 ? null : checks[0];
        });
        if (judged.some(check => check === null)) continue;
        // the part copy with the most pairs, the first of them on a tie
        const check = judged.reduce((worst, each) => each!.pairs.length > worst!.pairs.length ? each : worst)!;
        if (check.hands.length === 0) continue;
        const waits = check.pairs.length > 0 ? waitsOf(check.hands, speedOf(config, line.belt_id), line.tiles_per_tick, window_cycle_ticks) : [];
        const fits = judged.every(each => each!.pairs.length === 0);
        const started = [...new Set(line.inserters.filter(inserter => (starts.get(inserter.id) ?? []).length > 0).map(inserter => inserter.id))];
        results.push({
            line, step, sense: check.sense,
            result: {
                belt_id: line.belt_id,
                inserter_ids: started,
                facing: line.facing, hands: check.hands.length,
                starts: started.map(id => ({ inserter_id: id, ticks: [...starts.get(id)!].sort(pair) })),
                fits, tile_move_collides: fits && !line.stated && tileMoveCollides(config, line, starts, window_cycle_ticks, step, senses, parts),
                pairs: check.pairs.length, longest_wait: waits.length === 0 ? 0 : Math.max(...waits),
                ...(line.stated && { copies: [...new Set(check.hands.map(hand => hand.copy + 1))].sort(pair) }),
                ...(check.part !== null && { part: started.filter(id => check.part!.has(id)) }),
                run_counts: runCountsOf(line, check.hands),
            },
        });
    }
    if (results.length === 0) return null;
    const first = results[0];
    // the gap between copies is that of the first line the check repeats by copy_offset: a line of stated drops has none
    const repeated = results.find(it => !it.line.stated);
    const shared = repeated !== undefined && repeated.step !== null && repeated.step.shared && copies > 1;
    const spacing: DropSpacing = {
        window_cycle_ticks, copies,
        gap: shared ? Math.abs(repeated.step!.along) : null,
        belt_tiles: first.line.tiles_per_tick * window_cycle_ticks,
        hand: first.line.hand, lane_stack: first.line.lane_stack,
        lines: results.map(it => it.result),
        unchecked: uncheckedDrops(config),
        unchecked_part: partUncheckedOf(config, all_lines),
    };
    if (shared) spacing.room = dropRoom(config, results.map(it => it.line), window_cycle_ticks) ?? undefined;
    if (!results.every(it => it.result.fits)) {
        const failing = results.find(it => !it.result.fits)!;
        spacing.fitting_start = fittingStart(config, failing.line, failing.step, failing.sense, starts, window_cycle_ticks);
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

export function dropTieBreak(config: Config, window_cycle_ticks: number): DropTieBreak | null {
    if (!(window_cycle_ticks > 0)) return null;
    const lines = dropLines(config);
    if (lines.length === 0) return null;
    const places = new Map<number, { line: number; along: number }>();
    // the place of the config's own copy only: a line of stated drops holds the drops of later copies too
    lines.forEach((line, index) => line.inserters.forEach(inserter => {
        if ((inserter.copy ?? 0) === 0) places.set(inserter.id, { line: index, along: inserter.along });
    }));
    // a check that can be made for no clock (copies whose gap is not given) leaves nothing to choose by
    const probe = new Map(lines.flatMap(line => line.inserters.map(inserter => [inserter.id, [0]] as const)));
    if (dropSpacing(config, probe, window_cycle_ticks) === null) return null;
    return {
        places,
        collisions: starts => dropSpacing(config, starts, window_cycle_ticks)?.lines.reduce((sum, line) => sum + line.pairs, 0) ?? 0,
    };
}

/** The widest a pitch or an offset scan lists, and the longest start delay it tries */
const MAX_LISTED = 8;
const MAX_OFFSET_TILES = 64;
const MAX_DELAY_TICKS = 1000;
/** The narrowest machine or drill of the game is 3 tiles across: the span of the positions of a copy, plus one such entity */
const NARROWEST_ENTITY_TILES = 3;
/** How near a whole number the tiles the belt moves in a window cycle must be to count as one */
const LOOP_SLACK = 1e-9;

/** Whether no two hands overlap on the circle of the belt's tiles in a window cycle: the test of collidingPairs, sorted */
function handsFit(hands: readonly Hand[], tiles_per_tick: number, window_cycle_ticks: number): boolean {
    if (hands.length < 2) return true;
    const cycle = tiles_per_tick * window_cycle_ticks;
    const mod = (value: number) => ((value % cycle) + cycle) % cycle;
    const placed = hands.map(hand => ({ at: mod(hand.place - tiles_per_tick * hand.tick), width: QUARTER_TILE * hand.stacks })).sort((a, b) => a.at - b.at);
    for (let i = 1; i < placed.length; i++) if (placed[i].at - placed[i - 1].at < placed[i].width - EPSILON) return false;
    return placed[0].at + cycle - placed[placed.length - 1].at >= placed[0].width - EPSILON;
}

/** What the scan of the spacings of the copies finds, at the window cycle it was made for, for inserters that start in the same tick */
export interface DropRoom {
    /** The spacings tried, whole tiles from `low` to `high`: the width of a copy, and on to one full loop of the belt's tiles where that is a whole number */
    low: number;
    high: number;
    /**
     * The tiles the belt moves in a window cycle when that is a whole number the same on every shared line: whether the hands fit then depends on
     * the spacing less a whole number of loops only, so a spacing fits when the spacing plus this much does. Null otherwise.
     */
    loop: number | null;
    /** The copies, and the hands they drop on a lane in a window cycle when these take more of the lane than the belt moves in it: no spacing fits then. Null otherwise */
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
    /** Tiles the belt moves in a window cycle, ticks it takes for a tile, and tiles a hand takes */
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
 * The spacings of the copies, from the width of a copy for one full loop of the belt's tiles in a window cycle (the same list whatever
 * spacing the config has; where that is not a whole number, a fixed range), at which every shared line fits when its
 * inserters start in the same tick, or none when the hands of a lane take more of it than the belt moves in a window cycle; for a line of two inserters in a copy, the distances between them that fit at the spacings that
 * do not, and the start delays of the second one that fit. Arithmetic on the places alone: no run of the build. Null where
 * the copies' gap is not given or no line is shared.
 */
export function dropRoom(config: Config, lines: readonly DropLine[], window_cycle_ticks: number): DropRoom | null {
    const copies = config.setpoint.copies;
    const offset = config.setpoint.copy_offset;
    const shared = lines.filter(line => copyStepOf(config, line)?.shared === true);
    if (!(window_cycle_ticks > 0) || !(copies > 1) || offset === undefined || shared.length === 0) return null;
    const signs = shared.map(line => ((line.axis === "x" ? offset.x : offset.y) < 0 ? -1 : 1) as 1 | -1);
    const gap = Math.abs(shared[0].axis === "x" ? offset.x : offset.y);
    const first = shared[0];
    const tiles_per_tick = first.tiles_per_tick;
    const width = copyWidth(config, first.axis);
    const low = Math.max(1, width ?? 1);
    const together = new Map<number, readonly number[]>(shared.flatMap(line => line.inserters.map(inserter => [inserter.id, [0]] as const)));
    const loops = shared.map(line => line.tiles_per_tick * window_cycle_ticks);
    const whole = Math.round(loops[0]);
    const loop = whole >= 1 && loops.every(it => Math.abs(it - whole) < LOOP_SLACK) ? whole : null;
    // the part copies the lines are judged with (as dropSpacing): the lines fit only when they fit with each
    const parts = Number.isInteger(copies) ? [null] : partCopiesOfConfig(config) ?? [];
    if (parts.length === 0) return null;
    // the first line whose hands take more of the lane than the belt moves, with the part copy that takes the most
    const crowded = parts.map(part => shared.map((line, index) => {
        const hands = handsOf(line, together, copies, { along: gap, shared: true }, 1, part);
        return { hands: hands.length, belt_tiles: loops[index], hand_tiles: QUARTER_TILE * line.inserters[0].stacks, taken: hands.reduce((sum, hand) => sum + QUARTER_TILE * hand.stacks, 0) };
    }).find(it => it.taken > it.belt_tiles + EPSILON)).reduce((most, each) => each !== undefined && (most === undefined || each.taken > most.taken) ? each : most, undefined);
    const high = crowded !== undefined ? low - 1 : loop !== null ? low + loop - 1 : low + 2 * Math.ceil(loops[0]);
    const gap_in_scan = loop !== null ? low + (((Math.round(gap) - low) % loop) + loop) % loop : gap;
    const fitsWith = (candidates: readonly DropLine[], pitch: number, starts: ReadonlyMap<number, readonly number[]>): boolean =>
        parts.every(part => candidates.every((line, index) => (line.flow === null ? [1, -1] as const : [line.flow] as const)
            .every(sense => handsFit(handsOf(line, starts, copies, { along: signs[index] * pitch, shared: true }, sense, part), line.tiles_per_tick, window_cycle_ticks))));
    const pairable = shared.every(line => line.inserters.length === 2);
    // the line with the second inserter of each copy `apart` tiles from the first, in the direction it has
    const withApart = (apart: number): DropLine[] => shared.map(line => {
        const [one, two] = line.inserters;
        return { ...line, inserters: [one, { ...two, along: one.along + (two.along < one.along ? -apart : apart) }] };
    });
    const fits: number[] = [], never: number[] = [];
    const only = new Map<string, { spacings: number[]; apart: number[] }>();
    const reach = Math.min(MAX_OFFSET_TILES, Math.ceil(tiles_per_tick * window_cycle_ticks) - 1);
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
        for (let delay = 1; delay <= Math.min(window_cycle_ticks - 1, MAX_DELAY_TICKS) && starts_after.length < 3; delay++) {
            const later = new Map(together);
            shared.forEach(line => later.set(line.inserters[1].id, [delay]));
            if (fitsWith(shared, gap, later)) starts_after.push(delay);
        }
    }
    return {
        low, high, loop, copies, crowded: crowded === undefined ? null : { hands: crowded.hands, belt_tiles: crowded.belt_tiles, hand_tiles: crowded.hand_tiles },
        fits, only_with: [...only.values()], never,
        pair: pairable ? { first: first.inserters[0].id, second: first.inserters[1].id, apart: Math.abs(first.inserters[1].along - first.inserters[0].along) } : null,
        starts_after, belt_tiles: tiles_per_tick * window_cycle_ticks, ticks_per_tile: 1 / tiles_per_tick, hand_tiles: first.inserters[0].stacks * QUARTER_TILE, gap, gap_in_scan,
    };
}

/**
 * For a line that does not fit: the inserter that starts last, the ticks nearest to its own below and above at which
 * the line fits when it starts there, and the inserter that starts first if starting together fits.
 */
function fittingStart(config: Config, line: DropLine, step: CopyStep | null, sense: 1 | -1, starts: ReadonlyMap<number, readonly number[]>, window_cycle_ticks: number): DropSpacing["fitting_start"] {
    const started = line.inserters.filter((inserter, index) => (starts.get(inserter.id) ?? []).length > 0
        && line.inserters.findIndex(other => other.id === inserter.id) === index);
    const parts = partsFor(config, line, step);
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
        return parts.every(part => senses.every(each => checkLine(config, line, shifted, window_cycle_ticks, step, each, part).pairs.length === 0));
    };
    const own = first_tick(mover.id);
    const ticks: number[] = [];
    for (let tick = Math.ceil(own) - 1; tick >= 0; tick--) if (fitsAt(tick)) { ticks.push(tick); break; }
    for (let tick = Math.floor(own) + 1; tick < window_cycle_ticks; tick++) if (fitsAt(tick)) { ticks.push(tick); break; }
    const same = fitsAt(first_tick(reference.id));
    if (ticks.length === 0 && !same) return undefined;
    return { inserter_id: mover.id, ticks, ...(same && { same_as: reference.id }) };
}

// ----------------------------------------------------------------------------
// What the result says
// ----------------------------------------------------------------------------

/** The sentence about where the inserters of the clock start their hands: "Inserter 1 starts at tick 6 and inserter 2 at tick 62." */
function startsSentence(line: DropSpacingLine, names: DropNames): string {
    const ticksText = (ticks: number[]) => `${ticks.length === 1 ? "tick" : "ticks"} ${listed(ticks.map(tick => tiles(tick)))}`;
    const same = line.starts.every(it => it.ticks.join() === line.starts[0].ticks.join());
    if (same) return `${capital(inserterWords(line.starts.map(it => it.inserter_id), names))} start at ${ticksText(line.starts[0].ticks)}.`;
    const pieces = line.starts.map((it, index) => `${inserterWord(it.inserter_id, names)}${index === 0 ? " starts" : ""} at ${ticksText(it.ticks)}`);
    return `${capital(listed(pieces))}.`;
}

const handsWord = (count: number) => `${count} ${count === 1 ? "hand" : "hands"}`;

/** "Inserters 1 and 2 of the 7 copies" or, for one copy, "Inserters 1 and 2"; on a line of stated drops "inserter 2 of copies 1, 2 and 3" */
const whoOf = (line: DropSpacingLine, copies: number, names: DropNames) =>
    `${inserterWords(line.inserter_ids, names)}${line.copies !== undefined ? ` of ${line.copies.length === 1 ? "copy" : "copies"} ${listed(line.copies)}`
        : copies > 1 ? ` of the ${copies} copies` : ""}`;

/**
 * What the explanation says of the wait, by what the run counts of the lines that do not fit (`run_counts`): it does not count
 * it only for a line whose hands the run does not put on one lane. The drops `output_belt` states are on one lane in the run of the copies
 * (`run_with_copies`: it was made for this clock, and it ran the output belt); the sentence says no more of a clock without it than that
 * the copies were not run on the output belt. Where the lines differ, the sentence names those it is about.
 */
function waitSentence(spacing: DropSpacing, names: DropNames, run_with_copies: boolean): string {
    const failing = spacing.lines.filter(line => !line.fits);
    const effective = (line: DropSpacingLine) => line.run_counts === "counted_with_copies" ? (run_with_copies ? "counted" : "not_run") : line.run_counts;
    const kind = (["none", "between_copies", "not_run"] as const).find(each => failing.some(line => effective(line) === each)) ?? "counted";
    const about = failing.filter(line => effective(line) === kind);
    const whose = about.length < failing.length ? ` of ${inserterWords([...new Set(about.flatMap(line => line.inserter_ids))].sort(pair), names)}` : "";
    if (kind === "none") return `The simulator does not count this wait${whose}: it drops each inserter's hand on a belt of its own, so the rate and stability shown for this clock were worked out without it.`;
    if (kind === "between_copies") return `The simulator does not count the waits between copies${whose}: it drops each copy's hands on a belt of its own, so the rate and stability shown for this clock were worked out without them.`;
    if (kind === "not_run") return `The simulator did not run the copies of this clock on the output belt${whose}, so the rate and stability shown for it were worked out without the waits between copies.`;
    return "The simulator counts this wait: it puts these hands on one lane too.";
}

/** A list of at most MAX_LISTED numbers, "12, 16 or 24", with "and others" where there are more */
const listedSpacings = (values: readonly number[], word = "or"): string =>
    values.length > MAX_LISTED ? `${values.slice(0, MAX_LISTED).join(", ")} and others` : listed(values, word);

/** Why no spacing fits: "The belt moves 4.5 tiles a window cycle, but the 9 copies drop 9 hands on it, so no spacing of the copies fits: some hands always wait for room." */
export function crowdedText(crowded: { hands: number; belt_tiles: number; hand_tiles: number }, copies: number): string {
    const hands = crowded.hand_tiles === 1 ? `${crowded.hands} hands` : `${crowded.hands} hands of ${tiles(crowded.hand_tiles)} of a tile`;
    return `The belt moves ${tiles(crowded.belt_tiles)} tiles a window cycle, but the ${copies} copies drop ${hands} on it, so no spacing of the copies fits: some hands always wait for room.`;
}

/**
 * What the scan of the spacings says, as a paragraph: "The belt moves 14 tiles a window cycle, so each hand lands on one of 14 tiles. With
 * inserters 1 and 2 as they stand (3 tiles apart), the copies fit 12, 16 or 24 tiles apart; 13 or 15 apart only with a copy's
 * inserters 7 tiles apart; 14 or 21 apart never. The same holds at any of these spacings plus 14. Starting inserter 2 16, 32 or 48 ticks
 * after inserter 1 also fits (a tile every 8 ticks)."
 */
export function describeDropRoom(room: DropRoom, names: DropNames = NO_NAMES): string {
    if (room.crowded !== null) return crowdedText(room.crowded, room.copies);
    const lead = Number.isInteger(room.belt_tiles) && room.hand_tiles === 1
        ? `The belt moves ${tiles(room.belt_tiles)} tiles a window cycle, so each hand lands on one of ${tiles(room.belt_tiles)} tiles.`
        : `The belt moves ${tiles(room.belt_tiles)} tiles a window cycle, and a hand takes ${tiles(room.hand_tiles)} of a tile.`;
    const stand = room.pair !== null ? `With ${inserterWords([room.pair.first, room.pair.second], names)} as they stand (${tiles(room.pair.apart)} tiles apart)` : "With the inserters as they stand";
    const clauses: string[] = [room.fits.length > 0 ? `the copies fit ${listedSpacings(room.fits)} tiles apart`
        : `the copies fit at no spacing from ${room.low} to ${room.high} tiles`];
    for (const group of room.only_with) clauses.push(`${listedSpacings(group.spacings)} apart only with a copy's inserters ${listedSpacings(group.apart)} tiles apart`);
    if (room.never.length > 0) clauses.push(`${listedSpacings(room.never)} apart never`);
    const later = room.pair !== null && room.starts_after.length > 0
        ? ` Starting ${inserterWord(room.pair.second, names)} ${listed(room.starts_after.map(tick => String(tick)), "or")} ticks after ${inserterWord(room.pair.first, names)} also fits (a tile every ${tiles(room.ticks_per_tile)} ticks).`
        : "";
    const plus = room.loop !== null ? ` The same holds at any of these spacings plus ${room.loop}.` : "";
    return `${lead} ${stand}, ${clauses.join("; ")}.${plus}${later}`;
}

/**
 * The text a result gives of the drops onto the shared belt, as an insight's pieces. `run_with_copies`: whether the run of the copies
 * was made for the clock and ran the output belt (a clock that holds on one copy, and not a part copy on the output belt alone);
 * where it is not known, it is taken as not made.
 */
export function describeDropSpacing(spacing: DropSpacing, names: DropNames = NO_NAMES, run_with_copies = false): { fits: boolean; title: string; what: string; why: string; explanation: string } {
    const fits = spacing.lines.every(line => line.fits);
    const belts = [...new Set(spacing.lines.map(line => line.belt_id))];
    const belt = beltWords(belts, names);
    const window_cycle = `In every window cycle of ${tiles(spacing.window_cycle_ticks)} ticks`;
    const sentences: string[] = [];
    spacing.lines.forEach((line, index) => {
        const first = spacing.lines[0];
        if (line.fits) {
            if (index === 0) {
                sentences.push(`${window_cycle}, ${whoOf(line, spacing.copies, names)} drop ${handsWord(line.hands)} onto ${beltWords([line.belt_id], names)}, and each hand lands on a stretch of belt of its own, so none waits${line.copies !== undefined ? " for another of these hands" : ""}.`);
            } else if (first.fits && line.hands === first.hands && line.copies === undefined && first.copies === undefined) {
                // the same belt from the other side, or a belt of its own
                const where = line.belt_id !== first.belt_id ? ` onto ${beltWords([line.belt_id], names)}` : line.facing === (first.facing + 8) % 16 ? " on the other side of the belt" : "";
                sentences.push(`${capital(inserterWords(line.inserter_ids, names))} do the same${where}.`);
            } else {
                sentences.push(`${capital(whoOf(line, spacing.copies, names))} drop ${handsWord(line.hands)} onto ${beltWords([line.belt_id], names)}, and each hand lands on a stretch of belt of its own.`);
            }
        } else {
            const lead = index === 0 || spacing.lines[index - 1].fits ? `${window_cycle}, ` : "";
            const who = lead === "" ? capital(whoOf(line, spacing.copies, names)) : whoOf(line, spacing.copies, names);
            sentences.push(`${lead}${who} drop ${handsWord(line.hands)} onto ${beltWords([line.belt_id], names)}. ${line.pairs} ${line.pairs === 1 ? "pair" : "pairs"} of them land on each other, `
                + `and the later hand of each pair waits, the longest ${tiles(line.longest_wait)} ticks. ${startsSentence(line, names)}`);
        }
    });
    const closing = spacing.gap !== null
        ? `The copies stand ${tiles(spacing.gap)} tiles apart and the belt moves ${tiles(spacing.belt_tiles)} tiles in a window cycle.`
        : `The belt moves ${tiles(spacing.belt_tiles)} tiles in a window cycle.`;
    const hand_tiles = spacing.hand / (4 * spacing.lane_stack);
    const tile = hand_tiles === 1 ? `A tile of a belt lane holds one hand of ${spacing.hand} at stack size ${spacing.lane_stack}.`
        : `A tile of a belt lane holds ${4 * spacing.lane_stack} items at stack size ${spacing.lane_stack}, and a hand of ${spacing.hand} takes ${tiles(hand_tiles)} of a tile.`;
    const why = `${tile} A hand dropped where items already lie waits until they have moved on, so the hands ${spacing.copies > 1 ? "of all the copies " : ""}have to land in the gaps the others leave.`;
    const uncheckedText = `${spacing.gap !== null ? ` ${DROP_SPACING_COPIES_ALIKE}` : ""}${spacing.unchecked.length > 0 ? ` ${DROP_SPACING_UNCHECKED}` : ""}`
        + `${spacing.unchecked_part.length > 0 ? ` ${partUncheckedText(spacing.unchecked_part, names)}` : ""}`;
    // lines of stated drops are judged stretch by stretch along their lane, not on a belt taken to run straight past the inserters
    const some_stated = spacing.lines.some(line => line.copies !== undefined);
    const all_stated = some_stated && spacing.lines.every(line => line.copies !== undefined);
    const belt_text = `${all_stated ? "" : ` ${DROP_SPACING_STRAIGHT_BELT}`}${some_stated ? ` ${DROP_SPACING_STATED_LANES}` : ""}`;
    // "Moving one inserter by a tile puts hands on top of each other" is said where the check found it so for every line it repeats
    const moves_collide = spacing.lines.filter(line => line.copies === undefined).every(line => line.tile_move_collides);
    const roomText = spacing.room === undefined ? "" : ` ${describeDropRoom(spacing.room, names)}`;
    if (fits) {
        return {
            fits, title: `Drops onto ${belt} fit between each other`, what: `${sentences.join(" ")} ${closing}`, why,
            explanation: (all_stated ? "This holds for these start ticks. Starting one group of inserters at another tick can put hands on top of each other."
                : moves_collide ? "This holds for this spacing and these start ticks. Moving one inserter by a tile, or starting one group of inserters at another tick, puts hands on top of each other."
                    : "This holds for this spacing and these start ticks. Starting one group of inserters at another tick can put hands on top of each other.")
                + `${roomText}${belt_text}${uncheckedText}`,
        };
    }
    const parts: string[] = [];
    if (spacing.fitting_start !== undefined) {
        const start = spacing.fitting_start;
        const moves = start.ticks.length > 0 ? `${inserterWord(start.inserter_id, names)} starting at tick ${listed(start.ticks, "or")}` : "";
        const together = start.same_as !== undefined ? `at the same tick as ${inserterWord(start.same_as, names)}` : "";
        parts.push([moves, together].filter(it => it !== "").join(", or "));
    }
    const fit = parts.length > 0 ? ` The hands would fit with ${parts.join(", or with ")}.` : "";
    return {
        fits, title: `Drops onto ${belt} land on each other`, what: `${sentences.join(" ")} ${closing}`, why,
        explanation: `${waitSentence(spacing, names, run_with_copies)}${fit}${roomText}${belt_text}${uncheckedText}`,
    };
}

/** The numbers behind the text, a row for each line */
export function dropSpacingTable(spacing: DropSpacing): { columns: string[]; rows: string[][] } {
    return {
        columns: ["Inserters", "Hands each window cycle", "Tiles between copies", "Belt tiles in a window cycle", "Pairs landing on each other", "Longest wait (ticks)"],
        rows: spacing.lines.map(line => [listed(line.inserter_ids), String(line.hands), spacing.gap === null || line.copies !== undefined ? "-" : tiles(spacing.gap),
            tiles(spacing.belt_tiles), String(line.pairs), tiles(line.longest_wait)]),
    };
}

/**
 * The note that asks for the gap between copies: copies drop onto a belt from inserters whose places are known, and the
 * config does not say where the next copy stands. None otherwise.
 */
export function copyGapNeededNote(config: Config): string | null {
    if (!(config.setpoint.copies > 1) || config.setpoint.copy_offset !== undefined) return null;
    let lines: DropLine[];
    try {
        // the lines the check repeats by the gap: a line of stated drops stands where the output belt says
        lines = dropLines(config).filter(line => !line.stated);
    } catch {
        return null;
    }
    if (lines.length === 0) return null;
    const belts = [...new Set(lines.map(line => line.belt_id))].sort(pair);
    const named = beltWords(belts, { build: buildToNameOf(config), numbered: true });
    return `The ${config.setpoint.copies} copies may drop onto ${belts.length === 1 ? named.replace(/^the /, "the same ") : `the same belts: ${named}`}. `
        + "Say how far apart they stand to check whether their drops fit between each other.";
}
