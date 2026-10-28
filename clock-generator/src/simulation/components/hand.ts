import assert, { AssertionError } from "../../common/assert";
import type { TickProvider } from "../../control-logic/current-tick-provider";
import { reasonId } from "../../control-logic/mode/reason-table";
import { ItemName } from "../../data";
import { handSizeFor, Inserter } from "../../entities/inserter/inserter";
import type { InserterHandContents, InserterState } from "../../state/inserter-state";
import { InserterPhase, inserterStatusOf } from "../status-codes";
import type { Control } from "./control";
import type { Ingress } from "./ingress";
import { actsInTheTickTheBlockIsLifted } from "./machine-wakes";
import type { MachineWakes } from "./machine-wakes";

/**
 * What an inserter's hand keeps from one tick to the next besides its phase: one flat record, written by the hand's
 * rules and its ports. Built with the ports, once per archetype, so a control swap starts a fresh one while the hand,
 * the pickup arm and the lanes are kept (same-tick rule 12).
 */
export class HandScratch {
    /** Ticks of the pickup from a machine or a container that found something to take, since the pickup started */
    public pickup_ticks: number = 0;
    /** Whether the pickup from a machine started in the first tick of a window: entered from the disabled phase */
    public window_opened: boolean = false;
    /** Ticks since the pickup from a machine started, this one included */
    public ticks_in_pickup: number = 0;
    /**
     * As recorded in the game, a belt inserter that waited for its machine to have its products taken spends a tick
     * deciding before the first stack lands in its hand, both when the hand starts after an idle wait and when it goes
     * on after a pause in the middle; the stacks after that come a tick apart. True once that tick has passed.
     */
    public belt_grab_decided: boolean = true;
    /** Ticks of the drop into a machine or a container, since the drop started */
    public drop_ticks: number = 0;
    /** Whether the hand found its sink taking nothing it brings when the idle rule last looked, and has not acted since */
    public saw_sink_blocked: boolean = false;
    /** Whether a window of a clock of the game opens in this tick: the inserter was disabled the tick before */
    public window_opens: boolean = false;
    /** The tick the hand's swing started; null while it does not swing */
    public swing_entered_tick: number | null = null;
    /** The phase the swing started from: PICKUP towards the sink, DROP or TARGET_FULL back; null while it does not swing */
    public swing_from: InserterPhase | null = null;
    /**
     * Why the hand changes phase (a `HandReason`), with the item and the quantity a reason made from a template names:
     * written by the rule that changes the phase, or the pickup port it asks, and read at that change only
     */
    public reason: number = -1;
    public reason_item: ItemName = "";
    public reason_quantity: number = 0;
    /** The record of the hand last emptied, which the next hand fills (`takeIntoHand`); null for none */
    public spare_hand: InserterHandContents | null = null;
}

/**
 * The items a hand carries (`Inserter.filtered_items`), in the order it tries them, with the hand of each: bound once
 * at build, so that a tick asks by index and both of the hand's ports by the same one
 */
export class CarriedItems {
    public readonly names: readonly ItemName[];
    /** For each item, how many of it a swing carries (handSizeFor) */
    private readonly hand_sizes: readonly number[];

    constructor(private readonly inserter: Inserter) {
        this.names = Array.from(inserter.filtered_items);
        this.hand_sizes = this.names.map(item => handSizeFor(inserter, item));
    }

    /** The index of an item, -1 for one it does not carry */
    public indexOf(item: ItemName): number {
        const names = this.names;
        for (let index = 0; index < names.length; index++) {
            if (names[index] === item) {
                return index;
            }
        }
        return -1;
    }

    /** How many of the item a swing carries */
    public handSizeOf(item: ItemName): number {
        const index = this.indexOf(item);
        return index >= 0 ? this.hand_sizes[index] : handSizeFor(this.inserter, item);
    }

    /** Whether the hand's filter lets it take the item: any item when it carries none by name */
    public lets(item: ItemName): boolean {
        return this.names.length === 0 || this.indexOf(item) >= 0;
    }
}

