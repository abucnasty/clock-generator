/**
 * Whether a clock survives backpressure loss (GOALS.md, "Backpressure Loss"): an item of the build stops arriving for
 * a while, or its output stops being taken, the machines run dry or fill up, and when it comes back the build has to
 * return to its expected output under the same clock by itself.
 *
 * A loss is run as the rule words it. The belts and chests around a build are a supply that is always full and a
 * place that always takes; for the length of a loss one item is withheld from them, or one is refused by them (see
 * SupplyGate). The loss lasts until the build has stopped: nothing was picked up, dropped, crafted or burned for a
 * whole period, so every machine that depends on the item is dry or full and everything else has backed up to its
 * limits. Then the item comes back, at a place in the clock period the trial names, and what the output inserters drop
 * is counted period by period from that tick on.
 *
 * The trials of a loss are the same for every build and every clock (see LOSS_PLACES and LOSS_SHARES): the loss is
 * cut at four places in the clock period, and at each it lasts a quarter, a half, three quarters and all of the time
 * the build takes to stop. A loss that runs its course is restored at the place in the period it was cut at. Where
 * the clock stands when the item comes back decides which window sees a machine first, and a loss that ends before
 * the build has stopped leaves the machines part empty or part full, which one that runs its course never does.
 * One run makes the trials of a loss one after the other.
 *
 * A clock is not tried further than it has to be. The trials of a loss stop at the first that does not get back, and
 * the losses of a clock at the first it does not get back from (see backpressureLossOf): the clock does not recover
 * whatever the rest do, and the losses left are reported as not tried. A clock that gets back from everything runs
 * every trial.
 */
import { SimulationTick } from "./runner/simulation-tick";
import { FactorioDataService, ItemName } from "../data";
import { Chest, Entity, EntityId, ReadableEntityRegistry } from "../entities";
import { EntityState, InserterState } from "../state";
import { simulationStateKey } from "./runner/steady-state";
import { SimulationContext } from "./sequence/simulation-context";
import { ExportShortfall, ExportedItem, exportShortfallOfBins } from "./export-delivery";

export type BackpressureLoss =
    /** Nothing is cut: the run as it is, counted as the runs with a loss are */
    | { kind: "none" }
    /** The item stops arriving: no belt and no infinity chest has it */
    | { kind: "supply"; item: ItemName }
    /** The item is not taken away: the belts are full of it, and so are the chests the build puts it into */
    | { kind: "output"; item: ItemName };

/** "supply:coal", "output:advanced-circuit", "none" */
export function lossId(loss: BackpressureLoss): string {
    return loss.kind === "none" ? loss.kind : `${loss.kind}:${loss.item}`;
}

/** "coal stops arriving", "advanced-circuit is not taken away" */
export function lossLabel(loss: BackpressureLoss): string {
    if (loss.kind === "none") {
        return "nothing is cut";
    }
    return loss.kind === "output" ? `${loss.item} is not taken away` : `${loss.item} stops arriving`;
}

/** One trial of a loss: where in the clock period it starts, in ticks from the start of a period, and when it ends */
type LossTrialPlan =
    /** The loss lasts until the build has stopped, and ends at this place in the period */
    | { cut_at: number; restore_at: number }
    /** The loss lasts this many ticks, whatever the build is doing by then */
    | { cut_at: number; loss_ticks: number };

/** Places in the clock period a loss is cut at, as shares of the period */
export const LOSS_PLACES: readonly number[] = [0, 1 / 4, 1 / 2, 3 / 4];
/**
 * How long a loss lasts, as shares of the ticks the build takes to stop once the item is gone. 1 is a loss that
 * runs its course: it lasts until the build has stopped, and is restored at the place in the period it was cut at.
 */
export const LOSS_SHARES: readonly number[] = [1 / 4, 1 / 2, 3 / 4, 1];

/** The trials of a loss that runs its course: one for each place */
export function lossTrialsUntilStopped(bin_ticks: number, places: readonly number[] = LOSS_PLACES): LossTrialPlan[] {
    return places.map(place => ({ cut_at: Math.floor(place * bin_ticks), restore_at: Math.floor(place * bin_ticks) }));
}

/**
 * The trials of a loss that ends part of the way: for each share under 1 and each place, a loss of that share of
 * `stops_after_ticks`, the ticks the build takes to stop.
 */
