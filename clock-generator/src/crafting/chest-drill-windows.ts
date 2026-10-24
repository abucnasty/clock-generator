import { Config } from "../config";
import { EnableControlMode } from "../common/enable-control-types";
import { ChestType, chestName } from "../common/entity-types";
import { clockPosition } from "../control-logic/enable-control";
import { DrillChestWorkingMode } from "../control-logic/drill/modes/chest-working-mode";
import { OpenRange } from "../data-types";
import Fraction, { fraction } from "../data-types/fraction";
import { Chest, Entity, EntityId, handSizeFor, MiningDrill, ReadableEntityRegistry } from "../entities";
import { ChestState, DrillState, EntityStateFactory } from "../state";
import { CraftingCyclePlan } from "./sequence/cycle/crafting-cycle";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { TargetProductionRate } from "./target-production-rate";

/** Why nothing times a drill into a chest, so that it stays always enabled */
export type ChestDrillWhy =
    | { kind: "config" }
    | { kind: "other-drill"; drill_number: number; item: string }
    | { kind: "filler"; inserter_number: number; item: string }
    | { kind: "no-taker"; item: string }
    | { kind: "taker-without-window"; inserter_number: number; item: string }
    | { kind: "no-take"; item: string }
    | { kind: "no-room"; item: string }
    | { kind: "needs-whole-period" }
    | { kind: "would-cover-period" }
    | { kind: "fallback" }
    | { kind: "windows-did-not-hold" }
    | { kind: "no-window" };

/** The reason as the log and the insight say it, after "always enabled" */
export function chestDrillBecause(why: ChestDrillWhy): string {
    switch (why.kind) {
        case "config": return "the config sets it to always enabled";
        case "other-drill": return `drill ${why.drill_number} fills the same chest with ${why.item} too`;
        case "filler": return `inserter ${why.inserter_number} fills the same chest with ${why.item} too`;
        case "no-taker": return `no inserter of the plan takes ${why.item} out of the chest`;
        case "taker-without-window": return `inserter ${why.inserter_number} takes ${why.item} out of the chest with no window`;
        case "no-take": return `no window of the clock takes ${why.item} out of the chest`;
        case "no-room": return `the chest has no room for ${why.item}`;
        case "needs-whole-period": return "no windows shorter than the whole period keep the chest's takers supplied";
        case "would-cover-period": return "its windows would cover the whole period";
        case "fallback": return "the clock does not meet goal 1 with its fewest windows, nor with them a tick longer";
        case "windows-did-not-hold": return "its windows did not hold the clock";
        case "no-window": return "it has no window";
    }
}

/**
 * What the clock gives a drill that drops into a chest: windows that keep the chest's takers supplied just in time,
 * or none, with the reason it stays always enabled.
 */
export interface ChestDrillClock {
    /** The drill's config id */
    drill_id: number;
    /** The config id of the chest it drops into */
    chest_id: number;
    /** What the chest is: a car, a cargo wagon, a buffer chest ... (chestName names it) */
    chest_type: ChestType;
    item: string;
    /** Ticks it is enabled in a period, on average where the period is not a whole number of ticks; null when always enabled */
    enabled_ticks: number | null;
    /** Its windows in a period; 0 when always enabled */
    window_count: number;
    /** Why it is always enabled; absent when it has windows */
    always_enabled_because?: ChestDrillWhy;
    /** Its windows are the generator's own (enable control AUTO), which a fallback may lengthen or drop */
    planned: boolean;
}

/** One take of the drill's item out of the chest: an inserter window's first tick takes all the hands planned for it */
interface TakerWindow {
    range: OpenRange;
    items: number;
}

/** An inserter that takes the drill's item out of its chest, with its windows and the items each window takes */
interface Taker {
    windows: TakerWindow[];
}

/** An inserter of the plan that takes the drill's item out of its chest */
interface PlannedTaker {
    inserter_id: string;
    inserter_number: number;
    /** Items of the drill's item it takes a tick at the target */
    rate: Fraction;
    /** Items of it in a hand */
    hand: number;
}

/** What a chest drill's windows are made from, the same for every clock of a config */
interface ChestDrillPlan {
    drill: MiningDrill;
    drill_id: number;
    chest: Chest;
    chest_id: number;
    item: string;
    /** The inserters that take its item out of the chest; empty when a reason keeps the drill always enabled */
    takers: PlannedTaker[];
    always_enabled_because?: ChestDrillWhy;
}

