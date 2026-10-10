import { Config } from "../config";
import { clockPeriods, outputPerPeriod, PeriodRange, recipesMaking } from "../harness/recording-output";
import { EntityMatch } from "./entity-matching";
import { expandChangeList, Recording, recordedClockPeriod } from "./recording";
import { extractTransfers } from "./recording-history";
import { wakeUpsOfRecording } from "./recording-wake-ups";

/** A recording with which of the config's entities each of its own is, and the sample it is read from */
export interface ComparedRecording {
    recording: Recording;
    match: EntityMatch;
    /** Samples before this one are left out: the start-up of a simulated run */
    from_sample?: number;
}

export interface CompareRecordingsOptions {
    /** Items the build is expected to put out in each clock period */
    expected_output_per_period?: number;
    /**
     * Config ids of inserters whose swings do not repeat with the clock: a fuel inserter on a clock of its own. Their
     * states are compared by how much of the time they show, not position by position.
     */
    free_running_inserter_ids?: ReadonlySet<number>;
    /**
     * Items a period by which what an inserter moves, or a machine finishes, may differ between the two. A hand more
     * or less over the periods compared is allowed on top: a build that takes several periods to repeat is cut off
     * at another place in each.
     */
    items_tolerance: number;
    /** Share of the time the two have to show the same state for an entity not to be marked as different */
    state_agreement: number;
}

export const DEFAULT_COMPARE_RECORDINGS_OPTIONS: CompareRecordingsOptions = {
    items_tolerance: 0.5,
    state_agreement: 0.95,
};

/** A stretch of clock positions at which the two show the same state less than half the time, with the state each mostly shows */
export interface StateDifference {
    from: number;
    to: number;
    game: string;
    sim: string;
}

export interface StateComparison {
    /** Share of the time the two show the same state, laid over each other clock position by clock position */
    agreement: number;
    /**
     * How alike the two are in how much of the time they show each state, wherever in the period: an entity the
     * clock does not hold to a place in the period, like the inserters of a loop of machines, can only be judged by this
     */
    share_agreement: number;
    /** Share of the time in each state */
    game: Record<string, number>;
    sim: Record<string, number>;
    /** Longest first; empty for an inserter that runs free of the clock */
    differences: StateDifference[];
}

export interface PeriodCount {
    mean: number;
    min: number;
    max: number;
}

export interface InserterComparison {
    config_id: number;
    /** Its ends, e.g. "belt 2 -> machine 3" */
    label: string;
    /** Items dropped in a clock period */
    game_items: PeriodCount;
    sim_items: PeriodCount;
    /** Hands emptied in a clock period, on average */
    game_swings: number;
    sim_swings: number;
    game_wake_ups_per_minute: number;
    sim_wake_ups_per_minute: number;
    states: StateComparison;
}

export interface MachineComparison {
    config_id: number;
    recipe: string;
    /** Crafts and productivity bars finished in a clock period */
    game_finished: PeriodCount;
    sim_finished: PeriodCount;
    states: StateComparison;
}

export interface OutputComparison {
    expected_per_period: number | null;
    /** Items put out in each complete clock period */
    game: number[];
    sim: number[];
}

export interface RecordingComparison {
    /** Positions the clock counts, the same in both */
    clock_ticks: number;
    game_periods: number;
    sim_periods: number;
    output: OutputComparison;
    inserters: InserterComparison[];
    machines: MachineComparison[];
    game_wake_ups_per_minute: number;
    sim_wake_ups_per_minute: number;
    /** What makes the simulated run a different run than the recorded one: items moved, not the states shown */
    issues: string[];
    /** Worth knowing, and no difference between the two */
    notes: string[];
}

interface Side {
    recording: Recording;
    match: EntityMatch;
    periods: PeriodRange[];
    positions: number[];
}

function sideOf(compared: ComparedRecording): Side {
    const positions = compared.recording.clock?.values ?? [];
    // a period that starts with the recording is left out: what a hand dropped on its first tick cannot be told
    // without the sample before it, and a build may still be settling into its clock there
    const from = Math.max(compared.from_sample ?? 0, 1);
    return {
        recording: compared.recording,
        match: compared.match,
        periods: clockPeriods(positions).filter(period => period.start >= from),
        positions,
    };
}

function periodCount(values: number[]): PeriodCount {
    if (values.length === 0) {
        return { mean: 0, min: 0, max: 0 };
    }
    return { mean: values.reduce((sum, value) => sum + value, 0) / values.length, min: Math.min(...values), max: Math.max(...values) };
}

