import assert from "../../../common/assert";
import { EntityId, Inserter, InserterStackSize, Machine, MiningDrill, miningDrillMaxInsertion } from "../../../entities";
import { EntityTransferCountMap } from "../cycle/swing-counts";
import { AlwaysEnabledControl, EnableControl, ResettableRegistry, TickProvider } from "../../../control-logic";
import { assertIsInserterState, assertIsMachineState, BeltState, ChestState, EntityState, InserterState, MachineState, ReadableEntityStateRegistry } from "../../../state";
import { ItemName } from "../../../data";
import { computeSimulationMode, SimulationMode, simulationModeForInput } from "../simulation-mode";
import { CraftingCyclePlan } from "../cycle/crafting-cycle";
import { Duration, OpenRange } from "../../../data-types";
import { SwingDistribution } from "../cycle/swing-distribution";
import { Logger } from "../../../common/logger";

export class EnableControlFactory {

    private readonly target_output_item_name: string;
    private readonly terminal_machine_states: Set<MachineState>;
    private readonly terminal_inserter_states: Set<InserterState>;
    private readonly entity_transfer_map: EntityTransferCountMap

    constructor(
        private readonly entity_state_registry: ReadableEntityStateRegistry,
        private readonly crafting_cycle_plan: CraftingCyclePlan,
        private readonly tick_provider: TickProvider,
        private readonly resettable_registry: ResettableRegistry,
        private readonly logger: Logger
    ) {
        this.target_output_item_name = this.crafting_cycle_plan.production_rate.machine_production_rate.item;
        this.entity_transfer_map = this.crafting_cycle_plan.entity_transfer_map;
        this.terminal_machine_states = this.findFinalMachines();
        this.terminal_inserter_states = this.findFinalInserters();
    }

    public createForEntityId(entity_id: EntityId): EnableControl {

        const entity_state = this.entity_state_registry.getStateByEntityIdOrThrow(entity_id);
        if (EntityState.isDrill(entity_state)) {
            return this.forDrill(
                entity_state.drill,
                entity_state.drill.sink_id,
            )
        }
        assertIsInserterState(entity_state);

        const source_state = this.entity_state_registry.getSourceStateOrThrow(entity_id);
        const sink_state = this.entity_state_registry.getSinkStateOrThrow(entity_id);

        // Check if this is a terminal output inserter
        if (this.terminal_inserter_states.has(entity_state)) {
            // Find the corresponding terminal machine for this inserter
            const terminal_machine = this.findTerminalMachineForInserter(entity_state);
            return this.transferCountFromMachine(
                entity_state,
                terminal_machine,
            );
        }

        const additional_enable_controls: EnableControl[] = [];

        // Check if this inserter feeds into any terminal machine.
        // Skip for fractional swings, or when individual item transfers are fractional.
        // (Fractional per-item transfers are handled separately below in the belt→machine branch.)
        if (!this.crafting_cycle_plan.fractional_swings_enabled) {
            if (EntityState.isMachine(sink_state) && this.terminal_machine_states.has(sink_state)) {
                if (!this.hasFractionalPerItemTransfers(entity_state.inserter)) {
                    additional_enable_controls.push(
                        this.transferCountToMachine(
                            entity_state,
                            sink_state,
                        )
                    );
                }
            }
        }


        if (EntityState.isMachine(source_state) && EntityState.isMachine(sink_state)) {
            return EnableControl.all([
                ...additional_enable_controls,
                this.fromMachinetoMachine(entity_state.inserter, source_state, sink_state)
            ]);
        }

        if (EntityState.isBelt(source_state) && EntityState.isMachine(sink_state)) {
            // When the user sets terminal_swing_count below the natural maximum, individual
            // item transfer counts become fractional even though the total is an integer
            // (e.g. copper=0.5 + gear=0.5 = 1.0). The latched fromBeltToMachine control
            // cannot reliably handle this because the machine never blocks the first-filter
            // item before running out of cycle budget. Using AlwaysEnabledControl lets the
            // machine's own automated_insertion_limit blocking naturally rotate through all
            // items without any clocked or latched intervention.
            if (this.crafting_cycle_plan.terminal_swing_count_overridden &&
                this.terminal_machine_states.has(sink_state) &&
                this.hasFractionalPerItemTransfers(entity_state.inserter)) {
                return AlwaysEnabledControl;
            }
            return EnableControl.all([
                ...additional_enable_controls,
                this.fromBeltToMachine(entity_state.inserter, source_state, sink_state)
            ]);
        }

        // Machine → Chest: Enable when chest has space and source machine has output
        if (EntityState.isMachine(source_state) && EntityState.isChest(sink_state)) {
            return this.fromMachineToChest(entity_state.inserter, source_state, sink_state);
        }

        // Chest → Machine: Enable when chest has items and machine needs them
        if (EntityState.isChest(source_state) && EntityState.isMachine(sink_state)) {
            return EnableControl.all([
                ...additional_enable_controls,
                this.fromChestToMachine(entity_state.inserter, source_state, sink_state)
            ]);
        }

        if (EntityState.isChest(source_state) && EntityState.isChest(sink_state)) {
            return this.fromChestToChest(entity_state.inserter, source_state, sink_state);
        }

        return AlwaysEnabledControl
    }


