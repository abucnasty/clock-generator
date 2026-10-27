import { Mode } from "./mode";
import { ModePlugin } from "./mode-plugin";
import { ModeProvider } from "./mode-provider";
import { Transition } from "./mode-transition";
import { ModeTransitionEvaluator } from "./mode-transition-evaluator";

export class ModeStateMachine<M extends Mode> implements ModeProvider<M> {
    
    protected current: M;
    /** The evaluator of `current`, looked up when the mode changes rather than every tick */
    protected current_evaluator: ModeTransitionEvaluator<M> | undefined;
    /** The evaluator of the mode the last transition entered */
    protected entered_evaluator: ModeTransitionEvaluator<M> | undefined;
    /** The plugins that do something every tick; most only watch transitions */
    protected readonly tick_plugins: ModePlugin<M>[];

    constructor(
        initial_mode: M,
        private readonly graph: Map<M, ModeTransitionEvaluator<M>>,
        private readonly plugins: ModePlugin<M>[] = []
    ) {
        this.current = initial_mode;
        this.current_evaluator = graph.get(initial_mode);
        this.tick_plugins = plugins.filter(plugin => plugin.executeForTick);
    }

    public get current_mode(): M {
        return this.current;
    }

    public get modes(): ReadonlySet<M> {
        return new Set(this.graph.keys());
    }

    /**
     * A tick of the current mode. The state machines of inserters and machines run copies of it (see
     * InserterStateMachine.executeForTick): a copy of their own calls into their own kinds of modes and evaluators,
     * which the engine optimizes better than one place calling into every kind.
     */
    public executeForTick(): void {
        const next = this.evaluateTransition();
        if (next !== this.current) {
            this.current = next;
            this.current_evaluator = this.entered_evaluator ?? this.modeEvaluatorForMode(next);
        }
        next.executeForTick();
        const tick_plugins = this.tick_plugins;
        for (let index = 0; index < tick_plugins.length; index++) {
            tick_plugins[index].executeForTick!();
        }
    }

    public forceTransitionTo(mode: M): void {
        const transition = new Transition(mode, "forced transition");
        this.current = this.executeTransition(this.current, transition);
        this.current_evaluator = this.modeEvaluatorForMode(this.current);
    }

    private evaluateTransition(): M {
        const modeEvaluator = this.current_evaluator ?? this.modeEvaluatorForMode(this.current);
        const mode_transition = modeEvaluator.evaluateTransition();
        // as ModeTransition.fold, without its closures
        if (mode_transition instanceof Transition) {
            return this.executeTransition(this.current, mode_transition);
        }
        return this.current;
    }

    protected executeTransition(fromMode: M, transition: Transition<M>): M {
        if (fromMode === transition.toMode) {
            return fromMode;
        }

        const toMode = transition.toMode;
        this.notifiyPlugins(fromMode, transition);
        fromMode.onExit(toMode);
        (fromMode === this.current && this.current_evaluator !== undefined ? this.current_evaluator : this.modeEvaluatorForMode(fromMode)).onExit(toMode);
        toMode.onEnter(fromMode);
        const to_evaluator = this.modeEvaluatorForMode(toMode);
        to_evaluator.onEnter(fromMode);
        this.entered_evaluator = to_evaluator;

        return toMode;
    }

    private notifiyPlugins(fromMode: M, transition: Transition<M>): void {
        for (const plugin of this.plugins) {
            plugin.onTransition(fromMode, transition);
        }
    }

    protected modeEvaluatorForMode(mode: M): ModeTransitionEvaluator<M> {
        const evaluator = this.graph.get(mode);
        if (!evaluator) {
            throw new Error(`No mode evaluator found for mode ${mode}`);
        }
        return evaluator;
    }

    public addPlugin(plugin: ModePlugin<M>): void {
        this.plugins.push(plugin);
        if (plugin.executeForTick) {
            this.tick_plugins.push(plugin);
        }
    }

    /** Takes these plugins off, for a run whose observations nobody reads any more */
    public removePlugins(plugins: ReadonlySet<ModePlugin<M>>): void {
        for (const list of [this.plugins, this.tick_plugins]) {
            const kept = list.filter(plugin => !plugins.has(plugin));
            list.length = 0;
            // not list.push(...kept): a build has more plugins than a call takes arguments
            for (const plugin of kept) {
                list.push(plugin);
            }
        }
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
