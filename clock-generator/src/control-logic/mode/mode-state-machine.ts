import { Mode } from "./mode";
import { ModePlugin } from "./mode-plugin";
import { ModeProvider } from "./mode-provider";
import { ModeTransition, Transition } from "./mode-transition";
import { ModeTransitionEvaluator } from "./mode-transition-evaluator";

export class ModeStateMachine<M extends Mode> implements ModeProvider<M> {
    
    private current: M;

    constructor(
        initial_mode: M,
        private readonly graph: Map<M, ModeTransitionEvaluator<M>>,
        private readonly plugins: ModePlugin<M>[] = []
    ) {
        this.current = initial_mode;
    }

    public get current_mode(): M {
        return this.current;
    }

    public get modes(): ReadonlySet<M> {
        return new Set(this.graph.keys());
    }

    public executeForTick(): void {
        this.current = this.evaluateTransition()
        this.current.executeForTick();
        this.executePlugins();
    }

    public forceTransitionTo(mode: M): void {
        const transition: Transition<M> = {
            toMode: mode,
            reason: "forced transition",
        };
        this.current = this.executeTransition(this.current, transition);
    }

    private evaluateTransition(): M {
        const modeEvaluator = this.modeEvaluatorForMode(this.current);
        const mode_transition = modeEvaluator.evaluateTransition()
        const nextMode = ModeTransition.fold(
            mode_transition, 
            () => this.current,
            (transition) => this.executeTransition(this.current, transition)
        );
        return nextMode
    }

    private executeTransition(fromMode: M, transition: Transition<M>): M {
        if (fromMode === transition.toMode) {
            return fromMode;
        }

        this.notifiyPlugins(fromMode, transition);
        this.notifyOnExit(fromMode, transition.toMode);
        this.notifyOnEnter(fromMode, transition.toMode);

        return transition.toMode;
    }

    private notifiyPlugins(fromMode: M, transition: Transition<M>): void {
        for (const plugin of this.plugins) {
            plugin.onTransition(fromMode, transition);
        }
    }

    private executePlugins() {
        for (const plugin of this.plugins) {
            plugin.executeForTick && plugin.executeForTick();
        }
    }

    private notifyOnEnter(fromMode: M, toMode: M): void {
        toMode.onEnter(fromMode);
        this.modeEvaluatorForMode(toMode).onEnter(fromMode);
    }

    private notifyOnExit(fromMode: M, toMode: M): void {
        fromMode.onExit(toMode);
        this.modeEvaluatorForMode(fromMode).onExit(toMode);
    }

    private modeEvaluatorForMode(mode: M): ModeTransitionEvaluator<M> {
        const evaluator = this.graph.get(mode);
        if (!evaluator) {
            throw new Error(`No mode evaluator found for mode ${mode}`);
        }
        return evaluator;
    }

    public addPlugin(plugin: ModePlugin<M>): void {
        this.plugins.push(plugin);
    }

    public getPlugins(): ModePlugin<M>[] {
        return [...this.plugins];
    }

    /**
     * The current mode and what every mode and evaluator keeps from one tick to the next, with ticks made relative
     * to `tick`; two equal keys one clock period apart mean this state machine repeats. Plugins only observe.
     */
    public stateKey(tick: number): string {
        const parts = [this.current.status];
        for (const [mode, evaluator] of this.graph) {
            parts.push(mode.stateKey?.(tick) ?? "", evaluator.stateKey?.(tick) ?? "");
        }
        return parts.join("|");
    }
}