    public fromBeltToMachine(
        inserter: Inserter,
        source_state: BeltState,
        sink_state: MachineState,
    ): EnableControl {
        const inserter_filtered_items = inserter.filtered_items;
        const inserter_animation = inserter.animation;
        const time_to_transfer = inserter_animation.pickup_to_drop.ticks
        const belt_item_names = source_state.belt.lanes.map(it => it.ingredient_name)
        const transferred_items = belt_item_names.filter(it => inserter_filtered_items.has(it))
        const buffer_multiplier = 2

        const mode: SimulationMode = computeSimulationMode(
            sink_state.machine,
            inserter,
            this.entity_transfer_map.getOrThrow(inserter.entity_id),
        );

        if (mode === SimulationMode.LOW_INSERTION_LIMITS) {
            return AlwaysEnabledControl
        }

        const enable_control = EnableControl.any(
            transferred_items.map(source_item_name => {
                const sink_input = sink_state.machine.inputs.getOrThrow(source_item_name);
                const minimum_required = sink_input.consumption_rate.amount_per_craft
                const automated_insertion_limit = sink_input.automated_insertion_limit.quantity;
                const sink_consumption_per_tick = sink_input.consumption_rate.rate_per_tick;

                return EnableControl.latched({
                    base: EnableControl.lambda(() => {
                        const sink_quantity = sink_state.inventoryState.getItemOrThrow(source_item_name).quantity;
                        const sink_quantity_after_transfer = sink_quantity - Math.ceil(sink_consumption_per_tick * time_to_transfer);
                        return sink_quantity_after_transfer < minimum_required * buffer_multiplier
                    }),
                    release: EnableControl.lambda(() => {
                        const sink_quantity = sink_state.inventoryState.getItemOrThrow(source_item_name).quantity;
                        return sink_quantity >= automated_insertion_limit
                    })
                })
            })
        )
        return enable_control;
    }

    /**
     * Enable control for machine → chest inserters.
     * 
     * These inserters should be enabled when:
     * 1. The chest has available space
     * 2. The source machine has items to transfer
     * 
     * This allows the chest to act as a buffer that gets refilled when depleted.
     */
    public fromMachineToChest(
        inserter: Inserter,
        source_state: MachineState,
        sink_state: ChestState,
    ): EnableControl {
        const source_item_name = source_state.machine.output.item_name;
        const stack_size = inserter.metadata.stack_size;

        return EnableControl.latched({
            base: EnableControl.lambda(() => {
                // Enable when chest has space for at least one stack and source has items
                const available_space = sink_state.getAvailableSpace();
                const source_quantity = source_state.inventoryState.getQuantity(source_item_name);
                return available_space >= stack_size && source_quantity >= stack_size;
            }),
            release: EnableControl.lambda(() => {
                // Release when chest is full
                return sink_state.isFull();
            })
        });
    }

    public fromChestToChest(
        inserter: Inserter,
        source_state: ChestState,
        sink_state: ChestState,
    ): EnableControl {
        // Find all inserters pulling from this source chest
        const inserters_from_source = this.entity_state_registry
            .getAllStates()
            .filter(EntityState.isInserter)
            .filter(i => i.inserter.source.entity_id.id === source_state.entity_id.id);

        // Optimization: if only one inserter, use simple logic
        if (inserters_from_source.length === 1) {
            return this.fromChestToChestSingleInserter(inserter, source_state);
        }

        return this.fromChestToChestMultipleInserters(inserters_from_source, source_state);
    }

    /**
     * Enable control for chest → chest with a single inserter.
     * Simple check: enable when chest has enough items for one stack.
     */
    private fromChestToChestSingleInserter(
        inserter: Inserter,
        source_state: ChestState,
    ): EnableControl {
        const stack_size = inserter.metadata.stack_size;
        return EnableControl.lambda(() => {
            const source_quantity = source_state.getCurrentQuantity();
            return source_quantity >= stack_size;
        });
    }

    /**
     * Enable control for chest → chest with multiple inserters pulling from the same chest.
     * Accounts for items in all inserter hands to handle sequential evaluation in the same tick.
     */
    private fromChestToChestMultipleInserters(
        inserters_from_source: InserterState[],
        source_state: ChestState,
    ): EnableControl {
        const total_stack_size = inserters_from_source.reduce(
            (sum, i) => sum + i.inserter.metadata.stack_size,
            0
        );

        return EnableControl.lambda(() => {
            const source_quantity = source_state.getCurrentQuantity();

            // Sum items currently held by all inserters pulling from this chest
            const items_in_hands = inserters_from_source.reduce(
                (sum, i) => sum + (i.held_item?.quantity ?? 0),
                0
            );

            // Total available = chest quantity + items in all inserter hands
            const total_available = source_quantity + items_in_hands;

            return total_available >= total_stack_size;
        });
    }

    public fromChestToMachine(
        inserter: Inserter,
        source_state: ChestState,
        sink_state: MachineState,
    ): EnableControl {
        // Find all item types from the chest that the machine needs
        const item_filters = source_state.getItemFilters();
        const per_item_controls: EnableControl[] = [];

        for (const item_name of item_filters) {
            if (!sink_state.machine.inputs.has(item_name)) {
                continue;
            }
            if (!inserter.filtered_items.has(item_name)) {
                continue;
            }
            per_item_controls.push(
                this.fromChestToMachineForItem(source_state, sink_state, item_name)
            );
        }

        if (per_item_controls.length === 0) {
            // No items from this chest are needed by the sink machine
            return EnableControl.never;
        }

        return EnableControl.any(per_item_controls);
    }

