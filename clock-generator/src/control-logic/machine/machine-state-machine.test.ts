import { describe, test, expect } from "vitest"
import { MachineStateMachine } from "./machine-state-machine";
import { MachineState, MachineStatus } from "../../state";
import { Machine, MachineMetadata, MachineType, RecipeMetadata } from "../../entities";
import { DebugPluginFactory, DebugSettingsProvider } from "../../crafting/sequence";
import { TickProvider } from "../current-tick-provider";
import { CompositeControlLogic } from "../composite-control-logic";
import { TickControlLogic } from "../tick-control-logic";

const createMachine = (recipeName: string, metadata: Partial<MachineMetadata> = {}): Machine => {
    const id = -1;
    return Machine.createMachine(id, {
        crafting_speed: 1,
        productivity: 0,
        recipe: RecipeMetadata.fromRecipeName(recipeName),
        ...metadata,
        type: metadata.type ?? "machine",
    })
}

const executeControlLogicForTicks = (state_machine: MachineStateMachine, ticks: number, debug: boolean = false) => {
    const tick_provider = TickProvider.mutable()
    if (debug) {
        const settings_provider = DebugSettingsProvider.immutable({
            enabled: true,
            plugin_settings: {
                craft_event: {
                    print_bonus_progress: true,
                    print_craft_progress: true,
                }
            }
        })
        const debug_plugin_factory = new DebugPluginFactory(
            tick_provider,
            settings_provider
        )

        debug_plugin_factory.forMachine(state_machine);
    }

    const control_logic = new CompositeControlLogic([
        new TickControlLogic(tick_provider),
        state_machine,
    ])

    for (let i = 0; i < ticks; i++) {
        control_logic.executeForTick();
    }
}

