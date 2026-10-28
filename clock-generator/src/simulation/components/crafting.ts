import type { EntityId } from "../../entities/entity-id";
import type { Machine } from "../../entities/machine/machine";
import { reasonId } from "../../control-logic/mode/reason-table";
import { LiveQuantity, WritableInventoryState } from "../../state/inventory-state";
import { ProgressState } from "../../state/progress-state";
import { CraftingStatus } from "../status-codes";
import type { Energy, EnergyUser } from "./energy";
import type { Ingress } from "./ingress";
import type { Placement } from "./placement";
import { OutputFullCode, Yield, YieldUser } from "./yield";

// absorbs floating point drift when summing fractional per-tick progress
const PROGRESS_EPSILON = 1e-9;

// The reasons of a change of status whose text never varies, numbered once. A full output's reason and the drop of the
// output under its block are made from the machine's output at the change (reasonOf).
const NO_FUEL_TO_BURN = reasonId("machine has no fuel to burn");
const HAS_INPUTS = reasonId("machine has enough inputs for craft");
const HAS_INPUTS_AND_ROOM = reasonId("machine has enough inputs and room for a craft");
const FUEL_ARRIVED_WITH_INPUTS = reasonId("fuel arrived and the machine has enough inputs for craft");
const NOT_ENOUGH_INPUTS = reasonId("not enough inputs for craft");
const FUEL_ARRIVED_WITHOUT_INPUTS = reasonId("fuel arrived but not enough inputs for craft");

/** What a craft needs of an ingredient to start: the quantity where the machine keeps it, against a craft's amount */
interface CraftNeed {
    readonly quantity: LiveQuantity;
    readonly required: number;
}

/** What a craft takes out of an ingredient as it starts */
interface CraftTake {
    readonly inventory: WritableInventoryState;
    readonly item_name: string;
    readonly amount_per_craft: number;
}

/**
 * A crafting machine's Crafting component: the craft underway, the crafts started and finished, the main product made,
 * and the status the machine shows, with the status rule that decides it and the tick of a working machine. Reads the
 * machine's Energy, Yield and the ingredients its Ingress keeps, all bound at build, and counts what a machine that
 * places its results itself puts in its own output on its Placement.
 *
 * Crafting follows Factorio: ingredients are removed when a craft starts and products are added when it finishes. A
 * craft starts whatever the output holds. Products that do not fit under the stack size when they are made are held by
 * the machine (its Yield), which starts no craft and makes no progress until there is room for them.
 */
export class Crafting implements EnergyUser, YieldUser {
    /** The craft underway, from 0 to 1; 0 while none is */
    public readonly craftingProgress: ProgressState = ProgressState.empty();

    /** Crafts finished so far: what wakes the inserters that take from the machine (see MachineWakes) */
    public craftCount: number = 0;

    /**
     * Crafts started so far: the times the machine took the ingredients of a craft out of its inventory. The
     * simulation reads only whether it grew in the machine's last tick (`MachineWakes.startedCraftInLastTick`); the
     * rule count of the inserter cost series reads it to check the starts it infers from the products finished and the
     * working status (see crafting/rule-count.ts).
     */
    public craftsStarted: number = 0;

    /** The main product put in the output so far, a running total */
    public totalCrafted: number = 0;

    /** The status the machine shows, as the status rule gave it (statusRule) */
    public status: CraftingStatus = CraftingStatus.ITEM_INGREDIENT_SHORTAGE;

    private readonly yield: Yield;
    private readonly crafts_per_tick: number;
    /** What starting a craft asks, in recipe order */
    private readonly craft_needs: readonly CraftNeed[];
    /** What a craft takes out, in `machine.inputs` order */
    private readonly craft_takes: readonly CraftTake[];

    constructor(
        private readonly machine: Machine,
        /** What the machine runs on: electric or burner, the same class every tick */
        private readonly energy: Energy,
        /** What its crafts and its productivity bar make */
        made: Yield,
        /** Where results put in the machine's own output are counted as placed (a machine that places its results itself) */
        private readonly placement: Placement,
        /** Where the machine keeps each ingredient, read once here */
        ingress: Ingress,
    ) {
        this.yield = made;
        this.crafts_per_tick = machine.crafting_rate.crafts_per_tick;
        const recipe = machine.metadata.recipe;
        this.craft_needs = recipe.raw.ingredients.map(ingredient => ({
            quantity: new LiveQuantity(ingress.ingredientInventory(ingredient.name), ingredient.name),
            required: recipe.inputsPerCraft.get(ingredient.name)!.amount,
        }));
        this.craft_takes = Array.from(machine.inputs.values(), input => ({
            inventory: ingress.ingredientInventory(input.ingredient.name),
            item_name: input.ingredient.name,
            amount_per_craft: input.consumption_rate.amount_per_craft,
        }));
    }

