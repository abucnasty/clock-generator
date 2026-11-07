import assert from "../../../common/assert";
import { EntityId, Inserter } from "../../../entities";
import { AlwaysEnabledControl, EnableControl } from "../../../simulation/controls/enable-control";
import { ResettableRegistry } from "../../../simulation/controls/resettable-registry";
import { TickProvider } from "../../../simulation/current-tick-provider";
import { EnableControlOverrideConfig } from "../../../config/schema";
import { OutputCyclePlan } from "../cycle/output-cycle";
import { Duration, OpenRange } from "../../../data-types";
import { ReadableEntityStateRegistry } from "../../../state";
import { runThroughTicks } from "./inserter-enable-control-factory";
import { ConditionalEnableControlFactory } from "./conditional-enable-control-factory";

/**
 * keys are EntityId (e.g. "inserter:1")
 */
export type EntityEnableControlOverrideMap = Map<string, EnableControlOverrideConfig>;

/**
 * Factory for creating EnableControl instances from user-specified configuration overrides.
 * 
 * This factory handles explicit user overrides for enable control logic (ALWAYS, NEVER, CLOCKED).
 * For AUTO mode, the EnableControlFactory should be used instead.
 * 
 * The factory will assert if called for an entity without a configured override.
 */
export class ConfigurableEnableControlFactory {

    private readonly conditional_factory: ConditionalEnableControlFactory;

    constructor(
        private readonly override_map: EntityEnableControlOverrideMap,
        private readonly tick_provider: TickProvider,
        private readonly output_cycle_plan: OutputCyclePlan,
        private readonly resettable_registry: ResettableRegistry,
        entity_state_registry: ReadableEntityStateRegistry,
        /**
         * The ticks the clocks of the game count, where they run through the steps of a run: they
         * then keep their count when a later step starts. Without it they count the run's ticks and start again with each step.
         * Only a clock of a whole-tick period runs through, unless `counter_runs_through` (`runThroughTicks`).
         */
        private readonly game_tick_provider?: TickProvider,
        /**
         * Whether the clocks it makes of a p/q-tick period answer in whole 1/q ticks (enable-control.ts `SubtickPositions`):
         * true unless a test asks for floats
         */
        private readonly exact_subtick_positions: boolean = true,
        /** Whether a clock of a p/q-tick period runs through as well (`runThroughTicks`), given a game tick provider */
        private readonly counter_runs_through: boolean = false,
    ) {
        this.conditional_factory = new ConditionalEnableControlFactory(entity_state_registry);
    }

    /**
     * Check if an entity has a non-AUTO enable control override configured.
     */
    public hasOverride(entity_id: EntityId): boolean {
        const override = this.override_map.get(entity_id.id);
        return override !== undefined && override.mode !== "AUTO";
    }

    public getOverrideOrThrow(entity_id: EntityId): EnableControlOverrideConfig {
        const override = this.override_map.get(entity_id.id);
        assert(
            override !== undefined,
            `No enable control override configured for entity ${entity_id.id}`
        );
        return override;
    }

    /**
     * Create an EnableControl for the given entity ID based on its configured override.
     * 
     * @throws If no override is configured for this entity or if mode is AUTO.
     */
    public createForEntityId(entity_id: EntityId, inserter?: Inserter): EnableControl {
        const override = this.override_map.get(entity_id.id);
        assert(
            override !== undefined,
            `No enable control override configured for entity ${entity_id.id}`
        );
        assert(
            override.mode !== "AUTO",
            `Cannot create override control for AUTO mode entity ${entity_id.id}. Use EnableControlFactory instead.`
        );

        switch (override.mode) {
            case "ALWAYS":
                return AlwaysEnabledControl;

            case "NEVER":
                return EnableControl.never;

            case "CLOCKED":
                return this.createClockedControl(entity_id, override);

            case "CONDITIONAL":
                assert(inserter !== undefined, `Inserter required for CONDITIONAL mode on ${entity_id.id}`);
                return this.conditional_factory.createFromConfig(override, inserter);

            default:
                throw new Error(`Unknown enable control mode: ${(override as any).mode}`);
        }
    }

    private createClockedControl(
        entity_id: EntityId,
        override: Extract<EnableControlOverrideConfig, { mode: "CLOCKED" }>
    ): EnableControl {
        const window_cycle_duration = override.period_duration_ticks !== undefined
            ? Duration.ofTicks(override.period_duration_ticks)
            : this.output_cycle_plan.total_duration;

        // Validate and warn if ranges exceed cycle duration
        const enabled_ranges = override.ranges.map(range => {
            if (range.end > window_cycle_duration.ticks) {
                console.warn(
                    `Warning: Enable control range [${range.start}, ${range.end}] for entity ${entity_id.id} ` +
                    `exceeds period duration of ${window_cycle_duration.ticks} ticks. Range will be clamped.`
                );
            }
            return OpenRange.from(range.start, Math.min(range.end, window_cycle_duration.ticks));
        });

        const run_through_ticks = runThroughTicks(this.game_tick_provider, window_cycle_duration.ticks, this.counter_runs_through);
        const clocked_control = EnableControl.clocked({
            windowCycleDuration: window_cycle_duration,
            enabledRanges: enabled_ranges,
            exact_subtick_positions: this.exact_subtick_positions,
            tickProvider: run_through_ticks ?? this.tick_provider,
            is_game_clock: true,
            runs_through_steps: run_through_ticks !== undefined,
            decider_build_order: override.decider_build_order,
            start_latency_ticks: override.latency_ticks,
        });

        this.resettable_registry.register(clocked_control);

        return clocked_control;
    }
}