/**
 * The pickup port of a source as one hand reaches it, bound at build (P4 2.7): the CraftingMachine's output, a
 * Container's storage or a belt's lanes. It keeps nothing of its own between ticks: what the hand keeps is in its
 * HandScratch. The pickup phase calls it, and the idle rule asks it whether there is anything to start a pickup on.
 */
export interface HandPickupPort {
    /** The pickup phase's enter step, from the phase the hand leaves */
    enter(from: InserterPhase): void;
    /** The pickup phase's step: what the hand takes in this tick */
    pickup(): void;
    /** What the hand's pickup keeps between ticks, for the state key */
    key(): string;
    /**
     * The idle rule's ask: whether the source has anything for the hand to start a pickup on now. Where it has, the
     * reason of the start goes into the scratch (`HandReason`, with what the source has of which item).
     */
    startsPickup(): boolean;
}

/**
 * The drop port of a sink as one hand reaches it, bound at build (P4 2.7): the CraftingMachine's Ingress, a Container's
 * storage or a belt's lane. The drop phase calls it, and the hand's rules ask it what the sink takes, so that no rule
 * asks what kind of entity the sink is.
 */
export interface HandDropPort {
    /** The drop phase's enter step */
    enter(): void;
    /** The drop phase's step (the target-full phase's too): what the hand puts into the sink in this tick */
    drop(): void;
    /** What the hand's drop keeps between ticks, for the state key */
    key(): string;
    /** The idle rule's ask: whether the sink takes anything the hand brings now, the item in it or one it carries */
    acceptsHand(): boolean;
    /** Whether the sink takes more of the carried item at `index` now, as a hand fills: only a machine ever refuses */
    takesAt(index: number): boolean;
    /** The same for an item by its name: the item in the hand */
    takes(item: ItemName): boolean;
    /** The drop rule's ask: whether the sink is full for the item, so that the hand waits at it: only a container ever is */
    fullFor(item: ItemName): boolean;
}

/**
 * A pickup into the hand: `quantity` more of what it holds, or a new hand of `item`; counted and traced as `item`. A
 * hand that holds items is filled in place; a new hand fills the record of the hand last emptied, where there is one.
 */
export function takeIntoHand(state: InserterState, scratch: HandScratch, item: ItemName, quantity: number): void {
    const held = state.held_item;
    if (held !== null) {
        held.quantity += quantity;
    } else {
        const spare = scratch.spare_hand;
        if (spare === null) {
            state.held_item = { item_name: item, quantity };
        } else {
            scratch.spare_hand = null;
            spare.item_name = item;
            spare.quantity = quantity;
            state.held_item = spare;
        }
    }
    state.items_picked_up += quantity;
    state.inventoryState.addQuantity(item, quantity);
    state.trace?.record({ type: "pickup", item, quantity });
}

/**
 * Removes only what the hand holds, and clears the hand when its last items are dropped, keeping its record for the
 * next hand
 */
export function dropFromHand(state: InserterState, scratch: HandScratch, amount: number): void {
    const held = state.held_item;
    if (held === null) {
        throw new AssertionError(`${state.entity_id} Held item should not be null when dropping off`);
    }
    const actual_drop = Math.min(amount, held.quantity);
    if (actual_drop > 0) state.trace?.record({ type: "drop", item: held.item_name, quantity: actual_drop });
    state.inventoryState.removeQuantity(held.item_name, actual_drop);
    held.quantity -= actual_drop;
    state.items_dropped += actual_drop;

    assert(held.quantity >= 0, "Held item quantity went below 0");
    if (held.quantity === 0) {
        state.held_item = null;
        scratch.spare_hand = held;
    }
}

/**
 * Why a hand changes phase, as a code (P4 section 8): the rule that changes the phase writes it into the scratch, with
 * the item and the quantity for a reason made from a template; its text is made only when an observer asks for the
 * reason's number (`Hand.reasonId`), the same text the inserter's transitions gave.
 */
