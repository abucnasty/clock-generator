import { Config } from "../config";
import { BlueprintGenerationResult } from "../crafting/generate-blueprint";
import { EntityId } from "../entities";
import { EntityMatch } from "./entity-matching";
import { Recording, recordedClockPeriod } from "./recording";
import { clockValues, extractTransfers, machineStatuses, RecordedTransfer } from "./recording-history";

export interface CompareOptions {
    /** Allowed spread (ticks) of an inserter's start offsets around its own median before a window is flagged */
    tolerance_ticks: number;
    /** Max distance (ticks) outside a simulated window for a recorded swing to still count toward it */
    match_window_ticks: number;
}

export const DEFAULT_COMPARE_OPTIONS: CompareOptions = {
    tolerance_ticks: 2,
    match_window_ticks: 32,
};

/** One simulated enable window (merged back-to-back swings) and the recorded swings that landed in it */
export interface WindowComparison {
    period: number;
    item_name: string;
    sim_start: number;
    sim_end: number;
    sim_amount: number;
    game_swings: number;
    game_amount: number;
    /** First recorded swing start minus sim_start; null when nothing was recorded for the window */
    first_offset: number | null;
}

export interface ExtraSwing {
    period: number;
    item_name: string;
    start: number;
    amount: number;
}

export interface InserterComparison {
    config_id: number;
    recorded_id: number;
    windows: WindowComparison[];
    /** Recorded swings that fall in no simulated window */
    extra: ExtraSwing[];
    /** Recorded swings cut off by the start/end of the recording (not compared) */
    truncated: number;
    /** Median first_offset; the inserter's in-game latency behind the simulated schedule */
    median_offset: number | null;
}

export interface MachineComparison {
    config_id: number;
    recorded_id: number;
    recipe: string;
    agreement: number;
    mismatches: { start: number; end: number; sim: string; game: string }[];
}

export interface ComparisonReport {
    sim_period: number;
    game_period: number | null;
    recorded_periods: number;
    inserters: InserterComparison[];
    machines: MachineComparison[];
    output_items: { sim_per_period: number; game_per_period: number[] };
    match: EntityMatch;
    issues: string[];
}

function wrapOffset(offset: number, period: number): number {
    let wrapped = ((offset % period) + period) % period;
    if (wrapped > period / 2) wrapped -= period;
    return wrapped;
}

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

/** Period index for each sample: increments whenever the clock wraps */
function periodIndices(clock: number[]): number[] {
    const out: number[] = [];
    let period = 0;
    for (let i = 0; i < clock.length; i++) {
        if (i > 0 && clock[i] < clock[i - 1]) period++;
        out.push(period);
    }
    return out;
}

function simTransfersFor(result: BlueprintGenerationResult, config_id: number) {
    const key = EntityId.forInserter(config_id).id;
    for (const [entity_id, transfers] of result.transfer_history.entries()) {
        if (entity_id.id === key) return transfers;
    }
    return [];
}

/** Assigns each recorded swing to the closest simulated window of the same item */
function compareWindows(
    sim: { item_name: string; start: number; end: number; amount: number }[],
    game: RecordedTransfer[],
    period: number,
    period_index: number,
    window_ticks: number,
): { windows: WindowComparison[]; extra: ExtraSwing[] } {
    const windows: WindowComparison[] = sim.map(s => ({
        period: period_index,
        item_name: s.item_name,
        sim_start: s.start,
        sim_end: s.end,
        sim_amount: s.amount,
        game_swings: 0,
        game_amount: 0,
        first_offset: null,
    }));
    const extra: ExtraSwing[] = [];

    for (const g of game) {
        let best: { index: number; distance: number; offset: number } | null = null;
        sim.forEach((s, index) => {
            if (s.item_name !== g.item_name) return;
            const offset = wrapOffset(g.start_clock - s.start, period);
            const length = s.end - s.start;
            if (offset < -window_ticks || offset > length + window_ticks) return;
            const distance = offset < 0 ? -offset : Math.max(0, offset - length);
            if (!best || distance < best.distance) best = { index, distance, offset };
        });
        if (best === null) {
            extra.push({ period: period_index, item_name: g.item_name, start: g.start_clock, amount: g.amount });
            continue;
        }
        const { index, offset } = best;
        const w = windows[index];
        w.game_swings++;
        w.game_amount += g.amount;
        w.first_offset = w.first_offset === null ? offset : Math.min(w.first_offset, offset);
    }
    return { windows, extra };
}

function simMachineStatusPerTick(result: BlueprintGenerationResult, config_id: number, period: number): string[] | null {
    const key = EntityId.forMachine(config_id).id;
    const entity = result.serializable_state_transition_history.entities.find(e => e.entity_id === key);
    if (!entity) return null;
    const statuses: string[] = new Array(period);
    const transitions = [...entity.transitions].sort((a, b) => a.tick - b.tick);
    let current = entity.initial_status;
    let next = 0;
    for (let t = 0; t < period; t++) {
        while (next < transitions.length && transitions[next].tick <= t) {
            current = transitions[next].to_status;
            next++;
        }
        statuses[t] = current;
    }
    return statuses;
}