export function lossTrialsPartOfTheWay(
    bin_ticks: number,
    stops_after_ticks: number,
    places: readonly number[] = LOSS_PLACES,
    shares: readonly number[] = LOSS_SHARES,
): LossTrialPlan[] {
    return shares.filter(share => share < 1).flatMap(share => places.map(place =>
        ({ cut_at: Math.floor(place * bin_ticks), loss_ticks: Math.max(1, Math.ceil(share * stops_after_ticks)) })));
}

/** A loss ends at the latest after this many periods, whether the build has stopped or not */
export const MAX_LOSS_PERIODS = 200;
/**
 * A build whose items spoil is tried only with losses shorter than this share of the shortest spoil time of its items
 * (see lossLimitOf).
 */
export const SPOIL_LIMIT_SHARE = 3 / 4;

/** The losses a build whose items spoil is tried with: shorter than `ticks`, which `item`, its first to spoil, sets */
export interface LossLimit {
    ticks: number;
    item: ItemName;
}

/**
 * The limit of the losses a build is tried with, when an item of it spoils: SPOIL_LIMIT_SHARE of the spoil time of the
 * item that spoils first, of every item its machines take, make or burn and its inserters are set to move. In the game
 * a loss longer than that spoils the items the build holds, and no clock brings it back: a loss reaches them later than
 * it starts (the items in a machine are older than the loss), and an item that comes back takes a while to reach them.
 * Null for a build none of whose items spoil.
 */
export function lossLimitOf(
    entity_registry: Pick<ReadableEntityRegistry, "getAll">,
    spoilTicksOf: (item: ItemName) => number | null = item => FactorioDataService.itemSpoilTicks(item),
): LossLimit | null {
    const items = new Set<ItemName>();
    for (const entity of entity_registry.getAll()) {
        if (Entity.isMachine(entity)) {
            entity.inputs.forEach((_, item) => items.add(item));
            entity.outputs.forEach(output => items.add(output.item_name));
            if (entity.fuel_slot !== undefined) {
                items.add(entity.fuel_slot.fuel.item_name);
            }
        } else if (Entity.isInserter(entity)) {
            entity.filtered_items.forEach(item => items.add(item));
        }
    }
    let first: { item: ItemName; spoil_ticks: number } | null = null;
    for (const item of Array.from(items).sort()) {
        const spoil_ticks = spoilTicksOf(item);
        if (spoil_ticks !== null && (first === null || spoil_ticks < first.spoil_ticks)) {
            first = { item, spoil_ticks };
        }
    }
    return first === null ? null : { ticks: first.spoil_ticks * SPOIL_LIMIT_SHARE, item: first.item };
}
/**
 * Periods after the item is back in which the build has to be at its expected output again. A run on clock windows
 * alone repeats once its state does, so most trials end long before: with the state of a period boundary seen
 * before, what the build did since then is what it does for good.
 */
export const MAX_RECOVERY_PERIODS = 40;
/**
 * Where the state cannot be compared (a fuel inserter on a clock of its own does not repeat with the period), the
 * build has recovered when this many periods at the end of the recovery are all at the expected output.
 */
const RECOVERY_HOLD_PERIODS = 8;
/**
 * A trial that is short late in its window runs on (see runsOn): until this many periods at the expected output follow
 * its last short one, or its state repeats, and is judged on them. More than any stretch at the expected output that a
 * short period followed in the samples' trials (35 periods, agricultural science's batched swings after a loss of
 * nutrients, run on to 200 periods); as many as the window has (MAX_RECOVERY_PERIODS), a choice of its own.
 */
export const RUN_ON_EXACT_PERIODS = 40;
/** A trial that runs on ends at the latest this many periods after the item is back */
export const MAX_RUN_ON_PERIODS = 200;
/**
 * A trial is short late when it was at the expected output in the RECOVERY_HOLD_PERIODS before this mark (as a recovery
 * without a repeated state has to end) and is short after it only: it would be back in a window this long, and falls
 * short in the last RECOVERY_HOLD_PERIODS of MAX_RECOVERY_PERIODS.
 */
export const LATE_AFTER_PERIODS = MAX_RECOVERY_PERIODS - RECOVERY_HOLD_PERIODS;