export const HandReason = {
    INSERTER_DISABLED: 0,
    PICKUP_FROM_BELT: 1,
    /** `machine has ${quantity} of ${item} to pickup` */
    MACHINE_HAS: 2,
    /** `chest has ${quantity} of ${item} to pickup` */
    CHEST_HAS: 3,
    /** `Picked up full stack of ${item}` */
    FULL_HAND: 4,
    /** `Picked up ${quantity} ${item}, which it swings without waiting for a full hand` */
    PART_HAND: 5,
    /** `Inserter disabled while picking up ${item} (${quantity})`, "nothing (0)" for an empty hand */
    DISABLED_WHILE_PICKING_UP: 6,
    /** `machine takes no more ${item} for now, ${quantity} in hand` */
    SINK_TAKES_NO_MORE: 7,
    SWING_TO_SINK: 8,
    SWING_TO_SOURCE: 9,
    ALL_DROPPED: 10,
    CHEST_FULL: 11,
    ALL_DROPPED_TO_CHEST: 12,
    DISABLED_WHILE_WAITING: 13,
    NOTHING_TO_WAIT_WITH: 14,
    /** `machine takes ${item} again` */
    SINK_TAKES_AGAIN: 15,
    INSERTER_ENABLED: 16,
} as const;
export type HandReason = typeof HandReason[keyof typeof HandReason];

/** The reasons with a fixed text */
const FIXED_REASON_TEXTS: readonly (readonly [HandReason, string])[] = [
    [HandReason.INSERTER_DISABLED, "inserter disabled"],
    [HandReason.PICKUP_FROM_BELT, "pickup from belt"],
    [HandReason.SWING_TO_SINK, "swing to sink duration elapsed"],
    [HandReason.SWING_TO_SOURCE, "swing to source duration elapsed"],
    [HandReason.ALL_DROPPED, "all items dropped"],
    [HandReason.CHEST_FULL, "chest is full, waiting for space"],
    [HandReason.ALL_DROPPED_TO_CHEST, "all items dropped to chest"],
    [HandReason.DISABLED_WHILE_WAITING, "inserter disabled while waiting for the machine to take its hand"],
    [HandReason.NOTHING_TO_WAIT_WITH, "nothing in hand to wait with"],
    [HandReason.INSERTER_ENABLED, "inserter enabled"],
];

/** The numbers of the reasons with a fixed text, by code, made once at load (-1 for a reason made from a template) */
const FIXED_REASON_IDS: readonly number[] = fixedReasonIds();

function fixedReasonIds(): number[] {
    const ids = new Array<number>(Object.keys(HandReason).length).fill(-1);
    for (const [reason, text] of FIXED_REASON_TEXTS) {
        ids[reason] = reasonId(text);
    }
    return ids;
}

/** The number of a reason in the reason table; the text of a template is made here, at a change someone watches */
function reasonIdOf(reason: number, item: ItemName, quantity: number): number {
    switch (reason) {
        case HandReason.MACHINE_HAS: return reasonId(`machine has ${quantity} of ${item} to pickup`);
        case HandReason.CHEST_HAS: return reasonId(`chest has ${quantity} of ${item} to pickup`);
        case HandReason.FULL_HAND: return reasonId(`Picked up full stack of ${item}`);
        case HandReason.PART_HAND: return reasonId(`Picked up ${quantity} ${item}, which it swings without waiting for a full hand`);
        case HandReason.DISABLED_WHILE_PICKING_UP: return reasonId(`Inserter disabled while picking up ${item} (${quantity})`);
        case HandReason.SINK_TAKES_NO_MORE: return reasonId(`machine takes no more ${item} for now, ${quantity} in hand`);
        case HandReason.SINK_TAKES_AGAIN: return reasonId(`machine takes ${item} again`);
    }
    const id = FIXED_REASON_IDS[reason];
    if (id === undefined || id < 0) {
        throw new AssertionError(`No reason has the code ${reason}`);
    }
    return id;
}

