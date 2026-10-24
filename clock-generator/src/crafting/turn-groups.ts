import { OpenRange } from "../data-types";

/**
 * The machines of a build that cannot all draw from their sources together take turns: the grouped hands rule
 * (candidates/grouped-hands.ts) deals them into groups, and each group's windows open in its own part of the period.
 * What the clock's blueprint needs of that to show it is who is in a group and when its turn begins.
 */
export interface TurnGroup {
    /** The tick of the period at which the group's turn begins: its output swings open */
    start: number;
    /** The group's inserters and drills by entity id, in the order of the turn: the output swings, the inputs, the drills */
    entity_ids: string[];
}

/** Empty tiles between the combinators of one group and the next, so that the groups read as separate */
export const GROUP_GAP_TILES = 2;

/** The deciders of one turn, in the order they stand in */
export interface PlacedGroup {
    /** The index of the turn in the turns given; null for the deciders that no turn names, which stand after the groups */
    turn: number | null;
    /** The indices of the deciders given, in the order of the turn */
    deciders: number[];
}

/**
 * The deciders of a clock laid out by turn: a group each for the turns that have a decider, in the order of the turns, and the
 * deciders no turn names after them as a group of their own. A decider stands in the turn that names its first entity (a decider
 * with several entities has them in the same windows, so in the same turn), and in its turn where its entity comes first in
 * the order of the turn. Null where fewer than two turns have a decider: there is nothing to tell apart.
 *
 * @param deciders The entity ids each decider serves, the one it is made for first
 */
export function placeByTurns(deciders: readonly (readonly string[])[], turns: readonly TurnGroup[]): PlacedGroup[] | null {
    const named = new Map<string, { turn: number; place: number }>();
    turns.forEach((group, turn) => group.entity_ids.forEach((id, place) => {
        if (!named.has(id)) {
            named.set(id, { turn, place });
        }
    }));
    const turn_of = (decider: readonly string[]): { turn: number; place: number } | null => {
        const first = decider.map(id => named.get(id)).find(it => it !== undefined);
        if (first === undefined) {
            return null;
        }
        const places = decider.flatMap(id => named.get(id)?.turn === first.turn ? [named.get(id)!.place] : []);
        return { turn: first.turn, place: Math.min(...places) };
    };
    const placed = deciders.map(turn_of);
    const groups: PlacedGroup[] = turns.map((_, turn) => ({
        turn,
        deciders: deciders.map((_, index) => index)
            .filter(index => placed[index]?.turn === turn)
            .sort((a, b) => placed[a]!.place - placed[b]!.place || a - b),
    })).filter(group => group.deciders.length > 0);
    if (groups.length < 2) {
        return null;
    }
    const unplaced = deciders.map((_, index) => index).filter(index => placed[index] === null);
    return unplaced.length === 0 ? groups : [...groups, { turn: null, deciders: unplaced }];
}

/**
 * The ticks a group's turn lasts, as the ticks of the period it covers, from the tick its turn begins to the end of the last
 * window of its deciders. The end is past the period's last tick (`period` or more) where the turn runs over into the next period.
 */
export function turnTicks(start: number, windows: readonly OpenRange[], period: number): { start: number; end: number } {
    let end = start;
    for (const window of windows) {
        const opens = (((window.start_inclusive - start) % period) + period) % period;
        end = Math.max(end, start + opens + (window.end_inclusive - window.start_inclusive));
    }
    return { start, end: Math.min(end, start + period - 1) };
}