/**
 * Whether a trial that is not back at the end of its window runs on: no state of it repeated (one that did proves what
 * it does for good), its last short bin comes after `late_after_bins` bins of the window, and the `back_bins` bins
 * before those were all at the expected output. A bin of many periods (a subtick clock's) leaves no room for that: such
 * a trial does not run on.
 */
export function runsOn(
    output_per_bin: readonly number[],
    expected_per_bin: number,
    repeats_from: number | null,
    late_after_bins: number,
    back_bins: number,
): boolean {
    if (repeats_from !== null || late_after_bins < back_bins || back_bins < 1) {
        return false;
    }
    let last_off = -1;
    output_per_bin.forEach((items, index) => {
        if (items !== expected_per_bin) {
            last_off = index;
        }
    });
    return last_off >= late_after_bins
        && output_per_bin.slice(late_after_bins - back_bins, late_after_bins).every(items => items === expected_per_bin);
}

export interface BackpressureLossOptions {
    loss: BackpressureLoss;
    /** Ticks of the clock period the windows are of */
    period_ticks: number;
    /** Items the output inserters are expected to drop in a period */
    expected_output_items: number;
    /** Places in the period to cut at, in place of LOSS_PLACES: fewer make the run shorter */
    places?: readonly number[];
    /** Shares of the time the build takes to stop, in place of LOSS_SHARES */
    shares?: readonly number[];
    max_loss_periods?: number;
    max_recovery_periods?: number;
    recovery_hold_periods?: number;
    /** In place of RUN_ON_EXACT_PERIODS */
    run_on_exact_periods?: number;
    /** In place of MAX_RUN_ON_PERIODS; 0 or less than the window: no trial runs on */
    max_run_on_periods?: number;
    /** In place of LATE_AFTER_PERIODS */
    late_after_periods?: number;
    /** A loss lasts fewer ticks than this (see lossLimitOf); without it, as long as the build takes to stop */
    loss_limit_ticks?: number;
}

export interface LossTrial {
    /** Where in the period the item went, in ticks */
    cut_at: number;
    /** Where in the period it came back */
    restore_at: number;
    /** Whether the loss lasted until the build had stopped; false for one that was planned to end part of the way */
    until_stopped: boolean;
    /** Ticks the item was gone */
    loss_ticks: number;
    /** The loss was to last until the build had stopped, and ended at the loss limit first (loss_limit_ticks) */
    ended_at_limit?: true;
    /** What the output inserters dropped in those ticks */
    output_during_loss: number;
    /** Ticks from the cut to the last thing the build did; null when it was still doing something as the loss ended */
    stopped_after_ticks: number | null;
    /** What the output inserters dropped in each bin after the item was back, the first bin starting in that tick */
    output_per_bin: number[];
    /** The build is back at exactly its expected output in every bin, and stays there */
    recovers: boolean;
    /** Bins after the item was back that were not at the expected output, the last one counted; null when it does not recover */
    recovered_after_bins: number | null;
    /** The state of the build repeated, so what it did in its last bins it does for good; without it the verdict is of the bins run */
    proven: boolean;
    /** The bins the build ended in: those that repeat when `proven`, or the last ones it was held to */
    ends_in: number[];
    /** Bins run past the recovery window, as a trial short late in it runs on; absent when it did not */
    ran_on_bins?: number;
    /**
     * The export belts that received less than their consumers take in those bins; absent when none did. A build that
     * is at its expected output and shortchanges an export has not recovered.
     */
    export_shortfalls?: ExportShortfall[];
}

/** An export belt of the build, with the inserters that fill it as the simulation holds them */
export interface WatchedExport {
    exported: ExportedItem;
    fillers: readonly InserterState[];
}

export interface LossOutcome {
    loss: BackpressureLoss;
    /** Ticks in a bin: the clock period, or the whole ticks after which a fractional period repeats */
    bin_ticks: number;
    /** Clock periods in a bin */
    periods_per_bin: number;
    expected_per_bin: number;
    /** Trials from the canonical start, or the first lane-phase start that fails, up to the first that does not recover. */
    trials: LossTrial[];
    /** Every trial recovers at every checked lane-phase start. */
    recovers: boolean;
    /** The most bins a trial took to be back at the expected output; null when one does not recover */
    recovered_after_bins: number | null;
    /** The most ticks the build went on after a cut, over the trials that ran their course; null when it had not stopped at the cap in one of them */
    stopped_after_ticks: number | null;
    /** Additional lane-phase starts checked after the canonical start. */
    pickup_phase_starts_checked?: number;
    /** First failing lane-phase start; values are public 1/32-tile units, keyed by inserter ID. */
    failed_pickup_phases?: Record<string, readonly [number, number]>;
    /** Ticks simulated across all checked starts. */
    ticks: number;
}

