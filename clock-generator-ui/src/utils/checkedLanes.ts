import { withOtherClocks } from 'clock-generator/light';
import type { BuildLane, CheckedLaneRow, CheckedLanes, CheckedLaneState, ClockInsight, Config, WhyNotStable } from 'clock-generator/browser';
import type { ClockAlternativeView } from '../worker/types';
import { formatNumberText } from './numberText';

/**
 * What the page shows of a clock's checked lanes (the engine's `checked_lanes`) and the build's lanes (`lanes`). Every
 * sentence about what was checked is the engine's: the line, each row's label and sentence, each part of the cause. The
 * page adds the headings, the column names and the cells it makes from a row's data.
 */
export const CHECKED_LANES_COPY = {
    madeFor: (copies: number) => `Made for ${formatNumberText(copies)} ${copies === 1 ? 'copy' : 'copies'} of your build.`,
    /** The control that opens the table, and the table's heading where it is open without one */
    whatWasChecked: 'What was checked',
    heading: 'Shared lanes',
    columns: {
        lane: 'Lane',
        role: 'Role',
        item: 'Item',
        end: 'End',
        together: (copies: number) => `The ${formatNumberText(copies)} copies together`,
        supply: 'Supply rate',
        state: 'State',
    },
    laneCapacity: 'lane capacity',
    endFromRole: 'assumed from its role',
    carries: (perSecond: number) => `carries ${rate(perSecond)}`,
    onLanes: (lanes: number[]) => `on lanes ${lanes.join(' and ')}`,
};

const rate = (perSecond: number) => `${formatNumberText(perSecond)} /s`;

/** "Belt 1, lane 1": the numbers are kept */
export const laneText = (row: Pick<CheckedLaneRow, 'belt_id' | 'lane'>) => `Belt ${row.belt_id}, lane ${row.lane}`;

const ROLE_TEXT: Record<NonNullable<BuildLane['role']>, string> = { input: 'Input', output: 'Output', buffer: 'Buffer' };
export const roleText = (lane: BuildLane | undefined) => lane?.role ? ROLE_TEXT[lane.role] : '—';

const END_TEXT: Record<BuildLane['end'], string> = { dead_end: 'Dead end', infinite: 'Infinite', unknown: 'Unknown' };
/** The lane's end, and whether its role gave it where the config states none */
export const endText = (lane: BuildLane | undefined) => lane === undefined ? { value: '—' }
    : { value: END_TEXT[lane.end], ...(lane.end_given_by === 'role' && { sub: CHECKED_LANES_COPY.endFromRole }) };

/** "take 120 /s" or "drop 240 /s", over both lanes where the figure is */
export function togetherText(row: CheckedLaneRow): { value: string; sub?: string } {
    if (row.together === null) return { value: '—' };
    const { kind, items_per_second, lanes } = row.together;
    return { value: `${kind} ${rate(items_per_second)}`, ...(lanes.length > 1 && { sub: CHECKED_LANES_COPY.onLanes(lanes) }) };
}

/** "120 /s" with "lane capacity" where the lane states none; for an output lane a dash and what the lane carries */
export function supplyText(row: CheckedLaneRow, lane: BuildLane | undefined): { value: string; sub?: string } {
    if (lane === undefined) return { value: '—' };
    if (lane.role === 'output') {
        return { value: '—', sub: CHECKED_LANES_COPY.carries(row.together?.carries_per_second ?? lane.capacity) };
    }
    return { value: rate(lane.supply_rate), ...(lane.supply_rate_by_default && { sub: CHECKED_LANES_COPY.laneCapacity }) };
}

/** The lane of the build a row is of */
export const laneOf = (lanes: readonly BuildLane[] | undefined, row: Pick<CheckedLaneRow, 'belt_id' | 'lane'>) =>
    lanes?.find(lane => lane.belt_id === row.belt_id && lane.lane === row.lane);

/** How a state is shown beside its label: the colour is never alone, the label says it */
export type StateTone = 'holds' | 'loss' | 'caution' | 'quiet';
export function stateTone(state: CheckedLaneState): StateTone {
    switch (state.kind) {
        case 'holds': return state.not_the_cause ? 'quiet' : 'holds';
        case 'short':
        case 'join_full': return 'loss';
        case 'takes_less':
        case 'rate_fits': return 'caution';
        case 'not_checked':
        case 'not_run': return 'quiet';
    }
}

