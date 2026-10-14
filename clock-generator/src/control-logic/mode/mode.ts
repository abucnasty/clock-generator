import { ControlLogic } from "../control-logic";

export interface ModeOnEnterHook<M extends Mode> {
    onEnter(fromMode: M): void;
}

export interface ModeOnExitHook<M extends Mode> {
    onExit(toMode: M): void;
}

export interface Mode extends ControlLogic, ModeOnEnterHook<Mode>, ModeOnExitHook<Mode> {
    readonly status: string;
    /**
     * What the mode keeps from one tick to the next, with absolute ticks made relative to `tick` (see
     * ModeStateMachine.stateKey); a mode that keeps nothing has none.
     */
    stateKey?(tick: number): string;
}