import { describe, it, expect } from "vitest";
import { InserterInterceptor } from "./inserter-interceptor";
import { AlwaysEnabledControl } from "../../../simulation/controls/enable-control";
import { 
    InserterState, 
    MachineState,
} from "../../../state";
import { ConstantStorage } from "../../../simulation/components/constant-storage";
import { 
    Machine, 
    InfinityChest,
    EntityId,
} from "../../../entities";

describe("InserterInterceptor", () => {

    describe("wait_until_source_is_output_blocked", () => {
        
        describe("when source is an infinity chest and sink is a machine", () => {
            it("should return AlwaysEnabledControl for infinity chest sources", () => {
                // Create an infinity chest with holmium-plate
                const infinityChest = new InfinityChest(
                    EntityId.forChest(1),
                    [{ item_name: "holmium-plate", request_count: 128 }]
                );
                
                // Create chest state
                const infinityChestStorage = ConstantStorage.forChest(infinityChest);
                
                // Create a machine that needs holmium-plate (lithium recipe)
                const machine = Machine.fromConfig({
                    id: 1,
                    recipe: "lithium",
                    productivity: 0,
                    crafting_speed: 10,
                });
                
                // Create machine state
                const machineState = MachineState.forMachine(machine);
                
                // The inserter state is not used for the chest-to-machine logic,
                // so we can pass null and cast it
                const result = InserterInterceptor.wait_until_source_is_output_blocked(
                    null as unknown as InserterState,
                    infinityChestStorage,
                    machineState
                );
                
                // Should be always enabled for infinity chest sources
                expect(result).toBe(AlwaysEnabledControl);
            });
            
            it("should always be enabled regardless of machine inventory state", () => {
                const infinityChest = new InfinityChest(
                    EntityId.forChest(1),
                    [{ item_name: "holmium-plate", request_count: 128 }]
                );
                const infinityChestStorage = ConstantStorage.forChest(infinityChest);
                
                const machine = Machine.fromConfig({
                    id: 1,
                    recipe: "lithium",
                    productivity: 0,
                    crafting_speed: 10,
                });
                const machineState = MachineState.forMachine(machine);
                
                // Fill the machine with items to simulate it being full
                machineState.inventoryState.addQuantity("holmium-plate", 100);
                
                const result = InserterInterceptor.wait_until_source_is_output_blocked(
                    null as unknown as InserterState,
                    infinityChestStorage,
                    machineState
                );
                
                // Should still be always enabled - infinity chests are always ready
                expect(result).toBe(AlwaysEnabledControl);
            });
            
            it("should be always enabled even when infinity chest has multiple item filters", () => {
                // Create an infinity chest with multiple item types
                const infinityChest = new InfinityChest(
                    EntityId.forChest(1),
                    [
                        { item_name: "holmium-plate", request_count: 128 },
                        { item_name: "iron-plate", request_count: 64 },
                    ]
                );
                const infinityChestStorage = ConstantStorage.forChest(infinityChest);
                
                const machine = Machine.fromConfig({
                    id: 1,
                    recipe: "lithium",
                    productivity: 0,
                    crafting_speed: 10,
                });
                const machineState = MachineState.forMachine(machine);
                
                const result = InserterInterceptor.wait_until_source_is_output_blocked(
                    null as unknown as InserterState,
                    infinityChestStorage,
                    machineState
                );
                
                // Should be always enabled for any infinity chest configuration
                expect(result).toBe(AlwaysEnabledControl);
            });
        });
        
        describe("when source is NOT an infinity chest", () => {
            it("should NOT return AlwaysEnabledControl for machine sources", () => {
                // Machine to machine - should wait for output blocked, not be always enabled
                const sourceMachine = Machine.fromConfig({
                    id: 1,
                    recipe: "lithium",
                    productivity: 0,
                    crafting_speed: 10,
                });
                const sourceMachineState = MachineState.forMachine(sourceMachine);
                
                const sinkMachine = Machine.fromConfig({
                    id: 2,
                    recipe: "lithium-plate",
                    productivity: 0,
                    crafting_speed: 10,
                    prototype: "electric-furnace",
                });
                const sinkMachineState = MachineState.forMachine(sinkMachine);
                
                const result = InserterInterceptor.wait_until_source_is_output_blocked(
                    null as unknown as InserterState,
                    sourceMachineState,
                    sinkMachineState
                );
                
                // Should NOT be AlwaysEnabledControl - needs to wait for output blocked
                expect(result).not.toBe(AlwaysEnabledControl);
            });
        });
    });
});
