import { describe, it, expect, beforeEach } from "vitest";
import { ConditionalEnableControlFactory } from "./conditional-enable-control-factory";
import { EnableControlOverrideConditional } from "../../../config/schema";
import {
    EntityId,
    Machine,
    InfinityChest,
    EntityRegistry,
    InserterStackSize,
    InserterAnimationMetadata,
    INSERTER_SPECS,
    InserterType,
    EntityType,
} from "../../../entities";
import {
    MachineState,
    MachineStatus,
    InserterState,
    InfinityChestState,
    EntityStateRegistry,
} from "../../../state";
import { Inserter } from "../../../entities/inserter/inserter";
import { QualityIdType } from "../../../blueprints/components";
import { InserterAnimation } from "../../../entities/inserter/inserter-animation";

// Helper to create a minimal inserter for testing
function createTestInserter(
    id: number,
    sourceEntityId: EntityId,
    sinkEntityId: EntityId,
    sourceItems: Set<string>,
    sinkItems: Set<string>,
    stackSize: InserterStackSize = 3
): Inserter {
    const animation_metadata = InserterAnimationMetadata.create(
        INSERTER_SPECS[InserterType.STACK_INSERTER][QualityIdType.legendary],
        EntityType.MACHINE,
        EntityType.MACHINE,
        {}
    )
    return {
        entity_id: EntityId.forInserter(id),
        metadata: {
            stack_size: stackSize,
            animation: InserterAnimationMetadata.create(
                INSERTER_SPECS[InserterType.STACK_INSERTER][QualityIdType.legendary],
                EntityType.MACHINE,
                EntityType.MACHINE,
                {}
            ),
            type: InserterType.STACK_INSERTER,
            quality: QualityIdType.legendary,
            filters: new Set(),
        },
        source: {
            entity_id: sourceEntityId,
            item_names: sourceItems,
        },
        sink: {
            entity_id: sinkEntityId,
            item_names: sinkItems,
        },
        filtered_items: new Set(),
        animation: InserterAnimation.fromMetadata(animation_metadata),
    };
}