/** Items that left a hand in each period: every fall of the held count, as a hand goes onto a belt a stack at a time */
function dropsPerPeriod(held: number[], periods: PeriodRange[]): number[] {
    return periods.map(period => {
        let items = 0;
        for (let i = Math.max(period.start, 1); i < period.end; i++) {
            if (held[i] < held[i - 1]) {
                items += held[i - 1] - held[i];
            }
        }
        return items;
    });
}

/** How often each state shows at each clock position over the periods, and over all of them */
function stateCounts(states: string[], side: Side, clock_ticks: number): { by_position: Map<string, number>[]; total: Map<string, number>; samples: number } {
    const by_position: Map<string, number>[] = Array.from({ length: clock_ticks }, () => new Map());
    const total = new Map<string, number>();
    let samples = 0;
    for (const period of side.periods) {
        for (let i = period.start; i < period.end; i++) {
            const at = by_position[side.positions[i]];
            if (at === undefined) {
                continue;
            }
            at.set(states[i], (at.get(states[i]) ?? 0) + 1);
            total.set(states[i], (total.get(states[i]) ?? 0) + 1);
            samples++;
        }
    }
    return { by_position, total, samples };
}

const sumOf = (counts: Map<string, number>): number => Array.from(counts.values()).reduce((sum, count) => sum + count, 0);

function sharesOf(counts: Map<string, number>): Record<string, number> {
    const sum = sumOf(counts);
    return Object.fromEntries(Array.from(counts, ([state, count]) => [state, sum === 0 ? 0 : count / sum]));
}

/** The part of two distributions that is the same: 1 when they are equal, 0 when they share no state */
function overlap(a: Map<string, number>, b: Map<string, number>): number {
    const [sum_a, sum_b] = [sumOf(a), sumOf(b)];
    if (sum_a === 0 || sum_b === 0) {
        return 0;
    }
    let shared = 0;
    for (const [state, count] of a) {
        shared += Math.min(count / sum_a, (b.get(state) ?? 0) / sum_b);
    }
    return shared;
}

function mostCommon(counts: Map<string, number>): string {
    let best = "";
    let most = -1;
    for (const [state, count] of counts) {
        if (count > most) {
            best = state;
            most = count;
        }
    }
    return best;
}

/** A clock position is one where the two differ when they show the same state there less than this much of the time */
const DIFFERENT_BELOW = 0.5;

function compareStates(game_states: string[], game: Side, sim_states: string[], sim: Side, clock_ticks: number, by_position: boolean): StateComparison {
    const game_counts = stateCounts(game_states, game, clock_ticks);
    const sim_counts = stateCounts(sim_states, sim, clock_ticks);
    const shares = { game: sharesOf(game_counts.total), sim: sharesOf(sim_counts.total) };
    const share_agreement = overlap(game_counts.total, sim_counts.total);
    if (!by_position) {
        return { agreement: share_agreement, share_agreement, ...shares, differences: [] };
    }
    let agreement = 0;
    let positions = 0;
    const differences: StateDifference[] = [];
    for (let position = 0; position < clock_ticks; position++) {
        const [at_game, at_sim] = [game_counts.by_position[position], sim_counts.by_position[position]];
        if (at_game.size === 0 || at_sim.size === 0) {
            continue;
        }
        positions++;
        const same = overlap(at_game, at_sim);
        agreement += same;
        const [game_state, sim_state] = [mostCommon(at_game), mostCommon(at_sim)];
        // two states that each show half the time at a position are no difference, whichever is the more common
        if (game_state === sim_state || same >= DIFFERENT_BELOW) {
            continue;
        }
        const last = differences[differences.length - 1];
        if (last && last.to === position - 1 && last.game === game_state && last.sim === sim_state) {
            last.to = position;
        } else {
            differences.push({ from: position, to: position, game: game_state, sim: sim_state });
        }
    }
    differences.sort((a, b) => (b.to - b.from) - (a.to - a.from) || a.from - b.from);
    return { agreement: positions === 0 ? 0 : agreement / positions, share_agreement, ...shares, differences };
}

/**
 * Lays a recording of the game against a run of the simulator in the same format (see simulated-recording.ts): what
 * every inserter moved and every machine finished in a clock period, the state each showed at each position of the
 * clock, and the wake-ups. Both are read the same way, so a difference is one between the game and the simulator
 * and not between two ways of counting.
 *
 * The two are not laid tick against tick: they start from different stocks, and a build can take several periods to
 * repeat. Each is folded over the positions of the clock instead, over its complete periods.
 */