/** What a hand's rule returns when the hand stays in its phase */
export const STAY = -1;
export type PhaseChange = InserterPhase | typeof STAY;

/** What a hand is bound to at build besides its ports: what it reads of its sink and of its source, and its swing */
export interface HandBinding {
    /** The sink machine's Wakes, as the machine's last tick left them (same-tick rule 1); null for any other sink */
    readonly sink_wakes: MachineWakes | null;
    /** The sink machine's Ingress, for whether its output is at the block now; null for any other sink */
    readonly sink_ingress: Ingress | null;
    /**
     * Whether the hand takes from a belt: a partly filled hand then waits for its sink in a phase of its own, and lands
     * its first stack a tick after a wait by itself (`BeltHandPickup`)
     */
    readonly from_belt: boolean;
    /**
     * Whether it swings a part hand at its source: at a machine that places its results itself, an inserter whose Hand
     * trait does not wait for a full hand there (rule 18)
     */
    readonly swings_part_hands: boolean;
    /** Ticks a swing takes, either way */
    readonly swing_ticks: number;
}

/**
 * An inserter's Hand: its phase and the rules and steps of each (the phase table's inserter row, P4 2.5). What it holds
 * and has moved is the inserter's state (`InserterState`, which every context over the build shares); what it keeps
 * between ticks besides its phase is its scratch, written by its rules and its two ports.
 *
 * Its phase is a code (`InserterPhase`) and its rule and step a switch on it: each of the inserter's seven phases has a
 * rule, which gives the phase to change to (`STAY` for none) and why, and the pickup, drop and target-full phases have a
 * step through the source's pickup port or the sink's drop port. The archetype changes the phase between the two
 * (`InserterArchetype.phaseRule`): the status written first, then the observers told, then the exit and enter steps
 * (same-tick rule 17). The phase and the inserter's written status part in two places, as before: a pickup that finds
 * nothing writes the status IDLE and stays in its phase (rule 11), and a control swap starts a new Hand at IDLE while the
 * status is kept (rule 12).
 */
export class Hand {
    /** The phase the hand is in: what its rule and its step do */
    public phase: InserterPhase = InserterPhase.IDLE;
    /** Whether it swings a part hand at its source, the same in every tick */
    public readonly swings_part_hands: boolean;
    private readonly sink_wakes: MachineWakes | null;
    private readonly sink_ingress: Ingress | null;
    private readonly from_belt: boolean;
    private readonly swing_ticks: number;

    constructor(
        private readonly state: InserterState,
        public readonly scratch: HandScratch,
        private readonly items: CarriedItems,
        /** The source's pickup port as the hand reaches it */
        public readonly pickup: HandPickupPort,
        /** The sink's drop port as the hand reaches it */
        public readonly drop: HandDropPort,
        private readonly control: Control,
        private readonly tick_provider: TickProvider,
        binding: HandBinding,
    ) {
        this.sink_wakes = binding.sink_wakes;
        this.sink_ingress = binding.sink_ingress;
        this.from_belt = binding.from_belt;
        this.swings_part_hands = binding.swings_part_hands;
        this.swing_ticks = binding.swing_ticks;
    }

    /** The phase's rule: the phase to change to, its reason in the scratch, or STAY */
    public rule(): PhaseChange {
        switch (this.phase) {
            case InserterPhase.IDLE: return this.idleRule();
            case InserterPhase.PICKUP: return this.pickupRule();
            case InserterPhase.SWING: return this.swingRule();
            case InserterPhase.DROP: return this.dropRule();
            case InserterPhase.TARGET_FULL: return this.targetFullRule();
            case InserterPhase.WAITING_FOR_SINK: return this.waitForSinkRule();
            case InserterPhase.DISABLED: return this.disabledRule();
        }
    }

    /** The phase's step: the pickup takes through the source's port, the drop and the target-full wait drop through the sink's */
    public step(): void {
        switch (this.phase) {
            case InserterPhase.PICKUP:
                this.pickup.pickup();
                return;
            case InserterPhase.DROP:
            case InserterPhase.TARGET_FULL:
                this.drop.drop();
                return;
        }
    }

