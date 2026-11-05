/** One inserter of probe.lua dropping a full hand from a chest onto a turbo line */
export interface DropCase {
    name: string;
    /** Where the inserter stands (probe.lua APPROACHES) */
    approach: Approach;
    /** The way the line runs */
    direction: "north" | "east" | "south" | "west";
    inserter: string;
    quality?: string;
    /** The hand to force, 16 for the legendary stack inserter of the calibration */
    hand?: number;
    /** Copper stacks put on both lanes at the start of the line from tick 1 to `stop`: at the ticks of `ticks` in every `period`, shifted by `phase` */
    traffic?: {ticks: number[]; period: number; phase: number; stop: number};
    /** Copper stacks on each lane at the end of a dead-end line, put there before the chest is filled */
    queue?: number;
}

export type Approach =
    | "left" | "right" | "back" | "front"
    | "entrance-left" | "entrance-right" | "exit-left" | "exit-right"
    | "entrance-from-upstream" | "entrance-from-downstream" | "exit-from-upstream" | "exit-from-downstream";

/** One game run: the lines built side by side, logged every tick from just before the chest is filled */
export interface DropRun {
    name: string;
    /** Tick the chest is filled; the inserter picks up in the next */
    go: number;
    /** Ticks logged after it */
    ticks: number;
    force?: {inserter_stack_size_bonus?: number; bulk_inserter_capacity_bonus?: number; belt_stack_size_bonus?: number};
    scenarios: DropCase[];
}

export const GO = 40;
export const TICKS = 150;

/** Approaches whose line flows on to a sink, and the two that end it (the inserter faces the end) */
export const FLOWING: Approach[] = ["left", "right", "back", "entrance-left", "entrance-right", "exit-left", "exit-right",
    "entrance-from-upstream", "entrance-from-downstream", "exit-from-upstream"];
export const DEAD_ENDS: Approach[] = ["front", "exit-from-downstream"];

/** Traffic on the receiving lane, as stacks a period of the belt's quarter-tile stack spacing (2 ticks on turbo) */
export const DENSITIES = {
    d25: {ticks: [0], period: 8, phases: [0, 1, 2, 3, 4, 5, 6, 7]},
    d50: {ticks: [0], period: 4, phases: [0, 1, 2, 3]},
    d75: {ticks: [0, 2, 4], period: 8, phases: [0, 1, 2, 3, 4, 5, 6, 7]},
} as const;
/** A stack every 2 ticks is the lane at full density; it stops when the hand has waited a while, so the gap's arrival is measured */
export const FULL_STOP = GO + 20;


/** The cases of one inserter kind on every approach and lane state */
function matrix(kind: Partial<DropCase> & {inserter: string; label: string}): DropCase[] {
    const cases: DropCase[] = [];
    const base = {inserter: kind.inserter, quality: kind.quality, hand: kind.hand};
    const named = (approach: Approach, direction: DropCase["direction"], state: string) =>
        `${approach}-${direction}-${kind.label}-${state}`;
    for (const approach of [...FLOWING, ...DEAD_ENDS]) cases.push({name: named(approach, "east", "empty"), approach, direction: "east", ...base});
    for (const approach of FLOWING) {
        for (const [label, density] of Object.entries(DENSITIES)) for (const phase of density.phases) {
            cases.push({name: named(approach, "east", `${label}-p${phase}`), approach, direction: "east", ...base,
                traffic: {ticks: [...density.ticks], period: density.period, phase, stop: 10_000}});
        }
        cases.push({name: named(approach, "east", "full"), approach, direction: "east", ...base,
            traffic: {ticks: [0], period: 2, phase: 0, stop: FULL_STOP}});
    }
    for (const approach of DEAD_ENDS) for (const queue of [2, 3, 4]) {
        cases.push({name: named(approach, "east", `queue${queue}`), approach, direction: "east", ...base, queue});
    }
    return cases;
}

/** The other three ways the line can run, from each side and end, empty: the lane and the ticks do not depend on it */
function orientations(kind: {inserter: string; label: string; quality?: string; hand?: number}): DropCase[] {
    const base = {inserter: kind.inserter, quality: kind.quality, hand: kind.hand};
    return (["north", "south", "west"] as const).flatMap(direction => (["left", "right", "back", "front"] as const).map((approach): DropCase =>
        ({name: `${approach}-${direction}-${kind.label}-empty`, approach, direction, ...base})));
}

const LEGENDARY_STACK = {inserter: "stack-inserter", quality: "legendary", hand: 16, label: "legendary-stack"};

/** The legendary stack inserter of the calibration at belt stack sizes 1 to 4 (the force's bonus, research unchanged) */
export const STACK_RUNS: DropRun[] = ([1, 2, 3, 4] as const).map(size => ({
    name: `stack-${size}`, go: GO, ticks: TICKS, force: {belt_stack_size_bonus: size - 1},
    scenarios: [...matrix(LEGENDARY_STACK), ...orientations(LEGENDARY_STACK)],
}));

/** The calibrated case alone (turbo, the side the scaffold has, east, an empty lane) for the check that the probe agrees with it */
export const VALIDATION_RUNS: DropRun[] = ([1, 2, 3, 4] as const).map(size => ({
    name: `validation-${size}`, go: GO, ticks: TICKS, force: {belt_stack_size_bonus: size - 1},
    scenarios: [{name: "left-east-legendary-stack-empty", approach: "left", direction: "east", inserter: "stack-inserter", quality: "legendary", hand: 16}],
}));

/**
 * The other inserter kinds, with the save's research (hands of 4, 12 and 16) and no forced hand: the four electric prototypes
 * beside the stack inserter, at normal and legendary quality (the burner inserter needs fuel and is refused), on the straight
 * line from each side and end, in four lane states, at belt stack sizes 1, 3 and 4 (3 is the one a hand of 4 does not divide). The long-handed inserter stands two slots away.
 */
const KIND_PROTOTYPES = ["inserter", "long-handed-inserter", "fast-inserter", "bulk-inserter", "stack-inserter"] as const;
const KIND_QUALITIES = ["normal", "legendary"] as const;
function kindCases(): DropCase[] {
    const cases: DropCase[] = [];
    for (const inserter of KIND_PROTOTYPES) for (const quality of KIND_QUALITIES) {
        const base = {inserter, quality};
        const named = (approach: Approach, state: string) => `${approach}-east-${inserter}-${quality}-${state}`;
        for (const approach of ["left", "right", "back"] as const) {
            cases.push({name: named(approach, "empty"), approach, direction: "east", ...base});
            for (const phase of [0, 2]) cases.push({name: named(approach, `d50-p${phase}`), approach, direction: "east", ...base,
                traffic: {ticks: [0], period: 4, phase, stop: 10_000}});
            cases.push({name: named(approach, "full"), approach, direction: "east", ...base, traffic: {ticks: [0], period: 2, phase: 0, stop: FULL_STOP}});
        }
        cases.push({name: named("front", "empty"), approach: "front", direction: "east", ...base});
        for (const queue of [2, 3, 4]) cases.push({name: named("front", `queue${queue}`), approach: "front", direction: "east", ...base, queue});
    }
    return cases;
}
export const KIND_RUNS: DropRun[] = ([1, 3, 4] as const).map(size => ({
    name: `kinds-${size}`, go: GO, ticks: TICKS, force: {belt_stack_size_bonus: size - 1}, scenarios: kindCases(),
}));

export const ALL_RUNS: DropRun[] = [...VALIDATION_RUNS, ...STACK_RUNS, ...KIND_RUNS];
