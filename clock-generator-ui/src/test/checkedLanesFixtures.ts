/**
 * Results of the engine for three examples, kept as they came (made by a script from the engine's generateClockAlternatives,
 * not written by hand), and the views of their clocks as the worker gives them. A test reads the engine's sentences from
 * here, never from a copy of its own.
 */
import type { BuildLane, CheckedLaneRow, CheckedLanes } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import automation from './checked-lanes/automation-science-240.json';
import electromagnetic from './checked-lanes/electromagnetic-science-330.json';
import military from './checked-lanes/military-science-240.json';
import statesJson from './checked-lanes/states.json';

interface KeptClock {
    id: string;
    label: string;
    verdict: string;
    window_cycle_ticks: number;
    copies: number;
    description: string;
    belt: unknown;
    belt_label: string;
    assessment: unknown;
    ranking: unknown;
    strategy: unknown;
    deciders: number;
    inserter_window_count: number;
    terminal_swing_count: number;
    cycle_ticks: number;
    expected_output_items: number;
    insights: unknown[];
    checked_lanes: CheckedLanes | null;
}

export interface KeptResult {
    sample: string;
    copies: number;
    selected_index: number;
    lanes: BuildLane[];
    clocks: KeptClock[];
}

export const AUTOMATION_240 = automation as unknown as KeptResult;
export const ELECTROMAGNETIC_330 = electromagnetic as unknown as KeptResult;
export const MILITARY_240 = military as unknown as KeptResult;

/** One row of each state the engine gives, with the copies of its line and the lanes of its build */
export const STATES = statesJson as unknown as Record<string, { from: string; copies: number; row: CheckedLaneRow; lanes: BuildLane[] }>;

/** A clock of a kept result by its id */
export function keptClock(result: KeptResult, id: string): KeptClock {
    const clock = result.clocks.find(it => it.id === id);
    if (clock === undefined) throw new Error(`${result.sample} has no clock ${id}`);
    return clock;
}

/** The checked lanes of a clock of a kept result, which it must have */
export function checkedOf(result: KeptResult, id: string): CheckedLanes {
    const checked = keptClock(result, id).checked_lanes;
    if (checked === null) throw new Error(`${id} has no checked lanes`);
    return checked;
}

/** The view of a clock as the worker gives it (simulation.worker.ts toRunView), with the fields the result page reads */
export function viewOf(result: KeptResult, id: string): ClockAlternativeView {
    const clock = keptClock(result, id);
    return {
        id: clock.id, label: clock.label, description: clock.description, verdict: clock.verdict, copies: clock.copies,
        assessment: clock.assessment, ranking: clock.ranking, strategy: clock.strategy, belt: clock.belt, beltLabel: clock.belt_label,
        deciders: clock.deciders, inserterWindowCount: clock.inserter_window_count, rankingWindowCount: clock.inserter_window_count,
        terminalSwingCount: clock.terminal_swing_count, cycleTicks: clock.cycle_ticks, simulationDurationTicks: clock.window_cycle_ticks,
        expectedOutputItems: clock.expected_output_items, asBuilt: null, insights: clock.insights, deadlockRisk: null,
        assumptions: { lanes: result.lanes, kickStarts: [], outputDrops: [], overrides: {}, machineFuel: [] },
        ...(clock.checked_lanes !== null && { checkedLanes: clock.checked_lanes }),
    } as unknown as ClockAlternativeView;
}

/** Every clock of a kept result as views, in its order */
export const viewsOf = (result: KeptResult) => result.clocks.map(clock => viewOf(result, clock.id));
