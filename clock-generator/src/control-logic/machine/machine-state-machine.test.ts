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
        // a burner that worked before holds the energy that is over a tick of work, enough to start on
        const machine = machine_state.machine
        machine_state.fuelProgress.energy_buffer_mj = machine.fuel_slot!.energy_per_craft_mj * machine.crafting_rate.crafts_per_tick / 15
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
        expect(machine_state.status).toBe(MachineStatus.NO_FUEL)
        expect(machine_state.craftCount).toBe(0)
        expect(machine_state.inventoryState.getQuantity("yumako-mash")).toBe(8)
    })

    test("burns one nutrient for every two crafts", () => {
        const { machine_state, state_machine } = createBiochamberState(12, 1)
        run(machine_state, state_machine, 600)
        expect(machine_state.craftCount).toBe(2)
        expect(machine_state.fuelInventory.getQuantity("nutrients")).toBe(0)
        expect(machine_state.status).toBe(MachineStatus.NO_FUEL)
    })

    test("a machine with ingredients and no fuel is out of fuel, not short of ingredients", () => {
        const { machine_state, state_machine } = createBiochamberState(8, 0)
        executeControlLogicForTicks(state_machine, 1)
        expect(machine_state.status).toBe(MachineStatus.NO_FUEL)
    })

    test("works on the tick after an inserter drops fuel in", () => {
        const { machine_state, state_machine } = createBiochamberState(8, 0)
        executeControlLogicForTicks(state_machine, 1)
        expect(machine_state.status).toBe(MachineStatus.NO_FUEL)
        MachineState.insertItem(machine_state, "nutrients", 1)
        executeControlLogicForTicks(state_machine, 1)
        expect(machine_state.status).toBe(MachineStatus.WORKING)
        // a craft started once the machine had fuel to burn
        run(machine_state, state_machine, 120)
        expect(machine_state.craftCount).toBe(1)
    })

    test("a machine with fuel and no ingredients is short of ingredients, not out of fuel", () => {
        const { machine_state, state_machine } = createBiochamberState(0, 1)
        executeControlLogicForTicks(state_machine, 1)
        expect(machine_state.status).toBe(MachineStatus.INGREDIENT_SHORTAGE)
    })

    test("is out of fuel before it is output full", () => {
        // an idle machine with its output at the block shows full output, unless it has no fuel
        const { machine_state, state_machine } = createBiochamberState(0, 0)
        machine_state.inventoryState.setQuantity("nutrients", machine_state.machine.output.outputBlock.quantity)
        executeControlLogicForTicks(state_machine, 1)
        expect(machine_state.status).toBe(MachineStatus.NO_FUEL)
        // with fuel, the full output is what stops it
        MachineState.insertItem(machine_state, "nutrients", 1)
        executeControlLogicForTicks(state_machine, 1)
        expect(machine_state.status).toBe(MachineStatus.OUTPUT_FULL)
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

})