export function compareRecording(
    recording: Recording,
    config: Config,
    result: BlueprintGenerationResult,
    match: EntityMatch,
    options: CompareOptions = DEFAULT_COMPARE_OPTIONS,
): ComparisonReport {
    const issues: string[] = [];
    const sim_period = result.simulation_duration.ticks;
    const game_period = recordedClockPeriod(recording);
    // a combinator clock can only count whole ticks, so a fractional simulated period runs rounded down in game
    const clock_period = Math.floor(sim_period);
    if (!Number.isInteger(sim_period)) {
        issues.push(`Simulation period is fractional (${sim_period.toFixed(3)} ticks); the in-game clock runs it as ${clock_period} ticks.`);
    }
    if (game_period === null) {
        issues.push("Recording has no clock values; swings are compared by sample index, which is only meaningful if the recording started at clock 0.");
    } else if (game_period !== clock_period) {
        issues.push(`In-game clock period is ${game_period} ticks but the simulation period is ${sim_period} ticks; the blueprint may not match this config.`);
    }
    const period = game_period ?? clock_period;
    const clock = clockValues(recording);
    const periods_of_sample = periodIndices(clock);
    const recorded_periods = (periods_of_sample[periods_of_sample.length - 1] ?? 0) + 1;

    const inserters: InserterComparison[] = [];
    const game_swings_by_config_id = new Map<number, RecordedTransfer[]>();
    for (const recorded of recording.inserters) {
        const config_id = match.inserters.get(recorded.id);
        if (config_id === undefined) continue;

        const sim = simTransfersFor(result, config_id).map(t => ({
            item_name: t.item_name,
            start: t.tick_range.start_inclusive,
            end: t.tick_range.end_inclusive,
            amount: t.amount,
        }));
        const game_all = extractTransfers(recorded, clock);
        const game = game_all.filter(t => !t.truncated_start && !t.truncated_end);
        game_swings_by_config_id.set(config_id, game);

        const windows: WindowComparison[] = [];
        const extra: ExtraSwing[] = [];
        for (let p = 0; p < recorded_periods; p++) {
            const compared = compareWindows(sim, game.filter(t => periods_of_sample[t.pickup_index] === p), period, p, options.match_window_ticks);
            windows.push(...compared.windows);
            extra.push(...compared.extra);
        }
        inserters.push({
            config_id,
            recorded_id: recorded.id,
            windows,
            extra,
            truncated: game_all.length - game.length,
            median_offset: median(windows.flatMap(w => w.first_offset === null ? [] : [w.first_offset])),
        });
    }
    inserters.sort((a, b) => a.config_id - b.config_id);

    for (const ins of inserters) {
        const missed = ins.windows.filter(w => w.game_swings === 0);
        if (missed.length > 0) issues.push(`Inserter ${ins.config_id}: ${missed.length} simulated window(s) had no swing in game.`);
        const amount = ins.windows.filter(w => w.game_swings > 0 && w.game_amount !== w.sim_amount);
        if (amount.length > 0) issues.push(`Inserter ${ins.config_id}: ${amount.length} window(s) moved a different amount than simulated.`);
        if (ins.extra.length > 0) issues.push(`Inserter ${ins.config_id}: ${ins.extra.length} in-game swing(s) outside any simulated window.`);
        const drift = ins.windows.filter(w => w.first_offset !== null && ins.median_offset !== null
            && Math.abs(w.first_offset - ins.median_offset) > options.tolerance_ticks);
        if (drift.length > 0) issues.push(`Inserter ${ins.config_id}: ${drift.length} window(s) started more than ${options.tolerance_ticks} ticks away from its usual ${ins.median_offset}-tick offset.`);
    }

    const machines: MachineComparison[] = [];
    for (const recorded of recording.machines) {
        const config_id = match.machines.get(recorded.id);
        if (config_id === undefined) continue;
        const sim_statuses = simMachineStatusPerTick(result, config_id, period);
        if (!sim_statuses) continue;
        const game_statuses = machineStatuses(recorded, recording.sample_count);

        let agree = 0;
        const mismatches: { start: number; end: number; sim: string; game: string }[] = [];
        for (let i = 0; i < game_statuses.length; i++) {
            const sim_status = sim_statuses[((clock[i] % period) + period) % period];
            if (sim_status === game_statuses[i]) {
                agree++;
                continue;
            }
            const last = mismatches[mismatches.length - 1];
            if (last && last.end === i - 1 && last.sim === sim_status && last.game === game_statuses[i]) {
                last.end = i;
            } else {
                mismatches.push({ start: i, end: i, sim: sim_status, game: game_statuses[i] });
            }
        }
        machines.push({
            config_id,
            recorded_id: recorded.id,
            recipe: recorded.recipe,
            agreement: game_statuses.length > 0 ? agree / game_statuses.length : 1,
            mismatches: mismatches.map(m => ({ ...m, start: clock[m.start], end: clock[m.end] })),
        });
    }
    machines.sort((a, b) => a.config_id - b.config_id);

    const output_machine_ids = new Set(config.machines.filter(m => m.recipe === config.target_output.recipe).map(m => m.id));
    const output_inserter_ids = inserters.map(ins => ins.config_id).filter(id => {
        const cfg = config.inserters.find((c, index) => (c.id ?? index + 1) === id);
        return cfg?.source.type === "machine" && output_machine_ids.has(cfg.source.id);
    });
    const sim_per_period = output_inserter_ids
        .flatMap(id => simTransfersFor(result, id))
        .reduce((sum, t) => sum + t.amount, 0);
    const game_per_period = Array.from({ length: recorded_periods }, (_, p) => output_inserter_ids
        .flatMap(id => game_swings_by_config_id.get(id) ?? [])
        .filter(t => periods_of_sample[t.end_index] === p)
        .reduce((sum, t) => sum + t.amount, 0));
    game_per_period.forEach((amount, p) => {
        if (amount !== sim_per_period) issues.push(`Period ${p}: output inserters moved ${amount} items in game vs ${sim_per_period} simulated.`);
    });

    if (match.unmatched_recorded_inserters.length > 0) issues.push(`Recorded inserters with no config match: ${match.unmatched_recorded_inserters.join(", ")}`);
    if (match.unmatched_config_inserters.length > 0) issues.push(`Config inserters not found in recording: ${match.unmatched_config_inserters.join(", ")}`);
    if (match.unmatched_config_machines.length > 0) issues.push(`Config machines not found in recording: ${match.unmatched_config_machines.join(", ")}`);
    const missing_sim_machines = recording.machines
        .filter(m => match.machines.has(m.id) && !machines.some(c => c.recorded_id === m.id))
        .map(m => match.machines.get(m.id));
    if (missing_sim_machines.length > 0) issues.push(`No simulated status history for config machines: ${missing_sim_machines.join(", ")}`);

    return {
        sim_period,
        game_period,
        recorded_periods,
        inserters,
        machines,
        output_items: { sim_per_period, game_per_period },
        match,
        issues,
    };
}

