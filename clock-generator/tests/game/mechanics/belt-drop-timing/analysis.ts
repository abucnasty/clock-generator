import {DropRecording, DropScenarioInfo, RawRow} from "./recording";

/** One stack on a transport line in one tick */
/** `line` is the game's transport line of the piece: 1 and 2 are the surface lanes, 3 and 4 the lanes below ground of an underground end */
export interface Stack {piece: number; line: number; id: number; position: number; count: number; iron: boolean}

export function stacksOf(row: RawRow): Stack[] {
    return row[3].map(([code, id, position, countItem]) => ({
        piece: Math.floor(code / 8), line: code % 8, id, position: position / 256, count: Math.floor(countItem / 2), iron: countItem % 2 === 0,
    }));
}

/** A stack of the hand's items that appeared on the line */
export interface Drop {
    tick: number;
    /** The slot of the piece it first stood on (the line's u) */
    slot: number;
    line: number;
    /** The lane of the line: 1 is the left lane in the direction of travel, 2 the right (lines 3 and 4 are the lanes of an underground end's tunnel half) */
    lane: number;
    /** Distance to the end of that piece in tiles when first seen, after the tick's movement (the game's convention) */
    position: number;
    /** The same on the line as a whole: slots from the line's start, so a landing in slot 3 at 0.375 from the end is 3.625; NaN on an underground end, whose pieces are half a slot long */
    path: number;
    count: number;
}

export interface Hand {
    /** The tick the hand was picked up (the first tick the inserter holds it) */
    pickup: number;
    held: number;
    drops: Drop[];
}

export interface Summary {
    /** Pickups of the log: every tick the hand grew */
    pickups: number[];
    hands: Hand[];
    /** The statuses seen, by name */
    statuses: string[];
}

/** The hands of one scenario: when each was picked up and the stacks it put down, found as iron stacks not seen before */
export function summarise(recording: DropRecording, name: string): Summary {
    const info = recording.info.scenarios.find(scenario => scenario.name === name)!;
    const rows = recording.runs[name];
    const slotOfPiece = info.pieces.map(piece => piece.u);
    const isBelt = info.pieces.map(piece => piece.kind === "transport-belt");
    const seen = new Set<number>();
    const hands: Hand[] = [];
    const statuses = new Set<number>();
    let previous = 0;
    for (const row of rows) {
        const [tick, held, status] = row;
        statuses.add(status);
        if (held > previous) hands.push({pickup: tick, held, drops: []});
        previous = held;
        for (const stack of stacksOf(row)) {
            if (!stack.iron || seen.has(stack.id)) continue;
            seen.add(stack.id);
            const hand = hands.at(-1);
            if (!hand) continue;
            const slot = slotOfPiece[stack.piece - 1];
            hand.drops.push({tick, slot, line: stack.line, lane: (stack.line - 1) % 2 + 1, position: stack.position,
                path: isBelt[stack.piece - 1] ? slot + 1 - stack.position : NaN, count: stack.count});
        }
    }
    return {pickups: hands.map(hand => hand.pickup), hands, statuses: [...statuses].sort().map(code => recording.info.status[String(code)] ?? String(code))};
}

/** What the controls pin about a hand: the wait from pickup to the first stack, the ticks of the others from the first, the sizes, the lines and the landings */
export interface HandFigures {
    delay: number;
    offsets: number[];
    counts: number[];
    lanes: number[];
    landings: number[];
}

export function figuresOf(hand: Hand): HandFigures | null {
    if (hand.drops.length === 0) return null;
    const first = hand.drops[0].tick;
    return {
        delay: first - hand.pickup,
        offsets: hand.drops.map(drop => drop.tick - first),
        counts: hand.drops.map(drop => drop.count),
        lanes: hand.drops.map(drop => drop.lane),
        landings: hand.drops.map(drop => drop.position),
    };
}

export function scenarioOf(recording: DropRecording, name: string): DropScenarioInfo {
    return recording.info.scenarios.find(scenario => scenario.name === name)!;
}