/** A drill whose windows were given by the config: CLOCKED, or the generator's with a margin */
interface ChestDrillConfig {
    plan: ChestDrillPlan;
    mode: "AUTO" | "CLOCKED" | "ALWAYS";
    /** Ticks each of the generator's windows starts earlier (the fallback's one tick longer) */
    extra_ticks: number;
    clocked?: { ranges: OpenRange[]; period?: number };
}

const plans_of = new WeakMap<Config, ChestDrillConfig[]>();

/** The drills of a config that drop into a chest, each with what its windows are made from */
function chestDrillsOf(config: Config): ChestDrillConfig[] {
    const known = plans_of.get(config);
    if (known !== undefined) {
        return known;
    }
    const drills = (config.drills?.configs ?? []).filter(drill => drill.target.type === "chest");
    let made: ChestDrillConfig[] = [];
    if (drills.length > 0) {
        const registry = createEntityRegistryFromConfig(config);
        const rates = takerRates(config, registry);
        made = drills.map(drill_config => {
            const drill = registry.getEntityByIdOrThrow(EntityId.forDrill(drill_config.id)) as MiningDrill;
            const chest = registry.getEntityByIdOrThrow(drill.sink_id) as Chest;
            const control = drill_config.overrides?.enable_control;
            const mode = control?.mode === EnableControlMode.CLOCKED ? "CLOCKED"
                : control?.mode === EnableControlMode.ALWAYS ? "ALWAYS" : "AUTO";
            const plan: ChestDrillPlan = { drill, drill_id: drill_config.id, chest, chest_id: drill_config.target.id, item: drill.item.name, takers: [] };
            const reason: ChestDrillWhy | null = mode === "ALWAYS" ? { kind: "config" } : alwaysEnabledBecause(plan, registry, rates);
            if (reason === null) {
                plan.takers = registry.getAll().filter(Entity.isInserter).flatMap(inserter => {
                    const rate = rates.get(inserter.entity_id.id)?.get(plan.item);
                    return inserter.source.entity_id.id === chest.entity_id.id && rate !== undefined
                        ? [{ inserter_id: inserter.entity_id.id, inserter_number: inserter.entity_id.number, rate, hand: handSizeFor(inserter, plan.item) }] : [];
                });
            } else {
                plan.always_enabled_because = reason;
            }
            return {
                plan, mode,
                extra_ticks: drill_config.overrides?.extra_window_ticks ?? 0,
                clocked: control?.mode === EnableControlMode.CLOCKED
                    ? { ranges: control.ranges.map(range => OpenRange.from(range.start, range.end)), period: control.period_duration_ticks }
                    : undefined,
            };
        });
    }
    plans_of.set(config, made);
    return made;
}

/**
 * The items each inserter moves a tick at the target, by inserter id and item: the plan's hands a cycle over the
 * cycle's ticks. The plan is made without a run of the build (one output swing a cycle fixes its units, and the rate is
 * the same for any count), as the at-target rates of the machines are.
 */
function takerRates(config: Config, registry: ReadableEntityRegistry): Map<string, Map<string, Fraction>> {
    const rates = new Map<string, Map<string, Fraction>>();
    const cycle = CraftingCyclePlan.create(TargetProductionRate.fromConfig(config.target_output), registry, fraction(1), config.overrides);
    for (const transfer of cycle.entity_transfer_map.values()) {
        if (!Entity.isInserter(transfer.entity)) {
            continue;
        }
        const inserter = transfer.entity;
        rates.set(inserter.entity_id.id, new Map(transfer.item_transfers.map(it =>
            [it.item_name, it.transfer_count.multiply(handSizeFor(inserter, it.item_name)).divide(cycle.total_duration_ticks)] as const)));
    }
    return rates;
}

