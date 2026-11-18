import type { EntityId } from "../../entities/entity-id";
import type { Machine } from "../../entities/machine/machine";
import { reasonId } from "../../state/reason-table";
import { LiveQuantity, WritableInventoryState } from "../../state/inventory-state";
import { ProgressState } from "../../state/progress-state";
import { CraftingStatus } from "../status-codes";
import type { Energy, EnergyUser } from "./energy";
import type { Ingress } from "./ingress";
import type { Placement } from "./placement";
import { OutputFullCode, Yield, YieldUser } from "./yield";

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
 *
 * The craft underway is kept as the game keeps it (Factorio 2.1.24): in seconds of recipe time, a double, a tick adding
 * crafting speed / 60 of them at full power. A craft finishes in the tick that sum reaches the recipe time, with no
 * tolerance, and the rest of the step goes on to the next craft: a rest above 0 starts it in the same tick, a rest of
 * exactly 0 at the top of the next tick, and a sum that falls short of the recipe time by rounding finishes the craft a
 * tick late, the next craft starting in that late tick.
 */
export class Crafting implements EnergyUser, YieldUser {
    /** The craft underway, from 0 to 1; 0 while none is. Read and written in recipe seconds (`seconds`) */
    public readonly craftingProgress: ProgressState;

    /** The craft underway in seconds of recipe time, a double; 0 while none is */
    private seconds: number = 0;

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
    /** The recipe's time in seconds: a craft's length at crafting speed 1 */
    private readonly recipe_seconds: number;
    /** The machine's crafting speed: the recipe seconds a second of work makes */
    private readonly crafting_speed: number;
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
        const recipe = machine.metadata.recipe;
        this.recipe_seconds = recipe.energy_required;
        this.crafting_speed = machine.metadata.crafting_speed;
        // the fraction every reader of a machine's progress sees, read from and written to the recipe seconds
        const progress = {} as ProgressState;
        Object.defineProperty(progress, "progress", {
            get: (): number => this.seconds / this.recipe_seconds,
            set: (value: number): void => { this.seconds = value * this.recipe_seconds; },
            enumerable: true,
        });
        this.craftingProgress = progress;
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
        if (this.keepsWorking() && !this.yield.barWaits() && this.energy.hasFuel()) {
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
     * products it holds put in first, then crafts progressed, started and finished while the step lasts and no product
     * waits for room, then the energy spent. The step is the recipe seconds of the tick, (crafting speed x the share
     * its energy pays for) / 60; a craft finishes when the step reaches what is left of the recipe time, with no
     * tolerance, and what is left of the step goes on to the next craft (none when it is exactly 0). The productivity bar
     * is fed the part of a craft each step makes.
     */
    public tick(): void {
        const recipe_seconds = this.recipe_seconds;
        let step = (this.crafting_speed * this.energy.poweredShare()) / 60;
        let worked = false;

        this.yield.release(this);
        while (step > 0 && !this.yield.holdsProducts() && !this.yield.barWaits()) {
            let seconds = this.seconds;
            if (seconds <= 0) {
                if (!this.canStartCraft() || !this.energy.hasFuel()) {
                    break;
                }
                this.consume();
                seconds = 0;
            }

            worked = true;
            const rest = recipe_seconds - seconds;
            if (rest > step) {
                this.seconds = seconds + step;
                this.yield.advanceBonus(step / recipe_seconds);
                break;
            }
            this.yield.advanceBonus(rest / recipe_seconds);
            this.seconds = recipe_seconds;
            this.yield.finishCraft(this);
            this.craftCount += 1;
            this.seconds = 0;
            step -= rest;
        }

        this.energy.spend(worked, this);
    }

    /** Whether a craft is underway (what Energy asks) */
    public craftInProgress(): boolean {
        return this.seconds > 0;
    }

    /**
     * Whether the machine works on after this tick: no product waits for room, and a craft is underway or can start. A
     * full bar waiting for room (Yield.barWaits) stops the next tick, not this answer: a burner is topped up after the
     * tick its bar fills.
     */
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

    /**
     * What of it drives the machine's next ticks, for the machine's key (see simulationStateKey): the status as its code,
     * whether a craft is underway, and the craft underway in billionths of a craft (ProgressState.keyOf): a craft started
     * with a rest of a few 1e-16 s keys as underway, though its billionths are 0. The crafts counted and the main product
     * made are running totals: they never repeat.
     */
    public key(): string {
        return `${this.status};${this.seconds > 0};${ProgressState.keyOf(this.seconds / this.recipe_seconds)}`;
    }

    /** A snapshot's copy of what `other` holds: the craft underway, the counts and the status */
    public copyFrom(other: Crafting): void {
        this.seconds = other.seconds;
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
        this.yield.notifications.ingredientsConsumed();
    }
}