    /**
     * The status rule (same-tick rule 13): the status the machine shows this tick. A burner with nothing to burn is out
     * of fuel first, whatever stops it besides, as in the game; then it works while a craft can go on (one underway or
     * one that can start, no product held, fuel to progress it), whatever its output holds, up to the stack size; an
     * idle machine shows a full output where its output stops it (Yield.outputFullCode), and a shortage of ingredients
     * otherwise. The same asks in the same order from every status.
     */
    public statusRule(): CraftingStatus {
        if (this.energy.outOfFuel(this)) {
            return CraftingStatus.NO_FUEL;
        }
        if (this.keepsWorking() && this.energy.hasFuel()) {
            return CraftingStatus.WORKING;
        }
        return this.yield.outputFullCode() !== OutputFullCode.NONE ? CraftingStatus.FULL_OUTPUT : CraftingStatus.ITEM_INGREDIENT_SHORTAGE;
    }

    /**
     * The number of the reason a history records for a change of status the rule just gave, from `from` to `to`, asked
     * by an observer of the change that records it (`CraftingMachineArchetype.reasonId`). Its text is made here only for
     * the two reasons read off the output (a full output's, naming the result target where a stack waits for room in
     * it, and the drop under the block), from the state the rule read: nothing it reads is written between the rule and
     * the observers (the status, written before them, is not read here).
     */
    public reasonOf(from: CraftingStatus, to: CraftingStatus, result_target: { readonly entity_id: EntityId } | null): number {
        switch (to) {
            case CraftingStatus.NO_FUEL:
                return NO_FUEL_TO_BURN;
            case CraftingStatus.WORKING:
                return from === CraftingStatus.FULL_OUTPUT ? HAS_INPUTS_AND_ROOM
                    : from === CraftingStatus.NO_FUEL ? FUEL_ARRIVED_WITH_INPUTS : HAS_INPUTS;
            case CraftingStatus.FULL_OUTPUT:
                return reasonId(this.yield.outputFullText(this.yield.outputFullCode(), result_target));
            default:
                if (from === CraftingStatus.FULL_OUTPUT) {
                    const made = this.yield;
                    return reasonId(`output "${made.output_name}" ${made.outputQuantity()} < ${this.machine.output.outputBlock.ingredients_blocked_at} and not enough inputs for craft`);
                }
                return from === CraftingStatus.NO_FUEL ? FUEL_ARRIVED_WITHOUT_INPUTS : NOT_ENOUGH_INPUTS;
        }
    }

    /**
     * A working machine's tick: the part of a tick's work its energy pays for, a full productivity bar paid out and the
     * products it holds put in first, then crafts progressed, started and finished while the budget lasts and no product
     * waits for room, then the energy spent.
     */
    public tick(): void {
        const powered_share = this.energy.poweredShare();
        let budget = this.crafts_per_tick * powered_share;
        let worked = false;

        this.yield.release(this);
        while (budget > PROGRESS_EPSILON && !this.yield.holdsProducts()) {
            let progress = this.craftingProgress.progress;
            if (progress <= 0) {
                if (!this.canStartCraft() || !this.energy.hasFuel()) {
                    break;
                }
                this.consume();
                progress = 0;
            }

            const step = Math.min(budget, 1 - progress);
            progress += step;
            budget -= step;
            worked = true;
            this.yield.advanceBonus(step);

            if (progress >= 1 - PROGRESS_EPSILON) {
                this.yield.finishCraft(this);
                this.craftCount += 1;
                progress = 0;
            }
            this.craftingProgress.progress = progress;
        }

        this.energy.spend(worked, this);
    }

    /** Whether a craft is underway (what Energy asks) */
    public craftInProgress(): boolean {
        return this.craftingProgress.progress > 0;
    }

    /** Whether the machine works on after this tick: no product waits for room, and a craft is underway or can start */
    public keepsWorking(): boolean {
        return !this.yield.holdsProducts() && (this.craftInProgress() || this.canStartCraft());
    }

    /** The main product the Yield put in the output: the machine's total */
    public countCrafted(amount: number): void {
        this.totalCrafted += amount;
    }

    /** Results a machine that places its results itself puts in its own output, where it has no result target to place them into */
    public countPlacedInOutput(amount: number): void {
        this.placement.countPlacedInOwnOutput(amount);
    }

    /** A snapshot's copy of what `other` holds: the craft underway, the counts and the status */
    public copyFrom(other: Crafting): void {
        this.craftingProgress.progress = other.craftingProgress.progress;
        this.craftCount = other.craftCount;
        this.craftsStarted = other.craftsStarted;
        this.totalCrafted = other.totalCrafted;
        this.status = other.status;
    }

    /** Every ingredient a craft takes is there, and the output has the room the next craft needs (Yield) */
    private canStartCraft(): boolean {
        const needs = this.craft_needs;
        for (let index = 0; index < needs.length; index++) {
            if (needs[index].quantity.get() < needs[index].required) {
                return false;
            }
        }
        return this.yield.roomForNextCraft();
    }

    /** A craft starts: its ingredients taken out */
    private consume(): void {
        this.craftsStarted += 1;
        const takes = this.craft_takes;
        for (let index = 0; index < takes.length; index++) {
            takes[index].inventory.removeQuantity(takes[index].item_name, takes[index].amount_per_craft);
        }
    }
}