/** Why nothing can time the drill, so that it stays always enabled; null when windows can be made for it */
function alwaysEnabledBecause(plan: ChestDrillPlan, registry: ReadableEntityRegistry, rates: Map<string, Map<string, Fraction>>): ChestDrillWhy | null {
    const chest_key = plan.chest.entity_id.id;
    const other_drill = registry.getAll().filter(Entity.isDrill).find(drill => drill.entity_id.id !== plan.drill.entity_id.id
        && drill.sink_id.id === chest_key && drill.item.name === plan.item);
    if (other_drill !== undefined) {
        return { kind: "other-drill", drill_number: other_drill.entity_id.number, item: plan.item };
    }
    const inserters = registry.getAll().filter(Entity.isInserter);
    const filler = inserters.find(inserter => inserter.sink.entity_id.id === chest_key && rates.get(inserter.entity_id.id)?.has(plan.item));
    if (filler !== undefined) {
        return { kind: "filler", inserter_number: filler.entity_id.number, item: plan.item };
    }
    const takers = inserters.filter(inserter => inserter.source.entity_id.id === chest_key && rates.get(inserter.entity_id.id)?.has(plan.item));
    if (takers.length === 0) {
        return { kind: "no-taker", item: plan.item };
    }
    return null;
}

/** Windows a period, from a whole-tick clock position: the ranges are inclusive, as clock windows are */
function inWindows(ranges: readonly OpenRange[], position: number): boolean {
    for (const range of ranges) {
        if (position >= range.start_inclusive && position <= range.end_inclusive) {
            return true;
        }
    }
    return false;
}

/** The items a taker takes in each of its windows: the hands of a period, shared by the windows' lengths */
function takerWindows(ranges: readonly OpenRange[], items_per_period: number, hand: number, wraps_at: number | null): TakerWindow[] {
    const hands = Math.ceil(items_per_period / hand - 1e-9);
    const lengths = ranges.map(range => range.end_inclusive - range.start_inclusive + 1);
    const total = lengths.reduce((sum, length) => sum + length, 0);
    const shares = lengths.map(length => hands * length / total);
    const given = shares.map(Math.floor);
    // the hands left over go to the windows with the largest remainders, the earlier first
    const order = shares.map((share, index) => ({ index, rest: share - given[index] })).sort((a, b) => b.rest - a.rest || a.index - b.index);
    for (let left = hands - given.reduce((sum, count) => sum + count, 0), at = 0; left > 0; left--, at++) {
        given[order[at % order.length].index]++;
    }
    const windows = ranges.map((range, index) => ({ range, items: given[index] * hand }));
    // a window that runs over the end of a whole-tick period into its start is one window: it takes in its first tick
    const first = windows[0];
    const last = windows[windows.length - 1];
    if (wraps_at !== null && windows.length > 1 && first.range.start_inclusive === 0 && last.range.end_inclusive >= wraps_at - 1) {
        last.items += first.items;
        first.items = 0;
    }
    return windows;
}

/** Ranges of whole positions of a period, a range that runs over its end carried to its start */
function rangesInPeriod(start: number, end: number, whole_period: number): OpenRange[] {
    const length = end - start + 1;
    if (length >= whole_period) {
        return [OpenRange.from(0, whole_period - 1)];
    }
    const from = ((start % whole_period) + whole_period) % whole_period;
    const to = from + length - 1;
    return to < whole_period ? [OpenRange.from(from, to)] : [OpenRange.from(from, whole_period - 1), OpenRange.from(0, to - whole_period)];
}

/** What a replay of a drill's windows against its chest's takers found */
interface ReplayOutcome {
    passes: boolean;
    /** The replay came back to a state it had been in at a period's start: what it found is what the clock repeats */
    proven: boolean;
}

/** Ticks a replay runs at most: it is one of many a generation makes */
const REPLAY_MAX_TICKS = 200_000;

/**
 * Runs the drill on `drill_windows` against its chest, tick by tick as the engine's own drill does
 * (`DrillChestWorkingMode`: drop what it holds as far as the chest has room, then mine while it holds nothing), and
 * the takers as the hardest case: each window takes all the hands planned for it in its first tick, before the drill
 * in that tick (inserters act first). It starts with the chest and the drill's hold empty, so the first period's takes
 * may come up short; every take after it has to find its hands. With nothing in the chest to start from, a drill that
 * brings less than is taken comes up short within the periods its first hold lasts. The replay ends when the state at
 * a period's start repeats (the steady state the clock repeats: the chest, the hold and the bars), or after
 * `min_periods` periods and as many more as the chest takes to fill and the drill to mine a few times at its top (a
 * window that has to mine when the hold runs out brings less than a period's takes, which the chest has to cover).
 */