// as recorded in Factorio 2.1.21 on a pentapod egg biochamber at crafting speed 64.5 with +150% productivity and
// +1020% energy consumption: fuel slot filled up to 9 nutrients, ingredients up to 210 nutrients and 7 eggs
describe("Machine State Machine with a pentapod egg recipe", () => {
    const createEggState = () => MachineState.forMachine(createMachine("pentapod-egg", {
        type: MachineType.BIOCHAMBER, crafting_speed: 64.5, productivity: 150, energy_consumption_bonus: 1020,
    }))
    const eggsGiven = (machine_state: MachineState) => MachineState.ingredientQuantity(machine_state, "pentapod-egg")
    const eggsMade = (machine_state: MachineState) => machine_state.inventoryState.getQuantity("pentapod-egg")
    const nutrientsToCraft = (machine_state: MachineState) => MachineState.ingredientQuantity(machine_state, "nutrients")
    const nutrientsToBurn = (machine_state: MachineState) => machine_state.fuelInventory.getQuantity("nutrients")

    test("a hand of nutrients goes whole to the fuel slot while that is below its limit, and to the ingredients otherwise", () => {
        const machine_state = createEggState()
        expect(machine_state.machine.fuel_slot!.automated_insertion_limit).toBe(9)
        machine_state.fuelInventory.addQuantity("nutrients", 8)
        MachineState.insertItem(machine_state, "nutrients", 16)
        expect([nutrientsToBurn(machine_state), nutrientsToCraft(machine_state)]).toEqual([24, 0])
        MachineState.insertItem(machine_state, "nutrients", 16)
        expect([nutrientsToBurn(machine_state), nutrientsToCraft(machine_state)]).toEqual([24, 16])
    })

    test("takes nutrients for a low fuel slot even when the ingredient is at its insertion limit", () => {
        const machine_state = createEggState()
        machine_state.fuelInventory.addQuantity("nutrients", 9)
        machine_state.inventoryState.addQuantity("nutrients", 209)
        expect(MachineState.machineInputIsBlocked(machine_state, "nutrients")).toBe(false)
        machine_state.inventoryState.addQuantity("nutrients", 1)
        expect(MachineState.machineInputIsBlocked(machine_state, "nutrients")).toBe(true)
        machine_state.fuelInventory.removeQuantity("nutrients", 1)
        expect(MachineState.machineInputIsBlocked(machine_state, "nutrients")).toBe(false)
    })

    test("starts with the eggs it is filled up to, since the recipe cannot start without one, and then takes no more", () => {
        const machine_state = createEggState()
        expect(eggsGiven(machine_state)).toBe(7)
        expect(MachineState.machineInputIsBlocked(machine_state, "pentapod-egg")).toBe(true)
        machine_state.selfIngredients.removeQuantity("pentapod-egg", 1)
        expect(MachineState.machineInputIsBlocked(machine_state, "pentapod-egg")).toBe(false)
    })

    test("a craft makes 2 eggs and a full productivity bar 1, and the eggs it makes are not the eggs it crafts from", () => {
        const machine_state = createEggState()
        machine_state.fuelInventory.addQuantity("nutrients", 20)
        machine_state.inventoryState.addQuantity("nutrients", 60)
        machine_state.selfIngredients.setQuantity("pentapod-egg", 2)
        const state_machine = MachineStateMachine.create({ machine_state })
        // two crafts of 14 ticks each fill the bar 3 times
        executeControlLogicForTicks(state_machine, 40)
        expect(machine_state.craftCount).toBe(2)
        expect(eggsMade(machine_state)).toBe(2 * 2 + 3)
        expect(eggsGiven(machine_state)).toBe(0)
        expect(nutrientsToCraft(machine_state)).toBe(0)
        expect(state_machine.current_mode.status).toBe(MachineStatus.INGREDIENT_SHORTAGE)
    })

    test("makes 3.5 eggs a craft on average", () => {
        expect(createEggState().machine.output.amount_per_craft.toDecimal()).toBe(3.5)
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
        // a tick more than the crafts take: a burner that has not worked yet takes its energy from the fuel first
        for (let i = 0; i < 50 * 60 + 1; i++) {
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

// as recorded on a pentapod egg biochamber with two stack inserters waiting for eggs: each batch of eggs went to
// one of them in turn
describe("inserters waiting for the product of one machine", () => {
    const createState = () => {
        const machine_state = MachineState.forMachine(createMachine("iron-gear-wheel"))
        machine_state.inventoryState.setQuantity("iron-gear-wheel", 3)
        return machine_state
    }

    test("take turns at less than a hand", () => {
        const machine_state = createState()
        expect(MachineState.takesTurnForOutput(machine_state, "iron-gear-wheel", "inserter:1", 10, 16)).toBe(true)
        MachineState.waitsForOutput(machine_state, "iron-gear-wheel", "inserter:2", 10)
        // the one that took last is passed over while the other waits
        expect(MachineState.takesTurnForOutput(machine_state, "iron-gear-wheel", "inserter:1", 11, 13)).toBe(false)
        expect(MachineState.takesTurnForOutput(machine_state, "iron-gear-wheel", "inserter:2", 11, 16)).toBe(true)
        expect(MachineState.takesTurnForOutput(machine_state, "iron-gear-wheel", "inserter:2", 12, 13)).toBe(false)
        expect(MachineState.takesTurnForOutput(machine_state, "iron-gear-wheel", "inserter:1", 12, 13)).toBe(true)
    })

    test("do not wait for one that stopped asking", () => {
        const machine_state = createState()
        MachineState.waitsForOutput(machine_state, "iron-gear-wheel", "inserter:2", 10)
        expect(MachineState.takesTurnForOutput(machine_state, "iron-gear-wheel", "inserter:1", 11, 16)).toBe(true)
        expect(MachineState.takesTurnForOutput(machine_state, "iron-gear-wheel", "inserter:1", 13, 13)).toBe(true)
    })

    test("all take from a machine that has a hand for the one asking", () => {
        const machine_state = createState()
        machine_state.inventoryState.setQuantity("iron-gear-wheel", 40)
        MachineState.waitsForOutput(machine_state, "iron-gear-wheel", "inserter:2", 10)
        expect(MachineState.takesTurnForOutput(machine_state, "iron-gear-wheel", "inserter:1", 10, 16)).toBe(true)
        expect(MachineState.takesTurnForOutput(machine_state, "iron-gear-wheel", "inserter:1", 11, 16)).toBe(true)
    })
})
