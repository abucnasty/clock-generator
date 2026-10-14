import { Mode, ModeOnEnterHook, ModeOnExitHook } from "./mode";
import { ModeTransition } from "./mode-transition";

export interface ModeTransitionEvaluator<M extends Mode> extends ModeOnEnterHook<M>, ModeOnExitHook<M> {
    evaluateTransition(): ModeTransition<M>
    /** What the evaluator keeps from one tick to the next, like Mode.stateKey; one that keeps nothing has none */
    stateKey?(tick: number): string;
}