function replay(plan: ChestDrillPlan, takers: readonly Taker[], drill_windows: readonly OpenRange[], period: number, min_periods: number, fill_periods: number): ReplayOutcome {
    const registry = createEntityRegistryForReplay(plan);
    const chest_state = new EntityStateFactory(registry).createStateForEntity(plan.chest.entity_id) as ChestState;
    const drill_state = DrillState.fromEntity(plan.drill);
    const mode = new DrillChestWorkingMode(drill_state, chest_state);
    const item = plan.item;
    const hold = () => drill_state.inventoryState.getQuantity(item);
    const stock = () => chest_state.getCurrentQuantity(item);

    const periods = Math.max(min_periods, Math.min(fill_periods, Math.floor(REPLAY_MAX_TICKS / period)));
    const last_tick = Math.min(Math.ceil(periods * period), Math.max(REPLAY_MAX_TICKS, Math.ceil(min_periods * period)));
    const was_in = takers.map(() => false);
    const seen = new Map<string, number>();
    let period_index = -1;
    for (let tick = 0; tick < last_tick; tick++) {
        const position = clockPosition(tick, period);
        const index = Math.floor(tick / period + 1e-9);
        if (index !== period_index) {
            period_index = index;
            // the first period's takes may come up short, so a cycle that holds is one of the periods after it
            if (index >= 1) {
                const key = `${position};${stock()};${hold()};${mode.stateKey()}`;
                if (seen.has(key)) {
                    return { passes: true, proven: true };
                }
                seen.set(key, index);
            }
        }
        for (let t = 0; t < takers.length; t++) {
            const window = takers[t].windows.find(it => position >= it.range.start_inclusive && position <= it.range.end_inclusive);
            const now_in = window !== undefined;
            if (now_in && !was_in[t]) {
                const got = Math.min(window.items, stock());
                if (got > 0) {
                    chest_state.inventoryState.removeQuantity(item, got);
                }
                if (got < window.items && tick >= period) {
                    return { passes: false, proven: false };
                }
            }
            was_in[t] = now_in;
        }
        if (inWindows(drill_windows, position)) {
            mode.executeForTick();
        }
    }
    return { passes: true, proven: false };
}

/** A registry with the drill's chest only, for a replay's fresh state of it */
function createEntityRegistryForReplay(plan: ChestDrillPlan): ReadableEntityRegistry {
    return {
        getAll: () => [plan.chest],
        getEntityById: (id: EntityId) => id.id === plan.chest.entity_id.id ? plan.chest : null,
        getEntityByIdOrThrow: (id: EntityId) => {
            if (id.id !== plan.chest.entity_id.id) {
                throw new Error(`No entity ${id.id} in a chest drill replay`);
            }
            return plan.chest;
        },
    } as unknown as ReadableEntityRegistry;
}

/** The windows of a chest drill on the generator's plan, with what they cost, or why it stays always enabled */
interface PlannedDrillWindows {
    ranges: OpenRange[] | null;
    enabled_ticks: number;
    always_enabled_because?: ChestDrillWhy;
}

/** Periods a period of part ticks is averaged over */
const AVERAGED_PERIODS = 64;

/** Enabled ticks a period of windows, on average for a period that is not a whole number of ticks */
function enabledTicks(ranges: readonly OpenRange[], period: number): number {
    // a period of part ticks is averaged over enough of them for its windows' ticks to even out
    const ticks = Number.isInteger(period) ? period : Math.ceil(period * AVERAGED_PERIODS);
    let enabled = 0;
    for (let tick = 0; tick < ticks; tick++) {
        if (inWindows(ranges, clockPosition(tick, period))) {
            enabled++;
        }
    }
    return enabled * period / ticks;
}

/** Steps of the margin the search for the fewest enabled ticks tries, before it gives up */
const MAX_EXTRA_STEPS = 24;

/** What the windows of one chest drill are made from in one clock, and the replay that checks them */
interface DrillWindowsSetup {
    /** The takes after the longest stretch without one, in order */
    order: { start: number; items: number }[];
    /** The indexes in `order` of the takes a window ends before */
    before: number[];
    /** Each window's ticks without a margin: what it serves over the drill's yield a tick */
    base: number[];
    whole_period: number;
    /** Whether windows keep the chest's takers supplied (see replay) */
    passes(ranges: OpenRange[]): boolean;
}

