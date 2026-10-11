import { Config } from "../../config";
import { OpenRange } from "../../data-types";
import { InserterStatus, MachineStatus } from "../../state";
import { Logger } from "../../common/logger";
import { CIRCUIT_LATENCY_TICKS } from "../clock";
import { TrialRun } from "../plan/plan-run";
import { AS_BUILT_START_PHASES, AsBuiltStabilityCheck, FULL_CHECK_START_PHASES, runAsBuiltCheck } from "../trial";
import { search } from "./search";
import { cycleOfWindow, withCycleShifted } from "./transforms";

/** One place tried for a moved crafting cycle or output swing, in ticks from its planned start (negative is earlier) */
export interface CheckedShift {
    shift_ticks: number;
    /** Passed the quick clock-only check (a dozen clock start phases); only the shift that is used is confirmed from more */
    holds: boolean;
}

/** Every place tried for one crafting cycle or output swing (1-based `index`), in shift order */
export interface CheckedShiftRow {
    index: number;
    shifts: CheckedShift[];
}

/** One end of the unbroken range of shifts that work around the shift in use */
export interface ShiftRangeEdge {
    shift_ticks: number;
    /** No place further out was tried: the moved windows would meet the same inserters' other windows or the end of the period */
    is_search_limit: boolean;
    /** What the inserters and machines are waiting on at this shift, the limits that stop the swings from going further */
    notes: string[];
}

/** The planned swings moved together by the shifted swings candidate */
export interface ShiftedSwings {
    /** 1-based crafting cycle within the clock period whose windows were moved */
    cycle: number;
    /** Ticks the windows were moved by (negative is earlier) */
    shift_ticks: number;
    /** Clock ticks the moved windows were planned in */
    planned_ticks: { start: number; end: number };
    /** Inserters and drills with a moved window, and the items they move */
    moved: { entity_id: string; item_names: string[] }[];
    shifts_checked: CheckedShiftRow[];
    /** Ends of the range that works around shift_ticks, for the moved cycle */
    earliest: ShiftRangeEdge;
    latest: ShiftRangeEdge;
}

/** Groups checked shifts by the cycle or swing they moved, keeping their order */
export function checkedShiftRows(checked: { index: number; shift_ticks: number; holds: boolean }[]): CheckedShiftRow[] {
    const rows = new Map<number, CheckedShift[]>();
    for (const { index, shift_ticks, holds } of checked) {
        rows.set(index, [...(rows.get(index) ?? []), { shift_ticks, holds }]);
    }
    return Array.from(rows, ([index, shifts]) => ({ index, shifts }));
}

/** Positions tried for a shifted crafting cycle; each costs up to a dozen clock-only simulations */
const MAX_SHIFTED_CYCLE_CANDIDATES = 48;

/** Best-ranked shifts confirmed from many start phases before giving up */
const MAX_SHIFTED_CYCLE_CONFIRMATIONS = 3;

/** Smallest shift tried, as a fraction of the crafting cycle; anything closer to the plan is barely a different clock */
const MIN_SHIFTED_CYCLE_FRACTION = 1 / 8;


interface ShiftedCycleCandidate {
    /** 0-based crafting cycle within the clock period */
    cycle_index: number;
    shift_ticks: number;
    /** False for the planned position and shifts next to it: checked to show the whole range, never used */
    selectable: boolean;
    windows: Map<string, OpenRange[]>;
}

/**
 * The planned windows with one crafting cycle's windows (every inserter's and drill's) moved together, keeping their
 * lengths and spacing. A window belongs to the cycle it starts in. The first cycle stays put as the reference, and a
 * moved window never touches the same entity's windows of another cycle or wraps the end of the period.
 * Only shifts at least an eighth of a cycle away from the planned position can be used; a cycle with none is left out.
 */
