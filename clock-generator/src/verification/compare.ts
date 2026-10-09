import { Config } from "../config";
import { BlueprintGenerationResult } from "../crafting/generate-blueprint";
import { EntityId, Machine } from "../entities";
import { EntityMatch } from "./entity-matching";
import { expandChangeList, RecordedMachine, Recording, recordedClockPeriod } from "./recording";
import { clockValues, extractTransfers, RecordedTransfer } from "./recording-history";

export interface CompareOptions {
    /** Allowed spread (ticks) of an inserter's start offsets around its own median before a window is flagged */
    tolerance_ticks: number;
    /** Max distance (ticks) outside a simulated window for a recorded swing to still count toward it */
    match_window_ticks: number;
}

/** How far the fuel burned in game may be from what the configured energy consumption predicts before it is flagged */
const FUEL_RATIO_TOLERANCE = 0.1;

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
    /**
     * Periods in which the swings landed in the windows moved a different total than the simulation. A swing next to
     * another can belong to either window, so a window's own amount can differ while its period's total does not.
     */
    amount_mismatch_periods: number[];
}

/** An inserter outside the plan (fuel, or taking a by-product away): its swings checked against the clock it is enabled by */
export interface ClockedInserterComparison {
    config_id: number;
    recorded_id: number;
    kind: "fuel" | "by-product";
    /** The window repeats every `modulus` ticks of the clock, and is enabled for ticks `window` of each */
    modulus: number;
    window: { start: number; end: number };
    swings: number;
    /** Recorded swings that started outside every window, with the clock tick they started at */
    outside: { item_name: string; clock: number }[];
    /** Distinct amounts the swings moved */
    amounts: number[];
    items: string[];
    /** Recorded swings cut off by the start/end of the recording (not compared) */
    truncated: number;
}

/** What a burner machine burned, against what its energy consumption predicts */
export interface FuelComparison {
    config_id: number;
    recorded_id: number;
    fuel_item: string;
    /** Ticks the machine was crafting */
    working_ticks: number;
    /** Energy taken out of the fuel slot and the burning item, in MJ */
    consumed_mj: number;
    /** What the machine burns while crafting for that long at its configured energy consumption, in MJ */
    expected_mj: number;
    /** consumed / expected, null when the machine did not craft */
    ratio: number | null;
    consumed_items: number;
    expected_items: number;
    /** Ticks the game reported the machine had no fuel */
    no_fuel_ticks: number;
    slot_min: number;
    slot_max: number;
}

/** The state an entity shows in Factorio, simulated against recorded, per tick */
export interface StateComparison {
    config_id: number;
    recorded_id: number;
    /** The machine's recipe, or the inserter's ends */
    label: string;
    agreement: number;
    mismatches: { start: number; end: number; sim: string; game: string }[];
}

/** @deprecated the machines are StateComparison entries now */
export type MachineComparison = StateComparison;

