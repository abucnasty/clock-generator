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
/**
 * The output block as recorded in Factorio 2.1: a machine that cannot start a craft shows full output while its
 * output is at overload multiplier x recipe amount (productivity not counted) and ingredient shortage below it,
 * but a machine with its ingredients keeps crafting past the block, up to the stack size.
 */
describe("Machine State Machine at the output block", () => {
    // rocket-fuel-from-jelly in the gleba rocket fuel recordings: 7.09 ticks per craft, 1 rocket fuel per craft and
    // 3 more from 300% productivity, output block 11 (overload multiplier 11 x 1), stack size 20
    const createRocketFuel = (rocket_fuel: number, crafts_of_ingredients: number) => {
        const machine_state = MachineState.forMachine(
            createMachine("rocket-fuel-from-jelly", { type: MachineType.BIOCHAMBER, crafting_speed: 84.6655, productivity: 300 })
        )
        machine_state.fuelInventory.addQuantity("nutrients", 10)
        machine_state.inventoryState.addQuantity("rocket-fuel", rocket_fuel)
        machine_state.inventoryState.addQuantity("jelly", 30 * crafts_of_ingredients)
        machine_state.inventoryState.addQuantity("bioflux", 2 * crafts_of_ingredients)
        const state_machine = MachineStateMachine.create({ machine_state })
        return { machine_state, state_machine }
    }

    test("the output block is the overload multiplier times the recipe amount, without productivity", () => {
        const { machine_state } = createRocketFuel(0, 0)
        expect(machine_state.machine.output.outputBlock).toEqual({ item_name: "rocket-fuel", quantity: 11, max_stack_size: 20 })
    })

    // the lowest output the game showed full output at and the highest it showed ingredient shortage at, per recording
    test.each([
        { recipe: "advanced-circuit", crafting_speed: 100.0625, productivity: 175, block: 21 },         // full at 21, short at 20
        { recipe: "engine-unit", crafting_speed: 49.0859375, productivity: 100, block: 7 },             // full at 16, short at 0
        { recipe: "chemical-science-pack", crafting_speed: 66.0253125, productivity: 100, block: 10 },  // full at 12, short at 8
        { recipe: "utility-science-pack", crafting_speed: 52.9159375, productivity: 100, block: 12 },   // full at 14, short at 6
        { recipe: "casting-low-density-structure", crafting_speed: 225.331, productivity: 300, block: 19 }, // full at 20, short at 16
        { recipe: "tungsten-plate", crafting_speed: 169.331, productivity: 150, block: 21 },            // full at 28, short at 16
    ])("$recipe blocks at $block like in game", ({ recipe, crafting_speed, productivity, block }) => {
        const machine = createMachine(recipe, { crafting_speed, productivity })
        expect(machine.output.outputBlock.quantity).toBe(block)
    })

    test("keeps crafting with its ingredients while its output is over the block", () => {
        // in game a craft started with 12 rocket fuel in the output and finished at 14 (gleba recording, tick 65)
        const { machine_state, state_machine } = createRocketFuel(12, 2)
        executeControlLogicForTicks(state_machine, 1)
        expect(machine_state.status).toBe(MachineStatus.WORKING)
        executeControlLogicForTicks(state_machine, 20)
        expect(machine_state.craftCount).toBe(2)
        expect(machine_state.inventoryState.getQuantity("rocket-fuel")).toBe(20)
        expect(machine_state.status).toBe(MachineStatus.OUTPUT_FULL)
    })

    test("is output full once out of ingredients with its output at the block, and short of ingredients under it", () => {
        // in game: 16 rocket fuel and too little jelly shows full output, 8 left after a pickup shows ingredient shortage
        const { machine_state, state_machine } = createRocketFuel(16, 0)
        executeControlLogicForTicks(state_machine, 2)
        expect(machine_state.status).toBe(MachineStatus.OUTPUT_FULL)
        machine_state.inventoryState.setQuantity("rocket-fuel", 11)
        executeControlLogicForTicks(state_machine, 2)
        expect(machine_state.status).toBe(MachineStatus.OUTPUT_FULL)
        machine_state.inventoryState.setQuantity("rocket-fuel", 8)
        executeControlLogicForTicks(state_machine, 1)
        expect(machine_state.status).toBe(MachineStatus.INGREDIENT_SHORTAGE)
    })

    test("a full output machine works again as soon as its ingredients arrive, even at the block", () => {
        // in game an advanced circuit machine at its block of 21 started a craft the tick its copper cable arrived
        const { machine_state, state_machine } = createRocketFuel(12, 0)
        executeControlLogicForTicks(state_machine, 2)
        expect(machine_state.status).toBe(MachineStatus.OUTPUT_FULL)
        machine_state.inventoryState.addQuantity("jelly", 30)
        machine_state.inventoryState.addQuantity("bioflux", 2)
        executeControlLogicForTicks(state_machine, 1)
        expect(machine_state.status).toBe(MachineStatus.WORKING)
        expect(machine_state.inventoryState.getQuantity("jelly")).toBe(0)
    })

    test("its inserters only fetch ingredients while the output is under the block", () => {
        const { machine_state } = createRocketFuel(11, 0)
        expect(MachineState.machineInputIsBlocked(machine_state, "jelly")).toBe(true)
        machine_state.inventoryState.setQuantity("rocket-fuel", 10)
        expect(MachineState.machineInputIsBlocked(machine_state, "jelly")).toBe(false)
    })

    test("an idle machine started with its output at the block shows full output", () => {
        const { machine_state, state_machine } = createRocketFuel(11, 0)
        expect(machine_state.status).toBe(MachineStatus.INGREDIENT_SHORTAGE)
        executeControlLogicForTicks(state_machine, 1)
        expect(machine_state.status).toBe(MachineStatus.OUTPUT_FULL)
    })
})

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