function shiftedCycleCandidates(
    planned_windows: Map<string, OpenRange[]>,
    cycle_ticks: number,
    period: number,
): ShiftedCycleCandidate[] {
    const cycles = Math.round(period / cycle_ticks);
    if (!Number.isInteger(period) || cycles < 2) {
        return [];
    }
    const cycleOf = (range: OpenRange) => cycleOfWindow(range, cycle_ticks, cycles);

    const room: { cycle_index: number; min: number; max: number }[] = [];
    for (let cycle_index = 1; cycle_index < cycles; cycle_index++) {
        let min = -Infinity;
        let max = Infinity;
        for (const ranges of planned_windows.values()) {
            const moved = ranges.filter(range => cycleOf(range) === cycle_index);
            if (moved.length === 0) {
                continue;
            }
            const fixed = ranges.filter(range => cycleOf(range) !== cycle_index);
            const first = Math.min(...moved.map(range => range.start_inclusive));
            const last = Math.max(...moved.map(range => range.end_inclusive));
            const before = Math.max(-2, ...fixed.filter(range => range.end_inclusive < first).map(range => range.end_inclusive));
            const after = Math.min(period + 1, ...fixed.filter(range => range.start_inclusive > last).map(range => range.start_inclusive));
            min = Math.max(min, before + 2 - first);
            max = Math.min(max, after - 2 - last);
        }
        if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
            room.push({ cycle_index, min, max });
        }
    }
    const span = room.reduce((sum, it) => sum + it.max - it.min, 0);
    const step = Math.max(1, Math.ceil(span / MAX_SHIFTED_CYCLE_CANDIDATES));

    const candidates: ShiftedCycleCandidate[] = [];
    for (const { cycle_index, min, max } of room) {
        const of_cycle: ShiftedCycleCandidate[] = [];
        for (let shift_ticks = Math.ceil(min / step) * step; shift_ticks <= max; shift_ticks += step) {
            of_cycle.push({
                cycle_index,
                shift_ticks,
                selectable: Math.abs(shift_ticks) >= cycle_ticks * MIN_SHIFTED_CYCLE_FRACTION,
                windows: withCycleShifted(planned_windows, cycle_index, shift_ticks, cycle_ticks, period),
            });
        }
        if (of_cycle.some(it => it.selectable)) {
            candidates.push(...of_cycle);
        }
    }
    return candidates;
}

/** The windows a candidate moves, at the candidate's shift */
function movedWindows(
    planned_windows: Map<string, OpenRange[]>,
    candidate: { cycle_index: number; shift_ticks: number },
    cycle_ticks: number,
    period: number,
): { entity_id: string; start: number; end: number }[] {
    const cycles = Math.round(period / cycle_ticks);
    const moved: { entity_id: string; start: number; end: number }[] = [];
    for (const [entity_id, ranges] of planned_windows) {
        for (const range of ranges) {
            if (cycleOfWindow(range, cycle_ticks, cycles) === candidate.cycle_index) {
                moved.push({ entity_id, start: range.start_inclusive + candidate.shift_ticks, end: range.end_inclusive + candidate.shift_ticks });
            }
        }
    }
    return moved;
}

/** Waits shorter than this are the normal tick or two between an inserter being enabled and moving */
const MIN_SHIFT_EDGE_WAIT_TICKS = 3;

/**
 * What limits a clock-only run at the edge of the range of shifts that work, read from what the moved inserters and
 * the machines they feed were waiting on: an inserter enabled but idle at a belt is waiting for its machine to drop
 * below an insertion limit, one waiting at a machine is waiting for a full hand, and a machine that stops until
 * the moved swings arrive has run out of ingredients.
 */
