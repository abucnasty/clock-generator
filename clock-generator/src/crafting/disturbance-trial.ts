/**
 * Whether a clock survives backpressure loss (GOALS.md, "Backpressure Loss"): an item of the build stops arriving for
 * a while, or its output stops being taken, the machines run dry or fill up, and when it comes back the build has to
 * return to its expected output under the same clock by itself.
 *
 * A loss is run as the rule words it. The belts and chests around a build are a supply that is always full and a
 * place that always takes; for the length of a loss one item is withheld from them, or one is refused by them (see
 * SupplyGate). The loss lasts until the build has stopped: nothing was picked up, dropped, crafted or burned for a
 * whole window cycle, so every machine that depends on the item is dry or full and everything else has backed up to its
 * limits. Then the item comes back, at a place in the window cycle the trial names, and what the output inserters drop
 * is counted window cycle by window cycle from that tick on.
 *
 * The trials of a loss are the same for every build and every clock (see LOSS_PLACES and LOSS_SHARES): the loss is
 * cut at four places in the window cycle, and at each it lasts a quarter, a half, three quarters and all of the time
 * the build takes to stop. A loss that runs its course is restored at the place in the window cycle it was cut at. Where
 * the clock stands when the item comes back decides which window sees a machine first, and a loss that ends before
 * the build has stopped leaves the machines part empty or part full, which one that runs its course never does.
 * One run makes the trials of a loss one after the other.
 *
 * A run of a loss stops at the first trial that the clock does not recover from. For such a loss, the trials after it are
 * then run too (withEveryTrialCounted), so that the result counts every trial of the loss. The losses of a clock stop at
 * the first it does not recover from (see disturbanceTrialOf): the clock does not recover whatever the rest do, and the
 * losses left are reported as not tried. A clock that recovers from everything runs every trial once.
 */
import assert from "../common/assert";
import { SimulationTick } from "./runner/simulation-tick";
import { atRateFrom, branchesScaledTo, cycleAtRate, firstBinAtRate, type BranchBins, type TerminalBranch } from "./terminal-rate";
import { FactorioDataService, ItemName } from "../data";
import { Chest, Entity, EntityId, ReadableEntityRegistry } from "../entities";
import { EntityState, InserterState } from "../state";
import { simulationStateKey } from "./runner/steady-state";
import { SimulationContext } from "./sequence/simulation-context";
import { ExportShortfall, ExportedItem, exportShortfallOfBins } from "./export-delivery";
import { SPOIL_LIMIT_SHARE } from "../common/rule-constants";
import { ContainerStorage } from "../simulation/components/container-storage";
import { DropBy } from "../simulation/components/ports";
import type { SharedLane } from "../state/shared-lane";
import type { OutputBeltRun } from "./output-belt-run";
import type { CopiesTrialVerdict } from "./shared-lane-trial";
import { COPY_NUMBER_STRIDE, twinOf } from "./sequence/build-copies";
import type { WindowCycleClock } from "../simulation/controls/enable-control";
import { textWords } from "./entity-name";

export type DisturbanceTrial =
    /** Nothing is cut: the run as it is, counted as the runs with a loss are */
    | { kind: "none" }
    /** The item stops arriving: no belt and no infinity chest has it */
    | { kind: "supply"; item: ItemName }
    /** The item is not taken away: the belts are full of it, and so are the chests the build puts it into */
    | { kind: "output"; item: ItemName }
    /** Results that come by chance come over their mean: their machines place more of them at once (see ExcessLoss) */
    | ExcessLoss;

/**
 * More of the results that come by chance than their expected amount, as the game's rolls give them in a run of window cycles
 * over the mean (the simulator gives every result at its expected amount). Each machine of `at` places `count` more of
 * its item at once into its result target, or into its own output where it has none, at each place in the window cycle. The
 * build has to hold its expected output through it, every window cycle: an excess the clock takes up costs it nothing, and
 * one it does not costs it a hand of its output, which it does not get back (on the recycler that voids iron ore, the
 * inserters that bring the ore in wait while what came back fills the recycler to its insertion limit). The excess is
 * the backlog the random margins say the container takes up (`CraftingMargin.backlog`, excessLossOf in
 * random-margins.ts).
 */
export interface ExcessLoss {
    kind: "excess";
    at: readonly { machine_id: string; item: ItemName; count: number }[];
}

/** The items of an excess, each once, in the order of its machines */
function excessItems(loss: ExcessLoss): ItemName[] {
    return [...new Set(loss.at.map(it => it.item))];
}

/** "supply:coal", "output:advanced-circuit", "none" */
export function lossId(loss: DisturbanceTrial): string {
    if (loss.kind === "excess") {
        return `excess:${excessItems(loss).join("+")}`;
    }
    return loss.kind === "none" ? loss.kind : `${loss.kind}:${loss.item}`;
}

/** "coal stops arriving", "advanced circuit is not taken away": the item by its game name, as a sentence has it */
export function lossLabel(loss: DisturbanceTrial): string {
    if (loss.kind === "none") {
        return "nothing is cut";
    }
    if (loss.kind === "excess") {
        const items = excessItems(loss).map(item => textWords().item(item));
        return items.length === 1 ? `${items[0]} comes over its mean` : `${items.join(" and ")} come over their mean`;
    }
    const item = textWords().item(loss.item);
    return loss.kind === "output" ? `${item} is not taken away` : `${item} stops arriving`;
}

/** One trial of a loss: where in the window cycle it starts, in ticks from the start of a window cycle, and when it ends */
type LossTrialPlan =
    /** The loss lasts until the build has stopped, and ends at this place in the window cycle */
    | { cut_at: number; restore_at: number }
    /** The loss lasts this many ticks, whatever the build is doing by then */
    | { cut_at: number; loss_ticks: number };

/** Places in the window cycle a loss is cut at, as shares of the window cycle */
export const LOSS_PLACES: readonly number[] = [0, 1 / 4, 1 / 2, 3 / 4];
/**
 * How long a loss lasts, as shares of the ticks the build takes to stop once the item is gone. 1 is a loss that
 * runs its course: it lasts until the build has stopped, and is restored at the place in the window cycle it was cut at.
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

/**
 * How many trials a loss has, as runLossTrials plans them: one with nothing cut; an excess, or a loss of fixed ticks, one at
 * each place; any other loss one at each place that runs its course (one at the first place where `shares` has no 1) and one
 * at each place for each share under 1. A run stops at the first trial that does not recover; withEveryTrialCounted runs
 * the rest.
 */
export function plannedTrialsOf(loss: DisturbanceTrial, places: readonly number[], shares: readonly number[], fixed_loss_ticks?: number): number {
    if (loss.kind === "none") return 1;
    if (loss.kind === "excess" || fixed_loss_ticks !== undefined) return places.length;
    return (shares.includes(1) ? places.length : 1) + places.length * shares.filter(share => share < 1).length;
}

