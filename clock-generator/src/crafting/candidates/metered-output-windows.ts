import { CIRCUIT_LATENCY_TICKS } from "../../common/rule-constants";
import { OpenRange } from "../../data-types";
import { Entity, EntityId, handSizeFor } from "../../entities";
import { fullHandOf } from "../../entities/traits/hand";
import type { SerializableClockWindows } from "../clock";
import type { UnclockedRun } from "../plan/unclocked-run";
import type { AsBuiltRun } from "../trial";
import { MARGIN_SHIFT_TICKS } from "./round-robin-polling";

type Range = { start: number; end: number };
type Unproved = "unsupported_route" | "no_stock_witness" | "service_not_balanced" | "no_idle_gap" | "joint_check_failed";
export type OutputWindowDecision = { kind: "already_bounded" } | { kind: "retained"; reason: Unproved }
    | { kind: "bounded"; service_ticks: number; observed_ticks: number; items_taken: number };

/** Keep all observed service in one circular window. A full hand needs the following update to enter its swing;
 * each end stays open for the same one-tick shift the joint margin check exercises. */
export function outputServiceWindow(takes: ReadonlySet<number>, full: ReadonlySet<number>, service_ticks: number, period: number): Range[] | null {
    if (!takes.size) return null;
    const required = new Set<number>();
    for (const tick of takes) {
        const last = full.has(tick) ? 1 : 0;
        for (let offset = -MARGIN_SHIFT_TICKS; offset <= last + MARGIN_SHIFT_TICKS; offset++) {
            required.add((tick + offset + service_ticks) % service_ticks);
        }
    }
    const positions = [...required].sort((a, b) => a - b);
    let gap = 0;
    let start = 0;
    for (const [i, position] of positions.entries()) {
        const next = positions[(i + 1) % positions.length];
        const closed = (next - position - 1 + service_ticks) % service_ticks;
        if (closed > gap) {
            gap = closed;
            start = next;
        }
    }
    if (!gap) return null;
    const end = start + service_ticks - gap - 1;
    const ranges: Range[] = [];
    for (let base = 0; base < period; base += service_ticks) {
        if (end >= service_ticks) ranges.push({ start: base, end: base + end - service_ticks });
        ranges.push({ start: base + start, end: base + Math.min(end, service_ticks - 1) });
    }
    return ranges;
}

/** Propose changes only on target output routes downstream of chosen metered turns. The stock was recorded on
 * the composed clock with its real inputs, insertion limits, discrete production and local belt drops. Each
 * positive withdrawal can free output space before ingredient admission; include even the start of a partial hand.
 * This projects observed service. Only joint verification decides whether the changed clock can use it. */
export function meteredOutputWindows(plan: UnclockedRun, windows: SerializableClockWindows, takers: ReadonlySet<string>, run: Pick<AsBuiltRun, "stock" | "check">) {
    const changes: SerializableClockWindows = {};
    const decisions: Record<string, OutputWindowDecision> = {};
    const period = plan.run.duration.ticks;
    const arms = plan.run.simulation_context.entity_registry.getAll().filter(Entity.isInserter);
    const feeds = arms.filter(arm => takers.has(arm.entity_id.id));
    const item = plan.config.setpoint.item;
    const { stock, check } = run;
    for (const arm of arms) {
        const id = arm.entity_id.id;
        const feeding = feeds.filter(feed => feed.sink.entity_id.id === arm.source.entity_id.id);
        if (!feeding.length || !plan.run.output_inserter_ids.has(id)) continue;
        const retain = (reason: Unproved) => { decisions[id] = { kind: "retained", reason }; };
        const transfer = plan.run.swing_counts.get(arm.entity_id);
        const ranges = windows[id];
        if (feeding.length !== 1 || !EntityId.isBelt(arm.sink.entity_id) || !EntityId.isMachine(arm.source.entity_id)
            || !fullHandOf(arm.metadata.type).elsewhere || !transfer || transfer.item_transfers.length !== 1
            || transfer.item_transfers[0].item_name !== item || !ranges?.length
            || handSizeFor(arm, item) !== transfer.stack_size
            || plan.run.always_enabled_by_config.has(id) || plan.run.inserter_clocks.has(id)) {
            retain("unsupported_route");
            continue;
        }
        if (ranges.some(range => range.start < 0 || range.end >= period || range.start > range.end
            || !Number.isInteger(range.start) || !Number.isInteger(range.end))) {
            retain("unsupported_route");
            continue;
        }
        const union = OpenRange.reduceRanges(ranges.map(range => OpenRange.from(range.start, range.end)));
        if (union.length !== 1 || union[0].start_inclusive !== 0 || union[0].end_inclusive !== period - 1) {
            decisions[id] = { kind: "already_bounded" };
            continue;
        }

        const hand = transfer.stack_size;
        const turns = windows[feeding[0].entity_id.id] ?? [];
        const service = period / turns.length;
        if (!Number.isSafeInteger(service) || !turns.every((turn, i) => turn.start === turns[0].start + i * service)) {
            retain("unsupported_route");
            continue;
        }
        const held = stock?.inserters.find(series => series.inserter_id === id)?.held;
        const source = stock?.machines.find(series => series.machine_id === arm.source.entity_id.id)?.outputs[item];
        const from = check.first_judged_tick, origin = check.clock_tick_at_first_judged, cycles = check.long_run_cycle_window_cycles;
        if (!check.long_run_proven || !held || !source || from === undefined || origin === undefined || !cycles
            || from + cycles * period > held.length || from + cycles * period > source.length) {
            retain("no_stock_witness");
            continue;
        }
        const end = from + cycles * period;
        const takes = new Set<number>(), full = new Set<number>();
        let picked = 0;
        let dropped = 0;
        let source_ready = true;
        for (let i = from; i < end; i++) {
            const previous = i === from ? end - 1 : i - 1;
            const change = held[i] - held[previous];
            if (change > 0) {
                // The sample follows this update. Its zero-based position on the raw command precedes circuit latency.
                const position = (origin + i - from + 1 - CIRCUIT_LATENCY_TICKS + service) % service;
                takes.add(position);
                if (held[i] === hand) full.add(position);
                picked += change;
                if (change > source[previous]) source_ready = false;
            } else dropped -= change;
        }
        const quota = transfer.total_transfer_count.multiply(hand * cycles);
        if (!source_ready || quota.getDenominator !== 1 || picked !== quota.getNumerator || dropped !== picked || !full.size) {
            retain("service_not_balanced");
            continue;
        }
        const proposal = outputServiceWindow(takes, full, service, period);
        if (!proposal) {
            retain("no_idle_gap");
            continue;
        }
        decisions[id] = { kind: "bounded", service_ticks: service, observed_ticks: end - from, items_taken: picked };
        changes[id] = proposal;
    }
    return { changes, decisions };
}
