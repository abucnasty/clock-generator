import { ItemName } from "../data";
import { EntityId } from "../entities";
import { BeltPickupStock } from "../state/belt-pickup-stock";
import { EntityState } from "../state/entity-state";
import { InserterState } from "../state/inserter-state";
import type { MachineState } from "../state/machine-state";
import type { InserterArchetype } from "./archetypes/inserter";
import { TransportBelt } from "./archetypes/transport-belt";
import { BeltHandPickup } from "./components/belt-hand-pickup";
import { Control } from "./components/control";
import { CarriedItems, dropFromHand, Hand, HandDropPort, HandScratch, STAY } from "./components/hand";
import { HandNotifications } from "./components/hand-notifications";
import { InserterWakes } from "./components/inserter-wakes";
import { MachineHandDrop } from "./components/machine-hand-drop";
import type { TickProvider } from "./current-tick-provider";
import type { CopyTakerTick } from "./world";

/** A hand that an inserter put down, at the tick it did */
export interface HandDropped {
    readonly tick: number;
    readonly item: ItemName;
    readonly items: number;
}

/**
 * The drop port of a taker of another copy: its machine is not simulated, and is taken to be as the simulated copy's
 * is, so the port answers what that machine takes and puts nothing into it. A hand is dropped whole in one tick, as
 * into a machine (`MachineHandDrop`).
 */
class DropAsTheSimulatedCopy implements HandDropPort {
    private readonly reads: MachineHandDrop;

    constructor(private readonly state: InserterState, private readonly scratch: HandScratch, items: CarriedItems,
                sink: MachineState, private readonly notifications: HandNotifications, private readonly dropped: HandDropped[],
                private readonly tick_provider: TickProvider) {
        this.reads = new MachineHandDrop(state, scratch, items, sink.ingress, notifications);
    }

    public enter(): void { this.reads.enter(); }
    public key(): string { return this.reads.key(); }
    public acceptsHand(): boolean { return this.reads.acceptsHand(); }
    public takesAt(index: number): boolean { return this.reads.takesAt(index); }
    public takes(item: ItemName): boolean { return this.reads.takes(item); }
    public takesNothing(): boolean { return this.reads.takesNothing(); }
    public fullFor(): boolean { return false; }

    public drop(): void {
        const held = this.state.held_item;
        if (held === null) return;
        this.dropped.push({ tick: this.tick_provider.getCurrentTick(), item: held.item_name, items: held.quantity });
        dropFromHand(this.state, this.scratch, held.quantity, this.notifications);
        this.scratch.drop_ticks += 1;
    }
}

/**
 * The control of a taker of another copy: the simulated copy's inserter's, read each tick. A clock answers from the
 * tick alone, so the taker is enabled exactly when its twin is. A control that is not a clock (a condition on the
 * machine, a latch) needs what the twin's machine holds and what the latch keeps: the taker is then enabled when its
 * twin shows enabled, which holds only as long as the copy's machine is as the simulated copy's (`clock_alone` false).
 */
class TwinControl extends Control {
    constructor(private readonly twin: InserterArchetype) {
        super({ isEnabled: () => false });
        this.refresh();
    }

    /** Whether the twin's control is a clock, which answers from the tick alone */
    public get clock_alone(): boolean {
        return this.twin.control.looks_ahead;
    }

    public refresh(): void {
        const twin = this.twin.control;
        this.is_game_clock = twin.is_game_clock;
        this.looks_ahead = twin.looks_ahead;
        this.decider_build_order = twin.decider_build_order;
    }

    public override enabled(): boolean {
        return this.clock_alone ? this.twin.control.enabled() : this.twin.inserter_state.enabled;
    }

    public override enabledIn(ticks: number): boolean {
        return this.twin.control.enabledIn(ticks);
    }
}

/**
 * The inserter of another copy that takes from a shared lane (ruling: the other copies' pickup inserters are simulated
 * on the lane, their machines are not). Its hand is an inserter's Hand over a state of its own: it fills from the lane
 * at its own reach (`BeltHandPickup` over the reach's stocks), waits for items, and is cut off when its window closes;
 * it is enabled as its twin in the simulated copy is, and its sink is taken to be as the twin's machine is
 * (`DropAsTheSimulatedCopy`). It runs after the simulated copy's inserters, every tick (`World.copy_takers`).
 */
export class CopyTaker implements CopyTakerTick {
    public readonly state: InserterState;
    public readonly dropped: HandDropped[] = [];
    private readonly hand: Hand;
    private readonly control: TwinControl;
    private readonly wakes: InserterWakes;

    constructor(
        public readonly twin: InserterArchetype,
        /** Which copy of the row it stands in, 0 the simulated one */
        public readonly copy: number,
        /** The taker's own number, apart from every inserter of the config */
        number: number,
        source: TransportBelt,
        /** Its reach on each lane of the belt, in the belt's lane order */
        stocks: readonly BeltPickupStock[],
        sink: EntityState,
        tick_provider: TickProvider,
    ) {
        if (!EntityState.isMachine(sink)) {
            throw new Error(`The other copies' takers of ${twin.entity_id.id} put into ${sink.entity_id.id}: only a machine sink is modelled`);
        }
        const inserter = twin.inserter_state.inserter;
        this.state = { ...InserterState.createIdle(inserter), entity_id: EntityId.forInserter(number) };
        // a belt of its own over the same belt, its lanes holding this taker's reaches only
        const belt = TransportBelt.create(source.belt);
        belt.seedPickups(this.state.entity_id.id, stocks);
        const scratch = new HandScratch(), items = new CarriedItems(inserter), notifications = new HandNotifications();
        const drop = new DropAsTheSimulatedCopy(this.state, scratch, items, sink, notifications, this.dropped, tick_provider);
        const pickup = new BeltHandPickup(this.state, scratch, items, drop, belt, sink.wakes, tick_provider, notifications);
        this.control = new TwinControl(twin);
        this.hand = new Hand(this.state, scratch, items, pickup, drop, this.control, tick_provider, {
            sink_wakes: sink.wakes,
            sink_ingress: sink.ingress,
            from_belt: true,
            swings_part_hands: twin.hand.swings_part_hands,
            swing_ticks: inserter.animation.rotation.ticks,
        }, notifications);
        this.wakes = new InserterWakes(this.state, this.control);
    }

    /** Whether its control answers from the clock alone, so that nothing of the twin's machine or latch decides it */
    public get clock_alone(): boolean {
        return this.control.clock_alone;
    }

    /** One tick, as an inserter's: the phase rule, the phase's step, then whether it shows enabled */
    public tick(): void {
        this.control.refresh();
        const hand = this.hand;
        const from = hand.phase;
        const to = hand.rule();
        if (to !== STAY && to !== from) {
            hand.writeStatus(from, to);
            hand.exitAndEnter(from, to);
        }
        hand.step();
        this.wakes.endOfTick();
    }

    /** What the taker keeps between ticks, for the state key */
    public stateKey(tick: number): string {
        return `${this.copy};${this.hand.key(tick)};${this.wakes.key()}`;
    }
}