/**
 * The trials of a loss that breaks a clock, as numbers: those its plan has, those run (every trial of the plan, see
 * withEveryTrialCounted: `run` equals `planned`), those the build recovers from, and the first it does not recover from.
 * The counts are of the run that broke it: at the lanes' modeled phase, or from the first lane phase, the first order of
 * the takers or the first run of the copies under which the clock does not recover.
 */
export interface TrialCount {
    /** The loss: a supply stop, an output blockage or an excess of results that come by chance, and its items */
    loss: { kind: "supply" | "output" | "excess"; items: ItemName[] };
    planned: number;
    run: number;
    recovered: number;
    /**
     * The first trial the build does not recover from: where in the window cycle it was cut (LossTrial.cut_at), how long
     * the item was gone, and whether the loss was to last until the build had stopped
     */
    first_not_recovered: { cut_at: number; loss_ticks: number; until_stopped: boolean };
}

/** The trials of a loss as numbers (TrialCount); null for a loss the clock recovers from, or one with no trial */
export function trialCountOf(outcome: Pick<LossOutcome, "loss" | "trials" | "planned_trials" | "recovers" | "every_trial">): TrialCount | null {
    const loss = outcome.loss;
    const first = outcome.trials.find(trial => !trial.recovers);
    if (outcome.recovers || loss.kind === "none" || first === undefined) return null;
    return {
        loss: { kind: loss.kind, items: loss.kind === "excess" ? excessItems(loss) : [loss.item] },
        planned: outcome.planned_trials,
        run: outcome.every_trial?.run ?? outcome.trials.length,
        recovered: outcome.every_trial?.recovered ?? outcome.trials.filter(trial => trial.recovers).length,
        first_not_recovered: { cut_at: first.cut_at, loss_ticks: first.loss_ticks, until_stopped: first.until_stopped },
    };
}

/**
 * A loss the clock does not recover from, with every trial of its plan run: the run of the loss stops at the first trial
 * that does not recover, so `rerun` runs the loss again from the same start with each trial that did not recover left out
 * (DisturbanceTrialOptions.skipped_trials), as often as a trial after them does not recover. The runs are the same up to
 * the trial left out, so the trial after it starts from the state the build was in before that trial began: the state of
 * the run at the end of the last bin of the trial before (at the end of the warm-up, before the first trial), as if that
 * loss had not happened. The outcome stays the one given (its trials up to the first that does not recover, which the
 * verdict names), with `every_trial` and the ticks of the runs added. A loss it recovers from is given back as it is, and
 * `rerun` is not called.
 */
export function withEveryTrialCounted(outcome: LossOutcome, rerun: (skipped: readonly SkippedTrial[]) => LossOutcome): LossOutcome {
    if (outcome.recovers || outcome.loss.kind === "none") return outcome;
    const skipped: SkippedTrial[] = [];
    let last = outcome;
    let ticks = outcome.ticks;
    for (let failed = last.trials.find(trial => !trial.recovers); failed !== undefined; failed = last.trials.find(trial => !trial.recovers)) {
        // each run leaves out one more trial of the plan: at most as many runs as it has trials
        assert(skipped.length < outcome.planned_trials, `The trials of ${lossId(outcome.loss)} do not end after the ${outcome.planned_trials} planned`);
        skipped.push({ plan_index: failed.plan_index, stopped_after_ticks: failed.stopped_after_ticks });
        last = rerun(skipped);
        ticks += last.ticks;
    }
    return { ...outcome, ticks, every_trial: { run: last.trials.length + skipped.length, recovered: last.trials.length } };
}

/** A loss ends at the latest after this many window cycles, whether the build has stopped or not */
export const MAX_LOSS_WINDOW_CYCLES = 200;

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
 * Window cycles after the item is back in which the build has to be at its expected output again. A run on clock windows
 * alone repeats once its state does, so most trials end long before: with the state of a window cycle boundary seen
 * before, what the build did since then is what it does for good.
 */
export const MAX_RECOVERY_WINDOW_CYCLES = 40;
/**
 * Where the state cannot be compared (a fuel inserter on a clock of its own does not repeat with the window cycle), the
 * build has recovered when this many window cycles at the end of the recovery are all at the expected output.
 */
const RECOVERY_HOLD_WINDOW_CYCLES = 8;
/**
 * A trial that is short late in its window runs on (see runsOn): until this many window cycles at the expected output follow
 * its last short one, or its state repeats, and is judged on them. More than any stretch at the expected output that a
 * short window cycle followed in the samples' trials (35 window cycles, agricultural science's batched swings after a loss of
 * nutrients, run on to 200 window cycles); as many as the window has (MAX_RECOVERY_WINDOW_CYCLES), a choice of its own.
 */
export const RUN_ON_EXACT_WINDOW_CYCLES = 40;
/** A trial that runs on ends at the latest this many window cycles after the item is back */
export const MAX_RUN_ON_WINDOW_CYCLES = 200;
/**
 * A trial is short late when it was at the expected output in the RECOVERY_HOLD_WINDOW_CYCLES before this mark (as a recovery
 * without a repeated state has to end) and is short after it only: it would be back in a window this long, and falls
 * short in the last RECOVERY_HOLD_WINDOW_CYCLES of MAX_RECOVERY_WINDOW_CYCLES.
 */
export const LATE_AFTER_WINDOW_CYCLES = MAX_RECOVERY_WINDOW_CYCLES - RECOVERY_HOLD_WINDOW_CYCLES;

/**
 * Whether a trial that is not back at the end of its window runs on: no state of it repeated (one that did proves what
 * it does for good), it is not at the rate from any bin before `late_after_bins` on (it fell behind its share after the
 * mark), and it was at the rate over the `back_bins` bins before the mark. A bin of many window cycles (a subtick clock's)
 * leaves no room for that: such a trial does not run on.
 *
 * @param branches the bins of each branch of the terminal outputs into sinks that never block (see terminal-rate.ts);
 *                 without them the output as one branch with no hand to spare
 */
export function runsOn(
    output_per_bin: readonly number[],
    expected_per_bin: number,
    repeats_from: number | null,
    late_after_bins: number,
    back_bins: number,
    branches: readonly BranchBins[] = [{ bins: output_per_bin, share_per_bin: expected_per_bin, hand: 0, takes_surplus: false }],
): boolean {
    if (repeats_from !== null || late_after_bins < back_bins || back_bins < 1) {
        return false;
    }
    const before_the_mark = branches.map(branch => ({ ...branch, bins: branch.bins.slice(late_after_bins - back_bins, late_after_bins) }));
    return firstBinAtRate(branches) >= late_after_bins && atRateFrom(before_the_mark, 0);
}