describe("Machine State Machine with several outputs", () => {
    // jellynut-processing: 1 jellynut -> 4 jelly and 1 jellynut-seed at 2%, in 1s
    const createProcessing = (productivity = 0) => {
        const machine_state = MachineState.forMachine(
            createMachine("jellynut-processing", { type: MachineType.BIOCHAMBER, productivity })
        )
        machine_state.fuelInventory.addQuantity("nutrients", 5)
        return { machine_state, state_machine: MachineStateMachine.create({ machine_state }) }
    }

    test("the main product is the result with the largest expected amount", () => {
        const { machine_state } = createProcessing()
        expect(machine_state.machine.output.item_name).toBe("jelly")
        expect(machine_state.machine.outputs.map(it => it.item_name)).toEqual(["jelly", "jellynut-seed"])
    })

    test("a by-product is made at its expected amount, carrying fractions over", () => {
        const { machine_state, state_machine } = createProcessing()
        machine_state.inventoryState.addQuantity("jellynut", 50)
        for (let i = 0; i < 50 * 60; i++) {
            executeControlLogicForTicks(state_machine, 1)
            machine_state.inventoryState.setQuantity("jelly", 0)
            machine_state.fuelInventory.setQuantity("nutrients", 5)
        }
        expect(machine_state.craftCount).toBe(50)
        expect(machine_state.inventoryState.getQuantity("jellynut-seed")).toBe(1)
    })

    test("productivity multiplies a by-product's rate", () => {
        const { machine_state } = createProcessing(100)
        const seed = machine_state.machine.outputs[1]
        expect(seed.amount_per_craft.toDecimal()).toBeCloseTo(0.04)
        expect(seed.production_rate.amount_per_second.toDecimal()).toBeCloseTo(0.04)
    })

    test("the machine is output full as soon as any output reaches its stack size", () => {
        const { machine_state, state_machine } = createProcessing()
        const seed_stack_size = machine_state.machine.outputs[1].outputBlock.max_stack_size
        machine_state.inventoryState.addQuantity("jellynut", 10)
        executeControlLogicForTicks(state_machine, 5)
        expect(machine_state.status).toBe(MachineStatus.WORKING)
        machine_state.inventoryState.setQuantity("jellynut-seed", seed_stack_size)
        executeControlLogicForTicks(state_machine, 120)
        expect(machine_state.status).toBe(MachineStatus.OUTPUT_FULL)
        // the craft that was underway finished and no other started
        expect(machine_state.inventoryState.getQuantity("jellynut")).toBe(9)

        machine_state.inventoryState.setQuantity("jellynut-seed", 0)
        executeControlLogicForTicks(state_machine, 10)
        expect(machine_state.status).toBe(MachineStatus.WORKING)
    })
})
