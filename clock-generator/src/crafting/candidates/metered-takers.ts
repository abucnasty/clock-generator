import { OpenRange } from "../../data-types";
import { Entity, EntityId, handSizeFor, Inserter, Machine } from "../../entities";
import { traitsOf, traitsOfMachine } from "../../entities/traits/traits-of";
import { fullHandOf } from "../../entities/traits/hand";
import type { Config } from "../../config";
import { BlueprintGenerationResult, unclockedRun, type UnclockedRun } from "../plan/unclocked-run";
import { clockFromWindows } from "../trial";
import { MARGIN_SHIFT_TICKS, marginFailureOf, marginReasonOf, marginText } from "./round-robin-polling";
import { withSecondaryPlanningProvenance } from "../round-robin-polling-primitive-policy";
import { targetItemOf, targetMachinesOf } from "../sequence/cycle/target-ends";
import { CodedError, reasonOf } from "../maker-log";
import type { Logger } from "../../common/logger";

/**
 * Metered takers: where one machine hands an ingredient to two or more of the machines that make the target, only those
 * takers are clocked. Each opens for a full pickup and the following swing entry, its enable windows a hand's share of
 * the window cycle apart, and the takers of one source open in turn, a share of that apart. Every other inserter and drill
 * has one enable window for the whole window cycle: it is always enabled, and the insertion limits and output blocks meter it.
 * The window cycle is the plan's at the smallest output swing count (on a recipe LCM of 1) where each taker moves whole
 * hands and whole crafts of its machine per window cycle, so the hands of the target machines repeat every window cycle. A count
 * whose enable windows fail the as-built check or the margin check is refused, and the next count is tried.
 */
const MAX_SWINGS = 12;

interface Taker { inserter: Inserter; source: string; sink: Machine; item: string }

/** The inserters that take from a machine into a machine that makes the target, where that source has two or more of them */
function takersOf(plan: UnclockedRun): { takers: Taker[]; target_machines: number } {
    const registry = plan.run.simulation_context.entity_registry;
    const target = targetItemOf(plan.config.setpoint);
    const sinks = new Set(targetMachinesOf(target, registry).map(machine => machine.entity_id.id));
    const candidates = registry.getAll().filter(Entity.isInserter)
        .filter(inserter => EntityId.isMachine(inserter.source.entity_id) && sinks.has(inserter.sink.entity_id.id))
        .map(inserter => {
            const transfer = plan.run.swing_counts.get(inserter.entity_id);
            const item = transfer?.item_transfers[0]?.item_name;
            return item === undefined ? null : { inserter, source: inserter.source.entity_id.id, sink: registry.getEntityByIdOrThrow(inserter.sink.entity_id) as Machine, item };
        })
        .filter((it): it is Taker => it !== null);
    const per_source = new Map<string, number>();
    for (const taker of candidates) per_source.set(taker.source, (per_source.get(taker.source) ?? 0) + 1);
    const takers = candidates.filter(taker => per_source.get(taker.source)! >= 2)
        .sort((a, b) => a.source.localeCompare(b.source) || a.inserter.entity_id.number - b.inserter.entity_id.number);
    return { takers, target_machines: sinks.size };
}

/** The hands a taker moves a window cycle, where they are whole and make whole crafts of its machine; else null */
function wholeHands(plan: UnclockedRun, taker: Taker): number | null {
    const transfer = plan.run.swing_counts.get(taker.inserter.entity_id)!;
    const count = transfer.total_transfer_count;
    if (count.getDenominator !== 1) return null;
    const hands = count.getNumerator;
    const per_craft = taker.sink.inputs.get(taker.item)?.consumption_rate.amount_per_craft;
    if (per_craft === undefined || (hands * transfer.stack_size) % per_craft !== 0) return null;
    return hands;
}

function unproved(taker: Taker, cause: string, why: string): CodedError {
    const inserter = taker.inserter.entity_id.number;
    return new CodedError(`cannot bound the enable windows of inserter ${inserter}: ${why}`,
        reasonOf("metered_window_unproved", { inserter, cause }));
}