export function compareRecordings(
    game_recording: ComparedRecording,
    sim_recording: ComparedRecording,
    config: Config,
    options: Partial<CompareRecordingsOptions> = {},
): RecordingComparison {
    const { expected_output_per_period, free_running_inserter_ids, items_tolerance, state_agreement } = { ...DEFAULT_COMPARE_RECORDINGS_OPTIONS, ...options };
    const game = sideOf(game_recording);
    const sim = sideOf(sim_recording);
    const issues: string[] = [];
    const notes: string[] = [];
    // a hand, or a craft, more or less over the periods compared
    const periods_compared = Math.max(1, Math.min(game.periods.length, sim.periods.length));

    const game_clock = recordedClockPeriod(game.recording);
    const clock_ticks = recordedClockPeriod(sim.recording) ?? 0;
    if (game_clock === null) {
        issues.push("The recording has no clock values, so it cannot be laid against the clock: was the clock combinator part of what was recorded?");
    } else if (game_clock !== clock_ticks) {
        issues.push(`The recorded clock counts ${game_clock} ticks, the clock of this config ${clock_ticks}: the blueprint that was recorded is not this clock.`);
    }
    if (game.periods.length === 0 && game_clock !== null) {
        issues.push("The recording does not hold one complete clock period.");
    }

    const by_config_id = <T extends { id: number }>(side: Side, entities: T[], matched: Map<number, number>) =>
        new Map(entities.flatMap(entity => matched.has(entity.id) ? [[matched.get(entity.id)!, entity] as const] : []));
    const statesOf = (side: Side, changes: [number, string][]) => expandChangeList(changes, side.recording.sample_count, "none");
    const wakeUpsBy = (side: Side) => {
        const from = side.periods[0]?.start ?? 0;
        const to = side.periods[side.periods.length - 1]?.end ?? 0;
        return wakeUpsOfRecording(side.recording, side.match, from, to);
    };
    const [game_wake_ups, sim_wake_ups] = [wakeUpsBy(game), wakeUpsBy(sim)];
    const wakeUpsOfInserter = (wake_ups: typeof game_wake_ups, config_id: number) =>
        wake_ups.inserters.find(it => it.inserter_id === `inserter:${config_id}`)?.wake_ups_per_minute ?? 0;

    const game_inserters = by_config_id(game, game.recording.inserters, game.match.inserters);
    const sim_inserters = by_config_id(sim, sim.recording.inserters, sim.match.inserters);
    const inserters: InserterComparison[] = [];
    for (const [config_id, sim_inserter] of Array.from(sim_inserters).sort(([a], [b]) => a - b)) {
        const game_inserter = game_inserters.get(config_id);
        if (game_inserter === undefined) {
            continue;
        }
        const swingsIn = (side: Side, inserter: typeof sim_inserter) => {
            const swings = extractTransfers(inserter, side.positions).filter(swing => !swing.truncated_end);
            const counted = side.periods.map(period => swings.filter(swing => swing.end_index > period.start && swing.end_index <= period.end).length);
            return periodCount(counted).mean;
        };
        const comparison: InserterComparison = {
            config_id,
            label: `${sim_inserter.source.type} ${sim_inserter.source.id} -> ${sim_inserter.sink.type} ${sim_inserter.sink.id}`,
            game_items: periodCount(dropsPerPeriod(game_inserter.samples.held_count, game.periods)),
            sim_items: periodCount(dropsPerPeriod(sim_inserter.samples.held_count, sim.periods)),
            game_swings: swingsIn(game, game_inserter),
            sim_swings: swingsIn(sim, sim_inserter),
            game_wake_ups_per_minute: wakeUpsOfInserter(game_wake_ups, config_id),
            sim_wake_ups_per_minute: wakeUpsOfInserter(sim_wake_ups, config_id),
            states: compareStates(
                statesOf(game, game_inserter.samples.status), game, statesOf(sim, sim_inserter.samples.status), sim,
                clock_ticks, !free_running_inserter_ids?.has(config_id),
            ),
        };
        inserters.push(comparison);
        if (Math.abs(comparison.game_items.mean - comparison.sim_items.mean) > items_tolerance + sim_inserter.stack_size / periods_compared) {
            issues.push(`Inserter ${config_id} (${comparison.label}) moves ${comparison.game_items.mean.toFixed(2)} items a period in the game `
                + `and ${comparison.sim_items.mean.toFixed(2)} in the simulator.`);
        }
    }

    const game_machines = by_config_id(game, game.recording.machines, game.match.machines);
    const sim_machines = by_config_id(sim, sim.recording.machines, sim.match.machines);
    const machines: MachineComparison[] = [];
    for (const [config_id, sim_machine] of Array.from(sim_machines).sort(([a], [b]) => a - b)) {
        const game_machine = game_machines.get(config_id);
        if (game_machine === undefined) {
            continue;
        }
        const finishedIn = (side: Side, finished: number[]) =>
            periodCount(side.periods.map(period => finished[period.end - 1] - finished[Math.max(period.start - 1, 0)]));
        const comparison: MachineComparison = {
            config_id,
            recipe: sim_machine.recipe,
            game_finished: finishedIn(game, game_machine.samples.products_finished),
            sim_finished: finishedIn(sim, sim_machine.samples.products_finished),
            states: compareStates(statesOf(game, game_machine.samples.status), game, statesOf(sim, sim_machine.samples.status), sim, clock_ticks, true),
        };
        machines.push(comparison);
        const spread = Math.max(comparison.game_finished.max - comparison.game_finished.min, comparison.sim_finished.max - comparison.sim_finished.min);
        if (Math.abs(comparison.game_finished.mean - comparison.sim_finished.mean) > items_tolerance + spread / periods_compared) {
            issues.push(`Machine ${config_id} (${comparison.recipe}) finishes ${comparison.game_finished.mean.toFixed(2)} crafts and productivity bars a period `
                + `in the game and ${comparison.sim_finished.mean.toFixed(2)} in the simulator.`);
        }
    }

    const recipes = recipesMaking(config, config.target_output.recipe);
    const periods_from = (side: Side) => new Set(side.periods.map(period => period.start));
    const outputOf = (side: Side) => {
        const kept = periods_from(side);
        return outputPerPeriod(side.recording, recipes).filter(period => kept.has(period.start)).map(period => period.items);
    };
    const output: OutputComparison = { expected_per_period: expected_output_per_period ?? null, game: outputOf(game), sim: outputOf(sim) };
    if (expected_output_per_period !== undefined) {
        const off = (who: string, items: number[]) => {
            const periods = items.flatMap((it, index) => it === expected_output_per_period ? [] : [`${index + 1}: ${it}`]);
            if (periods.length > 0) {
                issues.push(`The ${who} put out something other than the expected ${expected_output_per_period} items in ${periods.length} of ${items.length} `
                    + `clock periods (${periods.slice(0, 8).join(", ")}${periods.length > 8 ? ", ..." : ""}).`);
            }
        };
        off("game", output.game);
        off("simulator", output.sim);
    }

    const { match } = game;
    if (match.unmatched_recorded_inserters.length > 0) {
        notes.push(`Recorded inserters that are not in the config, such as those that load a scaffold: ${match.unmatched_recorded_inserters.join(", ")}`);
    }
    if (match.unmatched_config_inserters.length > 0) issues.push(`Config inserters not found in recording: ${match.unmatched_config_inserters.join(", ")}`);
    if (match.unmatched_config_machines.length > 0) issues.push(`Config machines not found in recording: ${match.unmatched_config_machines.join(", ")}`);

    return {
        clock_ticks,
        game_periods: game.periods.length,
        sim_periods: sim.periods.length,
        output,
        inserters,
        machines,
        game_wake_ups_per_minute: game_wake_ups.wake_ups_per_minute,
        sim_wake_ups_per_minute: sim_wake_ups.wake_ups_per_minute,
        issues,
        notes,
    };
}