    private fromChestToMachineForItem(
        source_state: ChestState,
        sink_state: MachineState,
        item_name: ItemName,
    ): EnableControl {
        const buffer_multiplier = 2;

        const sink_input = sink_state.machine.inputs.get(item_name);
        if (!sink_input) {
            return EnableControl.never;
        }

        const minimum_required = sink_input.consumption_rate.amount_per_craft;
        const automated_insertion_limit = sink_input.automated_insertion_limit.quantity;

        return EnableControl.latched({
            base: EnableControl.lambda(() => {
                // Enable when sink needs items (below buffer threshold) AND chest has items
                const sink_quantity = sink_state.inventoryState.getQuantity(item_name);
                const chest_has_items = source_state.getCurrentQuantity(item_name) > 0;
                return chest_has_items && sink_quantity < minimum_required * buffer_multiplier;
            }),
            release: EnableControl.lambda(() => {
                // Release when sink is at insertion limit OR chest is empty (for buffer chests)
                const sink_quantity = sink_state.inventoryState.getQuantity(item_name);
                const chest_is_empty = source_state.isEmpty();
                return sink_quantity >= automated_insertion_limit || chest_is_empty;
            })
        });
    }

    public fromMachinetoMachine(
        inserter: Inserter,
        source_state: MachineState,
        sink_state: MachineState,
    ): EnableControl {
        const source_item_name = source_state.machine.output.item_name;
        const buffer_multiplier = 2

        const mode: SimulationMode = computeSimulationMode(
            sink_state.machine,
            inserter,
            this.entity_transfer_map.getOrThrow(inserter.entity_id),
        );

        // For fractional swings, use clocked control to schedule inserters at end of subcycle
        if (this.crafting_cycle_plan.fractional_swings_enabled) {
            const enabled_ranges = this.computeInputInserterEnableRanges(inserter)
            this.logger.log(`Fractional swings enabled for inserter ${inserter.entity_id.id}, enabled ranges:`);
            enabled_ranges.forEach(range => {
                this.logger.log(`  [${range.start_inclusive},${range.end_inclusive}]`);
            });
            const clocked_control = this.clockedForCycle(
                this.computeInputInserterEnableRanges(inserter)
            );

            return EnableControl.all([
                clocked_control,
                this.sourceIsGreaterThanStackSize(
                    source_state,
                    inserter.metadata.stack_size,
                ),
                this.latchedUntilLessThanMinimum(
                    sink_state,
                    source_item_name,
                    buffer_multiplier
                )
            ]);
        }

        if (mode === SimulationMode.LOW_INSERTION_LIMITS) {
            if (sink_state.machine.output.outputBlock.quantity < inserter.metadata.stack_size) {
                return EnableControl.always
            }
            return this.latchedUntilLessThanMinimum(
                sink_state,
                source_item_name,
                buffer_multiplier
            )
        }

        if (source_state.machine.output.outputBlock.quantity < inserter.metadata.stack_size) {
            return EnableControl.all([
                this.latchedUntilLessThanMinimum(
                    sink_state,
                    source_item_name,
                    buffer_multiplier
                )
            ])
        }

        return EnableControl.all(
            [
                this.sourceIsGreaterThanStackSize(
                    source_state,
                    inserter.metadata.stack_size,
                ),
                this.latchedUntilLessThanMinimum(
                    sink_state,
                    source_item_name,
                    buffer_multiplier
                )
            ]
        )
    }

    public forDrill(
        drill: MiningDrill,
        sink_entity_id: EntityId,
    ): EnableControl {
        const sink_state = this.entity_state_registry.getStateByEntityIdOrThrow(sink_entity_id);
        assertIsMachineState(sink_state);
        const sink_machine = sink_state.machine
        const source_item = drill.item
        const source_item_name = source_item.name;
        const sink_input = sink_machine.inputs.getOrThrow(source_item_name);
        const minimum_required = sink_input.consumption_rate.amount_per_craft
        const sink_consumption_per_tick = sink_input.consumption_rate.rate_per_tick;
        const drill_output_per_tick = drill.production_rate.amount_per_tick.toDecimal();
        const time_to_transfer_minimum_amount = Math.ceil(minimum_required / drill_output_per_tick)

        const max_insertion_amount = miningDrillMaxInsertion(drill, sink_machine);

        const ensure_at_least_once_per_cycle = this.clockedForCycle(
            [OpenRange.from(1, 1)]
        )

        return EnableControl.any([
            EnableControl.latched({
                base: EnableControl.any([
                    ensure_at_least_once_per_cycle,
                    EnableControl.lambda(() => {
                        const sink_quantity = sink_state.inventoryState.getItemOrThrow(source_item_name).quantity;
                        const sink_quantity_after_transfer = sink_quantity - Math.ceil(sink_consumption_per_tick * time_to_transfer_minimum_amount);
                        return sink_quantity_after_transfer < minimum_required * 4
                    })
                ]),
                release: EnableControl.lambda(() => {
                    const sink_quantity = sink_state.inventoryState.getItemOrThrow(source_item_name).quantity;
                    return sink_quantity >= max_insertion_amount
                })
            })
        ])
    }

    /**
     * Determines if a machine requires clocked control for input inserters due to fast crafting.
     * Fast-crafting machines can complete multiple crafts during one insertion window
     * 
     * This is a beta feature and is a guess on how to decide if we should clock or keep always enabled
     */
    private shouldUseClockedControlForInputs(inserter: Inserter, machine: Machine): boolean {
        const insertion_duration = machine.insertion_duration.tick_duration.toDecimal();
        const transfer_count = this.entity_transfer_map.getOrThrow(inserter.entity_id);
        const total_transfer_duration = inserter.animation.total.ticks * Math.ceil(transfer_count.total_transfer_count.toDecimal());

        const ratios_are_all_equal = new Set(transfer_count.item_transfers.map(it => it.transfer_count.toDecimal())).size === 1;
        if (!ratios_are_all_equal) {
            return false;
        }

        return total_transfer_duration > insertion_duration
    }

