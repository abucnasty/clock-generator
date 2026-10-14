import { describe, test, expect, vi } from "vitest"
import { mock } from 'vitest-mock-extended';
import { IdleModeTransitionEvaluator } from "./idle-mode-transition-evaluator"
import { BeltState, ChestState, EntityState, InserterState, MachineState, SupplyGate } from "../../../state"
import { EntityId, Inserter, InserterMetadata, InserterStackSize, InserterTarget, Machine, MachineMetadata, MachineType, RecipeMetadata } from "../../../entities"
import { ItemName } from "../../../data/factorio-data-types"
import { InserterAnimation } from "../../../entities/inserter/inserter-animation"
import { InserterAnimationOverrideConfig } from "../../../config/schema"
import { InserterPickupMode, InserterWaitForSinkMode } from "../modes"
import { InserterDisabledMode } from "../modes/disabled-mode"
import { ModeTransition } from "../../mode";
import { AlwaysEnabledControl } from "../../enable-control";


/** A belt built by hand for a test, with the gate every belt has: nothing withheld, nothing refused */
function withSupplyGate(belt: BeltState): BeltState {
    // assigned after the mock is made, which would wrap the sets of the gate otherwise
    belt.supply = new SupplyGate();
    return belt;
}

describe("transitions (belt to machine)", () => {

    interface TestContext {
        inserterState: InserterState,
        sourceState: EntityState,
        sinkState: EntityState,
    }

    const createMachine = (recipeName: string, metadata: Partial<MachineMetadata> = {}): Machine => {
        const id = -1;
        return Machine.createMachine(id, {
            crafting_speed: 1,
            productivity: 0,
            recipe: RecipeMetadata.fromRecipeName(recipeName),
            ...metadata,
            type: metadata.type ?? MachineType.MACHINE,
        })
    }

    const createInserter = (args: {
        source: InserterTarget,
        sink: InserterTarget,
        stack_size?: InserterStackSize,
        filters?: ItemName[]
    }): Inserter => {
        const {
            source,
            sink,
            stack_size = InserterStackSize.SIZE_16,
            filters = []
        } = args;

        const overrides: InserterAnimationOverrideConfig = {}
        const metadata = InserterMetadata.create(
            source.entity_id.type,
            sink.entity_id.type,
            stack_size,
            filters,
            overrides
        )
        return {
            entity_id: EntityId.forInserter(-1),
            metadata: metadata,
            animation: InserterAnimation.fromMetadata(metadata.animation),
            source: source,
            sink: sink,
            filtered_items: new Set(filters),
        }
    }

    const createTestContext = (): TestContext => {
        const mockSource: BeltState = withSupplyGate(mock<BeltState>({
            entity_id: EntityId.forBelt(-1),
        }));

        const mockSink: MachineState = MachineState.forMachine(
            createMachine("iron-gear-wheel")
        )
        return {
            sourceState: mockSource,
            sinkState: mockSink,
            inserterState: InserterState.createIdle(createInserter({
                source: {
                    entity_id: mockSource.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                sink: {
                    entity_id: mockSink.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                filters: ["iron-plate"]
            }))
        }
    }

    describe("IdleModeTransition", () => {

        test("transitions to PICKUP when able to pickup", () => {
            const testContext = createTestContext();

            const pickup_mode = mock<InserterPickupMode>();

            const evaluator = IdleModeTransitionEvaluator.create({
                inserter_state: testContext.inserterState,
                source_state: testContext.sourceState,
                sink_state: testContext.sinkState,
                pickup_mode: pickup_mode,
                disabled_mode: mock(),
                tick_provider: mock(),
                enable_control: AlwaysEnabledControl,
            });

            const nextMode = evaluator.evaluateTransition();

            expect(nextMode).not.toBe(ModeTransition.NONE)
            expect(nextMode?.toMode).toBe(pickup_mode);
        })

        test("remains in IDLE when inputs are over the automated insertion limit of the machine", () => {
            const testContext = createTestContext();

            const pickup_mode = mock<InserterPickupMode>();
            const evaluator = IdleModeTransitionEvaluator.create({
                inserter_state: testContext.inserterState,
                source_state: testContext.sourceState,
                sink_state: testContext.sinkState,
                pickup_mode: pickup_mode,
                disabled_mode: mock(),
                tick_provider: mock(),
                enable_control: AlwaysEnabledControl,
            });

            const machineState = testContext.sinkState as MachineState;
            const automated_insertion_limit = machineState.machine.inputs.get("iron-plate")!.automated_insertion_limit;
            machineState.inventoryState.setQuantity("iron-plate", automated_insertion_limit.quantity);


            const nextMode = evaluator.evaluateTransition();
            expect(nextMode).toBe(ModeTransition.NONE)
        })

        test("remains in IDLE when target machine is output blocked", () => {
            const testContext = createTestContext();

            const pickup_mode = mock<InserterPickupMode>();
            const evaluator = IdleModeTransitionEvaluator.create({
                inserter_state: testContext.inserterState,
                source_state: testContext.sourceState,
                sink_state: testContext.sinkState,
                pickup_mode: pickup_mode,
                disabled_mode: mock(),
                tick_provider: mock(),
                enable_control: AlwaysEnabledControl
            });

            const machineState = testContext.sinkState as MachineState;
            const output_block_quantity = machineState.machine.output.outputBlock.quantity;
            machineState.inventoryState.setQuantity("iron-gear-wheel", output_block_quantity);

            const nextMode = evaluator.evaluateTransition();
            expect(nextMode).toBe(ModeTransition.NONE)
        })
    })

    // An inserter that waits for space in a machine is asleep and acts in the tick after the one that wakes it.
    // Recorded in Factorio 2.1.21 on inserters that take from a machine or a chest and had waited 6 ticks or more for a
    // machine at its output block, at the tick another inserter took its products down: the first items a tick later
    // in 5,777 cases of 5,777 where the machine finished no craft the tick before, in the same tick in 3,756 of 3,756
    // where it did. On the advanced circuit scaffold: the output inserter took 16 advanced circuits at sample 230 of
    // the recording of the evenly spaced windows (28 down to 12, block 21), and the cable and the plastic inserter of
    // that plant, waiting since 221 and 224, took their hands at 231.
    describe("an inserter that waits for space in a machine whose products another inserter takes", () => {
        /** `window_opens_at`: the tick a window of a clock of the game opens, before which the inserter is disabled */
        const setup = (source_state: EntityState, window_opens_at?: number) => {
            const sink = MachineState.forMachine(createMachine("transport-belt"));
            const inserter_state = InserterState.createIdle(createInserter({
                source: { entity_id: source_state.entity_id, item_names: new Set(["iron-gear-wheel"]) },
                sink: { entity_id: sink.entity_id, item_names: new Set(["iron-gear-wheel"]) },
                filters: ["iron-gear-wheel"],
            }));
            const pickup_mode = mock<InserterPickupMode>();
            const disabled_mode = mock<InserterDisabledMode>();
            let tick = 0;
            const window_control = window_opens_at === undefined ? AlwaysEnabledControl : {
                is_game_clock: true,
                isEnabled: () => tick >= window_opens_at,
                isEnabledIn: (ticks: number) => tick + ticks >= window_opens_at,
            };
            const evaluator = IdleModeTransitionEvaluator.create({
                inserter_state, source_state, sink_state: sink, pickup_mode,
                disabled_mode,
                tick_provider: { getCurrentTick: () => tick },
                enable_control: window_control,
            });
            const block = sink.machine.output.outputBlock;
            return {
                sink, pickup_mode, disabled_mode,
                /** The inserter looks at its sink in a tick */
                look: () => { tick += 1; return evaluator.evaluateTransition(); },
                /** The machine ends a tick with its output at the block */
                endTickAtTheBlock: (finished_craft: boolean) => {
                    sink.inventoryState.setQuantity(block.item_name, block.ingredients_blocked_at);
                    sink.outputBlockedAfterLastTick = true;
                    sink.finishedCraftInLastTick = finished_craft;
                },
                /** An output inserter, which is updated first, takes the products in the tick the inserter looks next */
                takeProducts: () => sink.inventoryState.setQuantity(block.item_name, 0),
                /** The machine ends a tick with its output under the block */
                endTickUnderTheBlock: () => { sink.outputBlockedAfterLastTick = false; sink.finishedCraftInLastTick = false; },
            };
        };
        const machineWithGears = (): MachineState => {
            const source = MachineState.forMachine(createMachine("iron-gear-wheel"));
            source.inventoryState.setQuantity("iron-gear-wheel", 50);
            return source;
        };

        test("takes its first items a tick after the products are taken", () => {
            const { look, endTickAtTheBlock, takeProducts, endTickUnderTheBlock, pickup_mode } = setup(machineWithGears());
            endTickAtTheBlock(false);
            expect(look()).toBe(ModeTransition.NONE);
            takeProducts();
            expect(look()).toBe(ModeTransition.NONE);
            endTickUnderTheBlock();
            expect(look()?.toMode).toBe(pickup_mode);
        })

        test("takes them in the tick the products are taken when the machine finished a craft the tick before", () => {
            const { look, endTickAtTheBlock, takeProducts, pickup_mode } = setup(machineWithGears());
            endTickAtTheBlock(false);
            expect(look()).toBe(ModeTransition.NONE);
            endTickAtTheBlock(true);
            takeProducts();
            expect(look()?.toMode).toBe(pickup_mode);
        })

        test("is not held up when it only looks in the tick the products are taken: its arm came back, or its window opened", () => {
            const { look, endTickAtTheBlock, takeProducts, pickup_mode } = setup(machineWithGears());
            endTickAtTheBlock(false);
            takeProducts();
            expect(look()?.toMode).toBe(pickup_mode);
        })

        test("waits a tick once: products taken again in the tick after do not hold it up again", () => {
            const { look, endTickAtTheBlock, takeProducts, pickup_mode } = setup(machineWithGears());
            endTickAtTheBlock(false);
            expect(look()).toBe(ModeTransition.NONE);
            takeProducts();
            expect(look()).toBe(ModeTransition.NONE);
            // the machine was back at its block when that tick was done, and is emptied again
            endTickAtTheBlock(false);
            takeProducts();
            expect(look()?.toMode).toBe(pickup_mode);
        })

        // An inserter whose window of a clock of the game opens in a tick shows as enabled in the tick before and waits in
        // it. Recorded in Factorio 2.1.21 on the accumulator build of issue 152 and on the scaffolds, for inserters
        // that take from a machine and whose window opens in the tick another inserter takes the products of the
        // machine they put into down from its block: the first items a tick later in 1,158 cases of 1,170 where the
        // inserter that took the products was enabled before, also where the machine finished a craft the tick before
        // (44 of 44), and in the tick the products are taken in 852 of 888 where that inserter's window opened too.
        test("takes its first items a tick later when its window opens in the tick the products are taken", () => {
            const { look, endTickAtTheBlock, takeProducts, endTickUnderTheBlock, pickup_mode, disabled_mode } = setup(machineWithGears(), 2);
            endTickAtTheBlock(false);
            expect(look()?.toMode).toBe(disabled_mode);
            takeProducts();
            expect(look()).toBe(ModeTransition.NONE);
            endTickUnderTheBlock();
            expect(look()?.toMode).toBe(pickup_mode);
        })

        test("takes its first items a tick later when its window opens as the products are taken, though a craft finished the tick before", () => {
            const { look, endTickAtTheBlock, takeProducts, disabled_mode } = setup(machineWithGears(), 2);
            endTickAtTheBlock(false);
            expect(look()?.toMode).toBe(disabled_mode);
            endTickAtTheBlock(true);
            takeProducts();
            expect(look()).toBe(ModeTransition.NONE);
        })

        test("takes them in the tick they are taken when the window of the inserter that takes them opens in that tick too", () => {
            const { sink, look, endTickAtTheBlock, takeProducts, pickup_mode, disabled_mode } = setup(machineWithGears(), 2);
            endTickAtTheBlock(false);
            expect(look()?.toMode).toBe(disabled_mode);
            takeProducts();
            sink.productsTakenAsWindowOpened = true;
            expect(look()?.toMode).toBe(pickup_mode);
        })

        test("is not held up when its window opens after the machine was cleared", () => {
            const { look, endTickAtTheBlock, takeProducts, endTickUnderTheBlock, pickup_mode, disabled_mode } = setup(machineWithGears(), 3);
            endTickAtTheBlock(false);
            expect(look()?.toMode).toBe(disabled_mode);
            takeProducts();
            endTickUnderTheBlock();
            expect(look()?.toMode).toBe(disabled_mode);
            expect(look()?.toMode).toBe(pickup_mode);
        })

        test("leaves an inserter that takes from a belt to its pickup mode, which lands the first stack a tick later", () => {
            const belt: BeltState = withSupplyGate(mock<BeltState>({ entity_id: EntityId.forBelt(-1) }));
            const { look, endTickAtTheBlock, takeProducts, pickup_mode } = setup(belt);
            endTickAtTheBlock(false);
            expect(look()).toBe(ModeTransition.NONE);
            takeProducts();
            expect(look()?.toMode).toBe(pickup_mode);
        })
    })

    describe("InserterPickupMode (belt to machine)", () => {

        test("stops picking up from belt once stack size is reached", () => {
            const mockSource: BeltState = withSupplyGate(mock<BeltState>({
                entity_id: EntityId.forBelt(-1),
                belt: {
                    lanes: [
                        { ingredient_name: "iron-plate", stack_size: 4 }
                    ]
                }
            }));

            const mockSink: MachineState = MachineState.forMachine(
                createMachine("iron-gear-wheel")
            );

            const stack_size = InserterStackSize.SIZE_12;
            const inserterState = InserterState.createIdle(createInserter({
                source: {
                    entity_id: mockSource.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                sink: {
                    entity_id: mockSink.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                stack_size: stack_size,
                filters: ["iron-plate"]
            }));

            const pickup_mode = InserterPickupMode.create({
                inserterState: inserterState,
                sourceState: mockSource,
                sinkState: mockSink,
            });

            // First pickup: 0 + 4 = 4
            pickup_mode.executeForTick();
            expect(inserterState.held_item?.quantity).toBe(4);

            // Second pickup: 4 + 4 = 8
            pickup_mode.executeForTick();
            expect(inserterState.held_item?.quantity).toBe(8);

            // Third pickup: 8 + 4 = 12 (should reach stack size)
            pickup_mode.executeForTick();
            expect(inserterState.held_item?.quantity).toBe(12);

            // Fourth pickup: should not exceed stack size of 12
            pickup_mode.executeForTick();
            expect(inserterState.held_item?.quantity).toBe(12);
            expect(inserterState.held_item?.quantity).toBeLessThanOrEqual(stack_size);
        })

        test("holds a partly filled hand while the machine's output is at the block, and goes on once it is under", () => {
            const mockSource: BeltState = withSupplyGate(mock<BeltState>({
                entity_id: EntityId.forBelt(-1),
                belt: {
                    lanes: [
                        { ingredient_name: "iron-plate", stack_size: 4 }
                    ]
                }
            }));

            const mockSink: MachineState = MachineState.forMachine(
                createMachine("iron-gear-wheel")
            );

            const inserterState = InserterState.createIdle(createInserter({
                source: {
                    entity_id: mockSource.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                sink: {
                    entity_id: mockSink.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                stack_size: InserterStackSize.SIZE_16,
                filters: ["iron-plate"]
            }));

            const pickup_mode = InserterPickupMode.create({
                inserterState: inserterState,
                sourceState: mockSource,
                sinkState: mockSink,
            });

            pickup_mode.executeForTick();
            expect(inserterState.held_item?.quantity).toBe(4);

            // the machine's output reaches the block: the hand waits with what it holds
            const block = mockSink.machine.output.outputBlock;
            mockSink.inventoryState.addQuantity(block.item_name, block.quantity);
            pickup_mode.executeForTick();
            pickup_mode.executeForTick();
            expect(inserterState.held_item?.quantity).toBe(4);

            // the output drops under the block and the inserter comes back from waiting: one tick to decide, then the next stack
            mockSink.inventoryState.removeQuantity(block.item_name, 1);
            pickup_mode.onEnter(new InserterWaitForSinkMode());
            pickup_mode.executeForTick();
            expect(inserterState.held_item?.quantity).toBe(4);
            pickup_mode.executeForTick();
            expect(inserterState.held_item?.quantity).toBe(8);

            // Again at the block, and this time the machine finished a craft in the tick before its products are taken:
            // that had woken the inserter, and the next stack lands in the tick they are taken. Recorded in Factorio
            // 2.1.21: 248 hands of 248 went on in that tick, 843 of 843 a tick later without a craft the tick before.
            mockSink.inventoryState.addQuantity(block.item_name, 1);
            pickup_mode.executeForTick();
            expect(inserterState.held_item?.quantity).toBe(8);
            mockSink.outputBlockedAfterLastTick = true;
            mockSink.finishedCraftInLastTick = true;
            mockSink.inventoryState.removeQuantity(block.item_name, 1);
            pickup_mode.onEnter(new InserterWaitForSinkMode());
            pickup_mode.executeForTick();
            expect(inserterState.held_item?.quantity).toBe(12);
        })

        // Recorded in Factorio 2.1.21 on the accumulator build of issue 152 and on the scaffolds: an inserter that takes
        // from a machine and holds part of a hand took nothing more while the machine it puts into was at its output
        // block, in 20,701 samples of 20,701 with products to take, and took more in 11,561 of 11,561 where it was not.
        test("holds a partly filled hand from a machine while the machine it puts into is at its block", () => {
            const source = MachineState.forMachine(createMachine("iron-gear-wheel"));
            const sink = MachineState.forMachine(createMachine("transport-belt"));
            const inserter_state = InserterState.createIdle(createInserter({
                source: { entity_id: source.entity_id, item_names: new Set(["iron-gear-wheel"]) },
                sink: { entity_id: sink.entity_id, item_names: new Set(["iron-gear-wheel"]) },
                filters: ["iron-gear-wheel"],
            }));
            const pickup_mode = InserterPickupMode.create({ inserterState: inserter_state, sourceState: source, sinkState: sink });
            source.inventoryState.setQuantity("iron-gear-wheel", 5);
            pickup_mode.executeForTick();
            expect(inserter_state.held_item?.quantity).toBe(5);

            const block = sink.machine.output.outputBlock;
            sink.inventoryState.setQuantity(block.item_name, block.ingredients_blocked_at);
            source.inventoryState.setQuantity("iron-gear-wheel", 5);
            pickup_mode.executeForTick();
            expect(inserter_state.held_item?.quantity).toBe(5);

            sink.inventoryState.setQuantity(block.item_name, 0);
            pickup_mode.executeForTick();
            expect(inserter_state.held_item?.quantity).toBe(10);
        })

        test("caps pickup quantity when remaining capacity is less than lane stack size", () => {
            const mockSource: BeltState = withSupplyGate(mock<BeltState>({
                entity_id: EntityId.forBelt(-1),
                belt: {
                    lanes: [
                        { ingredient_name: "iron-plate", stack_size: 4 }
                    ]
                }
            }));

            const mockSink: MachineState = MachineState.forMachine(
                createMachine("iron-gear-wheel")
            );

            const stack_size = InserterStackSize.SIZE_10;
            const inserterState = InserterState.createIdle(createInserter({
                source: {
                    entity_id: mockSource.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                sink: {
                    entity_id: mockSink.entity_id,
                    item_names: new Set(["iron-plate"])
                },
                stack_size: stack_size,
                filters: ["iron-plate"]
            }));

            const pickup_mode = InserterPickupMode.create({
                inserterState: inserterState,
                sourceState: mockSource,
                sinkState: mockSink,
            });

            // First pickup
            pickup_mode.executeForTick();
            expect(inserterState.held_item?.quantity).toBe(4);

            // Second pickup
            pickup_mode.executeForTick();
            expect(inserterState.held_item?.quantity).toBe(8);

            // Third pickup
            pickup_mode.executeForTick();
            expect(inserterState.held_item?.quantity).toBe(10);
            expect(inserterState.held_item?.quantity).toBeLessThanOrEqual(stack_size);
        })

        test("skips blocked belt item and picks next available unblocked item", () => {
            const mockSource: BeltState = withSupplyGate(mock<BeltState>({
                entity_id: EntityId.forBelt(-1),
                inventoryState: mock<any>(),
                belt: {
                    lanes: [
                        { ingredient_name: "iron-plate", stack_size: 4 },
                        { ingredient_name: "copper-cable", stack_size: 4 },
                    ]
                }
            }));

            const mockSink: MachineState = MachineState.forMachine(
                createMachine("electronic-circuit")
            );

            const ironPlateInsertionLimit = mockSink.machine.inputs
                .getOrThrow("iron-plate")
                .automated_insertion_limit
                .quantity;
            mockSink.inventoryState.setQuantity("iron-plate", ironPlateInsertionLimit);

            const inserterState = InserterState.createIdle(createInserter({
                source: {
                    entity_id: mockSource.entity_id,
                    item_names: new Set(["iron-plate", "copper-cable"])
                },
                sink: {
                    entity_id: mockSink.entity_id,
                    item_names: new Set(["iron-plate", "copper-cable"])
                },
                filters: ["iron-plate", "copper-cable"]
            }));

            const pickup_mode = InserterPickupMode.create({
                inserterState: inserterState,
                sourceState: mockSource,
                sinkState: mockSink,
            });

            pickup_mode.executeForTick();

            expect(inserterState.held_item?.item_name).toBe("copper-cable");
            expect(inserterState.held_item?.quantity).toBe(4);
        })

        test("skips blocked chest item and picks next available unblocked item", () => {
            const mockSource: ChestState = mock<ChestState>({
                entity_id: EntityId.forChest(-1),
                inventoryState: {
                    removeQuantity: vi.fn(),
                } as any,
                getCurrentQuantity: (itemName?: string) => {
                    if (itemName === "iron-plate") {
                        return 100;
                    }
                    if (itemName === "copper-cable") {
                        return 100;
                    }
                    return 0;
                },
                getItemFilters: () => ["iron-plate", "copper-cable"],
            });

            const mockSink: MachineState = MachineState.forMachine(
                createMachine("electronic-circuit")
            );

            const ironPlateInsertionLimit = mockSink.machine.inputs
                .getOrThrow("iron-plate")
                .automated_insertion_limit
                .quantity;
            mockSink.inventoryState.setQuantity("iron-plate", ironPlateInsertionLimit);

            const inserterState = InserterState.createIdle(createInserter({
                source: {
                    entity_id: mockSource.entity_id,
                    item_names: new Set(["iron-plate", "copper-cable"])
                },
                sink: {
                    entity_id: mockSink.entity_id,
                    item_names: new Set(["iron-plate", "copper-cable"])
                },
                filters: ["iron-plate", "copper-cable"]
            }));

            const pickup_mode = InserterPickupMode.create({
                inserterState: inserterState,
                sourceState: mockSource,
                sinkState: mockSink,
            });

            pickup_mode.executeForTick();

            expect(inserterState.held_item?.item_name).toBe("copper-cable");
            expect(inserterState.held_item?.quantity).toBeGreaterThan(0);
        })
    })
})