    /**
     * The first thing at a change of phase, before the observers are told: the inserter's status written and traced, as
     * the game's status of the inserter and its trace read it
     */
    public writeStatus(from: InserterPhase, to: InserterPhase): void {
        const state = this.state;
        state.status = inserterStatusOf(to);
        state.trace?.record({ type: "mode", from: inserterStatusOf(from), to: state.status });
    }

    /**
     * The last thing at a change of phase, after the observers are told (same-tick rule 17): the exit step of the phase
     * left (a swing forgets where and when it started), the enter steps of the phase entered, then the phase itself
     */
    public exitAndEnter(from: InserterPhase, to: InserterPhase): void {
        const scratch = this.scratch;
        if (from === InserterPhase.SWING) {
            scratch.swing_entered_tick = null;
            scratch.swing_from = null;
        }
        switch (to) {
            case InserterPhase.PICKUP:
                // the belt's port reads the wait flag before it is cleared, to decide its first grab's timing (rule 10)
                this.pickup.enter(from);
                this.state.waits_for_sink = false;
                break;
            case InserterPhase.DROP:
                this.drop.enter();
                break;
            case InserterPhase.SWING:
                scratch.swing_entered_tick = this.tick_provider.getCurrentTick();
                scratch.swing_from = from;
                break;
        }
        this.phase = to;
    }

    /** The number of the reason of the change the rule just gave, made only when an observer is told of it */
    public reasonId(): number {
        const scratch = this.scratch;
        return reasonIdOf(scratch.reason, scratch.reason_item, scratch.reason_quantity);
    }

    /**
     * Its phase and what its rules and ports keep from one tick to the next, with the text the inserter's mode state
     * machine gave them before: the phase, then each mode's and evaluator's key in the order of its graph (idle, swing,
     * drop, pickup, disabled, target-full, wait-for-sink), of which only the idle rule's, the swing's, the drop port's
     * and the pickup port's had any; ticks relative to `tick`. With `InserterState.stateKey`, two equal keys one clock
     * period apart mean the inserter repeats.
     */
    public key(tick: number): string {
        const scratch = this.scratch;
        const entered = scratch.swing_entered_tick;
        const from = scratch.swing_from;
        return `${inserterStatusOf(this.phase)}||${scratch.saw_sink_blocked},${scratch.window_opens}`
            + `||${entered === null ? null : entered - tick},${from === null ? null : inserterStatusOf(from)}`
            + `|${this.drop.key()}||${this.pickup.key()}|||||||`;
    }

    /**
     * Idle at the source: disabled when the control says so; waiting while the sink takes nothing the hand brings, and
     * for a tick after another inserter took the sink's products when that is what wakes it; else a pickup where the
     * source has anything for the hand
     */
    private idleRule(): PhaseChange {
        const state = this.state;
        const scratch = this.scratch;
        if (!this.control.enabled()) {
            state.waits_for_sink = false;
            scratch.saw_sink_blocked = false;
            scratch.window_opens = this.opensWindowNextTick();
            return this.changeTo(InserterPhase.DISABLED, HandReason.INSERTER_DISABLED);
        }
        const window_opens = scratch.window_opens;
        scratch.window_opens = false;

        if (!this.drop.acceptsHand()) {
            state.waits_for_sink = true;
            scratch.saw_sink_blocked = true;
            return STAY;
        }

        const woken_this_tick = this.wokenThisTick(window_opens);
        scratch.saw_sink_blocked = false;
        if (woken_this_tick) {
            return STAY;
        }
        return this.pickup.startsPickup() ? InserterPhase.PICKUP : STAY;
    }