/**
 * The takes of the drill's item out of its chest in the clock's windows, the windows' places and their lengths without
 * a margin, and the replay; or why nothing can time the drill on these windows
 */
function drillWindowsSetup(plan: ChestDrillPlan, windows: ReadonlyMap<string, OpenRange[]>, period: number): DrillWindowsSetup | { because: ChestDrillWhy } {
    const whole_period = Math.ceil(period - 1e-9);
    const takers: Taker[] = [];
    for (const taker of plan.takers) {
        const ranges = OpenRange.reduceRanges(windows.get(taker.inserter_id) ?? []);
        if (ranges.length === 0) {
            return { because: { kind: "taker-without-window", inserter_number: taker.inserter_number, item: plan.item } };
        }
        const items = taker.rate.toDecimal() * period;
        const per_period = Math.abs(items - Math.round(items)) < 1e-6 ? Math.round(items) : Math.ceil(items);
        takers.push({ windows: takerWindows(ranges, per_period, taker.hand, Number.isInteger(period) ? period : null) });
    }
    const takes = takers.flatMap(taker => taker.windows).filter(it => it.items > 0)
        .sort((a, b) => a.range.start_inclusive - b.range.start_inclusive);
    if (takes.length === 0) {
        return { because: { kind: "no-take", item: plan.item } };
    }
    // takes that start in the same tick are one
    const starts: { start: number; items: number }[] = [];
    for (const take of takes) {
        const last = starts[starts.length - 1];
        if (last !== undefined && last.start === take.range.start_inclusive) {
            last.items += take.items;
        } else {
            starts.push({ start: take.range.start_inclusive, items: take.items });
        }
    }
    const demand = starts.reduce((sum, it) => sum + it.items, 0);
    const room = new EntityStateFactory(createEntityRegistryForReplay(plan)).createStateForEntity(plan.chest.entity_id) as ChestState;
    const capacity = room.getAvailableSpace(plan.item);
    if (capacity <= 0) {
        return { because: { kind: "no-room", item: plan.item } };
    }

    // the first window ends before the first take after the longest stretch without one
    const gap = (index: number) => {
        const previous = starts[(index - 1 + starts.length) % starts.length].start;
        return ((starts[index].start - previous) % whole_period + whole_period) % whole_period || whole_period;
    };
    let anchor = 0;
    for (let index = 1; index < starts.length; index++) {
        if (gap(index) > gap(anchor)) {
            anchor = index;
        }
    }
    const order = starts.map((_, step) => starts[(anchor + step) % starts.length]);
    // a window more where what is taken since the last one would not fit in the chest
    const before: number[] = [0];
    let taken = 0;
    for (let index = 0; index < order.length; index++) {
        if (index > 0 && taken + order[index].items > capacity) {
            before.push(index);
            taken = 0;
        }
        taken += order[index].items;
    }
    const served = before.map((first, at) => order.slice(first, before[at + 1] ?? order.length).reduce((sum, it) => sum + it.items, 0));
    const per_tick = plan.drill.production_rate.amount_per_tick.toDecimal();
    const base = served.map(items => Math.max(1, Math.ceil(items / per_tick - 1e-9)));
    // the replay lasts as long as a mining tick's yield takes to be taken, the chest to fill, and three times more
    const mining_periods = Math.ceil(per_tick / Math.max(1, demand));
    const min_periods = mining_periods + 2;
    return {
        order, before, base, whole_period,
        passes: ranges => {
            const supply = Math.max(1e-9, Math.min(enabledTicks(ranges, period) * per_tick, capacity + per_tick) - demand);
            const fill_periods = min_periods + 3 * mining_periods + Math.ceil(capacity / supply);
            return replay(plan, takers, ranges, period, min_periods, fill_periods).passes;
        },
    };
}

/** The windows ending the tick before each take of `before`, each its `base` ticks and `extra` more long */
function windowsWith(setup: DrillWindowsSetup, extra: number): OpenRange[] {
    return OpenRange.reduceRanges(setup.before.flatMap((first, at) => {
        const end = setup.order[first].start - 1;
        return rangesInPeriod(end - (setup.base[at] + extra) + 1, end, setup.whole_period);
    }));
}