/**
 * The losses a build can have: one for each item an inserter takes off a belt or out of an infinity chest, and one
 * for each item an inserter puts onto a belt or into a chest nothing takes from. The product the build is for comes
 * first among the last kind. A mining drill is no supply that stops: the ore is in the ground. Fluids are left out,
 * as the simulator leaves them out: a loss of a fluid is not tried.
 */
export function backpressureLossesOf(entity_registry: Pick<ReadableEntityRegistry, "getAll" | "getEntityById">, target_item?: ItemName): BackpressureLoss[] {
    const inserters = entity_registry.getAll().filter(Entity.isInserter);
    const supplied = new Set<ItemName>();
    const taken_away = new Set<ItemName>();
    for (const inserter of inserters) {
        const source = entity_registry.getEntityById(inserter.source.entity_id);
        if (source !== null && (Entity.isBelt(source) || (Entity.isChest(source) && Chest.isInfinityChest(source)))) {
            inserter.filtered_items.forEach(item_name => supplied.add(item_name));
        }
        const sink = entity_registry.getEntityById(inserter.sink.entity_id);
        if (sink !== null && (Entity.isBelt(sink) || (Entity.isChest(sink) && !isEmptiedByTheBuild(inserters, sink.entity_id)))) {
            itemsCarried(entity_registry, inserter).forEach(item_name => taken_away.add(item_name));
        }
    }
    const outputs = Array.from(taken_away).sort((a, b) => Number(b === target_item) - Number(a === target_item));
    return [
        ...Array.from(supplied, item => ({ kind: "supply", item }) as const),
        ...outputs.map(item => ({ kind: "output", item }) as const),
    ];
}

/** Whether an inserter of the build takes from the chest, so that what is put into it does not stay */
export function isEmptiedByTheBuild(inserters: readonly { source: { entity_id: EntityId } }[], chest_id: EntityId): boolean {
    return inserters.some(it => it.source.entity_id.id === chest_id.id);
}

/** The items an inserter moves: its filters, or without any, what the machine it takes from makes */
export function itemsCarried(entity_registry: Pick<ReadableEntityRegistry, "getEntityById">, inserter: { filtered_items: Set<ItemName>; source: { entity_id: EntityId } }): ItemName[] {
    if (inserter.filtered_items.size > 0) {
        return Array.from(inserter.filtered_items);
    }
    const source = entity_registry.getEntityById(inserter.source.entity_id);
    return source !== null && Entity.isMachine(source) ? source.outputs.map(output => output.item_name) : [];
}

/** What a loss switches off, and on again when it is over */
function switchOf(context: SimulationContext, loss: BackpressureLoss): { cut(): void; restore(): void } {
    if (loss.kind === "none") {
        return { cut: () => { }, restore: () => { } };
    }
    // on every belt and chest that gives the item, or that the build puts it into
    const inserters = context.inserters.map(it => it.inserter_state.inserter);
    const sets: Set<ItemName>[] = [];
    for (const state of context.state_registry.getAllStates()) {
        if (EntityState.isBelt(state)) {
            sets.push(loss.kind === "supply" ? state.supply.withheld : state.supply.refused);
        } else if (EntityState.isInfinityChest(state) || EntityState.isFiniteChest(state)) {
            if (loss.kind === "supply" && EntityState.isInfinityChest(state)) {
                sets.push(state.supply.withheld);
            }
            // a chest that refuses an item has no room for anything, so only the chests the item ends in are closed
            const ends_here = !isEmptiedByTheBuild(inserters, state.entity_id) && inserters.some(inserter =>
                inserter.sink.entity_id.id === state.entity_id.id && itemsCarried(context.entity_registry, inserter).includes(loss.item));
            if (loss.kind === "output" && ends_here) {
                sets.push(state.supply.refused);
            }
        }
    }
    return {
        cut: () => sets.forEach(set => set.add(loss.item)),
        restore: () => sets.forEach(set => set.delete(loss.item)),
    };
}

