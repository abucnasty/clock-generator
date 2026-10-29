import { Config } from "../../config";
import { OpenRange } from "../../data-types";
import { EntityId, EntityType } from "../../entities";
import { InserterStatus, MachineStatus } from "../../state";
import { Logger } from "../../common/logger";
import { CIRCUIT_LATENCY_TICKS } from "../../common/rule-constants";
import { AsBuiltRun } from "../trial";
import { BlueprintGenerationResult, GenerateClockOptions, TrialRun, checkedClock, clockOfPlan, planRun } from "../plan/plan-run";
import { Confirmed, QuickTrial, SearchRangeEdge, SearchReport, confirm, quickTrial, search } from "./search";
import { cycleOfWindow, withCycleShifted } from "./transforms";
import { transitionsOf } from "../sequence/compact-history";

/** Positions tried for a shifted crafting cycle, each a quick trial */
const MAX_SHIFTED_CYCLE_CANDIDATES = 48;

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
        const sorted = transitionsOf(run.serializable_state_transition_history, entity).sort((a, b) => a.tick - b.tick);
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
                if (entity.source?.entity_type === EntityType.BELT && entity.sink?.entity_type === EntityType.MACHINE) {
                    const item = run.serializable_transfer_history.entities.find(it => it.entity_id === window.entity_id)
                        ?.transfers.filter(it => it.end_tick > next.start).sort((a, b) => a.start_tick - b.start_tick)[0]?.item_name;
                    notes.add(`${entity.label} waits ${waited} ticks for ${entity.sink.label} to drop below its insertion limit`
                        + (item ? ` for ${item}` : ""));
                } else if (entity.source?.entity_type === EntityType.MACHINE) {
                    notes.add(`${entity.label} waits ${waited} ticks for ${entity.source.label} to have items`);
                }
            }
            if (segment.status === InserterStatus.PICKUP && next.status === InserterStatus.SWING && entity.source?.entity_type === EntityType.MACHINE) {
                notes.add(`${entity.label} waits ${waited} ticks at ${entity.source.label} for a full hand`);
            }
        });

        // a machine that only starts again while these swings are under way was waiting for them
        const fed_end = entity.sink?.entity_type === EntityType.MACHINE ? entity.sink : entity.source;
        if (fed_end === undefined || fed_end.entity_type !== EntityType.MACHINE) {
            continue;
        }
        const fed = fed_end.entity_id;
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
 * run earlier or later while the machines' buffers carry the difference. Every shift gets the quick trial; of those
 * that pass, one whose neighbours (in the same direction from the planned position) pass too is confirmed before one
 * whose do not, the smallest shift of those (see search.ts). The report carries the ends of the range that works
 * around the pick, with what limits them. Null when no shift passes.
 */
function shiftedCycleWindows(
    config: Config,
    planned_windows: Map<string, OpenRange[]>,
    /** The entity behind each key of the windows */
    entity_ids: ReadonlyMap<string, EntityId>,
    cycle_ticks: number,
    period: number,
    logger: Logger,
    report?: (detail: string) => void,
): { windows: Map<string, OpenRange[]>; search: SearchReport; verified: Confirmed } | null {
    const candidates = shiftedCycleCandidates(planned_windows, cycle_ticks, period);
    const describe = (candidate: ShiftedCycleCandidate) =>
        `cycle ${candidate.cycle_index + 1} ${Math.abs(candidate.shift_ticks)} ticks ${candidate.shift_ticks < 0 ? "earlier" : "later"}`;

    const { picked, pick, tried } = search<ShiftedCycleCandidate, QuickTrial & { result: TrialRun; run: AsBuiltRun }, Confirmed>({
        candidates,
        quick: (candidate, index) => {
            report?.(`Shift ${index + 1}/${candidates.length} (${describe(candidate)})`);
            return quickTrial(config, candidate.windows, period, logger);
        },
        // candidates are listed per cycle in shift order; the shifts around the planned position are not used and end a run
        neighbours: (a, b) => a.selectable && b.selectable && a.cycle_index === b.cycle_index && Math.sign(a.shift_ticks) === Math.sign(b.shift_ticks),
        eligible: candidate => candidate.selectable,
        tieBreak: (a, b) => Math.abs(a.candidate.shift_ticks) - Math.abs(b.candidate.shift_ticks),
        confirm: ({ candidate, quick }) => confirm(config, candidate.windows, period, logger, describe(candidate), report, quick.run),
    });
    logger.log(`Shifted crafting cycle: ${tried.filter(it => it.quick.holds).length} of ${candidates.length} shifts pass the quick trial`);
    if (picked === null || pick === null) {
        return null;
    }
    const { candidate, index } = pick;
    // the range that works runs through the planned position, so its ends ignore the direction split used for ranking
    const edgeOf = (direction: 1 | -1): SearchRangeEdge => {
        let edge = index;
        while (tried[edge + direction]?.quick.holds && candidates[edge + direction].cycle_index === candidate.cycle_index) {
            edge += direction;
        }
        const beyond = candidates[edge + direction];
        return {
            setting: candidates[edge].shift_ticks,
            is_search_limit: beyond === undefined || beyond.cycle_index !== candidate.cycle_index,
            notes: shiftEdgeNotes(tried[edge].quick.result, movedWindows(planned_windows, candidates[edge], cycle_ticks, period)),
        };
    };
    const planned = movedWindows(planned_windows, { ...candidate, shift_ticks: 0 }, cycle_ticks, period);
    return {
        windows: candidate.windows,
        verified: picked,
        search: {
            kind: "shifted cycle",
            candidates: tried.map(it => ({ row: it.candidate.cycle_index + 1, setting: it.candidate.shift_ticks, holds: it.quick.holds })),
            picked: { row: candidate.cycle_index + 1, setting: candidate.shift_ticks },
            planned_ticks: {
                start: Math.min(...planned.map(it => it.start)),
                end: Math.max(...planned.map(it => it.end)),
            },
            moved: Array.from(new Set(planned.map(it => it.entity_id)), key => ({ entity_id: entity_ids.get(key)!, item_names: [] })),
            earliest: edgeOf(-1),
            latest: edgeOf(1),
        },
    };
}

/**
 * The shifted swings candidate: the clock of the plan with one crafting cycle's windows moved together to another place
 * in the period (`shiftedCycleWindows`), checked and exported as a planned clock is. The planned windows are exported
 * when no shift passes.
 */
export function shiftedSwingsClock(config: Config, options: GenerateClockOptions = {}): BlueprintGenerationResult {
    const plan = planRun(config, options);
    const clock = clockOfPlan(plan, options);
    const shifted = shiftedCycleWindows(
        { ...config, overrides: { ...config.overrides, derive_clock_windows: false } },
        clock.windows, plan.entity_ids, plan.run.crafting_cycle_plan.total_duration.ticks, plan.run.duration.ticks, plan.logger, options.on_progress_detail,
    );
    const report = shifted === null ? undefined : {
        ...shifted.search,
        moved: shifted.search.moved!.map(it => ({ ...it, item_names: (plan.item_names.get(it.entity_id.id) ?? "").split(",").filter(Boolean) })),
    };
    return checkedClock(plan, clock, shifted?.windows ?? clock.windows, options,
        { search: report, verified: shifted === null ? undefined : { windows: shifted.windows, run: shifted.verified } });
}