export interface DisturbanceTrialOptions {
    loss: DisturbanceTrial;
    /** Ticks of the window cycle the windows are of */
    window_cycle_ticks: number;
    /** Items the output inserters are expected to drop in a window cycle */
    expected_output_items: number;
    /** Places in the window cycle to cut at, in place of LOSS_PLACES: fewer make the run shorter */
    places?: readonly number[];
    /** Shares of the time the build takes to stop, in place of LOSS_SHARES */
    shares?: readonly number[];
    max_loss_window_cycles?: number;
    max_recovery_window_cycles?: number;
    recovery_hold_window_cycles?: number;
    /** In place of RUN_ON_EXACT_WINDOW_CYCLES */
    run_on_exact_window_cycles?: number;
    /** In place of MAX_RUN_ON_WINDOW_CYCLES; 0 or less than the window: no trial runs on */
    max_run_on_window_cycles?: number;
    /** In place of LATE_AFTER_WINDOW_CYCLES */
    late_after_window_cycles?: number;
    /** A loss lasts fewer ticks than this (see lossLimitOf); without it, as long as the build takes to stop */
    loss_limit_ticks?: number;
    /**
     * Every trial cuts the item for this many ticks, at each place, and none runs until the build has stopped: for a loss
     * whose recovery is worked out by arithmetic and only confirmed here (a result of windows for results that come by
     * small chances, exhaust.ts)
     */
    fixed_loss_ticks?: number;
    /**
     * Items whose count in a container is watched: a trial recovers only where, after its recovery window cycles, the container
     * holds no more of them than `limit` (the backlog the loss left has drained)
     */
    watched_backlog?: { container_id: string; items: readonly ItemName[]; limit: number };
    /**
     * The run holds every copy of the build on the lanes they share (shared-lane-trial.ts): a supply stop closes the entry of
     * each of those lanes that carries the item, and the output of each copy is judged on its own
     */
    copies?: CopiesOnSharedLanes;
    /**
     * Trials of the plan that are not run (by their place in the plan, LossTrial.plan_index): the next trial starts from the
     * state the run was in before such a trial, at the end of the last bin of the trial before it (or at the start of the
     * trials), as the build would be had that loss not happened. Each keeps the ticks it took to stop, for the lengths of the
     * trials that end part of the way (see withEveryTrialCounted).
     */
    skipped_trials?: readonly SkippedTrial[];
}

/** A trial of a plan that a run of the loss leaves out (DisturbanceTrialOptions.skipped_trials) */
export interface SkippedTrial {
    plan_index: number;
    stopped_after_ticks: number | null;
}

/**
 * The lanes the copies of a build share, as a run of the copies holds them: filled when the run's context is made, before
 * its first tick, and read by the trials after the run
 */
export interface CopiesOnSharedLanes {
    lanes: { belt_entity_id: string; item: ItemName; lane: SharedLane }[];
    /** Where the config states its output belt: the belt that takes the copies' product, its item, to the infinite end */
    output_belt?: { item: ItemName; belt: OutputBeltRun };
}

/** What one copy put down after a trial of a run of the copies, and whether it was back at the expected output */
export interface CopyAfterLoss {
    /** The copy, counted from the lanes' entry: 1 is the config's own */
    copy: number;
    recovers: boolean;
    /** The bins the copy ended in: those that repeat when the state did, or the last ones it was held to */
    ends_in: number[];
}

export interface LossTrial {
    /** The trial's place in the plan of the loss, from 0 */
    plan_index: number;
    /**
     * Where in the window cycle the item went: ticks from the start of the trials, in their bin. The trials start at a
     * tick the clock counts 1 (clockCountsOneAt; so on every run of four samples, 2026-11-14), so this is the tick of the
     * window cycle from 0. The item is gone from the tick after.
     */
    cut_at: number;
    /** Where in the window cycle it came back */
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
    /**
     * The build is back at its expected output, exactly or at the rate of every branch, and stays there (see judgeRecovery);
     * where its state repeats, in the bins or in the window cycles of the repeat counted on the clock (see judgedOnTheClock)
     */
    recovers: boolean;
    /**
     * Bins after the item was back before the first from which it is at the rate; for a trial back only on the clock, the
     * bin its repeat begins at; null when it does not recover
     */
    recovered_after_bins: number | null;
    /** The state of the build repeated, so what it did in its last bins it does for good; without it the verdict is of the bins run */
    proven: boolean;
    /** The bins the build ended in: those that repeat when `proven`, or the last ones it was held to */
    ends_in: number[];
    /**
     * In a run of one copy, the window cycles of the repeat counted on the clock, where its bins are not at the rate (see
     * judgedOnTheClock); absent where they are, where no state repeated, and in a run with nothing cut
     */
    ends_in_on_the_clock?: number[];
    /** Bins run past the recovery window, as a trial short late in it runs on; absent when it did not */
    ran_on_bins?: number;
    /** What the container held of the watched items (DisturbanceTrialOptions.watched_backlog) after each bin; absent where none are watched */
    backlog_per_bin?: number[];
    /**
     * In a run of the copies (DisturbanceTrialOptions.copies): each copy whose output is judged, in order. Absent in a run of
     * one copy. `output_per_bin` is then the output of those copies together.
     */
    copies?: CopyAfterLoss[];
    /** In a run of the copies: the copies that hold only part of the output inserters, whose output is not judged */
    copies_not_judged?: number[];
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
    loss: DisturbanceTrial;
    /** Ticks in a bin: the window cycle, or the whole ticks after which a fractional window cycle repeats */
    bin_ticks: number;
    /** Clock window cycles in a bin */
    window_cycles_per_bin: number;
    expected_per_bin: number;
    /** Trials from the canonical start, or the first lane-phase start that fails, up to the first that does not recover. */
    trials: LossTrial[];
    /** The trials the loss has: each place in the window cycle for each length (plannedTrialsOf); `trials` stops at the first that does not recover */
    planned_trials: number;
    /** Where the trials after the first that does not recover were run too (withEveryTrialCounted): every trial planned, and those the build recovers from */
    every_trial?: { run: number; recovered: number };
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
    /** Orders of the inserters that take one product from one machine the loss was tried under, the default included; absent where there are none */
    taker_orders_checked?: number;
    /** The order of those inserters under which the build did not get back, after it did under the default ("ascending") */
    failed_taker_order?: string;
    /** Ticks simulated across all checked starts. */
    ticks: number;
}

/**
 * The losses a build can have: one for each item an inserter takes off a belt or out of an infinity chest, and one
 * for each item an inserter puts onto a belt or into a chest nothing takes from. The product the build is for comes
 * first among the last kind. A mining drill is no supply that stops: the ore is in the ground. Fluids are left out,
 * as the simulator leaves them out: a loss of a fluid is not tried.
 */