/**
 * Whether the build is back at its expected output, from what it dropped in each bin after the item came back.
 *
 * @param repeats_from with the state at the end of the last bin equal to the state at the end of this bin (0: the
 *                     tick the item came back), the bins after it repeat for good; null when no state repeated
 * @param hold_bins without a repeat, the bins at the end that all have to be at the expected output
 */
export function judgeRecovery(
    output_per_bin: readonly number[],
    expected_per_bin: number,
    repeats_from: number | null,
    hold_bins: number,
): Pick<LossTrial, "recovers" | "recovered_after_bins" | "proven" | "ends_in"> {
    const proven = repeats_from !== null;
    const ends_in = proven ? output_per_bin.slice(repeats_from) : output_per_bin.slice(-hold_bins);
    const held = proven || output_per_bin.length >= hold_bins;
    const recovers = held && ends_in.length > 0 && ends_in.every(items => items === expected_per_bin);
    let last_off = -1;
    output_per_bin.forEach((items, index) => {
        if (items !== expected_per_bin) {
            last_off = index;
        }
    });
    return { recovers, recovered_after_bins: recovers ? last_off + 1 : null, proven, ends_in };
}

/**
 * A recovery that also holds the export belts to what their consumers take, in the bins the output is judged on: the bins
 * that repeat when the state did, or the last ones the build was held to. A build at its expected output that comes up short
 * on an export has not recovered.
 */
export function judgedWithExports(
    judged: Pick<LossTrial, "recovers" | "recovered_after_bins" | "proven" | "ends_in">,
    watched: readonly WatchedExport[],
    export_per_bin: readonly (readonly number[])[],
    bin_ticks: number,
    repeats_from: number | null,
    hold_bins: number,
): Pick<LossTrial, "recovers" | "recovered_after_bins" | "proven" | "ends_in" | "export_shortfalls"> {
    const short = watched.flatMap((it, at) => {
        const bins = repeats_from !== null ? export_per_bin[at].slice(repeats_from) : export_per_bin[at].slice(-hold_bins);
        return bins.length === 0 ? [] : exportShortfallOfBins(it.exported, bins, bin_ticks, judged.proven) ?? [];
    });
    return short.length === 0 ? judged : { ...judged, recovers: false, recovered_after_bins: null, export_shortfalls: short };
}

/**
 * Runs the trials of one loss on a build that is running on its clock, and leaves it wherever the last one ends. The
 * trials stop at the first that does not get back to the expected output: the loss is one the clock does not recover
 * from, and the trials after it would say nothing more.
 *
 * @param context the build on its clock windows, warmed up
 * @param output_inserters the inserters whose drops are the output of the build
 * @param bin whole ticks the output is counted in, and the clock periods they are
 * @param quiet_ticks ticks without anything done after which the build has stopped: a period, or the longest clock of
 *                    an inserter that has one of its own
 * @param watched_exports the belts with a consumption rate, whose deliveries in the bins the build ends in are held to what their
 *                consumers take as the output is held to its expected output
 * @param proof_stride bins between boundaries whose equal states repeat for good: 1 when every inserter is on the
 *                     clock of the period or always enabled, more when inserters have clocks of their own (fuel),
 *                     which stand at the same place only every merged period (see provenRepeatBin); null when a
 *                     repeated state proves nothing (some control decides from more than the tick)
 */
