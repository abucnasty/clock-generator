import { Config } from "../config";
import { BlueprintGenerationResult } from "../crafting/generate-blueprint";
import { EntityId, Machine } from "../entities";
import { EntityMatch } from "./entity-matching";
import { expandChangeList, RecordedMachine, Recording } from "./recording";
import { extractTransfers, RecordedTransfer, windowPositions } from "./recording-history";

interface CompareOptions {
    /** Ticks before its window opens that a recorded swing may start and still count as inside it */
    tolerance_ticks: number;
    /** Ticks after its window closes that a recorded swing may start and still count as inside it */
    match_window_ticks: number;
}

/** How far the fuel burned in game may be from what the configured energy consumption predicts before it is flagged */
const FUEL_RATIO_TOLERANCE = 0.1;

const DEFAULT_COMPARE_OPTIONS: CompareOptions = {
    tolerance_ticks: 2,
    match_window_ticks: 32,
};

/** An inserter outside the plan (fuel, or taking a by-product away): its swings checked against the clock it is enabled by */
interface ClockedInserterComparison {
    config_id: number;
    recorded_id: number;
    kind: "fuel" | "by-product";
    /** The window repeats every `modulus` ticks of the clock, and is enabled for ticks `window` of each */
    modulus: number;
    window: { start: number; end: number };
    swings: number;
    /** Recorded swings that started outside every window, with the position in the period (the windows') they started at */
    outside: { item_name: string; clock: number }[];
    /** Distinct amounts the swings moved */
    amounts: number[];
    items: string[];
    /** Recorded swings cut off by the start/end of the recording (not compared) */
    truncated: number;
}

/** What a burner machine burned, against what its energy consumption predicts */
interface FuelComparison {
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

/**
 * What a recording is checked for against the exported clocks and the config, which a simulated run of the clock
 * does not tell (for that see compare-recordings.ts): the swings of the inserters outside the plan against the
 * clocks they are on, and the fuel burned against the energy consumption of the config.
 */
interface ExportedClockReport {
    clocked_inserters: ClockedInserterComparison[];
    fuel: FuelComparison[];
    issues: string[];
}

function wrapOffset(offset: number, period: number): number {
    let wrapped = ((offset % period) + period) % period;
    if (wrapped > period / 2) wrapped -= period;
    return wrapped;
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

export function compareWithExportedClocks(
    recording: Recording,
    config: Config,
    result: BlueprintGenerationResult,
    match: EntityMatch,
    options: CompareOptions = DEFAULT_COMPARE_OPTIONS,
): ExportedClockReport {
    const issues: string[] = [];
    // positions are those of the windows, which are a tick behind the clock
    const clock = windowPositions(recording);

    const clocked_inserters: ClockedInserterComparison[] = [];
    for (const recorded of recording.inserters) {
        const config_id = match.inserters.get(recorded.id);
        // an inserter outside the plan swings by its own clock and the state of its machine, not once per period
        const clock_of_inserter = config_id === undefined ? undefined : result.unplanned_inserter_clocks?.[EntityId.forInserter(config_id).id];
        if (config_id === undefined || !clock_of_inserter) continue;
        const game_all = extractTransfers(recorded, clock);
        const game = game_all.filter(t => !t.truncated_start && !t.truncated_end);
        clocked_inserters.push(compareClocked(config_id, recorded.id, clock_of_inserter, game, game_all.length - game.length, clock, options));
    }
    clocked_inserters.sort((a, b) => a.config_id - b.config_id);
    for (const clocked of clocked_inserters) {
        if (clocked.outside.length > 0) {
            issues.push(`Inserter ${clocked.config_id}: ${clocked.outside.length} in-game swing(s) started outside its clock window `
                + `(every ${clocked.modulus} ticks, ticks ${clocked.window.start}-${clocked.window.end}).`);
        }
    }

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

    return { clocked_inserters, fuel, issues };
}

/** The lines of the report, none when the build has no inserter outside the plan and burns no fuel */
export function formatExportedClockReport(report: ExportedClockReport): string[] {
    const lines: string[] = [];
    if (report.clocked_inserters.length > 0) {
        lines.push("Inserters outside the plan (fuel, by-products), checked against their clock windows:");
        for (const ins of report.clocked_inserters) {
            const ok = ins.outside.length === 0;
            lines.push(`  ${ok ? "OK  " : "DIFF"} inserter ${ins.config_id} (recorded ${ins.recorded_id}, ${ins.kind}): ${ins.swings} swing(s) of ${ins.items.join("|") || "nothing"} `
                + `x${ins.amounts.join("/") || "-"}, window ticks ${ins.window.start}-${ins.window.end} every ${ins.modulus}, ${ins.outside.length} outside${ins.truncated ? `, ${ins.truncated} truncated` : ""}`);
            for (const o of ins.outside.slice(0, 5)) lines.push(`         ${o.item_name} swing at position ${o.clock} (${o.clock % ins.modulus} of ${ins.modulus})`);
        }
        lines.push("");
    }
    if (report.fuel.length > 0) {
        lines.push("Fuel burned by burner machines, against the configured energy consumption:");
        for (const f of report.fuel) {
            const ratio = f.ratio === null ? "n/a" : `${(f.ratio * 100).toFixed(1)}%`;
            lines.push(`  machine ${f.config_id} (recorded ${f.recorded_id}): burned ${f.consumed_items.toFixed(1)} ${f.fuel_item} vs ${f.expected_items.toFixed(1)} expected over ${f.working_ticks} working ticks (${ratio}), `
                + `fuel slot ${f.slot_min}-${f.slot_max}, ${f.no_fuel_ticks} tick(s) out of fuel`);
        }
        lines.push("");
    }
    return lines;
}