/** A state in the heading's count */
function countWord(state: CheckedLaneState): string {
    switch (state.kind) {
        case 'holds': return state.not_the_cause ? 'not the cause' : 'hold';
        case 'short': return 'short';
        case 'join_full': return 'join full';
        case 'takes_less': return 'take less';
        case 'rate_fits': return 'by rate only';
        case 'not_checked': return 'not checked';
        case 'not_run': return 'not run with the copies';
    }
}

/** The heading's count: "3 lanes · all hold", "6 lanes · 4 hold · 2 by rate only", "3 lanes · 1 join full · 2 take less" */
export function lanesCountText(rows: readonly CheckedLaneRow[]): string {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(countWord(row.state), (counts.get(countWord(row.state)) ?? 0) + 1);
    const lanes = `${rows.length} ${rows.length === 1 ? 'lane' : 'lanes'}`;
    if (counts.size === 1) {
        const [word] = counts.keys();
        return `${lanes} · ${word === 'hold' ? (rows.length === 1 ? 'holds' : 'all hold') : word}`;
    }
    return [lanes, ...[...counts].map(([word, count]) => `${count} ${word}`)].join(' · ');
}

/** Whether a clock was made by an engine that gives the build's lanes, so that what it says of them is read from them */
export const givesLanes = (clock: Pick<ClockAlternativeView, 'assumptions'>) => clock.assumptions?.lanes !== undefined;

/**
 * The clocks of a generation with each cause's "what changes it" naming another clock of them that holds with all the
 * copies, as the engine's own result does (`withOtherClocks`): the page puts the clocks of a generation together itself.
 * `selectedIndex` is the clock the rule picks. A clock with no cause is the same object.
 */
export function withOtherClocksOf(alternatives: ClockAlternativeView[], selectedIndex: number): ClockAlternativeView[] {
    if (!alternatives.some(clock => clock.checkedLanes?.cause)) return alternatives;
    const shaped = alternatives.map(view => ({ id: view.id, label: view.label, verdict: view.verdict, checked_lanes: view.checkedLanes,
        result: { simulation_duration: { ticks: view.simulationDurationTicks } }, view }));
    const copies = alternatives[0]?.copies ?? 1;
    return withOtherClocks(shaped, selectedIndex, copies)
        .map(it => it.checked_lanes === it.view.checkedLanes ? it.view : { ...it.view, checkedLanes: it.checked_lanes as CheckedLanes });
}

/**
 * The clock's description as its help shows it: where the page shows the clock's cause, without the sentences the engine
 * gives on the same loss (`sharedLaneLossNote`, the exact text the description holds)
 */
export function descriptionShown(clock: Pick<ClockAlternativeView, 'description' | 'checkedLanes' | 'sharedLaneLossNote'>): string {
    const note = clock.sharedLaneLossNote;
    return clock.checkedLanes?.cause && note ? clock.description.replace(` ${note}`, '') : clock.description;
}

/** The insights of a clock without those a row of its checked lanes states: a lane not checked as the build drops onto it */
export function insightsShown(clock: Pick<ClockAlternativeView, 'insights' | 'checkedLanes'>): ClockInsight[] {
    const notChecked = new Set((clock.checkedLanes?.rows ?? []).filter(row => row.state.kind === 'not_checked')
        .map(row => `shared-lane-not-checked-${row.belt_id}-${row.lane}`));
    return notChecked.size === 0 ? clock.insights : clock.insights.filter(insight => !notChecked.has(insight.id));
}

/** Whether the note on why no clock is stable is of the recommended clock's loss on a shared lane, whose parts it then shows */
export const whyNotStableShowsCause = (why: Pick<WhyNotStable, 'cause'> | null | undefined, recommended: Pick<ClockAlternativeView, 'checkedLanes'> | undefined) =>
    (why?.cause === 'shared lane short' || why?.cause === 'join full') && Boolean(recommended?.checkedLanes?.cause);

/**
 * The first sentence of what a saved run assumed: "Made for 9 copies of your build." for a clock kept before the engine gave
 * the build's lanes (a clock that gives them says it in the card, with what was checked); no word of the belts either way
 */
export function madeForLead(saved: Pick<Config, 'setpoint'> | null, clock: Pick<ClockAlternativeView, 'assumptions'>): string {
    if (saved === null) return 'These results are for a saved build whose metadata is unavailable.';
    return givesLanes(clock) ? '' : CHECKED_LANES_COPY.madeFor(saved.setpoint.copies);
}