export function runLossTrials(
    context: SimulationContext,
    output_inserters: readonly InserterState[],
    options: BackpressureLossOptions,
    bin: { ticks: number; periods: number },
    quiet_ticks: number,
    proof_stride: number | null,
    watched_exports: readonly WatchedExport[] = [],
): LossOutcome {
    const { loss } = options;
    const expected_per_bin = options.expected_output_items * bin.periods;
    // the most ticks a loss lasts: until the build has stopped, at most the periods of MAX_LOSS_PERIODS, and shorter
    // than the loss limit of a build whose items spoil
    const limit_ticks = options.loss_limit_ticks !== undefined ? Math.max(1, Math.ceil(options.loss_limit_ticks) - 1) : Infinity;
    const max_loss_ticks = Math.min(limit_ticks, Math.ceil((options.max_loss_periods ?? MAX_LOSS_PERIODS) * options.period_ticks));
    const max_recovery_bins = Math.max(1, Math.ceil((options.max_recovery_periods ?? MAX_RECOVERY_PERIODS) / bin.periods));
    const hold_bins = Math.max(1, Math.ceil((options.recovery_hold_periods ?? RECOVERY_HOLD_PERIODS) / bin.periods));
    const max_run_on_bins = Math.floor((options.max_run_on_periods ?? MAX_RUN_ON_PERIODS) / bin.periods);
    const run_on_bins = Math.max(1, Math.ceil((options.run_on_exact_periods ?? RUN_ON_EXACT_PERIODS) / bin.periods));
    const late_after_bins = Math.floor((options.late_after_periods ?? LATE_AFTER_PERIODS) / bin.periods);
    const places = options.places ?? LOSS_PLACES;
    const shares = options.shares ?? LOSS_SHARES;
    const plans: LossTrialPlan[] = loss.kind === "none" ? [{ cut_at: 0, loss_ticks: 0 }]
        : shares.includes(1) ? lossTrialsUntilStopped(bin.ticks, places) : [{ cut_at: 0, restore_at: 0 }];
    // the trials that end part of the way are planned once it is known how long the build takes to stop
    let part_of_the_way_planned = loss.kind === "none";

    // a tick as the simulate step runs it
    const control_logic = new SimulationTick(context);
    const now = () => context.tick_provider.getCurrentTick();
    const start_tick = now();
    const step = () => control_logic.executeForTick();
    const runUntilPhase = (phase: number) => {
        const wanted = ((phase % bin.ticks) + bin.ticks) % bin.ticks;
        while ((now() - start_tick) % bin.ticks !== wanted) {
            step();
        }
    };
    const dropped = () => output_inserters.reduce((sum, state) => sum + state.items_dropped, 0);

    // What the build does: every item an inserter moves and every product a machine finishes is counted, and a
    // machine that crafts moves its bars. A drill puts into a machine without a count, which the stock shows; a drill
    // into a chest fills it while every inserter may idle, so its hold and its chest are watched too.
    const inserter_states = context.inserters.map(it => it.inserter_state);
    const machine_states = context.machines.map(it => it.machine_state);
    const watch_stock = context.drills.length > 0;
    const chest_drills = context.drills.flatMap(it => {
        const sink = context.state_registry.getStateByEntityId(it.drill_state.drill.sink_id);
        return sink !== null && EntityState.isChest(sink) ? [{ drill: it.drill_state, chest: sink }] : [];
    });
    // asked every tick of a loss: the two buffers are swapped instead of built anew
    const slots = inserter_states.length * 2 + machine_states.length * (watch_stock ? 4 : 3) + chest_drills.length * 2;
    let seen = new Float64Array(slots);
    let last_seen = new Float64Array(slots);
    let seen_before = false;
    const didSomething = (): boolean => {
        const current = seen;
        let at = 0;
        for (let index = 0; index < inserter_states.length; index++) {
            const state = inserter_states[index];
            current[at++] = state.items_picked_up;
            current[at++] = state.items_dropped;
        }
        for (let index = 0; index < machine_states.length; index++) {
            const state = machine_states[index];
            current[at++] = state.productsFinished;
            current[at++] = state.craftingProgress.progress;
            current[at++] = state.bonusProgress.progress;
            if (watch_stock) {
                current[at++] = state.inventoryState.getTotalQuantity();
            }
        }
        for (let index = 0; index < chest_drills.length; index++) {
            current[at++] = chest_drills[index].drill.inventoryState.getTotalQuantity();
            current[at++] = chest_drills[index].chest.getCurrentQuantity();
        }
        let changed = !seen_before;
        seen_before = true;
        if (!changed) {
            for (let index = 0; index < slots; index++) {
                if (current[index] !== last_seen[index]) {
                    changed = true;
                    break;
                }
            }
        }
        seen = last_seen;
        last_seen = current;
        return changed;
    };

    const supply = switchOf(context, loss);
    const trials: LossTrial[] = [];
    for (let index = 0; index < plans.length; index++) {
        const plan = plans[index];
        const until_stopped = "restore_at" in plan;
        let loss_ticks = 0;
        let output_during_loss = 0;
        let stopped_after_ticks: number | null = null;
        let ended_at_limit = false;
        if (loss.kind !== "none") {
            runUntilPhase(plan.cut_at);
            supply.cut();
            const cut_tick = now();
            const dropped_at_cut = dropped();
            const lasts_ticks = until_stopped ? max_loss_ticks : plan.loss_ticks;
            let last_done_tick = cut_tick;
            // whatever a tick throws, what was cut is back: the wires of the clocks are those of every run
            try {
                didSomething();
                while (now() - cut_tick < lasts_ticks) {
                    step();
                    if (didSomething()) {
                        last_done_tick = now();
                    } else if (now() - last_done_tick >= quiet_ticks) {
                        stopped_after_ticks = last_done_tick - cut_tick;
                        if (until_stopped) {
                            break;
                        }
                    }
                }
                if (until_stopped) {
                    // back at the place it was cut at, or at the limit where that comes first
                    const wanted = ((plan.restore_at % bin.ticks) + bin.ticks) % bin.ticks;
                    while ((now() - start_tick) % bin.ticks !== wanted && now() - cut_tick < limit_ticks) {
                        step();
                    }
                    ended_at_limit = stopped_after_ticks === null && now() - cut_tick >= limit_ticks;
                }
                loss_ticks = now() - cut_tick;
                output_during_loss = dropped() - dropped_at_cut;
            } finally {
                supply.restore();
            }
        }
        const restore_at = (now() - start_tick) % bin.ticks;

        const output_per_bin: number[] = [];
        const export_per_bin: number[][] = watched_exports.map(() => []);
        const bin_by_state = new Map<string, number>();
        let repeats_from: number | null = null;
        if (proof_stride !== null) {
            bin_by_state.set(simulationStateKey(context), 0);
        }
        // bins at the expected output since the last short one
        let exact_bins = 0;
        const runBin = () => {
            const before = dropped();
            const exported_before = watched_exports.map(it => it.fillers.reduce((sum, state) => sum + state.items_dropped, 0));
            for (let tick = 0; tick < bin.ticks; tick++) {
                step();
            }
            const items = dropped() - before;
            output_per_bin.push(items);
            exact_bins = items === expected_per_bin ? exact_bins + 1 : 0;
            watched_exports.forEach((it, at) => export_per_bin[at].push(it.fillers.reduce((sum, state) => sum + state.items_dropped, 0) - exported_before[at]));
            // only boundaries a whole stride apart have every clock standing at the same place, so only they compare
            if (proof_stride !== null && output_per_bin.length % proof_stride === 0) {
                const key = simulationStateKey(context);
                repeats_from = bin_by_state.get(key) ?? null;
                bin_by_state.set(key, output_per_bin.length);
            }
        };
        while (output_per_bin.length < max_recovery_bins && repeats_from === null) {
            runBin();
        }
        let judged_hold_bins = hold_bins;
        let judged = judgeRecovery(output_per_bin, expected_per_bin, repeats_from, hold_bins);
        const window_bins = output_per_bin.length;
        if (!judged.recovers && window_bins < max_run_on_bins && runsOn(output_per_bin, expected_per_bin, repeats_from, late_after_bins, hold_bins)) {
            while (output_per_bin.length < max_run_on_bins && repeats_from === null && exact_bins < run_on_bins) {
                runBin();
            }
            judged_hold_bins = run_on_bins;
            judged = judgeRecovery(output_per_bin, expected_per_bin, repeats_from, run_on_bins);
        }
        const ran_on_bins = output_per_bin.length - window_bins;
        trials.push({
            cut_at: plan.cut_at,
            restore_at,
            until_stopped,
            loss_ticks,
            ...(ended_at_limit && { ended_at_limit: true as const }),
            output_during_loss,
            stopped_after_ticks,
            output_per_bin,
            ...judgedWithExports(judged, watched_exports, export_per_bin, bin.ticks, repeats_from, judged_hold_bins),
            ...(ran_on_bins > 0 && { ran_on_bins }),
        });
        if (!trials[trials.length - 1].recovers) {
            break;
        }
        if (!part_of_the_way_planned && index === plans.length - 1) {
            part_of_the_way_planned = true;
            const stops_after_ticks = Math.max(...trials.map(trial => trial.stopped_after_ticks ?? max_loss_ticks));
            plans.push(...lossTrialsPartOfTheWay(bin.ticks, stops_after_ticks, places, shares));
        }
    }

    const recovers = trials.every(trial => trial.recovers);
    const ran_their_course = trials.filter(trial => trial.until_stopped);
    const never_stopped = ran_their_course.some(trial => trial.stopped_after_ticks === null);
    return {
        loss,
        bin_ticks: bin.ticks,
        periods_per_bin: bin.periods,
        expected_per_bin,
        trials,
        recovers,
        recovered_after_bins: recovers ? Math.max(...trials.map(trial => trial.recovered_after_bins ?? 0)) : null,
        stopped_after_ticks: never_stopped ? null : Math.max(0, ...ran_their_course.map(trial => trial.stopped_after_ticks ?? 0)),
        ticks: now() - start_tick,
    };
}