    private transferCountToMachine(
        inserter_state: InserterState,
        sink_state: MachineState,
    ): EnableControl {
        const mode = simulationModeForInput(inserter_state.inserter, sink_state.machine);

        // For fractional swings, use the same enable ranges as fromMachinetoMachine
        // to ensure consistent timing
        if (this.crafting_cycle_plan.fractional_swings_enabled) {
            return this.clockedForCycle(
                this.computeInputInserterEnableRanges(inserter_state.inserter)
            );
        }

        if (mode === SimulationMode.LOW_INSERTION_LIMITS) {
            if (this.shouldUseClockedControlForInputs(inserter_state.inserter, sink_state.machine)) {
                return this.clockedForCycle(
                    this.computeEnableRangesToMachine(inserter_state, sink_state)
                )
            }
            return this.enabledAfterOutputInserter(inserter_state, sink_state);
        }

        if (mode === SimulationMode.NORMAL) {
            return this.clockedForCycle(
                this.computeEnableRangesToMachine(inserter_state, sink_state)
            )
        }
        return AlwaysEnabledControl;
    }

    private transferCountFromMachine(
        inserter_state: InserterState,
        source_state: MachineState,
    ): EnableControl {

        const mode = computeSimulationMode(
            source_state.machine,
            inserter_state.inserter,
            this.entity_transfer_map.getOrThrow(inserter_state.inserter.entity_id),
        );

        // For fractional swings, use simple clocked ranges at the BEGINNING of each sub-cycle
        // No swing counting or buffer clear logic - just clock-based enable windows
        // For output inserters, we don't use the sourceIsGreaterThanStackSize check because
        // the cycle is designed to produce the right number of items overall, and consecutive
        // swings may need to happen before the machine has time to replenish inventory.
        if (this.crafting_cycle_plan.fractional_swings_enabled && this.crafting_cycle_plan.swing_distribution) {
            const distribution = this.crafting_cycle_plan.swing_distribution.get(inserter_state.inserter.entity_id.id);

            if (distribution) {
                const enabled_ranges = this.computeOutputInserterEnableRanges(inserter_state, distribution);
                return this.clockedForCycle(enabled_ranges);
            }
        }

        // Non-fractional mode: use original clocked control logic (TODO: refactor this eventually...)
        const enabled_ranges = [this.computeEnableRangeFromMachine(inserter_state, source_state)];
        const clocked_control = this.clockedForCycle(enabled_ranges);

        // For NORMAL mode, always add the inventory check
        if (mode === SimulationMode.NORMAL) {
            return EnableControl.all(
                [
                    clocked_control,
                    this.sourceIsGreaterThanStackSize(
                        source_state,
                        inserter_state.inserter.metadata.stack_size,
                    )
                ]
            )
        }

        // For PREVENT_DESYNCS, use clocked control only (no inventory check)
        if (mode === SimulationMode.PREVENT_DESYNCS) {
            return clocked_control;
        }

        return clocked_control;
    }

    /**
     * Computes enable ranges across all sub-cycles for fractional swings.
     * Each sub-cycle may have a different number of swings based on the distribution.
     * 
     * For NORMAL mode, the ranges are extended to cover the entire sub-cycle because
     * the sourceIsGreaterThanStackSize check will prevent actual swings until items
     * are available. This gives maximum flexibility for when swings can occur.
     */
    private computeEnableRangesFromMachineWithFractionalSwings(
        inserter_state: InserterState,
        source_state: MachineState,
    ): OpenRange[] {
        const swing_distribution = this.crafting_cycle_plan.swing_distribution;
        const cycle_multiplier = this.crafting_cycle_plan.cycle_multiplier;

        if (!swing_distribution || !cycle_multiplier) {
            // Fallback to single range if no distribution available
            return [this.computeEnableRangeFromMachine(inserter_state, source_state)];
        }

        const entity_id = inserter_state.inserter.entity_id.id;
        const distribution = swing_distribution.get(entity_id);

        if (!distribution) {
            // Fallback to single range if entity not in distribution map
            return [this.computeEnableRangeFromMachine(inserter_state, source_state)];
        }

        const base_cycle_duration = this.crafting_cycle_plan.total_duration.ticks;
        const ranges: OpenRange[] = [];

        // For fractional swings, we extend each range to cover the full sub-cycle.
        // The sourceIsGreaterThanStackSize condition (in NORMAL mode) will prevent
        // swings until items are available, so we can safely open the window for
        // the entire sub-cycle. This ensures we don't miss any swing opportunities.

        // Generate enable ranges for each sub-cycle based on the swing distribution
        for (let subcycle_index = 0; subcycle_index < cycle_multiplier; subcycle_index++) {
            const swings_in_subcycle = distribution.swings_per_subcycle[subcycle_index];

            if (swings_in_subcycle === 0) {
                continue; // No swings in this sub-cycle
            }

            const subcycle_offset = subcycle_index * base_cycle_duration;
            const subcycle_end = subcycle_offset + base_cycle_duration;

            // Cover the entire sub-cycle - let the inventory check determine actual swing timing
            ranges.push(OpenRange.from(subcycle_offset, subcycle_end));
        }

        return ranges.length > 0 ? ranges : [this.computeEnableRangeFromMachine(inserter_state, source_state)];
    }