/**
 * The fewest windows for a drill into a chest, from the windows of the chest's takers (see docs/drills.md, "A drill
 * into a chest on a clock"):
 * - each window ends the tick before a take, so the chest is topped up just in time;
 * - the first ends before the first take after the longest stretch of the period without one; the next ones are put
 *   in greedily, so that what is taken between two windows fits in the chest's room for the item;
 * - each window is as long as the ticks the drill needs to mine what is taken until the next window, and a margin is
 *   added to all of them until the replay passes; the drop of a window's last mining tick is carried in the drill's
 *   hold to the next window, so it costs no tick in the steady state.
 */
function plannedWindows(plan: ChestDrillPlan, windows: ReadonlyMap<string, OpenRange[]>, period: number, extra_ticks: number): PlannedDrillWindows {
    const setup = drillWindowsSetup(plan, windows, period);
    if ("because" in setup) {
        return { ranges: null, enabled_ticks: 0, always_enabled_because: setup.because };
    }
    const passes = (extra: number) => setup.passes(windowsWith(setup, extra));
    const whole = (extra: number) => windowsWith(setup, extra).reduce((sum, range) => sum + range.end_inclusive - range.start_inclusive + 1, 0) >= setup.whole_period;

    // the smallest margin that passes: up a step at a time, then by doubling, then back by halving
    let low = -1;
    let high: number | null = null;
    for (let extra = 0, step = 0; step < MAX_EXTRA_STEPS && !whole(extra); step++) {
        if (passes(extra)) {
            high = extra;
            break;
        }
        low = extra;
        extra = extra < 4 ? extra + 1 : extra * 2;
    }
    if (high === null) {
        return { ranges: null, enabled_ticks: 0, always_enabled_because: { kind: "needs-whole-period" } };
    }
    while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (passes(middle)) {
            high = middle;
        } else {
            low = middle;
        }
    }
    if (whole(high + extra_ticks)) {
        return { ranges: null, enabled_ticks: 0, always_enabled_because: { kind: "would-cover-period" } };
    }
    const ranges = windowsWith(setup, high + extra_ticks);
    return { ranges, enabled_ticks: enabledTicks(ranges, period) };
}

/**
 * Whether `drill_windows` keep the chest of drill `drill_id` supplied for the takers' `windows`, by the replay the
 * windows are made with (see chestDrillWindows); null when nothing times the drill
 */
export function chestDrillWindowsKeepUp(config: Config, windows: Map<string, OpenRange[]>, period: number, drill_id: number, drill_windows: OpenRange[]): boolean | null {
    const drill = chestDrillsOf(config).find(it => it.plan.drill_id === drill_id);
    if (drill === undefined || drill.plan.always_enabled_because !== undefined) {
        return null;
    }
    const setup = drillWindowsSetup(drill.plan, windows, period);
    return "because" in setup ? null : setup.passes(drill_windows);
}

/** A CLOCKED drill's windows in the clock's period: its ranges, repeated with its own period when it gives one */
function clockedWindows(clocked: NonNullable<ChestDrillConfig["clocked"]>, period: number): OpenRange[] {
    const own = clocked.period;
    const whole_period = Math.ceil(period - 1e-9);
    if (own === undefined || own >= whole_period) {
        return OpenRange.reduceRanges(clocked.ranges.flatMap(range => range.start_inclusive < whole_period
            ? [OpenRange.from(range.start_inclusive, Math.min(range.end_inclusive, whole_period - 1))] : []));
    }
    const ranges: OpenRange[] = [];
    for (let offset = 0; offset < whole_period; offset += own) {
        for (const range of clocked.ranges) {
            const start = offset + range.start_inclusive;
            if (start < whole_period) {
                ranges.push(OpenRange.from(start, Math.min(offset + Math.min(range.end_inclusive, own - 1), whole_period - 1)));
            }
        }
    }
    return OpenRange.reduceRanges(ranges);
}