export interface ComparisonReport {
    sim_period: number;
    game_period: number | null;
    recorded_periods: number;
    inserters: InserterComparison[];
    machines: StateComparison[];
    inserter_states: StateComparison[];
    clocked_inserters: ClockedInserterComparison[];
    fuel: FuelComparison[];
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

interface SimulatedTransfer {
    item_name: string;
    start: number;
    end: number;
    amount: number;
}

/**
 * What an inserter moved in the simulation. When the generation ran the exported clock windows on their own (the clock-only
 * run) that is the run to compare with: it is what the blueprint does in game. The planning simulation also makes inserters
 * wait on their machine's inventory, so it can swing differently than the clock does.
 */
function simTransfersFor(result: BlueprintGenerationResult, config_id: number): SimulatedTransfer[] {
    const key = EntityId.forInserter(config_id).id;
    if (result.clock_only_run) {
        const entity = result.clock_only_run.transfer_history.entities.find(e => e.entity_id === key);
        return (entity?.transfers ?? []).map(t => ({ item_name: t.item_name, start: t.start_tick, end: t.end_tick, amount: t.amount }));
    }
    for (const [entity_id, transfers] of result.transfer_history.entries()) {
        if (entity_id.id === key) {
            return transfers.map(t => ({
                item_name: t.item_name, start: t.tick_range.start_inclusive, end: t.tick_range.end_inclusive, amount: t.amount,
            }));
        }
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
            const length = s.end - s.start;
            // ticks after the window opened, around the clock; a long window covers most of the period, so a swing in its
            // second half is late in the window and not early for the next one
            const after = (((g.start_clock - s.start) % period) + period) % period;
            const offset = after <= length + window_ticks ? after : after - period;
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

function compareClocked(
    config_id: number,
    recorded_id: number,
    clock_of_inserter: NonNullable<BlueprintGenerationResult["unplanned_inserter_clocks"]>[string],
    game: RecordedTransfer[],
    truncated: number,
    clock: number[],
    options: CompareOptions,
): ClockedInserterComparison {
    const { modulus, window } = clock_of_inserter;
    const length = window.end - window.start;
    const outside: ClockedInserterComparison["outside"] = [];
    if (clock_of_inserter.own_clock) {
        // The clock of a fuel inserter is not recorded and runs free of the clock of the period, so only how the
        // swings sit to each other can be checked: all of them start within one window's length of the same tick of
        // the fuel clock, counted in recorded ticks.
        const offsets = game.map(swing => wrapOffset(swing.pickup_index - (game[0]?.pickup_index ?? 0), modulus));
        const earliest = Math.min(0, ...offsets);
        game.forEach((swing, index) => {
            if (offsets[index] - earliest > length + options.match_window_ticks + options.tolerance_ticks) {
                outside.push({ item_name: swing.item_name, clock: swing.pickup_index });
            }
        });
    } else {
        for (const swing of game) {
            // the inserter picks up after its window opens, a few ticks behind the clock like any other inserter
            const offset = wrapOffset(swing.start_clock - window.start, modulus);
            if (offset < -options.tolerance_ticks || offset > length + options.match_window_ticks) {
                outside.push({ item_name: swing.item_name, clock: swing.start_clock });
            }
        }
    }
    return {
        config_id,
        recorded_id,
        kind: clock_of_inserter.kind,
        modulus,
        window,
        swings: game.length,
        outside,
        amounts: Array.from(new Set(game.map(swing => swing.amount))).sort((a, b) => a - b),
        items: Array.from(new Set(game.map(swing => swing.item_name))).sort(),
        truncated,
    };
}

/** Compares the fuel a recorded burner machine burned with what its configured energy consumption predicts */
function compareFuel(recorded: RecordedMachine, config_id: number, config: Config, sample_count: number): FuelComparison | null {
    const machine_config = config.machines.find(m => m.id === config_id);
    if (!machine_config) return null;
    const machine = Machine.fromConfig(machine_config);
    const slot = machine.fuel_slot;
    const consumption = machine.fuel_consumption;
    if (!slot || !consumption) return null;

    const fuel_value_mj = slot.fuel.fuel_value_mj;
    const slot_counts = recorded.samples.fuel?.[slot.fuel.item_name];
    const burning = recorded.samples.burning_remaining;
    const statuses = expandChangeList(recorded.samples.status, sample_count, "none");
    const working_ticks = statuses.filter(status => status === "working").length;
    const no_fuel_ticks = statuses.filter(status => status === "no_fuel").length;

    // the energy held by the fuel slot and the burning item only rises when an inserter drops fuel in, so what falls is burned
    let consumed_mj = 0;
    if (slot_counts && burning) {
        const energy = (i: number) => (slot_counts[i] ?? 0) * fuel_value_mj + (burning[i] ?? 0);
        for (let i = 1; i < Math.min(slot_counts.length, burning.length); i++) {
            consumed_mj += Math.max(0, energy(i - 1) - energy(i));
        }
    }
    const expected_mj = working_ticks * consumption.rate_per_tick * fuel_value_mj;
    return {
        config_id,
        recorded_id: recorded.id,
        fuel_item: slot.fuel.item_name,
        working_ticks,
        consumed_mj,
        expected_mj,
        ratio: expected_mj > 0 ? consumed_mj / expected_mj : null,
        consumed_items: consumed_mj / fuel_value_mj,
        expected_items: expected_mj / fuel_value_mj,
        no_fuel_ticks,
        slot_min: slot_counts && slot_counts.length > 0 ? Math.min(...slot_counts) : 0,
        slot_max: slot_counts && slot_counts.length > 0 ? Math.max(...slot_counts) : 0,
    };
}

/** The state the simulator says an entity shows in Factorio, per tick of the period, in the game's own names */
function simFactorioStatePerTick(result: BlueprintGenerationResult, key: string, period: number): string[] | null {
    // the exported clock's run when there is one, like the inserters
    const history = result.clock_only_run?.state_transition_history ?? result.serializable_state_transition_history;
    const entity = history.entities.find(e => e.entity_id === key);
    if (!entity) return null;
    const states: string[] = new Array(period);
    const changes = [...entity.factorio_states].sort((a, b) => a.tick - b.tick);
    let current = entity.initial_factorio_state;
    let next = 0;
    for (let t = 0; t < period; t++) {
        while (next < changes.length && changes[next].tick <= t) {
            current = changes[next].state;
            next++;
        }
        states[t] = current;
    }
    return states;
}

/** Agreement per tick between the simulator's Factorio state and the recorded status, with the runs that differ */
function compareStates(sim_states: string[], game_statuses: string[], clock: number[], period: number): Pick<StateComparison, "agreement" | "mismatches"> {
    let agree = 0;
    const mismatches: { start: number; end: number; sim: string; game: string }[] = [];
    for (let i = 0; i < game_statuses.length; i++) {
        const sim_status = sim_states[((clock[i] % period) + period) % period];
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
    return {
        agreement: game_statuses.length > 0 ? agree / game_statuses.length : 1,
        mismatches: mismatches.map(m => ({ ...m, start: clock[m.start], end: clock[m.end] })),
    };
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
        issues.push("Recording has no clock values; swings are compared by sample index, which is only meaningful if the recording started at the start of a period.");
    } else if (game_period !== clock_period) {
        issues.push(`In-game clock period is ${game_period} ticks but the simulation period is ${sim_period} ticks; the blueprint may not match this config.`);
    }
    const period = game_period ?? clock_period;
    const clock = clockValues(recording);
    const periods_of_sample = periodIndices(clock);
    const recorded_periods = (periods_of_sample[periods_of_sample.length - 1] ?? 0) + 1;

    const inserters: InserterComparison[] = [];
    const clocked_inserters: ClockedInserterComparison[] = [];
    const game_swings_by_config_id = new Map<number, RecordedTransfer[]>();
    for (const recorded of recording.inserters) {
        const config_id = match.inserters.get(recorded.id);
        if (config_id === undefined) continue;

        const sim = simTransfersFor(result, config_id);
        const game_all = extractTransfers(recorded, clock);
        const game = game_all.filter(t => !t.truncated_start && !t.truncated_end);
        game_swings_by_config_id.set(config_id, game);

        // an inserter outside the plan swings by its own clock and the state of its machine, not once per period
        const clock_of_inserter = result.unplanned_inserter_clocks?.[EntityId.forInserter(config_id).id];
        if (clock_of_inserter) {
            clocked_inserters.push(compareClocked(config_id, recorded.id, clock_of_inserter, game, game_all.length - game.length, clock, options));
            continue;
        }

        const windows: WindowComparison[] = [];
        const extra: ExtraSwing[] = [];
        for (let p = 0; p < recorded_periods; p++) {
            const compared = compareWindows(sim, game.filter(t => periods_of_sample[t.pickup_index] === p), period, p, options.match_window_ticks);
            windows.push(...compared.windows);
            extra.push(...compared.extra);
        }
        const totals_by_period = new Map<number, { sim: number; game: number }>();
        for (const w of windows) {
            const total = totals_by_period.get(w.period) ?? { sim: 0, game: 0 };
            total.sim += w.sim_amount;
            total.game += w.game_amount;
            totals_by_period.set(w.period, total);
        }
        for (const e of extra) {
            const total = totals_by_period.get(e.period);
            if (total) total.game += e.amount;
        }
        inserters.push({
            config_id,
            recorded_id: recorded.id,
            windows,
            extra,
            truncated: game_all.length - game.length,
            median_offset: median(windows.flatMap(w => w.first_offset === null ? [] : [w.first_offset])),
            amount_mismatch_periods: Array.from(totals_by_period)
                .filter(([period_index, total]) => total.sim !== total.game && windows.some(w => w.period === period_index && w.game_swings > 0))
                .map(([period_index]) => period_index),
        });
    }
    inserters.sort((a, b) => a.config_id - b.config_id);

    for (const ins of inserters) {
        const missed = ins.windows.filter(w => w.game_swings === 0);
        if (missed.length > 0) issues.push(`Inserter ${ins.config_id}: ${missed.length} simulated window(s) had no swing in game.`);
        if (ins.amount_mismatch_periods.length > 0) {
            issues.push(`Inserter ${ins.config_id}: moved a different amount than simulated in period(s) ${ins.amount_mismatch_periods.join(", ")}.`);
        }
        if (ins.extra.length > 0) issues.push(`Inserter ${ins.config_id}: ${ins.extra.length} in-game swing(s) outside any simulated window.`);
        const drift = ins.windows.filter(w => w.first_offset !== null && ins.median_offset !== null
            && Math.abs(w.first_offset - ins.median_offset) > options.tolerance_ticks);
        if (drift.length > 0) issues.push(`Inserter ${ins.config_id}: ${drift.length} window(s) started more than ${options.tolerance_ticks} ticks away from its usual ${ins.median_offset}-tick offset.`);
    }

    const machines: StateComparison[] = [];
    for (const recorded of recording.machines) {
        const config_id = match.machines.get(recorded.id);
        if (config_id === undefined) continue;
        const sim_states = simFactorioStatePerTick(result, EntityId.forMachine(config_id).id, period);
        if (!sim_states) continue;
        const game_statuses = expandChangeList(recorded.samples.status, recording.sample_count, "none");
        machines.push({ config_id, recorded_id: recorded.id, label: recorded.recipe, ...compareStates(sim_states, game_statuses, clock, period) });
    }
    machines.sort((a, b) => a.config_id - b.config_id);

    const inserter_states: StateComparison[] = [];
    for (const recorded of recording.inserters) {
        const config_id = match.inserters.get(recorded.id);
        if (config_id === undefined) continue;
        const sim_states = simFactorioStatePerTick(result, EntityId.forInserter(config_id).id, period);
        if (!sim_states) continue;
        const game_statuses = expandChangeList(recorded.samples.status, recording.sample_count, "none");
        inserter_states.push({ config_id, recorded_id: recorded.id, label: `${recorded.source.type} ${recorded.source.id} -> ${recorded.sink.type} ${recorded.sink.id}`, ...compareStates(sim_states, game_statuses, clock, period) });
    }
    inserter_states.sort((a, b) => a.config_id - b.config_id);

    const fuel: FuelComparison[] = [];
    for (const recorded of recording.machines) {
        const config_id = match.machines.get(recorded.id);
        if (config_id === undefined) continue;
        const comparison = compareFuel(recorded, config_id, config, recording.sample_count);
        if (!comparison) continue;
        fuel.push(comparison);
        if (!recorded.samples.fuel) {
            issues.push(`Machine ${config_id} burns fuel but the recording has no fuel samples; record with clock-generator-recorder 0.2.0 or newer.`);
        }
        if (comparison.no_fuel_ticks > 0) {
            issues.push(`Machine ${config_id}: out of fuel for ${comparison.no_fuel_ticks} tick(s) in game.`);
        }
        if (comparison.ratio !== null && Math.abs(comparison.ratio - 1) > FUEL_RATIO_TOLERANCE) {
            issues.push(`Machine ${config_id}: burned ${(comparison.ratio * 100).toFixed(1)}% of the ${comparison.fuel_item} its energy consumption predicts `
                + `(${comparison.consumed_items.toFixed(1)} vs ${comparison.expected_items.toFixed(1)} items); check energy_consumption_bonus.`);
        }
    }
    fuel.sort((a, b) => a.config_id - b.config_id);

    for (const clocked of clocked_inserters) {
        if (clocked.outside.length > 0) {
            issues.push(`Inserter ${clocked.config_id}: ${clocked.outside.length} in-game swing(s) started outside its clock window `
                + `(every ${clocked.modulus} ticks, ticks ${clocked.window.start}-${clocked.window.end}).`);
        }
    }

    // the target is an item, which a machine makes with a recipe of another name (rocket-fuel from rocket-fuel-from-jelly)
    const output_machine_ids = new Set(config.machines
        .filter(m => Machine.fromConfig(m).output.item_name === config.target_output.recipe)
        .map(m => m.id));
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
        inserter_states,
        clocked_inserters,
        fuel,
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
        const flagged = ins.windows.filter(w => w.game_swings === 0
            || (w.game_amount !== w.sim_amount && ins.amount_mismatch_periods.includes(w.period))
            || (w.first_offset !== null && ins.median_offset !== null && Math.abs(w.first_offset - ins.median_offset) > options.tolerance_ticks));
        const ok = flagged.length === 0 && ins.extra.length === 0;
        lines.push(`  ${ok ? "OK  " : "DIFF"} inserter ${ins.config_id} (recorded ${ins.recorded_id}): ${ins.windows.length} windows, usual offset ${ins.median_offset ?? "n/a"} ticks, ${ins.extra.length} extra swing(s)${ins.truncated ? `, ${ins.truncated} truncated` : ""}`);
        for (const w of flagged) {
            const game = w.game_swings === 0 ? "no swing" : `${w.game_swings} swing(s) x${w.game_amount} @+${w.first_offset}`;
            lines.push(`         period ${w.period} ${w.item_name} sim [${w.sim_start}-${w.sim_end}] x${w.sim_amount} -> game ${game}`);
        }
        for (const e of ins.extra) lines.push(`         period ${e.period} EXTRA ${e.item_name} game @${e.start} x${e.amount}`);
    }
    if (report.clocked_inserters.length > 0) {
        lines.push("");
        lines.push("Inserters outside the plan (fuel, by-products), checked against their clock windows:");
        for (const ins of report.clocked_inserters) {
            const ok = ins.outside.length === 0;
            lines.push(`  ${ok ? "OK  " : "DIFF"} inserter ${ins.config_id} (recorded ${ins.recorded_id}, ${ins.kind}): ${ins.swings} swing(s) of ${ins.items.join("|") || "nothing"} `
                + `x${ins.amounts.join("/") || "-"}, window ticks ${ins.window.start}-${ins.window.end} every ${ins.modulus}, ${ins.outside.length} outside${ins.truncated ? `, ${ins.truncated} truncated` : ""}`);
            for (const o of ins.outside.slice(0, 5)) lines.push(`         ${o.item_name} swing at clock ${o.clock} (${o.clock % ins.modulus} of ${ins.modulus})`);
        }
    }
    if (report.fuel.length > 0) {
        lines.push("");
        lines.push("Fuel burned by burner machines, against the configured energy consumption:");
        for (const f of report.fuel) {
            const ratio = f.ratio === null ? "n/a" : `${(f.ratio * 100).toFixed(1)}%`;
            lines.push(`  machine ${f.config_id} (recorded ${f.recorded_id}): burned ${f.consumed_items.toFixed(1)} ${f.fuel_item} vs ${f.expected_items.toFixed(1)} expected over ${f.working_ticks} working ticks (${ratio}), `
                + `fuel slot ${f.slot_min}-${f.slot_max}, ${f.no_fuel_ticks} tick(s) out of fuel`);
        }
    }
    lines.push("");
    lines.push("Machines (config id): Factorio state agreement per tick");
    for (const m of report.machines) {
        lines.push(`  machine ${m.config_id} (recorded ${m.recorded_id}, ${m.label}): ${(m.agreement * 100).toFixed(1)}%`);
        for (const mm of m.mismatches.slice(0, 5)) {
            lines.push(`         clock ${mm.start}-${mm.end}: sim ${mm.sim}, game ${mm.game}`);
        }
        if (m.mismatches.length > 5) lines.push(`         ... ${m.mismatches.length - 5} more`);
    }
    lines.push("");
    lines.push("Inserters (config id): Factorio state agreement per tick");
    for (const i of report.inserter_states) {
        lines.push(`  inserter ${i.config_id} (recorded ${i.recorded_id}, ${i.label}): ${(i.agreement * 100).toFixed(1)}%`);
        for (const mm of i.mismatches.slice(0, 5)) {
            lines.push(`         clock ${mm.start}-${mm.end}: sim ${mm.sim}, game ${mm.game}`);
        }
        if (i.mismatches.length > 5) lines.push(`         ... ${i.mismatches.length - 5} more`);
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
