/**
 * Results of the engine for three examples, kept as they came (made by a script from the engine's generateClockAlternatives,
 * not written by hand), and the views of their clocks as the worker gives them. A test reads the engine's sentences from
 * here, never from a copy of its own.
 */
import type { BuildLane, CheckedLaneRow, CheckedLanes, ClockInsight, SharedLaneCause, WhyNotStable } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import automation from './checked-lanes/automation-science-240.json';
import causesJson from './checked-lanes/causes.json';
import electromagnetic from './checked-lanes/electromagnetic-science-330.json';
import electromagneticTwoSwings from './checked-lanes/electromagnetic-science-330-two-swings.json';
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
    shared_lane_loss_note: string | null;
    checked_lanes: CheckedLanes | null;
}

interface KeptResult {
    sample: string;
    copies: number;
    selected_index: number;
    why_not_stable: WhyNotStable | null;
    lanes: BuildLane[];
    clocks: KeptClock[];
}

export const AUTOMATION_240 = automation as unknown as KeptResult;
export const ELECTROMAGNETIC_330 = electromagnetic as unknown as KeptResult;
export const MILITARY_240 = military as unknown as KeptResult;
/** Electromagnetic science 330 with terminal_swing_count 2: its recommended clock is not stable on a shared lane */
export const ELECTROMAGNETIC_330_TWO_SWINGS = electromagneticTwoSwings as unknown as KeptResult;

/** Every clock with a cause on the shared lanes of the five samples that have one (agricultural science 250 too), by its sample and id */
export const CAUSES = causesJson as unknown as { sample: string; id: string; label: string; window_cycle_ticks: number; copies: number; cause: SharedLaneCause }[];

/** One row of each state the engine gives, with the copies of its line and the lanes of its build */
export const STATES = statesJson as unknown as Record<string, { from: string; copies: number; row: CheckedLaneRow; lanes: BuildLane[]; insights?: ClockInsight[] }>;

/** A clock of a kept result by its id */
function keptClock(result: KeptResult, id: string): KeptClock {
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
        ...(clock.shared_lane_loss_note !== null && { sharedLaneLossNote: clock.shared_lane_loss_note }),
    } as unknown as ClockAlternativeView;
}

/** Every clock of a kept result as views, in its order */
export const viewsOf = (result: KeptResult) => result.clocks.map(clock => viewOf(result, clock.id));

/** The engine's reason, as it gives one where the loss trials of a clock could not be made (an error's message) */
export const TRIALS_NOT_MADE_REASON = 'the loss trials could not be made: no item of the build stops arriving';

/**
 * The three cases of a clock whose recovery trials gave no answer (the status Error), which no clock of the samples is in:
 * the clocks of automation science 240 with the recommended one's recovery result changed. "not-tried": the trials could not
 * be made, with the engine's reason; "baseline-missed": the run with nothing cut did not make its expected output; "no-result":
 * there is no recovery result.
 */
export function errorCaseViews(kind: 'not-tried' | 'baseline-missed' | 'no-result'): ClockAlternativeView[] {
    const id = AUTOMATION_240.clocks[AUTOMATION_240.selected_index].id;
    return viewsOf(AUTOMATION_240).map(view => {
        if (view.id !== id) return view;
        const { disturbance_trial_not_tried: _reason, ...assessment } = view.assessment;
        void _reason;
        return { ...view, assessment: {
            ...assessment,
            disturbance_trial: kind === 'baseline-missed' ? { survives: false, broken_by: [], recovered_after_window_cycles: null } : null,
            ...(kind === 'not-tried' && { disturbance_trial_not_tried: TRIALS_NOT_MADE_REASON }),
        } };
    });
}