const SHORT_STATE: Record<string, string> = {
    working: "working",
    waiting_for_source_items: "source",
    waiting_for_more_items: "more",
    waiting_for_space_in_destination: "space",
    disabled_by_control_behavior: "off",
    item_ingredient_shortage: "shortage",
    full_output: "full",
    no_fuel: "no fuel",
};

const short = (state: string): string => SHORT_STATE[state] ?? state;

function formatShares(states: StateComparison): string {
    const names = Array.from(new Set([...Object.keys(states.game), ...Object.keys(states.sim)])).sort();
    const percent = (share: number | undefined) => `${((share ?? 0) * 100).toFixed(1)}`;
    return names.map(name => `${short(name)} ${percent(states.game[name])}/${percent(states.sim[name])}`).join(", ");
}

function formatCount(count: PeriodCount): string {
    const mean = Number.isInteger(count.mean) ? `${count.mean}` : count.mean.toFixed(2);
    return count.min === count.max ? mean : `${mean} (${count.min}-${count.max})`;
}

function formatOutput(items: number[]): string {
    const counts = new Map<number, number>();
    items.forEach(it => counts.set(it, (counts.get(it) ?? 0) + 1));
    return Array.from(counts).sort(([, a], [, b]) => b - a).map(([amount, periods]) => `${amount} in ${periods}`).join(", ") || "none";
}