function shiftEdgeNotes(
    run: TrialRun,
    moved: { entity_id: string; start: number; end: number }[],
): string[] {
    const entities = new Map(run.serializable_state_transition_history.entities.map(entity => [entity.entity_id, entity]));
    const segmentsOf = (entity_id: string) => {
        const entity = entities.get(entity_id);
        if (entity === undefined) {
            return [];
        }
        const sorted = [...entity.transitions].sort((a, b) => a.tick - b.tick);
        const first_tick = sorted[0]?.tick ?? run.serializable_state_transition_history.total_duration_ticks;
        return [
            { status: entity.initial_status, start: 0, end: first_tick },
            ...sorted.map(it => ({ status: it.to_status, start: it.tick, end: it.tick + it.duration_ticks })),
        ];
    };
    // ticks an inserter is enabled for a decider window
    const enabledSpan = (window: { start: number; end: number }) => ({
        start: window.start + CIRCUIT_LATENCY_TICKS,
        end: window.end + CIRCUIT_LATENCY_TICKS + 1,
    });

    const notes = new Set<string>();
    for (const window of moved) {
        const entity = entities.get(window.entity_id);
        if (entity === undefined || entity.entity_type !== "inserter") {
            continue;
        }
        const span = enabledSpan(window);
        const segments = segmentsOf(window.entity_id);
        segments.forEach((segment, index) => {
            const waited = Math.min(segment.end, span.end) - Math.max(segment.start, span.start);
            const next = segments[index + 1];
            if (waited < MIN_SHIFT_EDGE_WAIT_TICKS || next === undefined || next.start >= span.end) {
                return;
            }
            if (segment.status === InserterStatus.IDLE && next.status === InserterStatus.PICKUP) {
                if (entity.source?.entity_id.startsWith("belt:") && entity.sink?.entity_id.startsWith("machine:")) {
                    const item = run.serializable_transfer_history.entities.find(it => it.entity_id === window.entity_id)
                        ?.transfers.filter(it => it.end_tick > next.start).sort((a, b) => a.start_tick - b.start_tick)[0]?.item_name;
                    notes.add(`${entity.label} waits ${waited} ticks for ${entity.sink.label} to drop below its insertion limit`
                        + (item ? ` for ${item}` : ""));
                } else if (entity.source?.entity_id.startsWith("machine:")) {
                    notes.add(`${entity.label} waits ${waited} ticks for ${entity.source.label} to have items`);
                }
            }
            if (segment.status === InserterStatus.PICKUP && next.status === InserterStatus.SWING && entity.source?.entity_id.startsWith("machine:")) {
                notes.add(`${entity.label} waits ${waited} ticks at ${entity.source.label} for a full hand`);
            }
        });

        // a machine that only starts again while these swings are under way was waiting for them
        const fed = entity.sink?.entity_id.startsWith("machine:") ? entity.sink.entity_id : entity.source?.entity_id;
        if (fed === undefined || !fed.startsWith("machine:")) {
            continue;
        }
        const isStopped = (status: string) => status === MachineStatus.INGREDIENT_SHORTAGE || status === MachineStatus.OUTPUT_FULL;
        // a machine out of ingredients shows full output until its output drops under the output block: one stop
        const stops = segmentsOf(fed).reduce<{ status: string; start: number; end: number }[]>((merged, segment) => {
            const last = merged[merged.length - 1];
            if (last !== undefined && isStopped(last.status) && isStopped(segment.status) && last.end === segment.start) {
                merged[merged.length - 1] = { status: segment.status, start: last.start, end: segment.end };
            } else {
                merged.push(segment);
            }
            return merged;
        }, []);
        for (const segment of stops) {
            const stopped = isStopped(segment.status);
            if (stopped && segment.end > span.start && segment.end <= span.end + MIN_SHIFT_EDGE_WAIT_TICKS && segment.end - segment.start >= MIN_SHIFT_EDGE_WAIT_TICKS) {
                const label = entities.get(fed)?.label ?? fed;
                notes.add(segment.status === MachineStatus.INGREDIENT_SHORTAGE
                    ? `${label} is out of ingredients for ${segment.end - segment.start} ticks until these swings arrive`
                    : `${label} stops for ${segment.end - segment.start} ticks until these swings arrive, out of ingredients with its output waiting to be removed`);
            }
        }
    }
    return Array.from(notes);
}

/**
 * Finds a place for one crafting cycle's planned windows other than where the plan put them. The plan repeats the
 * same cycle evenly over the clock period, but the build only has to balance over the whole period, so a cycle can
 * run earlier or later while the machines' buffers carry the difference. Every shift is checked with the quick
 * clock-only check; of those that pass, the one with the most passing shifts on either side (in the same direction
 * from the planned position) is confirmed from many start phases and used, the next best after it when that fails,
 * up to three. Null when no shift passes.
 */