describe("Machine State Machine", () => {
    test("machine never transitions while no inputs are fed to it", () => {
        const machine_state = MachineState.forMachine(
            createMachine("stone-brick", {
                crafting_speed: 91.899995803833,
                productivity: 50
            })
        )

        const state_machine = MachineStateMachine.create({
            machine_state: machine_state,
            initial_mode_status: MachineStatus.INGREDIENT_SHORTAGE,
        })
        // const working_mode = Array.from(state_machine.modes).find(it => it.status === MachineStatus.WORKING);
        // expect(working_mode).toBeDefined();
        expect(machine_state.craftingProgress.progress).toBe(0);

        expect(state_machine.current_mode.status).toBe(MachineStatus.INGREDIENT_SHORTAGE);

        executeControlLogicForTicks(state_machine, 100);

        expect(state_machine.current_mode.status).toBe(MachineStatus.INGREDIENT_SHORTAGE);
    });

    test("machine transitions to working mode when all inputs are satisfied", () => {
        const machine_state = MachineState.forMachine(
            createMachine("stone-brick", {
                crafting_speed: 91.899995803833,
                productivity: 50
            })
        )

        const state_machine = MachineStateMachine.create({
            machine_state: machine_state,
            initial_mode_status: MachineStatus.INGREDIENT_SHORTAGE,
        })
        // const working_mode = Array.from(state_machine.modes).find(it => it.status === MachineStatus.WORKING);
        // expect(working_mode).toBeDefined();
        expect(machine_state.craftingProgress.progress).toBe(0);

        expect(state_machine.current_mode.status).toBe(MachineStatus.INGREDIENT_SHORTAGE);

        executeControlLogicForTicks(state_machine, 100);

        expect(state_machine.current_mode.status).toBe(MachineStatus.INGREDIENT_SHORTAGE);

        machine_state.inventoryState.addQuantity("stone", 100);
        executeControlLogicForTicks(state_machine, 1);
        expect(state_machine.current_mode.status).toBe(MachineStatus.WORKING);
    });

    test.each([
        { input_amount: 60, expected_output: 45, bonus_progress: 0.0 },
        { input_amount: 50, expected_output: 37, bonus_progress: 0.5 },
        { input_amount: 40, expected_output: 30, bonus_progress: 0.0 },
        { input_amount: 30, expected_output: 22, bonus_progress: 0.5 },
        { input_amount: 15, expected_output: 10, bonus_progress: 0.5 },
    ])("machine $input_amount -> $expected_output with bonus $bonus_progress",
        ({ input_amount, expected_output, bonus_progress }) => {
            const machine_state = MachineState.forMachine(
                createMachine("stone-brick", {
                    crafting_speed: 91.899995803833,
                    productivity: 50,
                    type: MachineType.FURNACE
                })
            )
            const state_machine = MachineStateMachine.create({
                machine_state: machine_state,
                initial_mode_status: MachineStatus.INGREDIENT_SHORTAGE,
            })

            machine_state.inventoryState.addQuantity("stone", input_amount);
            executeControlLogicForTicks(state_machine, 500);

            const produced_stone_bricks = machine_state.inventoryState.getQuantity("stone-brick");
            expect(produced_stone_bricks).toBe(expected_output);
            expect(machine_state.bonusProgress.progress).toBe(bonus_progress);
        }
    )

    test("furnace stops crafting when output reaches max stack size", () => {
        const machine_state = MachineState.forMachine(
            createMachine("stone-brick", {
                crafting_speed: 91.899995803833,
                productivity: 50,
                type: MachineType.FURNACE
            })
        )
        const state_machine = MachineStateMachine.create({
            machine_state: machine_state,
            initial_mode_status: MachineStatus.INGREDIENT_SHORTAGE,
        })

        machine_state.inventoryState.addQuantity("stone", 1_000_000);

        // Run for enough ticks to craft all possible items
        executeControlLogicForTicks(state_machine, 200);

        const produced_stone_bricks = machine_state.inventoryState.getQuantity("stone-brick");
        expect(produced_stone_bricks).toBe(100);

        expect(state_machine.current_mode.status).toBe(MachineStatus.OUTPUT_FULL);
    });

    test("assembly machine stops crafting when output reaches max stack size", () => {
        const machine_state = MachineState.forMachine(
            createMachine("automation-science-pack", {
                crafting_speed: 60,
                productivity: 100,
                type: MachineType.MACHINE
            })
        )
        const state_machine = MachineStateMachine.create({
            machine_state: machine_state,
            initial_mode_status: MachineStatus.INGREDIENT_SHORTAGE,
        })

        machine_state.inventoryState.addQuantity("copper-plate", 1_000_000);
        machine_state.inventoryState.addQuantity("iron-gear-wheel", 1_000_000);

        executeControlLogicForTicks(state_machine, 550);

        const produced_automation_science_packs = machine_state.inventoryState.getQuantity("automation-science-pack");
        expect(produced_automation_science_packs).toBe(200);

        expect(state_machine.current_mode.status).toBe(MachineStatus.OUTPUT_FULL);
    });

    test("machine is output full when the next craft does not fit under max stack size", () => {
        const machine_state = MachineState.forMachine(
            createMachine("plastic-bar", {
                crafting_speed: 99.194,
                productivity: 300,
                type: MachineType.MACHINE
            })
        )
        const state_machine = MachineStateMachine.create({
            machine_state: machine_state,
            initial_mode_status: MachineStatus.WORKING,
        })

        // e.g. a stack size 15 inserter leaves an odd count; 1 free slot cannot fit a 2-item craft
        machine_state.inventoryState.addQuantity("coal", 1_000);
        machine_state.inventoryState.addQuantity("plastic-bar", 99);
        executeControlLogicForTicks(state_machine, 10);

        expect(machine_state.inventoryState.getQuantity("plastic-bar")).toBe(99);
        expect(state_machine.current_mode.status).toBe(MachineStatus.OUTPUT_FULL);
    });
});
describe("Machine State Machine with a fuel slot", () => {
    // 4s recipe at crafting speed 2: 120 ticks per craft, 1 MJ per craft, so one 2 MJ nutrient pays for 2 crafts
    const createBiochamberState = (mash: number, nutrients: number) => {
        const machine_state = MachineState.forMachine(
            createMachine("nutrients-from-yumako-mash", { type: MachineType.BIOCHAMBER, crafting_speed: 2 })
        )
        machine_state.inventoryState.addQuantity("yumako-mash", mash)
        machine_state.fuelInventory.addQuantity("nutrients", nutrients)
        const state_machine = MachineStateMachine.create({ machine_state })
        return { machine_state, state_machine }
    }

    // the nutrients the recipe makes are taken away so a full output never stops the machine
    const run = (machine_state: MachineState, state_machine: MachineStateMachine, ticks: number) => {
        for (let i = 0; i < ticks; i++) {
            executeControlLogicForTicks(state_machine, 1)
            machine_state.inventoryState.setQuantity("nutrients", 0)
        }
    }

    test("does not start a craft, or consume its ingredients, without fuel", () => {
        const { machine_state, state_machine } = createBiochamberState(8, 0)
        run(machine_state, state_machine, 300)
        expect(machine_state.status).toBe(MachineStatus.INGREDIENT_SHORTAGE)
        expect(machine_state.craftCount).toBe(0)
        expect(machine_state.inventoryState.getQuantity("yumako-mash")).toBe(8)
    })

    test("burns one nutrient for every two crafts", () => {
        const { machine_state, state_machine } = createBiochamberState(12, 1)
        run(machine_state, state_machine, 600)
        expect(machine_state.craftCount).toBe(2)
        expect(machine_state.fuelInventory.getQuantity("nutrients")).toBe(0)
        expect(machine_state.status).toBe(MachineStatus.INGREDIENT_SHORTAGE)
    })

    test("a craft in progress waits for fuel and resumes where it stopped", () => {
        const { machine_state, state_machine } = createBiochamberState(16, 1)
        run(machine_state, state_machine, 180)
        // second craft is half done and has used up the nutrient
        expect(machine_state.craftCount).toBe(1)
        run(machine_state, state_machine, 100)
        expect(machine_state.craftCount).toBe(2)
        machine_state.fuelInventory.addQuantity("nutrients", 1)
        run(machine_state, state_machine, 400)
        expect(machine_state.craftCount).toBe(4)
        expect(machine_state.inventoryState.getQuantity("yumako-mash")).toBe(0)
    })

    test("machines without a fuel slot are unaffected", () => {
        const machine_state = MachineState.forMachine(createMachine("iron-gear-wheel"))
        machine_state.inventoryState.addQuantity("iron-plate", 2)
        executeControlLogicForTicks(MachineStateMachine.create({ machine_state }), 60)
        expect(machine_state.craftCount).toBe(1)
    })

    test("accepts fuel up to its insertion limit, even while the output is full", () => {
        const { machine_state } = createBiochamberState(0, 0)
        expect(MachineState.machineAcceptsItem(machine_state, "nutrients")).toBe(true)
        expect(MachineState.machineInputIsBlocked(machine_state, "nutrients")).toBe(false)
        machine_state.fuelInventory.addQuantity("nutrients", machine_state.machine.fuel_slot!.automated_insertion_limit)
        expect(MachineState.machineInputIsBlocked(machine_state, "nutrients")).toBe(true)
        expect(MachineState.machineAcceptsItem(machine_state, "coal")).toBe(false)
    })

    test("rejects a recipe that uses the fuel as an ingredient", () => {
        expect(() => createMachine("biochamber", { type: MachineType.BIOCHAMBER })).toThrow(/fuel/)
    })
})
