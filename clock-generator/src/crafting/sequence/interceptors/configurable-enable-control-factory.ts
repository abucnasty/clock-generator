import assert from "../../../common/assert";
import { EntityId, Inserter } from "../../../entities";
import { AlwaysEnabledControl, EnableControl, ResettableRegistry, TickProvider } from "../../../control-logic";
import { EnableControlOverrideConfig } from "../../../config/schema";
import { CraftingCyclePlan } from "../cycle/crafting-cycle";
import { Duration, OpenRange } from "../../../data-types";
import { ReadableEntityStateRegistry } from "../../../state";
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
        private readonly crafting_cycle_plan: CraftingCyclePlan,
        private readonly resettable_registry: ResettableRegistry,
        entity_state_registry: ReadableEntityStateRegistry,
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
        const period_duration = override.period_duration_ticks !== undefined
            ? Duration.ofTicks(override.period_duration_ticks)
            : this.crafting_cycle_plan.total_duration;

        // Validate and warn if ranges exceed cycle duration
        const enabled_ranges = override.ranges.map(range => {
            if (range.end > period_duration.ticks) {
                console.warn(
                    `Warning: Enable control range [${range.start}, ${range.end}] for entity ${entity_id.id} ` +
                    `exceeds period duration of ${period_duration.ticks} ticks. Range will be clamped.`
                );
            }
            return OpenRange.from(range.start, Math.min(range.end, period_duration.ticks));
        });

        const clocked_control = EnableControl.clocked({
            periodDuration: period_duration,
            enabledRanges: enabled_ranges,
            tickProvider: this.tick_provider,
            is_game_clock: true,
            decider_build_order: override.decider_build_order,
        });

        this.resettable_registry.register(clocked_control);

        return clocked_control;
    }
}