describe("ConditionalEnableControlFactory", () => {
    let entityRegistry: EntityRegistry;
    let stateRegistry: EntityStateRegistry;
    let sourceMachine: Machine;
    let sinkMachine: Machine;
    let sourceMachineState: MachineState;
    let sinkMachineState: MachineState;
    let inserter: Inserter;
    let inserterState: InserterState;
    let factory: ConditionalEnableControlFactory;

    beforeEach(() => {
        entityRegistry = new EntityRegistry();

        // Create source machine (produces iron-gear-wheel)
        sourceMachine = Machine.fromConfig({
            id: 1,
            recipe: "iron-gear-wheel",
            productivity: 0,
            crafting_speed: 1,
        });
        entityRegistry.add(sourceMachine);
        sourceMachineState = MachineState.forMachine(sourceMachine);

        // Create sink machine (consumes iron-gear-wheel)
        sinkMachine = Machine.fromConfig({
            id: 2,
            recipe: "transport-belt",
            productivity: 0,
            crafting_speed: 1,
        });
        entityRegistry.add(sinkMachine);
        sinkMachineState = MachineState.forMachine(sinkMachine);

        // Create inserter connecting source to sink
        inserter = createTestInserter(
            1,
            sourceMachine.entity_id,
            sinkMachine.entity_id,
            new Set(["iron-gear-wheel"]),
            new Set(["iron-gear-wheel"]),
            3
        );
        entityRegistry.add(inserter);
        inserterState = InserterState.createIdle(inserter);

        // Set up state registry
        stateRegistry = new EntityStateRegistry(entityRegistry);
        stateRegistry.addState(sourceMachineState);
        stateRegistry.addState(sinkMachineState);
        stateRegistry.addState(inserterState);

        factory = new ConditionalEnableControlFactory(stateRegistry);
    });

    describe("simple constant comparisons", () => {
        it("should evaluate > operator correctly", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "CONSTANT", value: 10 },
                            operator: ">",
                            right: { type: "CONSTANT", value: 5 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should evaluate < operator correctly", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "CONSTANT", value: 3 },
                            operator: "<",
                            right: { type: "CONSTANT", value: 5 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should evaluate >= operator correctly", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "CONSTANT", value: 5 },
                            operator: ">=",
                            right: { type: "CONSTANT", value: 5 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should evaluate <= operator correctly", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "CONSTANT", value: 5 },
                            operator: "<=",
                            right: { type: "CONSTANT", value: 5 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should evaluate == operator correctly", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "CONSTANT", value: 5 },
                            operator: "==",
                            right: { type: "CONSTANT", value: 5 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should evaluate != operator correctly", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "CONSTANT", value: 5 },
                            operator: "!=",
                            right: { type: "CONSTANT", value: 3 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should return false when condition is not met", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "CONSTANT", value: 3 },
                            operator: ">",
                            right: { type: "CONSTANT", value: 5 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(false);
        });
    });

    describe("AND/OR rule sets", () => {
        it("should evaluate AND rule set - all true", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "CONSTANT", value: 10 },
                            operator: ">",
                            right: { type: "CONSTANT", value: 5 },
                        },
                        {
                            left: { type: "CONSTANT", value: 3 },
                            operator: "<",
                            right: { type: "CONSTANT", value: 5 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should evaluate AND rule set - one false", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "CONSTANT", value: 10 },
                            operator: ">",
                            right: { type: "CONSTANT", value: 5 },
                        },
                        {
                            left: { type: "CONSTANT", value: 10 },
                            operator: "<",
                            right: { type: "CONSTANT", value: 5 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(false);
        });

        it("should evaluate OR rule set - one true", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "OR",
                    rules: [
                        {
                            left: { type: "CONSTANT", value: 3 },
                            operator: ">",
                            right: { type: "CONSTANT", value: 5 },
                        },
                        {
                            left: { type: "CONSTANT", value: 10 },
                            operator: ">",
                            right: { type: "CONSTANT", value: 5 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should evaluate OR rule set - all false", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "OR",
                    rules: [
                        {
                            left: { type: "CONSTANT", value: 3 },
                            operator: ">",
                            right: { type: "CONSTANT", value: 5 },
                        },
                        {
                            left: { type: "CONSTANT", value: 1 },
                            operator: ">",
                            right: { type: "CONSTANT", value: 5 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(false);
        });

        it("should handle nested rule sets", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "CONSTANT", value: 10 },
                            operator: ">",
                            right: { type: "CONSTANT", value: 5 },
                        },
                        {
                            operator: "OR",
                            rules: [
                                {
                                    left: { type: "CONSTANT", value: 1 },
                                    operator: ">",
                                    right: { type: "CONSTANT", value: 5 },
                                },
                                {
                                    left: { type: "CONSTANT", value: 10 },
                                    operator: ">",
                                    right: { type: "CONSTANT", value: 5 },
                                },
                            ],
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });
    });

    describe("INVENTORY_ITEM value reference", () => {
        it("should resolve source inventory quantity", () => {
            // Add items to source machine's inventory
            sourceMachineState.inventoryState.addQuantity("iron-gear-wheel", 10);

            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "INVENTORY_ITEM", entity: "SOURCE", item_name: "iron-gear-wheel" },
                            operator: ">=",
                            right: { type: "CONSTANT", value: 5 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should resolve sink inventory quantity", () => {
            // Add items to sink machine's inventory
            sinkMachineState.inventoryState.addQuantity("iron-gear-wheel", 3);

            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "INVENTORY_ITEM", entity: "SINK", item_name: "iron-gear-wheel" },
                            operator: "<",
                            right: { type: "CONSTANT", value: 10 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should return 0 for items not in inventory", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "INVENTORY_ITEM", entity: "SOURCE", item_name: "iron-gear-wheel" },
                            operator: "==",
                            right: { type: "CONSTANT", value: 0 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should update dynamically as inventory changes", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "INVENTORY_ITEM", entity: "SOURCE", item_name: "iron-gear-wheel" },
                            operator: ">=",
                            right: { type: "CONSTANT", value: 5 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);

            // Initially false (0 items)
            expect(control.isEnabled()).toBe(false);

            // Add items - should become true
            sourceMachineState.inventoryState.addQuantity("iron-gear-wheel", 10);
            expect(control.isEnabled()).toBe(true);

            // Remove items - should become false
            sourceMachineState.inventoryState.removeQuantity("iron-gear-wheel", 8);
            expect(control.isEnabled()).toBe(false);
        });
    });

    describe("MACHINE_STATUS value reference", () => {
        it("should return 1 when machine status matches", () => {
            sourceMachineState.status = MachineStatus.OUTPUT_FULL;

            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "MACHINE_STATUS", entity: "SOURCE", status: "OUTPUT_FULL" },
                            operator: "==",
                            right: { type: "CONSTANT", value: 1 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should return 0 when machine status does not match", () => {
            sourceMachineState.status = MachineStatus.WORKING;

            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "MACHINE_STATUS", entity: "SOURCE", status: "OUTPUT_FULL" },
                            operator: "==",
                            right: { type: "CONSTANT", value: 0 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should work with != operator for status mismatch", () => {
            sourceMachineState.status = MachineStatus.WORKING;

            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "MACHINE_STATUS", entity: "SOURCE", status: "OUTPUT_FULL" },
                            operator: "!=",
                            right: { type: "CONSTANT", value: 1 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });
    });

    describe("INSERTER_STACK_SIZE value reference", () => {
        it("should return the inserter stack size", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "INSERTER_STACK_SIZE" },
                            operator: "==",
                            right: { type: "CONSTANT", value: 3 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });
    });

    describe("HAND_QUANTITY value reference", () => {
        it("should return 0 when inserter hand is empty", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "HAND_QUANTITY" },
                            operator: "==",
                            right: { type: "CONSTANT", value: 0 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should return quantity when inserter is holding items", () => {
            inserterState.held_item = { item_name: "iron-gear-wheel", quantity: 2 };

            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "HAND_QUANTITY" },
                            operator: "==",
                            right: { type: "CONSTANT", value: 2 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should filter by item_name when specified", () => {
            inserterState.held_item = { item_name: "iron-gear-wheel", quantity: 2 };

            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "HAND_QUANTITY", item_name: "iron-plate" },
                            operator: "==",
                            right: { type: "CONSTANT", value: 0 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });

        it("should return quantity when item_name matches", () => {
            inserterState.held_item = { item_name: "iron-gear-wheel", quantity: 2 };

            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "HAND_QUANTITY", item_name: "iron-gear-wheel" },
                            operator: "==",
                            right: { type: "CONSTANT", value: 2 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });
    });

    describe("CRAFTING_PROGRESS value reference", () => {
        it("should return crafting progress as percentage", () => {
            sourceMachineState.craftingProgress.progress = 0.5; // 50%

            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "CRAFTING_PROGRESS", entity: "SOURCE" },
                            operator: ">=",
                            right: { type: "CONSTANT", value: 50 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });
    });

    describe("BONUS_PROGRESS value reference", () => {
        it("should return bonus progress as percentage", () => {
            sourceMachineState.bonusProgress.progress = 0.75; // 75%

            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "BONUS_PROGRESS", entity: "SOURCE" },
                            operator: ">=",
                            right: { type: "CONSTANT", value: 70 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            expect(control.isEnabled()).toBe(true);
        });
    });

    describe("AUTOMATED_INSERTION_LIMIT value reference", () => {
        it("should return the automated insertion limit for an input", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "INVENTORY_ITEM", entity: "SINK", item_name: "iron-gear-wheel" },
                            operator: "<",
                            right: { type: "AUTOMATED_INSERTION_LIMIT", entity: "SINK", item_name: "iron-gear-wheel" },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            // Initially 0 items, so 0 < limit should be true
            expect(control.isEnabled()).toBe(true);
        });
    });

    describe("OUTPUT_BLOCK value reference", () => {
        it("should return the output block quantity", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "INVENTORY_ITEM", entity: "SOURCE", item_name: "iron-gear-wheel" },
                            operator: "<",
                            right: { type: "OUTPUT_BLOCK", entity: "SOURCE" },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, inserter);
            // Initially 0 items < output block quantity
            expect(control.isEnabled()).toBe(true);
        });
    });

    describe("latched enable control", () => {
        it("should create latched control with base and release conditions", () => {
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "CONSTANT", value: 1 },
                            operator: "==",
                            right: { type: "CONSTANT", value: 1 },
                        },
                    ],
                },
                latch: {
                    release: {
                        operator: "AND",
                        rules: [
                            {
                                left: { type: "CONSTANT", value: 0 },
                                operator: "==",
                                right: { type: "CONSTANT", value: 0 },
                            },
                        ],
                    },
                },
            };

            const control = factory.createFromConfig(config, inserter);
            // With base true and release true, the latch should behave accordingly
            expect(control.isEnabled()).toBe(true);
        });

        it("should latch based on rule_set (base) condition", () => {
            // Start with source output not blocked (base = false)
            // and sink has items (release = false)
            sourceMachineState.status = MachineStatus.WORKING;
            sinkMachineState.inventoryState.addQuantity("iron-gear-wheel", 5);

            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            // Base: source is output blocked
                            left: { type: "MACHINE_STATUS", entity: "SOURCE", status: "OUTPUT_FULL" },
                            operator: "==",
                            right: { type: "CONSTANT", value: 1 },
                        },
                    ],
                },
                latch: {
                    release: {
                        operator: "AND",
                        rules: [
                            {
                                // Release: sink inventory is empty
                                left: { type: "INVENTORY_ITEM", entity: "SINK", item_name: "iron-gear-wheel" },
                                operator: "==",
                                right: { type: "CONSTANT", value: 0 },
                            },
                        ],
                    },
                },
            };

            const control = factory.createFromConfig(config, inserter);

            // Initially: base=false, release=false → not enabled (not latched)
            expect(control.isEnabled()).toBe(false);

            // Trigger base condition (output blocked)
            sourceMachineState.status = MachineStatus.OUTPUT_FULL;
            // Now: base=true, release=false → latches on, becomes enabled
            expect(control.isEnabled()).toBe(true);

            // Base goes false but latch keeps it enabled (release still false)
            sourceMachineState.status = MachineStatus.WORKING;
            // base=false, release=false → still latched
            expect(control.isEnabled()).toBe(true);

            // Clear sink inventory (release becomes true)
            sinkMachineState.inventoryState.removeQuantity("iron-gear-wheel", 5);
            // base=false, release=true → latch releases, returns false
            expect(control.isEnabled()).toBe(false);
        });
    });

    describe("integration with infinity chest", () => {
        let infinityChest: InfinityChest;
        let infinityChestState: InfinityChestState;
        let chestToMachineInserter: Inserter;
        let chestInserterState: InserterState;

        beforeEach(() => {
            infinityChest = new InfinityChest(
                EntityId.forChest(100),
                [{ item_name: "iron-plate", request_count: 128 }]
            );
            entityRegistry.add(infinityChest);
            infinityChestState = InfinityChestState.forChest(infinityChest);
            stateRegistry.addState(infinityChestState);

            chestToMachineInserter = createTestInserter(
                10,
                infinityChest.entity_id,
                sinkMachine.entity_id,
                new Set(["iron-plate"]),
                new Set(["iron-plate"]),
                3
            );
            entityRegistry.add(chestToMachineInserter);
            chestInserterState = InserterState.createIdle(chestToMachineInserter);
            stateRegistry.addState(chestInserterState);
        });

        it("should resolve inventory from infinity chest", () => {
            // Infinity chest always has items at request_count
            const config: EnableControlOverrideConditional = {
                mode: "CONDITIONAL",
                rule_set: {
                    operator: "AND",
                    rules: [
                        {
                            left: { type: "INVENTORY_ITEM", entity: "SOURCE", item_name: "iron-plate" },
                            operator: ">=",
                            right: { type: "CONSTANT", value: 100 },
                        },
                    ],
                },
            };

            const control = factory.createFromConfig(config, chestToMachineInserter);
            expect(control.isEnabled()).toBe(true);
        });
    });
});
