import { Entity, handSizeFor, ReadableEntityRegistry } from "../entities";
import { MachineState } from "../state";
import { mergedClockTicks } from "./blueprint";
import { InserterClock, fuelOnlyInserters } from "./sequence/unplanned-inserter-clock";

const TICKS_PER_SECOND = 60;
const TICKS_PER_MINUTE = 3600;

/** How a burner machine uses its fuel when it crafts as much as the plan says */
export interface FuelMachinePlan {
    machine_id: string;
    recipe: string;
    /** The main product of the recipe */
    output_item: string;
    fuel_item: string;
    /** Fuel items burned a second while the machine crafts */
    burn_rate_per_second: number;
    /** Part of the time the machine crafts in the plan, 0 to 1 */
    crafting_share: number;
    /** Fuel items burned a second over a clock period: the burn rate times the crafting share */
    effective_burn_rate_per_second: number;
    /** Fuel items burned over one clock period */
    burned_per_period: number;
    /** Inserters stop dropping fuel once the slot holds this many items */
    insertion_limit: number;
    /** Ticks the insertion limit lasts at the effective burn rate */
    insertion_limit_lasts_ticks: number;
    /** Energy consumption effect in percent, e.g. 50 for +50% */
    energy_consumption_bonus: number;
}

/** The fuel clock the blueprint exports for one fuel inserter, and how often it is expected to swing on it */
export interface FuelInserterPlan {
    inserter_id: string;
    machine_id: string;
    fuel_item: string;
    /** Fuel items in a full hand */
    hand_size: number;
    /** Ticks a full hand lasts the machine at its effective burn rate */
    hand_lasts_ticks: number;
    /** Ticks between the starts of two enable windows */
    modulus: number;
    /** The enable window within the first `modulus` ticks, as inclusive ticks */
    window: { start: number; end: number };
    enables_per_minute: number;
    /** One hand per time a hand lasts, shared between the fuel inserters of the machine */
    expected_swings_per_minute: number;
    /** Part of the enable windows the inserter is expected to swing in, 0 to 1 */
    swing_share: number;
}

/** Fuel is outside the transfer plan: what the burner machines use, and the clocks exported to refill them */
export interface FuelPlan {
    /** Ticks of the clock period */
    period_ticks: number;
    /** Ticks the one merged clock of the blueprint counts: the least common multiple of the period and the fuel clocks */
    merged_clock_ticks: number | null;
    /**
     * Why each fuel clock has a counter of its own instead of the merged clock: the period is not a whole number of
     * ticks (subtick clock), or the merged count does not fit a signal
     */
    separate_clocks_reason?: "fractional_period" | "merged_clock_too_long";
    machines: FuelMachinePlan[];
    inserters: FuelInserterPlan[];
}

export function fuelPlan(
    entity_registry: ReadableEntityRegistry,
    inserter_clocks: ReadonlyMap<string, InserterClock>,
    crafting_shares: ReadonlyMap<string, number>,
    period_ticks: number,
): FuelPlan | undefined {
    const fuel_inserters = fuelOnlyInserters(entity_registry).filter(inserter => inserter_clocks.get(inserter.entity_id.id)?.kind === "fuel");
    if (fuel_inserters.length === 0) {
        return undefined;
    }

    const machines = new Map<string, FuelMachinePlan>();
    const inserters_per_machine = new Map<string, number>();
    for (const inserter of fuel_inserters) {
        const machine = entity_registry.getEntityByIdOrThrow(inserter.sink.entity_id);
        if (!Entity.isMachine(machine) || !machine.fuel_consumption || !machine.fuel_slot) {
            continue;
        }
        const machine_id = machine.entity_id.id;
        inserters_per_machine.set(machine_id, (inserters_per_machine.get(machine_id) ?? 0) + 1);
        if (machines.has(machine_id)) {
            continue;
        }
        const crafting_share = crafting_shares.get(machine_id) ?? 1;
        const effective_rate = machine.fuel_consumption.rate_per_second * crafting_share;
        machines.set(machine_id, {
            machine_id,
            recipe: machine.metadata.recipe.name,
            output_item: machine.output.item_name,
            fuel_item: machine.fuel_slot.fuel.item_name,
            burn_rate_per_second: machine.fuel_consumption.rate_per_second,
            crafting_share,
            effective_burn_rate_per_second: effective_rate,
            burned_per_period: effective_rate * period_ticks / TICKS_PER_SECOND,
            insertion_limit: machine.fuel_slot.automated_insertion_limit,
            insertion_limit_lasts_ticks: machine.fuel_slot.automated_insertion_limit / effective_rate * TICKS_PER_SECOND,
            energy_consumption_bonus: machine.metadata.energy_consumption_bonus ?? 0,
        });
    }

    const inserters: FuelInserterPlan[] = [];
    for (const inserter of fuel_inserters) {
        const machine = machines.get(inserter.sink.entity_id.id);
        const clock = inserter_clocks.get(inserter.entity_id.id);
        if (!machine || !clock) {
            continue;
        }
        const hand_size = handSizeFor(inserter, machine.fuel_item);
        const hand_lasts_ticks = hand_size / machine.effective_burn_rate_per_second * TICKS_PER_SECOND;
        const ticks_per_swing = hand_lasts_ticks * (inserters_per_machine.get(machine.machine_id) ?? 1);
        inserters.push({
            inserter_id: inserter.entity_id.id,
            machine_id: machine.machine_id,
            fuel_item: machine.fuel_item,
            hand_size,
            hand_lasts_ticks,
            modulus: clock.modulus,
            window: { start: clock.window.start_inclusive, end: clock.window.end_inclusive },
            enables_per_minute: TICKS_PER_MINUTE / clock.modulus,
            expected_swings_per_minute: TICKS_PER_MINUTE / ticks_per_swing,
            swing_share: Math.min(1, clock.modulus / ticks_per_swing),
        });
    }

    const moduli = Array.from(new Set(inserters.map(inserter => inserter.modulus))).sort((a, b) => a - b);
    const merged_clock_ticks = mergedClockTicks(period_ticks, moduli);
    return {
        period_ticks,
        merged_clock_ticks,
        separate_clocks_reason: merged_clock_ticks !== null ? undefined
            : Number.isInteger(period_ticks) ? "merged_clock_too_long" : "fractional_period",
        machines: Array.from(machines.values()),
        inserters,
    };
}

