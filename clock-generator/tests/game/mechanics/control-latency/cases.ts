/** One cell of probe.lua: a decider that switches inserters at chosen ticks, and the state they are in when it does */
export interface LatencyCase {
    name: string;
    kind: "chest" | "machine-room" | "machine-craft" | "wake-take" | "belt-empty" | "belt-backed" | "pair" | "pair-shared";
    /** Signal A, which the decider turns into the inserters' enable: off (or `initial`) until the first entry, then as each entry says */
    initial?: boolean;
    schedule?: [number, boolean][];
    /** machine-room: signal B, the taker's own decider */
    initial2?: boolean;
    gate2?: [number, boolean][];
    /** machine-room, wake-take: the gears put in the machine's output at the start (its block is 4) */
    gears?: number;
    /** machine-craft, machine-room: the plates put in the machine's input at the start (its insertion limit is 8) */
    plates?: number;
    /** belt-empty: plates put on the belt's first tile in the ticks [belt_from, belt_from + belt_ticks) */
    belt_from?: number;
    belt_ticks?: number;
    /** belt-backed: plates put on the belt's first tile until this tick */
    fill_until?: number;
    /** pair-shared: the plates in the one chest both inserters take from */
    shared?: number;
}

export const LATENCY_TICKS = 400;

export const LATENCY_CASES: LatencyCase[] = [
    // (a) idle with items available, enabled at 60; (d) disabled while moving at 160; enabled again mid-swing at 260
    {name: "chest", kind: "chest", schedule: [[60, true], [160, false], [260, true]]},
    // (d) disabled while moving at two more points of the swing, enabled again 40 ticks later
    {name: "chest-off-103", kind: "chest", initial: true, schedule: [[103, false], [143, true]]},
    {name: "chest-off-107", kind: "chest", initial: true, schedule: [[107, false], [147, true]]},
    // (b) the feeder waits for space at a machine at its block, is disabled at 60, the taker (signal B) empties the
    // output from 80, and the feeder is enabled at 160 with room in the machine
    {name: "machine-room", kind: "machine-room", initial: true, schedule: [[60, false], [160, true]], gears: 12,
        gate2: [[80, true], [140, false]]},
    // (b) a craft finishes while the machine is at its block (2 gears and 3 crafts' plates at the start: the crafts finish
    // 24 ticks apart, the second puts the output at its block of 4, the third past it); the feeder is enabled at 55 and
    // waits; the taker takes the gears in the sample of the third craft's finish, one, two and three samples after it
    ...[70, 71, 72, 73].map((gate): LatencyCase => ({name: `craft-then-take-${gate}`, kind: "machine-room", initial: false,
        schedule: [[55, true]], gears: 2, plates: 6, gate2: [[gate, true]]})),
    // (b) room made by the machine's own crafts: the feeder (no circuit) waits while the input is at its insertion limit
    {name: "machine-craft", kind: "machine-craft", plates: 8},
    // woken in the walk: the feeder (no circuit) waits asleep at the machine's block; the taker is enabled and takes the gears
    {name: "wake-take-100", kind: "wake-take", schedule: [[100, true]], gears: 12},
    {name: "wake-take-101", kind: "wake-take", schedule: [[101, true]], gears: 12},
    // (c) waiting on a belt: enabled at 60 over an empty belt, plates put on from 120
    {name: "belt-empty", kind: "belt-empty", schedule: [[60, true]], belt_from: 120, belt_ticks: 20},
    // (c) a backed-up belt, enabled at 200
    {name: "belt-backed", kind: "belt-backed", schedule: [[200, true]], fill_until: 100},
    // two inserters enabled in the same tick by one decider, each with its own chest, and from one chest with one hand in it
    {name: "pair", kind: "pair", schedule: [[60, true]]},
    {name: "pair-shared", kind: "pair-shared", schedule: [[60, true]], shared: 16},
];