    /**
     * Sets the enable range per crafting cycle to be after the output inserter for the sink machine has completed its swings
     * 
     * The input inserter is enabled from the end of the output inserter's schedule until the end of the crafting cycle.
     */
    private enabledAfterOutputInserter(inserter_state: InserterState, sink_state: MachineState): EnableControl {
        const base_cycle_duration = this.crafting_cycle_plan.total_duration.ticks;

        // Find output inserters for the sink machine (inserters pulling FROM the sink machine)
        const output_inserters_for_sink = this.entity_state_registry
            .getAllStates()
            .filter(EntityState.isInserter)
            .filter(i => i.inserter.source.entity_id.id === sink_state.machine.entity_id.id);

        // If no output inserters, enable for the entire cycle
        if (output_inserters_for_sink.length === 0) {
            return AlwaysEnabledControl
        }

        // Get the enable ranges for all output inserters and merge them
        const output_inserter_enable_ranges = OpenRange.reduceRanges(
            output_inserters_for_sink.map(output_inserter_state => {
                return this.computeEnableRangeFromMachine(
                    output_inserter_state,
                    sink_state,
                );
            })
        );

        // Create enable ranges that start after each output inserter range ends until end of cycle
        const enabled_ranges: OpenRange[] = output_inserter_enable_ranges.map(range => {
            const start_tick = range.end_inclusive - 2;
            return OpenRange.from(start_tick, base_cycle_duration);
        });

        const merged_ranges = OpenRange.reduceRanges(enabled_ranges);
        const sorted_ranges = merged_ranges.sort((a, b) => a.start_inclusive - b.start_inclusive);

        return this.clockedForCycle(sorted_ranges.length > 0 ? sorted_ranges : [OpenRange.from(0, base_cycle_duration)]);
    }

    private computeEnableRangesToMachine(
        inserter_state: InserterState,
        sink_state: MachineState,
    ): OpenRange[] {
        const transfer_count = this.entity_transfer_map.getOrThrow(inserter_state.inserter.entity_id);
        const animation = inserter_state.inserter.animation;
        const base_cycle_duration = this.crafting_cycle_plan.total_duration.ticks;

        // For non-fractional swings, use the original logic
        if (!this.crafting_cycle_plan.fractional_swings_enabled) {
            return this.computeEnableRangesToMachineNonFractional(inserter_state, sink_state);
        }

        // For fractional swings, compute ranges at the END of each sub-cycle
        // Input inserters should swing right before the output inserters of their sink machine
        const cycle_multiplier = this.crafting_cycle_plan.cycle_multiplier ?? 1;

        // Get the swing distribution for this inserter if available
        const swing_distribution = this.crafting_cycle_plan.swing_distribution?.get(inserter_state.inserter.entity_id.id);

        // Time per swing cycle
        const ticks_per_swing = animation.total.ticks + 1;

        // Calculate swings per subcycle if no distribution is available
        // Distribute the total transfer count evenly across subcycles
        const total_swings = Math.ceil(transfer_count.total_transfer_count.toDecimal());
        const swings_per_subcycle_default = Math.ceil(total_swings / cycle_multiplier);

        const all_ranges: OpenRange[] = [];

        for (let subcycle = 0; subcycle < cycle_multiplier; subcycle++) {
            const subcycle_offset = subcycle * base_cycle_duration;

            // Get the number of swings for this sub-cycle from the distribution
            // If no distribution, distribute evenly across subcycles
            const swings_in_subcycle = swing_distribution
                ? swing_distribution.swings_per_subcycle[subcycle]
                : swings_per_subcycle_default;

            if (swings_in_subcycle === 0) {
                continue; // No swings in this sub-cycle
            }

            // Duration needed for all swings (no extra buffer)
            const swing_duration = ticks_per_swing * swings_in_subcycle;

            // Back-load: enable window positioned at end of subcycle
            const subcycle_end = subcycle_offset + base_cycle_duration;
            const range_start = Math.max(subcycle_offset, subcycle_end - swing_duration);
            // End tick is exactly start + duration (not the full subcycle end)
            const range_end = range_start + swing_duration;

            all_ranges.push(OpenRange.from(range_start, range_end));
        }

        const merged_ranges = OpenRange.reduceRanges(all_ranges);
        const sorted_ranges = merged_ranges.sort((a, b) => a.start_inclusive - b.start_inclusive);

        return sorted_ranges.length > 0 ? sorted_ranges : [
            OpenRange.fromStartAndDuration(0, base_cycle_duration)
        ];
    }

    /**
     * Original logic for computing enable ranges to machine (non-fractional swings).
     */
    private computeEnableRangesToMachineNonFractional(
        inserter_state: InserterState,
        sink_state: MachineState,
    ): OpenRange[] {
        const transfer_count = this.entity_transfer_map.getOrThrow(inserter_state.inserter.entity_id);
        const animation = inserter_state.inserter.animation;
        const total_transfer_duration = Duration.ofTicks(
            animation.total.ticks * Math.ceil(transfer_count.total_transfer_count.toDecimal())
        );

        const output_inserters_for_sink = this.entity_state_registry
            .getAllStates()
            .filter(EntityState.isInserter)
            .filter(i => i.inserter.source.entity_id.id === sink_state.machine.entity_id.id);

        const output_inserter_enable_ranges = OpenRange.reduceRanges(
            output_inserters_for_sink.map(output_inserter_state => {
                return this.computeEnableRangeFromMachine(
                    output_inserter_state,
                    sink_state,
                )
            })
        );

        const enabled_ranges: OpenRange[] = output_inserter_enable_ranges.map(range => {
            const output_inserter_end = range.end_inclusive;
            const end_of_cycle = this.crafting_cycle_plan.total_duration.ticks;

            let start_tick = output_inserter_end
            let end_tick = start_tick + total_transfer_duration.ticks

            if (end_tick > end_of_cycle) {
                start_tick = end_of_cycle - total_transfer_duration.ticks;
                end_tick = end_of_cycle;
            }
            return OpenRange.from(start_tick, end_tick);
        })
        const merged_ranges = OpenRange.reduceRanges(enabled_ranges);
        const sorted_ranges = merged_ranges.sort((a, b) => a.start_inclusive - b.start_inclusive);

        return sorted_ranges;
    }

