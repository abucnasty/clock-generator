/**
 * What the disturbance trials of one clock plan to simulate, counted before any of them runs (docs/stability.md, "How a
 * clock is tried for it"). Arithmetic only: the trials of each loss, the starts each loss is run from, and the ticks of
 * a trial that is not back before its window ends. A trial that ends early (its state repeats) costs less, and a loss
 * that runs its course costs the ticks the build takes to stop on top; neither is known before the run.
 */
import { LOSS_PLACES, LOSS_SHARES, MAX_RECOVERY_WINDOW_CYCLES } from "./disturbance-trial";

/** How one loss is tried, from its options: the run with nothing cut, a loss that runs its course, or one of fixed length */
export interface PlannedLoss {
    kind: "none" | "supply" | "output" | "excess";
    /** A loss of this many ticks at each place (a result's output, see resultLossOptionsOf), in place of the shares */
    fixed_loss_ticks?: number;
    /** The window cycles after the item is back that a trial is judged on; MAX_RECOVERY_WINDOW_CYCLES where absent */
    max_recovery_window_cycles?: number;
}

/** The bin the output is counted in: a window cycle, or the whole ticks a fractional one repeats in */
export interface EstimateBin {
    ticks: number;
    window_cycles: number;
}

/** The trials a clock's losses plan, and their ticks */
export interface LossTrialEstimate {
    /** The losses tried, the run with nothing cut not counted */
    losses: number;
    /** The starts each loss is run from: the modeled one, each other lane phase and each other order of the takers */
    starts: number;
    /** The trials of every loss from every start, the run with nothing cut included */
    trials: number;
    /** The ticks of those trials, each judged on its whole window of recovery */
    ticks: number;
}

/** The trials of one loss from one start: one with nothing cut; a place each for an excess or a fixed loss; else a place and a share each */
export function trialsOfLoss(loss: PlannedLoss): number {
    if (loss.kind === "none") return 1;
    if (loss.kind === "excess" || loss.fixed_loss_ticks !== undefined) return LOSS_PLACES.length;
    return LOSS_PLACES.length * LOSS_SHARES.length;
}

/** The ticks of one trial of a loss judged on its whole window: its bins of recovery, and its fixed loss where it has one */
export function ticksOfTrial(loss: PlannedLoss, bin: EstimateBin): number {
    const bins = Math.max(1, Math.ceil((loss.max_recovery_window_cycles ?? MAX_RECOVERY_WINDOW_CYCLES) / bin.window_cycles));
    return bins * bin.ticks + (loss.fixed_loss_ticks ?? 0);
}

/**
 * The trials of every loss, the run with nothing cut among them, each from `starts` starts. `losses` counts the losses
 * without the run with nothing cut.
 */
export function lossTrialEstimateOf(planned: readonly PlannedLoss[], starts: number, bin: EstimateBin): LossTrialEstimate {
    const trials = planned.reduce((sum, loss) => sum + trialsOfLoss(loss), 0) * starts;
    const ticks = planned.reduce((sum, loss) => sum + trialsOfLoss(loss) * ticksOfTrial(loss, bin), 0) * starts;
    return { losses: planned.filter(loss => loss.kind !== "none").length, starts, trials, ticks };
}