    /**
     * Filling the hand: a full hand swings, and so does a part hand at a source where the inserter does not wait for a
     * full one; disabled when the control says so; a partly filled hand from a belt waits while the machine takes no
     * more of its item (only a machine refuses)
     */
    private pickupRule(): PhaseChange {
        const held = this.state.held_item;
        if (held !== null && held.quantity === this.items.handSizeOf(held.item_name)) {
            return this.changeWith(InserterPhase.SWING, HandReason.FULL_HAND, held.item_name, held.quantity);
        }
        if (held !== null && this.swings_part_hands) {
            return this.changeWith(InserterPhase.SWING, HandReason.PART_HAND, held.item_name, held.quantity);
        }
        if (!this.control.enabled()) {
            return held === null
                ? this.changeWith(InserterPhase.DISABLED, HandReason.DISABLED_WHILE_PICKING_UP, "nothing", 0)
                : this.changeWith(InserterPhase.DISABLED, HandReason.DISABLED_WHILE_PICKING_UP, held.item_name, held.quantity);
        }
        if (held !== null && this.from_belt && !this.drop.takes(held.item_name)) {
            return this.changeWith(InserterPhase.WAITING_FOR_SINK, HandReason.SINK_TAKES_NO_MORE, held.item_name, held.quantity);
        }
        return STAY;
    }

    /**
     * A swing takes its ticks either way. Towards the sink it ends in the drop; back at the source it asks the idle rule
     * in the same tick, so that a hand can start its pickup at once (same-tick rule 8), and is idle otherwise.
     */
    private swingRule(): PhaseChange {
        const scratch = this.scratch;
        const entered = scratch.swing_entered_tick;
        if (entered === null) {
            throw new Error("A hand swings without having started a swing");
        }
        if (this.tick_provider.getCurrentTick() - entered < this.swing_ticks) {
            return STAY;
        }
        const from = scratch.swing_from;
        if (from === InserterPhase.PICKUP) {
            return this.changeTo(InserterPhase.DROP, HandReason.SWING_TO_SINK);
        }
        if (from === InserterPhase.DROP || from === InserterPhase.TARGET_FULL) {
            // after dropping its items (or after waiting for a full chest that had room again), back at the source
            const to = this.idleRule();
            if (to !== STAY && to !== InserterPhase.DISABLED) {
                return to;
            }
            return this.changeTo(InserterPhase.IDLE, HandReason.SWING_TO_SOURCE);
        }
        throw new Error(`A swing from ${from === null ? "nowhere" : inserterStatusOf(from)} has nowhere to go`);
    }

    /** Dropping: all items dropped, it swings back; a container full for the item, it waits there */
    private dropRule(): PhaseChange {
        const held = this.state.held_item;
        if (held === null) {
            return this.changeTo(InserterPhase.SWING, HandReason.ALL_DROPPED);
        }
        if (this.drop.fullFor(held.item_name)) {
            return this.changeTo(InserterPhase.TARGET_FULL, HandReason.CHEST_FULL);
        }
        return STAY;
    }

    /** Waiting at a full container with items in hand: once all are dropped, it swings back */
    private targetFullRule(): PhaseChange {
        return this.state.held_item === null ? this.changeTo(InserterPhase.SWING, HandReason.ALL_DROPPED_TO_CHEST) : STAY;
    }

    /** A part hand from a belt waiting for its machine: back to filling once the machine takes its item again; disabled when the window closes meanwhile */
    private waitForSinkRule(): PhaseChange {
        if (!this.control.enabled()) {
            return this.changeTo(InserterPhase.DISABLED, HandReason.DISABLED_WHILE_WAITING);
        }
        const held = this.state.held_item;
        if (held === null) {
            return this.changeTo(InserterPhase.PICKUP, HandReason.NOTHING_TO_WAIT_WITH);
        }
        if (this.drop.takes(held.item_name)) {
            return this.changeWith(InserterPhase.PICKUP, HandReason.SINK_TAKES_AGAIN, held.item_name, held.quantity);
        }
        return STAY;
    }