export function formatReport(report: ComparisonReport, options: CompareOptions = DEFAULT_COMPARE_OPTIONS): string[] {
    const lines: string[] = [];
    lines.push(`Sim period: ${report.sim_period} ticks | In-game clock period: ${report.game_period ?? "n/a"} | Recorded periods: ${report.recorded_periods}`);
    lines.push("");
    lines.push("Entity mapping (recorded -> config):");
    lines.push(`  machines:  ${Array.from(report.match.machines).map(([r, c]) => `${r}->${c}`).join(", ")}`);
    lines.push(`  inserters: ${Array.from(report.match.inserters).map(([r, c]) => `${r}->${c}`).join(", ")}`);
    lines.push("");
    lines.push("Inserters (config id), offsets are game clock minus simulated window start:");
    for (const ins of report.inserters) {
        const flagged = ins.windows.filter(w => w.game_swings === 0 || w.game_amount !== w.sim_amount
            || (w.first_offset !== null && ins.median_offset !== null && Math.abs(w.first_offset - ins.median_offset) > options.tolerance_ticks));
        const ok = flagged.length === 0 && ins.extra.length === 0;
        lines.push(`  ${ok ? "OK  " : "DIFF"} inserter ${ins.config_id} (recorded ${ins.recorded_id}): ${ins.windows.length} windows, usual offset ${ins.median_offset ?? "n/a"} ticks, ${ins.extra.length} extra swing(s)${ins.truncated ? `, ${ins.truncated} truncated` : ""}`);
        for (const w of flagged) {
            const game = w.game_swings === 0 ? "no swing" : `${w.game_swings} swing(s) x${w.game_amount} @+${w.first_offset}`;
            lines.push(`         period ${w.period} ${w.item_name} sim [${w.sim_start}-${w.sim_end}] x${w.sim_amount} -> game ${game}`);
        }
        for (const e of ins.extra) lines.push(`         period ${e.period} EXTRA ${e.item_name} game @${e.start} x${e.amount}`);
    }
    lines.push("");
    lines.push("Machines (config id): status agreement per tick");
    for (const m of report.machines) {
        lines.push(`  machine ${m.config_id} (recorded ${m.recorded_id}, ${m.recipe}): ${(m.agreement * 100).toFixed(1)}%`);
        for (const mm of m.mismatches.slice(0, 5)) {
            lines.push(`         clock ${mm.start}-${mm.end}: sim ${mm.sim}, game ${mm.game}`);
        }
        if (m.mismatches.length > 5) lines.push(`         ... ${m.mismatches.length - 5} more`);
    }
    lines.push("");
    lines.push(`Output items per period: sim ${report.output_items.sim_per_period}, game [${report.output_items.game_per_period.join(", ")}]`);
    lines.push("");
    if (report.issues.length === 0) {
        lines.push("RESULT: recording matches the simulation.");
    } else {
        lines.push(`RESULT: ${report.issues.length} issue(s):`);
        report.issues.forEach(issue => lines.push(`  - ${issue}`));
    }
    return lines;
}