    /**
     * Computes enable ranges for output inserters with fractional swings.
     * 
     * Output inserter swings happen at the BEGINNING of each sub-cycle.
     * Each sub-cycle gets an enable window starting at tick 0 (relative to sub-cycle)
     * with duration based on the number of swings for that sub-cycle.
     * 
     * For example, with [1, 2, 1, 2] swings per subcycle and 84 tick cycles:
     * - Subcycle 0: enabled [0, 12] (1 swing)
     * - Subcycle 1: enabled [84, 108] (2 swings)  
     * - Subcycle 2: enabled [168, 180] (1 swing)
     * - Subcycle 3: enabled [252, 276] (2 swings)
     */
    private computeOutputInserterEnableRanges(
        inserter_state: InserterState,
        distribution: SwingDistribution,
    ): OpenRange[] {
        const animation = inserter_state.inserter.animation;
        const base_cycle_duration = this.crafting_cycle_plan.total_duration.ticks;
        const cycle_multiplier = this.crafting_cycle_plan.cycle_multiplier ?? 1;

        // Time for a complete swing cycle: pickup + swing + drop + swing back
        // We use (total + 1) as the swing duration to account for the pickup tick
        const ticks_per_swing = animation.total.ticks + 1;

        const ranges: OpenRange[] = [];

        for (let subcycle = 0; subcycle < cycle_multiplier; subcycle++) {
            const swings_in_subcycle = distribution.swings_per_subcycle[subcycle] ?? 0;

            if (swings_in_subcycle === 0) {
                continue; // No swings in this sub-cycle
            }

            const subcycle_offset = subcycle * base_cycle_duration;

            // Enable window starts at beginning of subcycle
            const start_tick = subcycle_offset;
            // Duration based on number of swings + some buffer
            const duration = ticks_per_swing * swings_in_subcycle + 4;
            const end_tick = start_tick + duration;

            ranges.push(OpenRange.from(start_tick, end_tick));
        }

        return ranges.length > 0 ? ranges : [OpenRange.from(0, base_cycle_duration)];
    }

    /**
     * Computes enable ranges for input inserters (machine-to-machine) with fractional swings.
     * 
     * Input inserter swings happen at the END of each sub-cycle to feed the chain reaction.
     * The enable window is sized exactly for the required swings and positioned at the end
     * of the subcycle.
     * 
     * For example, with 84 tick subcycles, 12 ticks/swing, and [3, 4, 4, 4] swings:
     * - Subcycle 0: 3 swings × 12 = 36 ticks → enabled [48, 84]
     * - Subcycle 1: 4 swings × 12 = 48 ticks → enabled [120, 168]
     * - Subcycle 2: 4 swings × 12 = 48 ticks → enabled [204, 252]
     * - Subcycle 3: 4 swings × 12 = 48 ticks → enabled [288, 336]
     */
    private computeInputInserterEnableRanges(
        inserter: Inserter,
    ): OpenRange[] {
        const animation = inserter.animation;
        const base_cycle_duration = this.crafting_cycle_plan.total_duration.ticks;
        const cycle_multiplier = this.crafting_cycle_plan.cycle_multiplier ?? 1;

        // Get the swing distribution for this inserter
        const distribution = this.crafting_cycle_plan.swing_distribution?.get(inserter.entity_id.id);

        // Time for a complete swing cycle
        const ticks_per_swing = animation.total.ticks + 1;

        const ranges: OpenRange[] = [];

        for (let subcycle = 0; subcycle < cycle_multiplier; subcycle++) {
            // Get swings for this subcycle from the distribution
            const swings_in_subcycle = distribution?.swings_per_subcycle[subcycle] ?? 0;

            if (swings_in_subcycle === 0) {
                continue; // No swings in this sub-cycle
            }

            const subcycle_offset = subcycle * base_cycle_duration;

            // Duration of the enable window to allow exactly N swings to START.
            // If each swing takes T ticks, swing starts are spaced T ticks apart:
            //   Swing 1: starts at 0
            //   Swing 2: starts at T
            //   Swing N: starts at (N-1)*T
            // OpenRange is inclusive on both ends, so [start, start + duration] spans duration+1 distinct ticks.
            // Thus we use (N-1)*T for the duration parameter to get a span of (N-1)*T + 1 ticks, allowing N swings to start.
            const window_duration = (swings_in_subcycle - 1) * ticks_per_swing;

            // The subcycle boundary (end of this subcycle)
            const subcycle_end = subcycle_offset + base_cycle_duration;

            // Position the window so the LAST swing starts ticks_per_swing before the boundary
            // This ensures the last swing COMPLETES right at the boundary
            const last_swing_start = subcycle_end - ticks_per_swing;
            const start_tick = Math.max(subcycle_offset, last_swing_start - window_duration);
            // End tick is positioned so exactly N swings can START within [start_tick, end_tick]
            const end_tick = start_tick + window_duration;

            ranges.push(OpenRange.from(start_tick, end_tick));
        }

        return ranges.length > 0 ? ranges : [OpenRange.from(0, base_cycle_duration)];
    }

    /**
     * Calculates the tick at which the source machine will have produced a full stack of items.
     * Used for the "buffer in hand" strategy where the inserter picks up items at the end
     * of the cycle (when they're ready) and drops them at the start of the next cycle.
     */
    private ticksToProduceStack(
        source_machine: Machine,
        stack_size: number,
    ): number {
        const amount_per_craft = source_machine.output.amount_per_craft.toDecimal();
        const ticks_per_craft = source_machine.crafting_rate.ticks_per_craft;

        const crafts_for_stack = Math.ceil(stack_size / amount_per_craft);
        const ticks_to_full_stack = Math.ceil(crafts_for_stack * ticks_per_craft);

        return ticks_to_full_stack;
    }