/**
 * The clock's windows with those of each drill into a chest, made from its takers' windows in `windows`, and what each
 * such drill gets. A drill whose key `windows` already has keeps it (an exported clock carries them); one the config
 * sets to always enabled, or that nothing can time, gets none and so stays always enabled. Returns `windows` itself
 * when it adds nothing.
 */
export function chestDrillWindows(config: Config, windows: Map<string, OpenRange[]>, period: number): { windows: Map<string, OpenRange[]>; drills: ChestDrillClock[] } {
    const drills = chestDrillsOf(config);
    if (drills.length === 0) {
        return { windows, drills: [] };
    }
    let result = windows;
    const reports: ChestDrillClock[] = [];
    for (const { plan, mode, extra_ticks, clocked } of drills) {
        const key = plan.drill.entity_id.id;
        const report = { drill_id: plan.drill_id, chest_id: plan.chest_id, chest_type: plan.chest.chest_type, item: plan.item, planned: mode === "AUTO" };
        const given = windows.get(key);
        if (given !== undefined) {
            reports.push(given.length === 0
                ? { ...report, enabled_ticks: null, window_count: 0, always_enabled_because: plan.always_enabled_because ?? { kind: "windows-did-not-hold" } }
                : { ...report, enabled_ticks: enabledTicks(given, period), window_count: given.length });
            continue;
        }
        let ranges: OpenRange[] | null = null;
        let because = plan.always_enabled_because;
        if (mode === "CLOCKED") {
            ranges = clockedWindows(clocked!, period);
            because = undefined;
        } else if (because === undefined) {
            const made = plannedWindows(plan, windows, period, extra_ticks);
            ranges = made.ranges;
            because = made.always_enabled_because;
        }
        if (ranges === null || ranges.length === 0) {
            reports.push({ ...report, enabled_ticks: null, window_count: 0, always_enabled_because: because ?? { kind: "no-window" } });
            continue;
        }
        if (result === windows) {
            result = new Map(windows);
        }
        result.set(key, ranges);
        reports.push({ ...report, enabled_ticks: enabledTicks(ranges, period), window_count: ranges.length });
    }
    return { windows: result, drills: reports };
}

/** The clock's windows with those of each drill into a chest (see chestDrillWindows) */
export function withChestDrillWindows(config: Config, windows: Map<string, OpenRange[]>, period: number): Map<string, OpenRange[]> {
    return chestDrillWindows(config, windows, period).windows;
}

/** Whether the config has a drill into a chest whose windows the generator makes (no enable control, or AUTO) */
export function hasPlannedChestDrill(config: Config): boolean {
    return chestDrillsOf(config).some(it => it.mode === "AUTO" && it.plan.always_enabled_because === undefined);
}

/**
 * The config a fallback runs a clock on when the fewest windows of its drills into chests do not hold it: each such
 * drill's windows a tick longer, or the drill always enabled, as before the drill had windows
 */
export function chestDrillFallbackConfig(config: Config, fallback: "one tick longer" | "always enabled"): Config {
    return {
        ...config,
        drills: config.drills === undefined ? undefined : {
            ...config.drills,
            configs: config.drills.configs.map(drill => {
                const mode = drill.overrides?.enable_control?.mode;
                if (drill.target.type !== "chest" || (mode !== undefined && mode !== EnableControlMode.AUTO)) {
                    return drill;
                }
                return {
                    ...drill,
                    overrides: fallback === "always enabled"
                        ? { ...drill.overrides, enable_control: { mode: EnableControlMode.ALWAYS } }
                        : { ...drill.overrides, extra_window_ticks: (drill.overrides?.extra_window_ticks ?? 0) + 1 },
                };
            }),
        },
    };
}

/** One line per drill into a chest: its windows, or why it stays always enabled */
export function chestDrillClockLine(drill: ChestDrillClock): string {
    const what = `Drill ${drill.drill_id} into ${chestName(drill.chest_type, drill.chest_id)}`;
    if (drill.enabled_ticks === null) {
        return `${what}: always enabled, since ${drill.always_enabled_because === undefined ? "nothing times it" : chestDrillBecause(drill.always_enabled_because)}`;
    }
    const ticks = Number(drill.enabled_ticks.toFixed(2));
    return `${what}: enabled ${ticks} tick${ticks === 1 ? "" : "s"} a period, in ${drill.window_count} window${drill.window_count === 1 ? "" : "s"}`;
}