/** What a clock does under every loss of its build */
export interface BackpressureLossReport {
    period_ticks: number;
    expected_output_items: number;
    /** The run with nothing cut, counted as the others: a clock that is off here is off without any loss */
    undisturbed: LossOutcome;
    /** Those of the losses of the build (see backpressureLossesOf) that were tried, in the order they were tried */
    losses: LossOutcome[];
    /** The losses after the first the clock does not get back from, which were not tried (see backpressureLossOf) */
    not_tried: BackpressureLoss[];
    /** The clock holds its expected output undisturbed and gets back to it after every loss */
    survives: boolean;
    /** The losses it does not get back from, by lossId */
    broken_by: string[];
    /** The most periods it took to be back at the expected output over all trials; null when it does not survive */
    recovered_after_periods: number | null;
    /** Ticks simulated for the trials of all losses, without the warm-up of each run */
    ticks: number;
    /** The limit of the losses tried, for a build whose items spoil (lossLimitOf); null for any other */
    loss_limit: LossLimit | null;
}

export function reportOf(
    period_ticks: number,
    expected_output_items: number,
    undisturbed: LossOutcome,
    losses: LossOutcome[],
    loss_limit: LossLimit | null = null,
    not_tried: BackpressureLoss[] = [],
): BackpressureLossReport {
    const broken_by = losses.filter(outcome => !outcome.recovers).map(outcome => lossId(outcome.loss));
    const survives = undisturbed.recovers && broken_by.length === 0;
    return {
        period_ticks,
        expected_output_items,
        undisturbed,
        losses,
        not_tried,
        survives,
        broken_by,
        recovered_after_periods: survives ? Math.max(0, ...losses.map(outcome => (outcome.recovered_after_bins ?? 0) * outcome.periods_per_bin)) : null,
        ticks: undisturbed.ticks + losses.reduce((sum, outcome) => sum + outcome.ticks, 0),
        loss_limit,
    };
}