/** Differences listed for an entity before the rest is summed up in a line */
const LISTED_DIFFERENCES = 4;

export function formatRecordingComparison(report: RecordingComparison, options: Partial<CompareRecordingsOptions> = {}): string[] {
    const { state_agreement } = { ...DEFAULT_COMPARE_RECORDINGS_OPTIONS, ...options };
    const lines: string[] = [];
    const mark = (states: StateComparison) => states.agreement >= state_agreement ? "OK  " : "DIFF";
    const agreementOf = (states: StateComparison) => `same state ${(states.agreement * 100).toFixed(1)}%`
        + (states.agreement >= state_agreement ? "" : ` at the same place in the period, ${(states.share_agreement * 100).toFixed(1)}% wherever in it`);
    const differences = (states: StateComparison) => {
        states.differences.slice(0, LISTED_DIFFERENCES).forEach(it => lines.push(
            `         positions ${it.from}-${it.to}: game ${short(it.game)}, simulator ${short(it.sim)}`));
        if (states.differences.length > LISTED_DIFFERENCES) {
            const ticks = states.differences.slice(LISTED_DIFFERENCES).reduce((sum, it) => sum + it.to - it.from + 1, 0);
            lines.push(`         and ${states.differences.length - LISTED_DIFFERENCES} more stretches, ${ticks} positions in all`);
        }
    };

    lines.push(`Clock: ${report.clock_ticks} ticks | complete periods: ${report.game_periods} recorded, ${report.sim_periods} simulated`);
    lines.push("Every pair of figures is game/simulator.");
    lines.push("");
    lines.push(`Output a period${report.output.expected_per_period === null ? "" : `, ${report.output.expected_per_period} expected`}:`);
    lines.push(`  game:      ${formatOutput(report.output.game)} periods`);
    lines.push(`  simulator: ${formatOutput(report.output.sim)} periods`);
    lines.push("");
    lines.push(`Wake-ups a minute: ${report.game_wake_ups_per_minute.toFixed(1)}/${report.sim_wake_ups_per_minute.toFixed(1)}`);
    lines.push("");
    lines.push("Inserters (config id): items and swings a period, wake-ups a minute, and how much of the time the two show the same state");
    for (const it of report.inserters) {
        lines.push(`  ${mark(it.states)} inserter ${it.config_id} (${it.label}): items ${formatCount(it.game_items)}/${formatCount(it.sim_items)}, `
            + `swings ${it.game_swings.toFixed(2)}/${it.sim_swings.toFixed(2)}, wake-ups ${it.game_wake_ups_per_minute.toFixed(1)}/${it.sim_wake_ups_per_minute.toFixed(1)}, `
            + agreementOf(it.states));
        if (it.states.agreement < state_agreement) {
            lines.push(`         % of the time: ${formatShares(it.states)}`);
            differences(it.states);
        }
    }
    lines.push("");
    lines.push("Machines (config id): crafts and productivity bars finished a period, and how much of the time the two show the same state");
    for (const it of report.machines) {
        lines.push(`  ${mark(it.states)} machine ${it.config_id} (${it.recipe}): finished ${formatCount(it.game_finished)}/${formatCount(it.sim_finished)}, `
            + agreementOf(it.states));
        if (it.states.agreement < state_agreement) {
            lines.push(`         % of the time: ${formatShares(it.states)}`);
            differences(it.states);
        }
    }
    const different = [...report.inserters, ...report.machines].filter(it => it.states.agreement < state_agreement).length;
    lines.push("");
    report.notes.forEach(note => lines.push(`Note: ${note}`));
    if (report.issues.length === 0) {
        lines.push(`RESULT: the simulator moves what the game moved.${different === 0 ? "" : ` ${different} entities show another state than in the game more than ${((1 - state_agreement) * 100).toFixed(0)}% of the time.`}`);
    } else {
        lines.push(`RESULT: ${report.issues.length} issue(s):`);
        report.issues.forEach(issue => lines.push(`  - ${issue}`));
    }
    return lines;
}