    /**
     * Determines if the machine is "slow" relative to the inserter's needs.
     * A slow machine cannot produce items fast enough to sustain the inserter's
     * pickup rate, meaning items won't be ready at the start of the cycle.
     * 
     * We compare: ticks_to_produce_first_stack vs enable_window_start
     * If producing a full stack takes longer than the enable window allows,
     * we need to use buffer-in-hand strategy.
     */
    private isSlowMachine(
        source_machine: Machine,
        inserter: Inserter,
        total_transfer_count: number,
    ): boolean {
        const stack_size = inserter.metadata.stack_size;
        const ticks_to_stack = this.ticksToProduceStack(source_machine, stack_size);
        const cycle_duration = this.crafting_cycle_plan.total_duration.ticks;

        // Check if this is a fractional swing case (cycle produces less than a full stack).
        // In fractional swing cases, the cycle duration is artificially shorter than what 
        // the machine can produce, and we should NOT apply buffer-in-hand strategy.
        // Instead, we let the inserter start at tick 0 and pick up whatever is available.
        //
        // We detect this by checking if ticks_to_stack significantly exceeds cycle_duration
        // but the continuous rate shows we're producing items (not a truly slow machine).
        // A truly slow machine has ticks_to_stack > cycle_duration * total_transfer_count.
        // A fractional swing case has ticks_to_stack slightly > cycle_duration but the 
        // items actually fit within the larger timing window.
        const items_produced_per_cycle = (source_machine.output.amount_per_craft.toDecimal() / source_machine.crafting_rate.ticks_per_craft) * cycle_duration;

        // If the continuous rate produces at least a stack, but discrete timing takes
        // slightly longer than the cycle, this is a fractional case - not slow machine.
        // The key insight: if items_produced_per_cycle >= stack_size, the machine is 
        // "fast enough" in continuous terms, just discrete timing doesn't align perfectly.
        if (items_produced_per_cycle >= stack_size && ticks_to_stack <= cycle_duration * 1.2) {
            // Fractional swing case or near-match - don't use buffer-in-hand
            return false;
        }

        if (items_produced_per_cycle < stack_size) {
            // Fractional swing case - not a "slow machine", just an intentionally short cycle
            return false;
        }

        // A machine is "slow" if it can't produce a full stack within the cycle duration.
        // This means the inserter would need to start late in the cycle (or wrap around)
        // to pick up items, requiring the buffer-in-hand strategy.
        //
        // For single swing: slow if ticks_to_stack > cycle_duration
        // For multiple swings: slow if total items needed > items produced per cycle
        if (total_transfer_count <= 1) {
            return ticks_to_stack > cycle_duration;
        }

        // Multiple swings: slow if machine can't keep up with continuous pickup
        const total_items_needed = stack_size * total_transfer_count;

        // Machine is slow if it can't produce enough items in one cycle
        return items_produced_per_cycle < total_items_needed;
    }

    private computeEnableRangeFromMachine(
        inserter_state: InserterState,
        source_state: MachineState,
    ): OpenRange {
        const transfer_count = this.entity_transfer_map.getOrThrow(inserter_state.inserter.entity_id);
        const total_transfer_count = Math.ceil(transfer_count.total_transfer_count.toDecimal());
        const animation = inserter_state.inserter.animation;

        const mode = computeSimulationMode(
            source_state.machine,
            inserter_state.inserter,
            this.entity_transfer_map.getOrThrow(inserter_state.inserter.entity_id),
        );

        if (mode === SimulationMode.LOW_INSERTION_LIMITS) {
            const total_swing_duration = Duration.ofTicks(
                animation.total.ticks * total_transfer_count
            );
            return OpenRange.fromStartAndDuration(
                0,
                total_swing_duration.ticks + 4
            )
        }

        if (mode === SimulationMode.PREVENT_DESYNCS) {
            const total_swing_duration = Duration.ofTicks(
                animation.total.ticks * total_transfer_count
            );

            // For slow machines, use "buffer in hand" strategy:
            // The inserter starts when items will be ready for the first pickup.
            // Subsequent swings happen as items continue to be produced.
            // The enable window may wrap around the cycle boundary.
            if (this.isSlowMachine(source_state.machine, inserter_state.inserter, total_transfer_count)) {
                const cycle_duration = this.crafting_cycle_plan.total_duration.ticks;
                const stack_size = inserter_state.inserter.metadata.stack_size;
                const ticks_to_stack = this.ticksToProduceStack(source_state.machine, stack_size);

                // Calculate when the inserter should start (when first stack is ready)
                // The inserter is already at the source after its previous swing, so when 
                // enabled it will immediately go to IDLE and start PICKUP on the next tick.
                // We add +1 buffer because the craft event and pickup happen on the same tick,
                // and we need items to be in the output before pickup begins.
                //
                // If ticks_to_stack exceeds cycle_duration, wrap around to the start of the cycle.
                // This handles the edge case where the machine can't produce a full stack in one cycle.
                const raw_pickup_start = Math.max(0, ticks_to_stack + 1);
                const pickup_start = raw_pickup_start % cycle_duration;

                // For multiple swings, we need continuous production.
                // The machine produces items at rate: amount_per_craft / ticks_per_craft
                // After picking up stack_size, it takes ticks_to_stack to replenish.
                // So each swing needs ticks_to_stack + swing_duration to complete.
                const ticks_per_swing_with_wait = Math.max(
                    animation.total.ticks,
                    ticks_to_stack
                );
                const extended_duration = Math.min(
                    ticks_per_swing_with_wait * total_transfer_count + 4,
                    cycle_duration // Cap at cycle duration to avoid exceeding bounds
                );

                return OpenRange.fromStartAndDuration(
                    pickup_start,
                    extended_duration
                )
            }

            return OpenRange.fromStartAndDuration(
                0,
                total_swing_duration.ticks + 4
            )
        }

        if (mode === SimulationMode.NORMAL) {
            const total_swing_duration = Duration.ofTicks(
                animation.total.ticks * total_transfer_count
            );
            return OpenRange.fromStartAndDuration(
                0,
                total_swing_duration.ticks - animation.rotation.ticks - animation.drop.ticks
            )
        }

        throw new Error(`Unhandled simulation mode ${mode} for inserter ${inserter_state.inserter.entity_id}`);
    }