/** What the trials found about one clock, in the words a list of clocks needs */
export interface BackpressureLossVerdict {
    /** The clock gets back to its expected output after every loss of its build */
    survives: boolean;
    /** The losses it does not get back from, as lossLabel words them: "coal stops arriving" */
    broken_by: string[];
    /**
     * The losses that were not tried, as lossLabel words them, since an earlier loss already showed that the clock does
     * not recover: the ones after the first that it does not get back from at the modeled phase. Absent when every loss
     * was tried.
     */
    not_tried?: string[];
    /**
     * The losses of `broken_by` it gets back from at the lanes' modeled phase, and not from a start where a moving lane
     * comes back in another phase (the loss's `failed_pickup_phases`). Absent from results made before it was kept.
     */
    broken_at_other_lane_phases?: string[];
    /** The most periods it took to be back at the expected output over all trials; null when it does not survive */
    recovered_after_periods: number | null;
    /** For a build whose items spoil: the losses were shorter than this (lossLimitOf); absent for any other build */
    loss_limit?: LossLimit;
}

export function verdictOf(report: BackpressureLossReport): BackpressureLossVerdict {
    return {
        survives: report.survives,
        broken_by: report.losses.filter(outcome => !outcome.recovers).map(outcome => lossLabel(outcome.loss)),
        broken_at_other_lane_phases: report.losses.filter(outcome => !outcome.recovers && outcome.failed_pickup_phases !== undefined)
            .map(outcome => lossLabel(outcome.loss)),
        ...(report.not_tried.length > 0 && { not_tried: report.not_tried.map(lossLabel) }),
        recovered_after_periods: report.recovered_after_periods,
        ...(report.loss_limit !== null && { loss_limit: report.loss_limit }),
    };
}
