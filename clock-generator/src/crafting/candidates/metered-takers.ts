import { OpenRange } from "../../data-types";
import { Entity, EntityId, Inserter, Machine } from "../../entities";
import type { Config } from "../../config";
import { BlueprintGenerationResult, unclockedRun, type UnclockedRun } from "../plan/unclocked-run";
import { clockFromWindows } from "../trial";
import { marginFailureOf, marginReasonOf, marginText } from "./round-robin-polling";
import { withSecondaryPlanningProvenance } from "../round-robin-polling-primitive-policy";
import { targetItemOf, targetMachinesOf } from "../sequence/cycle/target-ends";
import { CodedError, reasonOf } from "../maker-log";
import type { Logger } from "../../common/logger";

/**
 * Metered takers: where one machine hands an ingredient to two or more of the machines that make the target, only those
 * takers are clocked. Each takes one hand in a window of `METERED_TAKERS_WINDOW_TICKS` ticks, its windows a hand's share of
 * the window cycle apart, and the takers of one source open in turn, a share of that apart. Every other inserter and drill
 * has one window of the whole cycle: it is always enabled, and the insertion limits and output blocks meter it.
 * The window cycle is the plan's at the smallest output swing count (on a recipe LCM of 1) where each taker moves whole
 * hands and whole crafts of its machine a cycle, so the hands of the target machines repeat every window cycle. A count
 * whose windows fail the as-built check or the margin check is refused, and the next count is tried.
 */
const MAX_SWINGS = 12;
/** The length of each taker's window, in ticks */
export const METERED_TAKERS_WINDOW_TICKS = 4;

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

/** The clock of the first output swing count whose windows hold, with their margin; a coded error where none does */
export function meteredTakersClock(config: Config, logger: Logger): BlueprintGenerationResult {
    const refused: string[] = [];
    let whole_counts = 0;
    let as_built_refusals = 0;
    let margin_refusals = 0;
    for (let swings = 1; swings <= MAX_SWINGS; swings++) {
        const planned_on: Config = { ...config, overrides: { ...config.overrides, derive_clock_windows: false, terminal_swing_count: swings, lcm: 1 } };
        const plan = unclockedRun(planned_on, { logger });
        const { takers, target_machines } = takersOf(plan);
        if (takers.length === 0) {
            throw new CodedError("no machine hands an ingredient to two or more of the machines that make the target",
                reasonOf("no_metered_takers", { target_machines }));
        }
        const hands = takers.map(taker => wholeHands(plan, taker));
        const T = plan.run.duration.ticks;
        if (!Number.isInteger(T) || hands.some(it => it === null || T % it !== 0)) continue;
        whole_counts++;
        const windows = new Map<string, OpenRange[]>();
        const registry = plan.run.simulation_context.entity_registry;
        for (const entity of registry.getAll()) {
            if (Entity.isInserter(entity) || Entity.isDrill(entity)) windows.set(entity.entity_id.id, [OpenRange.from(0, T - 1)]);
        }
        const sources = [...new Set(takers.map(it => it.source))];
        takers.forEach((taker, index) => {
            const of_source = takers.filter(it => it.source === taker.source);
            const k = of_source.indexOf(taker);
            const slot = T / hands[index]!;
            // the takers of one source a share of the slot apart; the sources spread evenly inside one share
            const offset = Math.round(k * slot / of_source.length + sources.indexOf(taker.source) * slot / (of_source.length * sources.length));
            windows.set(taker.inserter.entity_id.id, Array.from({ length: hands[index]! },
                (_, j) => OpenRange.from(offset + j * slot, offset + j * slot + METERED_TAKERS_WINDOW_TICKS - 1)));
        });
        const serial = Object.fromEntries([...windows].map(([id, ranges]) => [id, ranges.map(range => ({ start: range.start_inclusive, end: range.end_inclusive }))]));
        const result = clockFromWindows(planned_on, serial, T, logger);
        const count = `${swings} output swing${swings === 1 ? "" : "s"} (${T} ticks)`;
        if (!(result.stability_check.as_built?.holds ?? false)) {
            as_built_refusals++;
            refused.push(`${count}: the as-built check does not hold`);
            logger.log(`Metered takers on ${count}: refused, the as-built check does not hold`);
            continue;
        }
        const margin = marginFailureOf(plan, windows, T);
        if (margin !== null) {
            margin_refusals++;
            refused.push(`${count}: ${marginText(margin)}`);
            logger.log(`Metered takers on ${count}: refused, ${marginText(margin)} (${marginReasonOf(margin).check})`);
            continue;
        }
        // the checks after the maker plan the clock on its own count and LCM (verificationPlanningConfigOf), as they do the primitive one
        return withSecondaryPlanningProvenance(result);
    }
    throw new CodedError(`no metered takers clock holds${refused.length === 0 ? " (no output swing count gives whole hands and crafts)" : `: ${refused.join("; ")}`}`,
        reasonOf("no_count_holds", { swings_max: MAX_SWINGS, whole_counts, as_built_refusals, margin_refusals }));
}