/** The direct machine ports must move the planned item and whole hand under the taker's own enable window. */
function checkRoutes(plan: UnclockedRun, takers: Taker[]): void {
    const entities = plan.run.simulation_context.entity_registry.getAll();
    const arms = entities.filter(Entity.isInserter);
    const drills = entities.filter(Entity.isDrill);
    const traits = traitsOf(plan.config);
    const metered = new Set(takers.map(taker => taker.inserter));
    for (const taker of takers) {
        const { inserter, item } = taker;
        const id = inserter.entity_id.id;
        if (plan.run.always_enabled_by_config.has(id) || plan.run.inserter_clocks.has(id)) {
            throw unproved(taker, "control", "the taker does not use the metered enable window");
        }
        const hand = handSizeFor(inserter, item);
        const transfer = plan.run.swing_counts.get(inserter.entity_id)!;
        if (inserter.filtered_items.size !== 1 || !inserter.filtered_items.has(item) || !fullHandOf(inserter.metadata.type).elsewhere
            || !Number.isSafeInteger(hand) || hand < 1 || hand !== transfer.stack_size) {
            throw unproved(taker, "hand", "the direct route must wait for a whole hand of one planned item");
        }
        const drill = drills.find(other => other.sink_id.id === taker.sink.entity_id.id && other.item.name === item);
        if (drill !== undefined) {
            throw unproved(taker, "shared_route", `drill ${drill.entity_id.number} also supplies ${item} to the target`);
        }
        const placement = traitsOfMachine(traits, taker.source).placement;
        if (placement?.target != null && placement.per_result.some(result => result.item === item && result.lands_in !== null)) {
            throw unproved(taker, "shared_route", `the source also places ${item} into ${placement.target}`);
        }
        for (const arm of arms) {
            if (arm === inserter || !arm.filtered_items.has(item)) continue;
            if (arm.source.entity_id.id === taker.source && !metered.has(arm)) {
                throw unproved(taker, "shared_route", `inserter ${arm.entity_id.number} also takes ${item} from the source outside the metered turns`);
            }
            if (arm.sink.entity_id.id === taker.sink.entity_id.id) {
                throw unproved(taker, "shared_route", `inserter ${arm.entity_id.number} also supplies ${item} to the target`);
            }
        }
    }
}

/** One ready pickup step fills the hand. The next update enters the outbound swing. */
function meteredEnableWindows(plan: UnclockedRun, takers: Taker[], hands: number[], window_cycle_ticks: number): Map<string, OpenRange[]> | CodedError {
    const enable_windows = new Map<string, OpenRange[]>();
    for (const entity of plan.run.simulation_context.entity_registry.getAll()) {
        if (Entity.isInserter(entity) || Entity.isDrill(entity)) enable_windows.set(entity.entity_id.id, [OpenRange.from(0, window_cycle_ticks - 1)]);
    }
    const sources = [...new Set(takers.map(it => it.source))];
    for (const [source_index, source] of sources.entries()) {
        const of_source = takers.filter(it => it.source === source);
        const turns: { taker: Taker; range: OpenRange }[] = [];
        for (const [k, taker] of of_source.entries()) {
            const rotation = taker.inserter.animation.rotation.ticks;
            if (!Number.isSafeInteger(rotation) || rotation < 1) return unproved(taker, "rotation", "the swing needs a known positive whole number of ticks");
            const count = hands[takers.indexOf(taker)];
            const slot = window_cycle_ticks / count;
            const swing_entry = 1; // relative to the full pickup
            const width = swing_entry + 1; // inclusive of swing entry
            const drop = swing_entry + rotation;
            const first_return = drop + 1 + rotation; // whole drop, then return swing entry, then the pickup test
            if (width > first_return || slot < width - 1 + first_return) {
                return unproved(taker, "return", `a ${width}-tick enable window every ${slot} ticks leaves too little time for the ${first_return}-tick return`);
            }
            // The existing turn placement: a source's takers divide the slot, then the sources divide a turn.
            const offset = Math.round(k * slot / of_source.length + source_index * slot / (of_source.length * sources.length));
            const ranges = Array.from({ length: count }, (_, j) => OpenRange.fromStartAndDuration(offset + j * slot, width));
            if (ranges[count - 1].end_inclusive >= window_cycle_ticks) return unproved(taker, "cycle_edge", "the enable window crosses the end of the window cycle");
            enable_windows.set(taker.inserter.entity_id.id, ranges);
            turns.push(...ranges.map(range => ({ taker, range })));
        }
        // Only one group is shifted at a time. Check the actual turn order, including last to first.
        turns.sort((a, b) => a.range.start_inclusive - b.range.start_inclusive);
        for (const [index, { taker, range }] of turns.entries()) {
            const next = turns[(index + 1) % turns.length];
            const next_start = next.range.start_inclusive + (index + 1 === turns.length ? window_cycle_ticks : 0);
            const shift = taker === next.taker ? 0 : MARGIN_SHIFT_TICKS;
            if (range.end_inclusive >= next_start - shift) return unproved(taker, "overlap", `the enable window ending at ${range.end_inclusive} overlaps inserter ${next.taker.inserter.entity_id.number} opening at ${next_start} with the margin`);
        }
    }
    return enable_windows;
}