    /**
     * Disabled: idle again once the control enables it. On a clock of the game an inserter acts in the first tick it is
     * enabled: what it would do from idle, it does now (same-tick rule 9); the idle rule asks the clock.
     */
    private disabledRule(): PhaseChange {
        const control = this.control;
        if (!control.is_game_clock) {
            return control.enabled() ? this.changeTo(InserterPhase.IDLE, HandReason.INSERTER_ENABLED) : STAY;
        }
        const to = this.idleRule();
        if (to === STAY) {
            return this.changeTo(InserterPhase.IDLE, HandReason.INSERTER_ENABLED);
        }
        if (to === InserterPhase.DISABLED) {
            return STAY;
        }
        return to;
    }

    /**
     * True when another inserter took the sink's products down below the output block in this tick and that is what
     * wakes this one: it then takes its first items a tick later (see `actsInTheTickTheBlockIsLifted`, the rule of the
     * game with its recorded cases). An inserter that takes from a belt and waited for the machine lands its first
     * stack a tick later in both cases, which the belt's pickup port has (`HandScratch.belt_grab_decided`, set by
     * `BeltHandPickup.enter`); so for a belt source only the window that opens on the output-blocked machine counts
     * here, which starts from the disabled phase and has no such tick of its own.
     *
     * Inserters are updated before machines, and those that take from a machine before those that put into it. So
     * a machine that was at its block when its last tick was done, and is not now, has had its products taken in
     * this tick.
     *
     * An inserter whose window of a clock of the game opens in this tick shows as enabled in the tick before, and
     * waits in it: when the machine was at its block when that tick was done, the inserter is asleep on it and takes
     * its first items a tick later, whatever the machine did in that tick, as where the inserter that took the
     * products was enabled before (1,158 of 1,170 recorded in Factorio 2.1.21). Where the window of that inserter
     * opened in this tick too, the game updates the two in the reverse of the order their deciders were built, the
     * last built first: the inserter takes its first items in this tick when the taker's decider was built after its
     * own, as it is updated after the take, and a tick later when it was built before (`windowOpeningTakeDecider`,
     * `decider_build_order`). Recorded in Factorio 2.1.21 on windows that open with the taker's on a machine at its
     * block, from a belt and from a machine, onto a belt and into a machine or a chest, in 9,189 of 9,189 over fifteen
     * runs, each clock built in its own order, in reverse and renumbered (PR #268); where the drop target seemed to
     * decide (PR #267) it was the order the generator builds the deciders in. Where either order is not known, a tick
     * later.
     */
    private wokenThisTick(window_opens: boolean): boolean {
        const wakes = this.sink_wakes;
        const ingress = this.sink_ingress;
        if (wakes === null || ingress === null) {
            return false;
        }
        const lifted = wakes.outputBlockedAfterLastTick && !ingress.outputBlocked();
        if (window_opens) {
            return lifted && !this.updatedAfterTheTake(wakes);
        }
        if (this.from_belt) {
            return false;
        }
        return this.scratch.saw_sink_blocked && lifted && !actsInTheTickTheBlockIsLifted(wakes);
    }

    /**
     * The game updated this inserter after the inserter that took the sink's products as both their windows opened:
     * the taker's decider was built after this one's
     */
    private updatedAfterTheTake(wakes: MachineWakes): boolean {
        const own = this.control.decider_build_order;
        const taker = wakes.windowOpeningTakeDecider;
        return own !== undefined && taker !== null && taker > own;
    }

    /** True in the tick before a window of a clock of the game opens, which the game shows the inserter enabled in */
    private opensWindowNextTick(): boolean {
        const control = this.control;
        return control.is_game_clock && control.looks_ahead && control.enabledIn(1);
    }

    /** The phase to change to, its reason (a fixed text) written for the change */
    private changeTo(to: InserterPhase, reason: HandReason): InserterPhase {
        this.scratch.reason = reason;
        return to;
    }

    /** The phase to change to, its reason (a template) written for the change with the item and quantity it names */
    private changeWith(to: InserterPhase, reason: HandReason, item: ItemName, quantity: number): InserterPhase {
        const scratch = this.scratch;
        scratch.reason = reason;
        scratch.reason_item = item;
        scratch.reason_quantity = quantity;
        return to;
    }
}
