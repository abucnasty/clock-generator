import { Duration } from "../../../data-types";
import { InserterAnimation } from "../../../entities/inserter/inserter-animation";
import { InserterStatus } from "../../../state";
import { TickProvider } from "../../current-tick-provider";
import { ModeTransition, ModeTransitionEvaluator } from "../../mode";
import { InserterDropMode, InserterIdleMode, InserterMode, InserterPickupMode } from "../modes";
import { IdleModeTransitionEvaluator } from "./idle-mode-transition-evaluator";

export class InserterSwingModeTransitionEvaluator implements ModeTransitionEvaluator<InserterMode> {


    public static create(args: {
        inserter_animation: InserterAnimation,
        drop_mode: InserterDropMode,
        idle_mode: InserterIdleMode,
        tick_provider: TickProvider,
        idle_mode_transition_evaluator: IdleModeTransitionEvaluator,
    }): InserterSwingModeTransitionEvaluator {
        return new InserterSwingModeTransitionEvaluator(
            args.inserter_animation,
            args.drop_mode,
            args.idle_mode,
            args.tick_provider,
            args.idle_mode_transition_evaluator,
        );
    }

    constructor(
        private readonly inserter_animation: InserterAnimation,
        private readonly drop_mode: InserterDropMode,
        private readonly idle_mode: InserterIdleMode,
        private readonly tick_provider: TickProvider,
        private readonly idle_mode_transition_evaluator: IdleModeTransitionEvaluator,
    ) { }

    private entered_tick: number | null = null;
    private from: InserterMode | null = null;

    public onEnter(fromMode: InserterMode): void {
        this.entered_tick = this.tick_provider.getCurrentTick();
        this.from = fromMode;
    }

    public onExit(toMode: InserterMode): void {
        this.entered_tick = null;
        this.from = null;
    }

    public evaluateTransition(): ModeTransition<InserterMode> {

        if (this.entered_tick === null) {
            throw new Error("Cannot get elapsed duration, evaluator has not entered a mode yet");
        }
        if (this.tick_provider.getCurrentTick() - this.entered_tick < this.inserter_animation.rotation.ticks) {
            return ModeTransition.NONE;
        }

        if (this.from?.status === InserterStatus.PICKUP) {
            return ModeTransition.transition(this.drop_mode, "swing to sink duration elapsed");
        }

        if (this.from?.status === InserterStatus.DROP_OFF || this.from?.status === InserterStatus.TARGET_FULL) {
            // After dropping off items (or after TARGET_FULL when chest had space and items were dropped),
            // swing back to source
            const transition = this.idle_mode_transition_evaluator.evaluateTransition()
            if (transition !== ModeTransition.NONE && transition.toMode.status !== InserterStatus.DISABLED) {
                return transition;
            }
            return ModeTransition.transition(this.idle_mode, "swing to source duration elapsed");
        }

        throw new Error(`Invalid from mode status for swing mode transition: ${this.from?.status}`);
    }

    public elapsedDuration(): Duration {
        const current_tick = this.tick_provider.getCurrentTick();
        if(this.entered_tick === null) {
            throw new Error("Cannot get elapsed duration, evaluator has not entered a mode yet");
        }
        const ticks_elapsed = current_tick - this.entered_tick;
        return Duration.ofTicks(ticks_elapsed);
    }
}