export function disturbanceTrialsOf(entity_registry: Pick<ReadableEntityRegistry, "getAll" | "getEntityById">, target_item?: ItemName): DisturbanceTrial[] {
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

/**
 * What a loss switches off, and on again when it is over. In a run of the copies on the lanes they share (`copies`), a
 * supply stop closes the entry of each of those lanes that carries the item, so that the lane drains as its takers take
 * from it; the belt of such a lane does not withhold the item, which would stop every hand on it at once. Every other belt
 * and infinity chest withholds it as in a run of one copy.
 *
 * In a run of the copies whose config states its output belt, an output blockage of the item the output belt takes away
 * shuts its infinite end: the belt lane is blocked from draining to the belt it joins. Every lane upstream backs up from there,
 * and a hand is held only when its side belt is full. No belt that carries the item refuses it. The chests the item ends
 * in refuse it as in a run of one copy.
 */
function switchOf(context: SimulationContext, loss: DisturbanceTrial, copies?: CopiesOnSharedLanes): { cut(): void; restore(): void } {
    if (loss.kind === "none" || loss.kind === "excess") {
        return { cut: () => { }, restore: () => { } };
    }
    const now = () => context.tick_provider.getCurrentTick();
    const entries = loss.kind === "supply" ? (copies?.lanes ?? []).filter(it => it.item === loss.item) : [];
    const output_belt = loss.kind === "output" && copies?.output_belt?.item === loss.item ? copies.output_belt.belt : undefined;
    const entry_belts = new Set(entries.map(it => it.belt_entity_id));
    // on every belt and chest that gives the item, or that the build puts it into
    const inserters = context.inserters.map(it => it.inserter_state.inserter);
    const sets: Set<ItemName>[] = [];
    for (const state of context.state_registry.getAllStates()) {
        if (EntityState.isBelt(state)) {
            const on_output_belt = output_belt !== undefined && state.lanes.some(lane => lane.item === loss.item);
            if (!entry_belts.has(twinOf(state.entity_id).id) && !on_output_belt) sets.push(loss.kind === "supply" ? state.supply.withheld : state.supply.refused);
        } else if (ContainerStorage.isConstant(state) || ContainerStorage.isFinite(state)) {
            if (loss.kind === "supply" && ContainerStorage.isConstant(state)) {
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
        cut: () => {
            sets.forEach(set => set.add(loss.item));
            entries.forEach(it => it.lane.closeEntry(now()));
            output_belt?.shutInfiniteEnd(now());
        },
        restore: () => {
            sets.forEach(set => set.delete(loss.item));
            entries.forEach(it => it.lane.openEntry(now()));
            output_belt?.openInfiniteEnd(now());
        },
    };
}

/**
 * The output inserters of each copy of a run of the copies, by the copy's number (0 the config's own), from those of the
 * config's own copy: each copy's twins of them. A copy that holds only some of them (a part copy) is left out, and named.
 */
function outputsOfCopies(context: SimulationContext, output_inserters: readonly InserterState[]): { by_copy: Map<number, InserterState[]>; part: number[] } {
    const own = new Set(output_inserters.map(state => state.entity_id.id));
    const by_copy = new Map<number, InserterState[]>();
    for (const { inserter_state } of context.inserters) {
        if (!own.has(twinOf(inserter_state.entity_id).id)) continue;
        const copy = Math.floor(inserter_state.entity_id.number / COPY_NUMBER_STRIDE);
        by_copy.set(copy, [...by_copy.get(copy) ?? [], inserter_state]);
    }
    const part = [...by_copy].filter(([, states]) => states.length !== own.size).map(([copy]) => copy).sort((a, b) => a - b);
    part.forEach(copy => by_copy.delete(copy));
    return { by_copy: new Map([...by_copy].sort(([a], [b]) => a - b)), part };
}

/**
 * Whether the build is back at its expected output, from what it dropped in each bin after the item came back: exactly
 * in every bin, or, where every terminal output drops into a sink that never blocks, back at the rate of every branch
 * (terminal-rate.ts), each carrying its share over the cycle in whole hands. The bins before the first from which every
 * branch is at the rate to the end are the ones it took to get back.
 *
 * @param repeats_from with the state at the end of the last bin equal to the state at the end of this bin (0: the
 *                     tick the item came back), the bins after it repeat for good: they have to carry every share
 *                     (cycleAtRate); null when no state repeated
 * @param hold_bins without a repeat, the bins at the end that all have to be at the rate, from the first of them
 * @param branches the bins of each branch; without them the output as one branch with no hand to spare
 */
export function judgeRecovery(
    output_per_bin: readonly number[],
    expected_per_bin: number,
    repeats_from: number | null,
    hold_bins: number,
    branches: readonly BranchBins[] = [{ bins: output_per_bin, share_per_bin: expected_per_bin, hand: 0, takes_surplus: false }],
): Pick<LossTrial, "recovers" | "recovered_after_bins" | "proven" | "ends_in"> {
    const proven = repeats_from !== null;
    const ends_in = proven ? output_per_bin.slice(repeats_from) : output_per_bin.slice(-hold_bins);
    const from = firstBinAtRate(branches);
    const from_bin = (start: number) => branches.map(branch => ({ ...branch, bins: branch.bins.slice(start) }));
    const recovers = ends_in.length > 0 && (proven
        ? cycleAtRate(from_bin(repeats_from)) && from <= repeats_from
        : output_per_bin.length >= hold_bins && from <= output_per_bin.length - hold_bins && atRateFrom(branches, output_per_bin.length - hold_bins));
    return { recovers, recovered_after_bins: recovers ? from : null, proven, ends_in };
}

/**
 * A recovery that also holds the export belts to what their consumers take, in the bins the output is judged on: the bins
 * that repeat when the state did, or the last ones the build was held to. A build at its expected output that comes up short
 * on an export has not recovered.
 */
export function judgedWithExports(
    judged: JudgedRecovery,
    watched: readonly WatchedExport[],
    export_per_bin: readonly (readonly number[])[],
    bin_ticks: number,
    repeats_from: number | null,
    hold_bins: number,
): JudgedRecovery & Pick<LossTrial, "export_shortfalls"> {
    const short = watched.flatMap((it, at) => {
        const bins = repeats_from !== null ? export_per_bin[at].slice(repeats_from) : export_per_bin[at].slice(-hold_bins);
        return bins.length === 0 ? [] : exportShortfallOfBins(it.exported, bins, bin_ticks, judged.proven) ?? [];
    });
    return short.length === 0 ? judged : { ...judged, recovers: false, recovered_after_bins: null, export_shortfalls: short };
}

/** What a trial's output is judged to have done: its recovery, and where counted, its repeat on the clock */
export type JudgedRecovery = Pick<LossTrial, "recovers" | "recovered_after_bins" | "proven" | "ends_in" | "ends_in_on_the_clock">;

/**
 * Whether a trial's repeat is counted again on the clock where its bins are not at the rate: in the trials of a loss, on
 * one copy and on the copies. The run with nothing cut is the check of what the clock holds, and the runs from the other
 * lane phases are that check too: they are judged in their bins only.
 */
export function countedOnTheClock(loss: DisturbanceTrial): boolean {
    return loss.kind !== "none";
}

/**
 * The tick of the run at which the clock of the window cycle counts 1, as one of the ticks `bin_ticks` apart that do: from
 * the clocks of the game of that window cycle (the windows of the clock) where the run has them, else from any clock of it.
 * The bins are whole ticks: the window cycle, or the whole ticks a subtick clock repeats in, which its count also starts
 * again at. Null where the run has no such clock or its clocks do not agree.
 */
export function clockCountsOneAt(clocks: readonly WindowCycleClock[], window_cycle_ticks: number, bin_ticks: number, now: number): number | null {
    const of_the_cycle = clocks.filter(clock => Math.abs(clock.windowCycleDuration.ticks - window_cycle_ticks) < 1e-9);
    const game = of_the_cycle.filter(clock => clock.is_game_clock);
    const starts = new Set((game.length > 0 ? game : of_the_cycle).map(clock => ((now - clock.clockTick()) % bin_ticks + bin_ticks) % bin_ticks));
    return starts.size === 1 ? [...starts][0] : null;
}

/**
 * The window cycles of a repeat counted on the clock, from the running total of a branch's items at the start of each bin
 * (and at the end of the last: one more value than `marks`) and at the tick the clock counts 1 in each bin. A repeated state
 * does for good what it did since, so the window cycle that runs from the last bin's mark over the end of the repeat goes on
 * from the repeat's start to the first bin's mark: the repeat is as many whole window cycles on the clock as it has bins.
 */
export function repeatOnTheClock(starts: readonly number[], marks: readonly number[], repeats_from: number): number[] {
    const bins = marks.length;
    const window_cycles: number[] = [];
    for (let bin = repeats_from; bin < bins - 1; bin++) window_cycles.push(marks[bin + 1] - marks[bin]);
    window_cycles.push(starts[bins] - marks[bins - 1] + marks[repeats_from] - starts[repeats_from]);
    return window_cycles;
}

/**
 * A repeat whose bins are not at the rate, judged again by its window cycles counted on the clock (`on_the_clock`: each
 * branch's, see repeatOnTheClock): where every window cycle is at the rate by the judgement of a repeat's bins
 * (cycleAtRate), the trial is back from the bin the repeat begins at. A hand that drops on one side of a bin's edge or the
 * other moves items between bins, not between the window cycles of the clock. A trial that is back in its bins stays as it
 * is judged; so does one with no repeat.
 */
export function judgedOnTheClock(judged: JudgedRecovery, on_the_clock: readonly BranchBins[], repeats_from: number | null): JudgedRecovery {
    if (judged.recovers || repeats_from === null || !judged.proven) return judged;
    const window_cycles = on_the_clock[0].bins.map((_items, at) => on_the_clock.reduce((sum, branch) => sum + branch.bins[at], 0));
    return cycleAtRate(on_the_clock)
        ? { ...judged, recovers: true, recovered_after_bins: repeats_from, ends_in_on_the_clock: window_cycles }
        : { ...judged, ends_in_on_the_clock: window_cycles };
}

/** What one copy of a trial put down after the item was back (with one copy, the build's output) */
export interface CopyBins {
    bins: readonly number[];
    /** The bins of each of its branches (terminal-rate.ts) */
    branches: readonly BranchBins[];
    /**
     * Where its repeat is counted on the clock: each branch's running total at the start of each bin and at the end of the
     * last (`starts`), and at the tick the clock counts 1 in each bin (`marks`), as repeatOnTheClock takes them
     */
    on_the_clock?: { starts: readonly (readonly number[])[]; marks: readonly (readonly number[])[] };
}

/**
 * A trial of one copy or of the copies: each copy judged on its own (judgeRecovery), its repeat counted again on the clock
 * where its bins are not at the rate and it has the totals for it (judgedOnTheClock), and the trial back where every copy
 * is (judgedTogether)
 */
export function judgedCopies(copies: readonly CopyBins[], output_per_bin: readonly number[], expected_per_bin: number, repeats_from: number | null,
    hold_bins: number): { each: JudgedRecovery[]; judged: JudgedRecovery } {
    const each = copies.map(copy => {
        const judged = judgeRecovery(copy.bins, expected_per_bin, repeats_from, hold_bins, copy.branches);
        const totals = copy.on_the_clock;
        if (totals === undefined || judged.recovers || repeats_from === null) return judged;
        const counted = copy.branches.map((branch, index) => ({ ...branch, bins: repeatOnTheClock(totals.starts[index], totals.marks[index], repeats_from) }));
        return judgedOnTheClock(judged, counted, repeats_from);
    });
    return { each, judged: judgedTogether(each, output_per_bin, repeats_from, hold_bins) };
}

/**
 * A trial of the copies, each copy judged on its own (`each`): back where every copy is, after the most bins a copy took.
 * With one copy, as that copy is.
 *
 * @param output_per_bin the output of the copies together, whose bins the trial ends in are those of the repeat, or the last `hold_bins`
 */
export function judgedTogether(each: readonly JudgedRecovery[], output_per_bin: readonly number[], repeats_from: number | null, hold_bins: number): JudgedRecovery {
    if (each.length === 1) return each[0];
    const recovers = each.every(it => it.recovers);
    return {
        recovers,
        recovered_after_bins: recovers ? Math.max(...each.map(it => it.recovered_after_bins!)) : null,
        proven: repeats_from !== null,
        ends_in: repeats_from !== null ? output_per_bin.slice(repeats_from) : output_per_bin.slice(-hold_bins),
    };
}

/**
 * Puts the excess of a loss where its machines place the result: into the container that is a machine's result target,
 * as far as it has room, else into the machine's own output
 */
function placeExcess(context: SimulationContext, loss: ExcessLoss): void {
    for (const { machine_id, item, count } of loss.at) {
        const machine_state = context.machines.find(it => it.machine_state.machine.entity_id.id === machine_id)?.machine_state;
        if (machine_state === undefined || count <= 0) {
            continue;
        }
        const target_id = machine_state.machine.result_target;
        const target = target_id === undefined ? null : context.state_registry.getStateByEntityId(target_id);
        if (target !== null && ContainerStorage.is(target)) {
            const room = target.accepts(item, count, DropBy.PLACER);
            if (room > 0) {
                target.insert(item, room);
            }
        } else {
            const inventory = machine_state.inventoryState;
            inventory.setQuantity(item, inventory.getQuantity(item) + count);
        }
    }
}

/**
 * Runs the trials of one loss on a build that is running on its clock, and leaves it wherever the last one ends. The
 * trials stop at the first that does not get back to the expected output: the loss is one the clock does not recover
 * from. The trials after it are run by a run of their own that leaves it out (`skipped_trials`, withEveryTrialCounted).
 *
 * @param context the build on its clock windows, warmed up
 * @param output_inserters the inserters whose drops are the output of the build
 * @param bin whole ticks the output is counted in, and the window cycles they are
 * @param quiet_ticks ticks without anything done after which the build has stopped: a window cycle, or the longest clock of
 *                    an inserter that has one of its own
 * @param watched_exports the belts with a consumption rate, whose deliveries in the bins the build ends in are held to what their
 *                consumers take as the output is held to its expected output
 * @param proof_stride bins between boundaries whose equal states repeat for good: 1 when every inserter is on the
 *                     clock of the window cycle or always enabled, more when inserters have clocks of their own (fuel),
 *                     which stand at the same place only every merged window cycle (see provenRepeatBin); null when a
 *                     repeated state proves nothing (some control decides from more than the tick)
 */
export function runLossTrials(
    context: SimulationContext,
    output_inserters: readonly InserterState[],
    options: DisturbanceTrialOptions,
    bin: { ticks: number; window_cycles: number },
    quiet_ticks: number,
    proof_stride: number | null,
    watched_exports: readonly WatchedExport[] = [],
    /**
     * Where every terminal output drops into a sink that never blocks, its branches, each with its share
     * (terminal-rate.ts); without them the output inserters as one branch with no hand to spare: exact in every bin
     */
    terminal_branches?: readonly TerminalBranch[],
    /**
     * A tick of the run at which the clock counts 1 (clockCountsOneAt): a trial of a loss whose repeat is not at the rate
     * in its bins has its repeat counted again on the clock (judgedOnTheClock). Null: judged in the bins only.
     */
    clock_counts_one_at: number | null = null,
): LossOutcome {
    const { loss } = options;
    const expected_per_bin = options.expected_output_items * bin.window_cycles;
    // into sinks that never block, each branch at its rate, its surplus taken; otherwise the output exactly in every bin
    const takes_surplus = terminal_branches !== undefined && terminal_branches.length > 0;
    const branches = !takes_surplus
        ? [{ source_id: "", inserter_ids: output_inserters.map(state => state.entity_id.id), share_per_window_cycle: options.expected_output_items, hand: 0 }]
        : branchesScaledTo(terminal_branches, options.expected_output_items);
    // the output judged: the output inserters of the build, or in a run of the copies those of each copy, each copy's on
    // its own (its twins of the branches), every copy at the expected output of one
    const copies = options.copies;
    const copy_outputs = copies === undefined ? null : outputsOfCopies(context, output_inserters);
    const groups: { copy: number; states: InserterState[] }[] = copy_outputs === null ? [{ copy: 0, states: [...output_inserters] }]
        : [...copy_outputs.by_copy].map(([copy, states]) => ({ copy, states }));
    const group_branch_states = groups.map(group => branches.map(branch =>
        group.states.filter(state => branch.inserter_ids.includes(copy_outputs === null ? state.entity_id.id : twinOf(state.entity_id).id))));
    const groupDropped = (at: number) => groups[at].states.reduce((sum, state) => sum + state.items_dropped, 0);
    const branchDropped = (at: number) => group_branch_states[at].map(states => states.reduce((sum, state) => sum + state.items_dropped, 0));
    // the most ticks a loss lasts: until the build has stopped, at most the window cycles of MAX_LOSS_WINDOW_CYCLES, and shorter
    // than the loss limit of a build whose items spoil
    const limit_ticks = options.loss_limit_ticks !== undefined ? Math.max(1, Math.ceil(options.loss_limit_ticks) - 1) : Infinity;
    const max_loss_ticks = Math.min(limit_ticks, Math.ceil((options.max_loss_window_cycles ?? MAX_LOSS_WINDOW_CYCLES) * options.window_cycle_ticks));
    const max_recovery_bins = Math.max(1, Math.ceil((options.max_recovery_window_cycles ?? MAX_RECOVERY_WINDOW_CYCLES) / bin.window_cycles));
    const hold_bins = Math.max(1, Math.ceil((options.recovery_hold_window_cycles ?? RECOVERY_HOLD_WINDOW_CYCLES) / bin.window_cycles));
    const max_run_on_bins = Math.floor((options.max_run_on_window_cycles ?? MAX_RUN_ON_WINDOW_CYCLES) / bin.window_cycles);
    const run_on_bins = Math.max(1, Math.ceil((options.run_on_exact_window_cycles ?? RUN_ON_EXACT_WINDOW_CYCLES) / bin.window_cycles));
    const late_after_bins = Math.floor((options.late_after_window_cycles ?? LATE_AFTER_WINDOW_CYCLES) / bin.window_cycles);
    const places = options.places ?? LOSS_PLACES;
    const shares = options.shares ?? LOSS_SHARES;
    const fixed = loss.kind !== "none" ? options.fixed_loss_ticks : undefined;
    const plans: LossTrialPlan[] = loss.kind === "none" ? [{ cut_at: 0, loss_ticks: 0 }]
        // an excess is placed at once, at each place: it lasts no ticks
        : loss.kind === "excess" ? places.map(place => ({ cut_at: Math.floor(place * bin.ticks), loss_ticks: 0 }))
        : fixed !== undefined ? places.map(place => ({ cut_at: Math.floor(place * bin.ticks), loss_ticks: fixed }))
        : shares.includes(1) ? lossTrialsUntilStopped(bin.ticks, places) : [{ cut_at: 0, restore_at: 0 }];
    // the trials that end part of the way are planned once it is known how long the build takes to stop
    let part_of_the_way_planned = loss.kind === "none" || loss.kind === "excess" || fixed !== undefined;
    // the container whose count of some items is watched
    const watched = options.watched_backlog;
    const watched_container = watched === undefined ? undefined
        : context.state_registry.getAllStates().filter(ContainerStorage.is).find(state => state.entity_id.id === watched.container_id);
    const backlogNow = () => watched_container === undefined || watched === undefined ? 0
        : watched.items.reduce((sum, item) => sum + watched_container.getCurrentQuantity(item), 0);

    // a tick as the simulate step runs it
    const simulation_tick = new SimulationTick(context);
    const now = () => context.tick_provider.getCurrentTick();
    const start_tick = now();
    const step = () => simulation_tick.executeForTick();
    const runUntilPhase = (phase: number) => {
        const wanted = ((phase % bin.ticks) + bin.ticks) % bin.ticks;
        while ((now() - start_tick) % bin.ticks !== wanted) {
            step();
        }
    };
    const dropped = () => groups.reduce((sum, _group, at) => sum + groupDropped(at), 0);
    // the state a run's boundary is compared by: in a run of the copies, the lanes they share too, each brought up to now
    const stateKey = copies === undefined ? () => simulationStateKey(context)
        : () => [simulationStateKey(context), ...copies.lanes.map(it => { it.lane.advanceTo(now()); return it.lane.key(); })].join("\n");

    // What the build does: every item an inserter moves and every product a machine finishes is counted, and a
    // machine that crafts moves its bars. A drill puts into a machine without a count, which the stock shows; a drill
    // into a chest fills it while every inserter may idle, so its hold and its chest are watched too.
    const inserter_states = context.inserters.map(it => it.inserter_state);
    const machine_states = context.machines.map(it => it.machine_state);
    const watch_stock = context.drills.length > 0;
    const chest_drills = context.drills.flatMap(it => {
        const sink = context.state_registry.getStateByEntityId(it.drill_state.drill.sink_id);
        return sink !== null && ContainerStorage.is(sink) ? [{ drill: it.drill_state, chest: sink }] : [];
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

    const supply = switchOf(context, loss, copies);
    const trials: LossTrial[] = [];
    const skipped = new Map((options.skipped_trials ?? []).map(it => [it.plan_index, it] as const));
    // the trials that end part of the way, planned once those that run their course are done (or left out)
    const planPartOfTheWay = (index: number) => {
        if (part_of_the_way_planned || index !== plans.length - 1) return;
        part_of_the_way_planned = true;
        const stops = [...trials.map(trial => trial.stopped_after_ticks), ...[...skipped.values()].filter(it => it.plan_index <= index).map(it => it.stopped_after_ticks)];
        const stops_after_ticks = Math.max(...stops.map(stopped => stopped ?? max_loss_ticks));
        plans.push(...lossTrialsPartOfTheWay(bin.ticks, stops_after_ticks, places, shares));
    };
    for (let index = 0; index < plans.length; index++) {
        if (skipped.has(index)) {
            planPartOfTheWay(index);
            continue;
        }
        const plan = plans[index];
        const until_stopped = "restore_at" in plan;
        let loss_ticks = 0;
        let output_during_loss = 0;
        let stopped_after_ticks: number | null = null;
        let ended_at_limit = false;
        if (loss.kind === "excess") {
            runUntilPhase(plan.cut_at);
            placeExcess(context, loss);
        } else if (loss.kind !== "none") {
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
        const group_bins: number[][] = groups.map(() => []);
        const group_branch_bins: BranchBins[][] = groups.map(() => branches.map(branch => ({ bins: [], share_per_bin: branch.share_per_window_cycle * bin.window_cycles, hand: branch.hand, takes_surplus })));
        // each branch's running total at each bin's start and at the tick the clock counts 1 in it, where a repeat is counted on the clock
        const on_the_clock = clock_counts_one_at !== null && countedOnTheClock(loss);
        const group_branch_starts: number[][][] = groups.map(() => []);
        const group_branch_marks: number[][][] = groups.map(() => []);
        const backlog_per_bin: number[] = [];
        const export_per_bin: number[][] = watched_exports.map(() => []);
        const bin_by_state = new Map<string, number>();
        let repeats_from: number | null = null;
        if (proof_stride !== null) {
            bin_by_state.set(stateKey(), 0);
        }
        // bins at the rate at the end of the trial so far (see firstBinAtRate), of the copy with the fewest
        const binsAtRate = () => output_per_bin.length - Math.max(...group_branch_bins.map(branch_bins => firstBinAtRate(branch_bins)));
        const runBin = () => {
            const before = groups.map((_group, at) => groupDropped(at));
            const branch_before = groups.map((_group, at) => branchDropped(at));
            const exported_before = watched_exports.map(it => it.fillers.reduce((sum, state) => sum + state.items_dropped, 0));
            // a step from tick t runs tick t + 1: the clock counts 1 in the step `mark` of the bin
            const mark = on_the_clock ? (((clock_counts_one_at - now() - 1) % bin.ticks) + bin.ticks) % bin.ticks : -1;
            if (on_the_clock) branch_before.forEach((before, at) => group_branch_starts[at].push(before));
            for (let tick = 0; tick < bin.ticks; tick++) {
                if (tick === mark) groups.forEach((_group, at) => group_branch_marks[at].push(branchDropped(at)));
                step();
            }
            const items = groups.map((_group, at) => groupDropped(at) - before[at]);
            output_per_bin.push(items.reduce((sum, it) => sum + it, 0));
            items.forEach((it, at) => group_bins[at].push(it));
            groups.forEach((_group, at) => {
                const branch_after = branchDropped(at);
                group_branch_bins[at].forEach((branch, index) => (branch.bins as number[]).push(branch_after[index] - branch_before[at][index]));
            });
            if (watched_container !== undefined) {
                backlog_per_bin.push(backlogNow());
            }
            watched_exports.forEach((it, at) => export_per_bin[at].push(it.fillers.reduce((sum, state) => sum + state.items_dropped, 0) - exported_before[at]));
            // only boundaries a whole stride apart have every clock standing at the same place, so only they compare
            if (proof_stride !== null && output_per_bin.length % proof_stride === 0) {
                const key = stateKey();
                repeats_from = bin_by_state.get(key) ?? null;
                bin_by_state.set(key, output_per_bin.length);
            }
        };
        while (output_per_bin.length < max_recovery_bins && repeats_from === null) {
            runBin();
        }
        let judged_hold_bins = hold_bins;
        // each copy judged on its own, its repeat counted again on the clock where its bins are not at the rate; the trial is
        // back where every copy is (with one copy, as that copy is)
        const judgedRun = (hold: number) => judgedCopies(groups.map((_group, at) => {
            const end = branchDropped(at);
            return { bins: group_bins[at], branches: group_branch_bins[at], ...(on_the_clock && { on_the_clock: {
                starts: branches.map((_branch, index) => [...group_branch_starts[at].map(it => it[index]), end[index]]),
                marks: branches.map((_branch, index) => group_branch_marks[at].map(it => it[index])),
            } }) };
        }), output_per_bin, expected_per_bin, repeats_from, hold);
        let { each, judged } = judgedRun(hold_bins);
        const window_bins = output_per_bin.length;
        // a trial short late in its window runs on where every copy that is not back is short late (one copy: as it is)
        if (!judged.recovers && window_bins < max_run_on_bins
            && groups.every((_group, at) => each[at].recovers || runsOn(group_bins[at], expected_per_bin, repeats_from, late_after_bins, hold_bins, group_branch_bins[at]))) {
            while (output_per_bin.length < max_run_on_bins && repeats_from === null && binsAtRate() < run_on_bins) {
                runBin();
            }
            judged_hold_bins = run_on_bins;
            ({ each, judged } = judgedRun(run_on_bins));
        }
        // in a run of the copies, a trial a copy is not back from runs on until the lanes have settled: until the state of
        // the run, the lanes included, repeats, at most MAX_RUN_ON_WINDOW_CYCLES after the item is back; with no repeat by
        // then, it is judged on the last RUN_ON_EXACT_WINDOW_CYCLES (a lane still filling can take longer than the window)
        if (copies !== undefined && !judged.recovers && repeats_from === null && output_per_bin.length < max_run_on_bins) {
            while (output_per_bin.length < max_run_on_bins && repeats_from === null) {
                runBin();
            }
            if (repeats_from === null) judged_hold_bins = run_on_bins;
            ({ each, judged } = judgedRun(judged_hold_bins));
        }
        const ran_on_bins = output_per_bin.length - window_bins;
        // an excess has to cost the build nothing: it is at its expected output from the first window cycle on
        if (loss.kind === "excess" && judged.recovers && judged.recovered_after_bins !== 0) {
            judged = { ...judged, recovers: false, recovered_after_bins: null };
        }
        // the backlog the loss left has to be gone by the end, where it is watched
        if (watched !== undefined && watched_container !== undefined && judged.recovers && backlog_per_bin[backlog_per_bin.length - 1] > watched.limit) {
            judged = { ...judged, recovers: false, recovered_after_bins: null };
        }
        trials.push({
            plan_index: index,
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
            ...(watched_container !== undefined && { backlog_per_bin }),
            ...(copy_outputs !== null && { copies: groups.map((group, at) => ({ copy: group.copy + 1, recovers: each[at].recovers, ends_in: each[at].ends_in })) }),
            ...(copy_outputs !== null && copy_outputs.part.length > 0 && { copies_not_judged: copy_outputs.part.map(copy => copy + 1) }),
        });
        if (!trials[trials.length - 1].recovers) {
            break;
        }
        planPartOfTheWay(index);
    }

    const recovers = trials.every(trial => trial.recovers);
    const ran_their_course = trials.filter(trial => trial.until_stopped);
    const never_stopped = ran_their_course.some(trial => trial.stopped_after_ticks === null);
    return {
        loss,
        bin_ticks: bin.ticks,
        window_cycles_per_bin: bin.window_cycles,
        expected_per_bin,
        trials,
        planned_trials: plannedTrialsOf(loss, places, shares, fixed),
        recovers,
        recovered_after_bins: recovers ? Math.max(...trials.map(trial => trial.recovered_after_bins ?? 0)) : null,
        stopped_after_ticks: never_stopped ? null : Math.max(0, ...ran_their_course.map(trial => trial.stopped_after_ticks ?? 0)),
        ticks: now() - start_tick,
    };
}

/** What a clock does under every loss of its build */
export interface DisturbanceTrialReport {
    window_cycle_ticks: number;
    expected_output_items: number;
    /** The run with nothing cut, counted as the others: a clock that is off here is off without any loss */
    undisturbed: LossOutcome;
    /** Those of the losses of the build (see disturbanceTrialsOf) that were tried, in the order they were tried */
    losses: LossOutcome[];
    /** The losses after the first the clock does not get back from, which were not tried (see disturbanceTrialOf) */
    not_tried: DisturbanceTrial[];
    /** The clock holds its expected output undisturbed and gets back to it after every loss */
    survives: boolean;
    /** The losses it does not get back from, by lossId */
    broken_by: string[];
    /** The most window cycles it took to be back at the expected output over all trials; null when it does not survive */
    recovered_after_window_cycles: number | null;
    /** Ticks simulated for the trials of all losses, without the warm-up of each run */
    ticks: number;
    /** The limit of the losses tried, for a build whose items spoil (lossLimitOf); null for any other */
    loss_limit: LossLimit | null;
}

export function reportOf(
    window_cycle_ticks: number,
    expected_output_items: number,
    undisturbed: LossOutcome,
    losses: LossOutcome[],
    loss_limit: LossLimit | null = null,
    not_tried: DisturbanceTrial[] = [],
): DisturbanceTrialReport {
    const broken_by = losses.filter(outcome => !outcome.recovers).map(outcome => lossId(outcome.loss));
    const survives = undisturbed.recovers && broken_by.length === 0;
    return {
        window_cycle_ticks,
        expected_output_items,
        undisturbed,
        losses,
        not_tried,
        survives,
        broken_by,
        recovered_after_window_cycles: survives ? Math.max(0, ...losses.map(outcome => (outcome.recovered_after_bins ?? 0) * outcome.window_cycles_per_bin)) : null,
        ticks: undisturbed.ticks + losses.reduce((sum, outcome) => sum + outcome.ticks, 0),
        loss_limit,
    };
}

/** What the trials found about one clock, in the words a list of clocks needs */
export interface DisturbanceTrialVerdict {
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
    /**
     * The losses of `broken_by` it gets back from with the inserters that take one product from one machine served in the
     * default order, and not in another (the loss's `failed_taker_order`). Absent where there are none.
     */
    broken_under_other_taker_orders?: string[];
    /** The most window cycles it took to be back at the expected output over all trials; null when it does not survive */
    recovered_after_window_cycles: number | null;
    /** For a build whose items spoil: the losses were shorter than this (lossLimitOf); absent for any other build */
    loss_limit?: LossLimit;
    /**
     * The trials on the copies that share a lane (shared-lane-trial.ts), where the copies share one and the clock gets back
     * from every loss on one copy: a loss after which a copy is not back is in `broken_by` too. Absent where they were not
     * made.
     */
    on_copies?: CopiesTrialVerdict;
    /** The trials of each loss of one copy that breaks the clock, as numbers, in the order of `broken_by`; absent where none breaks it */
    trial_counts?: TrialCount[];
}

export function verdictOf(report: DisturbanceTrialReport): DisturbanceTrialVerdict {
    const trial_counts = report.losses.flatMap(outcome => trialCountOf(outcome) ?? []);
    return {
        survives: report.survives,
        broken_by: report.losses.filter(outcome => !outcome.recovers).map(outcome => lossLabel(outcome.loss)),
        broken_at_other_lane_phases: report.losses.filter(outcome => !outcome.recovers && outcome.failed_pickup_phases !== undefined)
            .map(outcome => lossLabel(outcome.loss)),
        ...(report.losses.some(outcome => !outcome.recovers && outcome.failed_taker_order !== undefined) && {
            broken_under_other_taker_orders: report.losses.filter(outcome => !outcome.recovers && outcome.failed_taker_order !== undefined)
                .map(outcome => lossLabel(outcome.loss)),
        }),
        ...(report.not_tried.length > 0 && { not_tried: report.not_tried.map(lossLabel) }),
        recovered_after_window_cycles: report.recovered_after_window_cycles,
        ...(report.loss_limit !== null && { loss_limit: report.loss_limit }),
        ...(trial_counts.length > 0 && { trial_counts }),
    };
}