export function shiftedCycleWindows(
    config: Config,
    planned_windows: Map<string, OpenRange[]>,
    cycle_ticks: number,
    period: number,
    logger: Logger,
    report?: (detail: string) => void,
): { windows: Map<string, OpenRange[]>; swings: ShiftedSwings } | null {
    const candidates = shiftedCycleCandidates(planned_windows, cycle_ticks, period);
    const describe = (candidate: ShiftedCycleCandidate) =>
        `cycle ${candidate.cycle_index + 1} ${Math.abs(candidate.shift_ticks)} ticks ${candidate.shift_ticks < 0 ? "earlier" : "later"}`;
    // candidates are listed per cycle in shift order; the shifts around the planned position are not used and end a run
    const sameRun = (a: ShiftedCycleCandidate, b: ShiftedCycleCandidate) =>
        a.selectable && b.selectable && a.cycle_index === b.cycle_index && Math.sign(a.shift_ticks) === Math.sign(b.shift_ticks);

    const { picked } = search<ShiftedCycleCandidate, { result: TrialRun; check: AsBuiltStabilityCheck }, { windows: Map<string, OpenRange[]>; swings: ShiftedSwings }>({
        candidates,
        quick: (candidate, index) => runAsBuiltCheck(config, candidate.windows, period, logger, AS_BUILT_START_PHASES,
            (n, total) => report?.(`Shift ${index + 1}/${candidates.length} (${describe(candidate)}), clock start ${n}/${total}`)),
        // once every shift is tried: the most passing shifts on either side first, then the smallest shift; three at most
        picks: (attempts, done) => {
            if (!done) {
                return [];
            }
            const passes = new Set(attempts.filter(it => it.quick.check.holds).map(it => it.index));
            logger.log(`Shifted crafting cycle: ${passes.size} of ${candidates.length} shifts pass the quick clock-only check: `
                + Array.from(passes, index => `${candidates[index].cycle_index + 1}:${candidates[index].shift_ticks}`).join(" "));
            const neighboursPassing = (index: number, direction: 1 | -1) => {
                let run = 0;
                for (let next = index + direction; passes.has(next) && sameRun(candidates[next], candidates[index]); next += direction) {
                    run++;
                }
                return run;
            };
            const margin = (index: number) => Math.min(neighboursPassing(index, 1), neighboursPassing(index, -1));
            return Array.from(passes).filter(index => candidates[index].selectable).sort((a, b) => margin(b) - margin(a)
                || Math.abs(candidates[a].shift_ticks) - Math.abs(candidates[b].shift_ticks)).slice(0, MAX_SHIFTED_CYCLE_CONFIRMATIONS);
        },
        confirm: ({ candidate, index }, tried) => {
            const full = runAsBuiltCheck(config, candidate.windows, period, logger, FULL_CHECK_START_PHASES,
                (n, total) => report?.(`Confirming ${describe(candidate)}, clock start ${n}/${total}`)).check;
            logger.log(`Shifted crafting cycle: ${describe(candidate)} full check -> stable=${full.holds}`);
            if (!full.holds) {
                return null;
            }
            const passes = new Set(tried.filter(it => it.quick.check.holds).map(it => it.index));
            // the range that works runs through the planned position, so its ends ignore the direction split used for ranking
            const edgeOf = (direction: 1 | -1): ShiftRangeEdge => {
                let edge = index;
                while (passes.has(edge + direction) && candidates[edge + direction].cycle_index === candidate.cycle_index) {
                    edge += direction;
                }
                const beyond = candidates[edge + direction];
                return {
                    shift_ticks: candidates[edge].shift_ticks,
                    is_search_limit: beyond === undefined || beyond.cycle_index !== candidate.cycle_index,
                    notes: shiftEdgeNotes(tried[edge].quick.result, movedWindows(planned_windows, candidates[edge], cycle_ticks, period)),
                };
            };
            const planned = movedWindows(planned_windows, { ...candidate, shift_ticks: 0 }, cycle_ticks, period);
            return {
                windows: candidate.windows,
                swings: {
                    cycle: candidate.cycle_index + 1,
                    shift_ticks: candidate.shift_ticks,
                    planned_ticks: {
                        start: Math.min(...planned.map(it => it.start)),
                        end: Math.max(...planned.map(it => it.end)),
                    },
                    moved: Array.from(new Set(planned.map(it => it.entity_id)), entity_id => ({ entity_id, item_names: [] })),
                    shifts_checked: checkedShiftRows(candidates.map((it, i) =>
                        ({ index: it.cycle_index + 1, shift_ticks: it.shift_ticks, holds: passes.has(i) }))),
                    earliest: edgeOf(-1),
                    latest: edgeOf(1),
                },
            };
        },
    });
    return picked;
}