    /**
     * Gets the period duration for clocked controls.
     * For fractional swings, this returns the extended period (base * cycle_multiplier).
     * For non-fractional, returns the base period.
     */
    private getExtendedPeriodDuration(): Duration {
        if (this.crafting_cycle_plan.fractional_swings_enabled && this.crafting_cycle_plan.cycle_multiplier) {
            return Duration.ofTicks(
                this.crafting_cycle_plan.total_duration.ticks * this.crafting_cycle_plan.cycle_multiplier
            );
        }
        return this.crafting_cycle_plan.total_duration;
    }

    private clockedForCycle(enable_ranges: OpenRange[]): EnableControl {
        const clocked_control = EnableControl.clocked({
            periodDuration: this.getExtendedPeriodDuration(),
            enabledRanges: [...enable_ranges],
            tickProvider: this.tick_provider,
        })
        this.resettable_registry.register(clocked_control);

        return clocked_control
    }


    private sourceIsGreaterThanStackSize(
        source: MachineState,
        stack_size: InserterStackSize
    ): EnableControl {
        return this.sourceIsGreaterThan(source, stack_size);
    }

    private sourceIsGreaterThan(
        source: MachineState,
        minimum_quantity: number
    ): EnableControl {
        const item_name = source.machine.output.item_name;
        const amount_per_craft = source.machine.output.amount_per_craft;

        return EnableControl.lambda(() => {
            // given that there is a 1 tick delay between an inserter enabling and the item being picked up,
            // we need to check if on the next tick it will have crafted the amount needed
            // we can do this more simply by just assuming it will complete the next tick and add
            // the production amount per craft to the current quantity
            const source_quantity = source.inventoryState.getItemOrThrow(item_name).quantity;
            const source_quantity_after_next_craft = Math.floor(
                amount_per_craft.add(source_quantity).toDecimal()
            )
            return source_quantity_after_next_craft >= minimum_quantity
        })
    }

    public latchedUntilLessThanMinimum(
        sink: MachineState,
        sink_input_item_name: ItemName,
        buffer_multiplier: number = 2
    ): EnableControl {
        const sink_input = sink.machine.inputs.getOrThrow(sink_input_item_name);
        const minimum_required = sink_input.consumption_rate.amount_per_craft
        const automated_insertion_limit = sink_input.automated_insertion_limit.quantity;
        return EnableControl.latched({
            base: EnableControl.lambda(() => {
                const sink_quantity = sink.inventoryState.getItemOrThrow(sink_input_item_name).quantity;
                return sink_quantity <= minimum_required * buffer_multiplier
            }),
            release: EnableControl.lambda(() => {
                const sink_quantity = sink.inventoryState.getItemOrThrow(sink_input_item_name).quantity;
                return sink_quantity >= automated_insertion_limit
            })
        })
    }
    /**
     * Returns true when a multi-filter inserter has at least one individual item transfer
     * count that is fractional (denominator > 1), even if the total transfer count is an
     * integer. This detects cases like copper=1/2 + gear=1/2 = 1 total that arise when
     * the user sets terminal_swing_count below the natural maximum value.
     */
    private hasFractionalPerItemTransfers(inserter: Inserter): boolean {
        const transfer_count = this.entity_transfer_map.get(inserter.entity_id);
        if (!transfer_count || transfer_count.item_transfers.length <= 1) {
            return false;
        }
        return transfer_count.item_transfers.some(it => it.transfer_count.getDenominator > 1);
    }

    /**
     * Find all machines that produce the target output item.
     */
    private findFinalMachines(): Set<MachineState> {
        const final_machines = this.entity_state_registry
            .getAllStates()
            .filter(EntityState.isMachine)
            .filter(s => s.machine.output.item_name === this.target_output_item_name);
        assert(
            final_machines.length > 0,
            `No machine found producing target output item ${this.target_output_item_name}`
        );
        return new Set(final_machines);
    }

    /**
     * Find all inserters that take output from terminal machines.
     * Multiple output inserters per terminal machine are supported (they work in parallel).
     */
    private findFinalInserters(): Set<InserterState> {
        const final_inserters = new Set<InserterState>();
        for (const terminal_machine of this.terminal_machine_states) {
            const inserters = this.entity_state_registry
                .getAllStates()
                .filter(EntityState.isInserter)
                .filter(s => s.inserter.source.entity_id.id === terminal_machine.entity_id.id);
            assert(
                inserters.length >= 1,
                `No inserter found taking output from terminal machine ${terminal_machine.entity_id.id}`
            );
            for (const inserter of inserters) {
                final_inserters.add(inserter);
            }
        }
        return final_inserters;
    }

    /**
     * Find the terminal machine that a given terminal inserter takes output from.
     */
    private findTerminalMachineForInserter(inserter_state: InserterState): MachineState {
        for (const terminal_machine of this.terminal_machine_states) {
            if (inserter_state.inserter.source.entity_id.id === terminal_machine.entity_id.id) {
                return terminal_machine;
            }
        }
        throw new Error(
            `Inserter ${inserter_state.entity_id.id} is not connected to any terminal machine`
        );
    }
}