/** The fuel a burner machine held over a run: the items in its fuel slot plus what is left of the burning one */
export interface FuelLevelSeries {
    machine_id: string;
    /** Ticks of the run each entry of `min` and `max` covers */
    ticks_per_sample: number;
    /** Lowest and highest fuel within each sample, in items */
    min: number[];
    max: number[];
    start_level: number;
    end_level: number;
    min_level: number;
    max_level: number;
    /** Fuel items put into the slot over the run */
    inserted: number;
    /** Fuel items burned over the run */
    burned: number;
    /** Ticks the machine had no fuel at all */
    empty_ticks: number;
    /** First tick the machine had no fuel at all, or null when it always had some */
    first_empty_tick: number | null;
}

/** Most samples a fuel level series is cut down to */
const MAX_FUEL_LEVEL_SAMPLES = 480;

// absorbs floating point drift in the energy left of the burning item
const FUEL_EPSILON = 1e-6;

/** Samples the fuel of every burner machine after each tick of a run */
export class FuelLevelRecorder {
    private readonly levels: Map<MachineState, number[]>;

    constructor(machine_states: readonly MachineState[]) {
        this.levels = new Map(machine_states
            .filter(state => state.machine.fuel_slot !== undefined)
            .map(state => [state, [FuelLevelRecorder.levelOf(state)]]));
    }

    private static levelOf(state: MachineState): number {
        const fuel = state.machine.fuel_slot!.fuel;
        return state.fuelInventory.getQuantity(fuel.item_name) + state.fuelProgress.energy_remaining_mj / fuel.fuel_value_mj;
    }

    public record(): void {
        for (const [state, levels] of this.levels) {
            levels.push(FuelLevelRecorder.levelOf(state));
        }
    }

    public series(): FuelLevelSeries[] {
        return Array.from(this.levels, ([state, levels]) => seriesOf(state.machine.entity_id.id, levels));
    }
}

/** `levels[0]` is the fuel before the run, `levels[n]` after its n-th tick */
function seriesOf(machine_id: string, levels: number[]): FuelLevelSeries {
    const ticks = levels.length - 1;
    const ticks_per_sample = Math.max(1, Math.ceil(ticks / MAX_FUEL_LEVEL_SAMPLES));
    const round = (level: number) => Math.round(level * 100) / 100;
    const min: number[] = [];
    const max: number[] = [];
    let inserted = 0;
    let empty_ticks = 0;
    let first_empty_tick: number | null = null;
    let min_level = levels[0];
    let max_level = levels[0];
    for (let tick = 1; tick <= ticks; tick++) {
        const level = levels[tick];
        // a machine burns less than an item a tick, so a rise is the hand dropped in that tick less what was burned
        const rise = level - levels[tick - 1];
        if (rise > FUEL_EPSILON) {
            inserted += Math.ceil(rise - FUEL_EPSILON);
        }
        if (level <= FUEL_EPSILON) {
            empty_ticks += 1;
            first_empty_tick ??= tick - 1;
        }
        min_level = Math.min(min_level, level);
        max_level = Math.max(max_level, level);
        const sample = Math.floor((tick - 1) / ticks_per_sample);
        // a sample starts from the fuel it began with, so a hand dropped in it shows as a step
        const before = (tick - 1) % ticks_per_sample === 0 ? levels[tick - 1] : level;
        min[sample] = Math.min(min[sample] ?? Infinity, level, before);
        max[sample] = Math.max(max[sample] ?? -Infinity, level, before);
    }
    return {
        machine_id,
        ticks_per_sample,
        min: min.map(round),
        max: max.map(round),
        start_level: round(levels[0]),
        end_level: round(levels[ticks]),
        min_level: round(min_level),
        max_level: round(max_level),
        inserted,
        burned: levels[0] + inserted - levels[ticks],
        empty_ticks,
        first_empty_tick,
    };
}