/** The clock of the first output swing count whose enable windows hold, with their margin; a coded error where none does */
export function meteredTakersClock(configuration: Config, logger: Logger): BlueprintGenerationResult {
    const refused: string[] = [];
    let whole_counts = 0;
    let as_built_refusals = 0;
    let margin_refusals = 0;
    let first_unproved: CodedError | undefined;
    const forced = configuration.overrides?.terminal_swing_count;
    const lcm = configuration.overrides?.lcm ?? 1;
    if (lcm !== 1 || (forced !== undefined && (!Number.isInteger(forced) || forced < 1 || forced > MAX_SWINGS))) {
        throw new CodedError(`metered takers cannot use the requested output swing count ${forced ?? "AUTO"} and recipe LCM ${lcm}`,
            reasonOf("metered_plan_override", { terminal_swing_count: forced ?? null, lcm }));
    }
    const last = forced ?? MAX_SWINGS;
    for (let swings = forced ?? 1; swings <= last; swings++) {
        const planned_on: Config = { ...configuration, overrides: { ...configuration.overrides, derive_clock_windows: false, terminal_swing_count: swings, lcm: 1 } };
        const plan = unclockedRun(planned_on, { logger });
        const { takers, target_machines } = takersOf(plan);
        if (takers.length === 0) {
            throw new CodedError("no machine hands an ingredient to two or more of the machines that make the target",
                reasonOf("no_metered_takers", { target_machines }));
        }
        checkRoutes(plan, takers);
        const hands = takers.map(taker => wholeHands(plan, taker));
        const window_cycle_ticks = plan.run.duration.ticks;
        if (!Number.isSafeInteger(window_cycle_ticks) || !hands.every((count): count is number => count !== null && count > 0 && window_cycle_ticks % count === 0)) continue;
        whole_counts++;
        const enable_windows = meteredEnableWindows(plan, takers, hands, window_cycle_ticks);
        if (enable_windows instanceof CodedError) {
            first_unproved ??= enable_windows;
            refused.push(`${swings} output swings (${window_cycle_ticks} ticks): ${enable_windows.message}`);
            continue;
        }
        const serial = Object.fromEntries([...enable_windows].map(([id, ranges]) => [id, ranges.map(range => ({ start: range.start_inclusive, end: range.end_inclusive }))]));
        const result = clockFromWindows(planned_on, serial, window_cycle_ticks, logger);
        const count = `${swings} output swing${swings === 1 ? "" : "s"} (${window_cycle_ticks} ticks)`;
        if (!(result.stability_check.as_built?.holds ?? false)) {
            as_built_refusals++;
            refused.push(`${count}: the as-built check does not hold`);
            logger.log(`Metered takers on ${count}: refused, the as-built check does not hold`);
            continue;
        }
        const margin = marginFailureOf(plan, enable_windows, window_cycle_ticks);
        if (margin !== null) {
            margin_refusals++;
            refused.push(`${count}: ${marginText(margin)}`);
            logger.log(`Metered takers on ${count}: refused, ${marginText(margin)} (${marginReasonOf(margin).check})`);
            continue;
        }
        // the checks after the maker plan the clock on its own count and LCM (verificationPlanningConfigOf), as they do the primitive one
        return { ...withSecondaryPlanningProvenance(result), metered_takers: takers.map(taker => taker.inserter.entity_id.id) };
    }
    if (first_unproved !== undefined && as_built_refusals + margin_refusals === 0) throw first_unproved;
    const request = forced === undefined ? "" : ` at ${forced} output swing${forced === 1 ? "" : "s"}`;
    throw new CodedError(`no metered takers clock holds${request}${refused.length === 0 ? " (no output swing count gives whole hands and crafts)" : `: ${refused.join("; ")}`}`,
        reasonOf("no_count_holds", { swings_max: last, whole_counts, as_built_refusals, margin_refusals }));
}
