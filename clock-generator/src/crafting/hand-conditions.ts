import { Config } from "../config";
import { EntityId, handSizeFor } from "../entities";
import type { InserterArchetype } from "../simulation/archetypes/inserter";
import { InserterPhase } from "../simulation/status-codes";
import type { BeltPickupStock } from "../state/belt-pickup-stock";
import { EntityState } from "../state/entity-state";
import { COPY_NUMBER_STRIDE } from "./sequence/build-copies";
import type { SimulationContext } from "./sequence/simulation-context";

/**
 * The four conditions a hand of a belt taker waits for before it takes, read in each tick of a run for the maker log. It
 * changes nothing in the run: it reads the inserter, its sink and its reach on each lane after the inserters' update.
 *
 * - `window_open`: the enable window of the inserter is open (its control, asked for this tick without moving it on).
 * - `hand_at_source`: the hand is at its source, not on its way to the sink or back.
 * - `room_at_sink`: the sink takes what the hand brings (an empty hand: any item it carries; else the item it holds).
 * - `item_there`: the reach of a lane holds a stack the hand can take (an empty hand: any lane of an item it carries;
 *   else a lane of the item it holds), or the hand took from the lane in this tick.
 *
 * The order of the list is the order a tie is given in: where two conditions came in the same tick, the first of them
 * in this order is the last condition.
 */
export const HAND_CONDITIONS = ["window_open", "hand_at_source", "room_at_sink", "item_there"] as const;
export type HandCondition = typeof HAND_CONDITIONS[number];

/** The bits of one tick of a taker's record */
const WINDOW = 1, AT_SOURCE = 2, ROOM = 4, ITEM = 8, TOOK = 16, START = 32, ON_ITS_WAY = 64;
const ITEM_ON_LANE = [128, 256] as const, TOOK_FROM_LANE = [512, 1024] as const, MOVED_AT_LANE = [2048, 4096] as const;
const CONDITION_BITS: Record<HandCondition, number> = { window_open: WINDOW, hand_at_source: AT_SOURCE, room_at_sink: ROOM, item_there: ITEM };

/**
 * What the recorder kept of one taker of one copy: for each tick of the run from `first_tick`, which conditions held after
 * the inserters' update, whether the hand took items (and from which lane), whether an empty hand took its first items
 * (a hand start), whether the hand holds a hand it swings, and whether its reach on each lane moved while the window was
 * open.
 */
export class TakerConditions {
    private bits = new Uint16Array(1024);
    private count = 0;
    /** The first tick recorded; ticks before it are not in the record */
    public first_tick = -1;

    constructor(
        /** The copy, counted from the lane's entry: 0 is the config's own */
        public readonly copy: number,
        /** The config's inserter that the copy's taker is a copy of */
        public readonly inserter_id: string,
        /** Whether its window was read from its control; where it was not, every tick counts as open */
        public readonly window_read: boolean,
        /** The lanes of its belt it can take from, 1 or 2 */
        public readonly lanes: readonly (1 | 2)[],
    ) {}

    /** Adds the bits of the next tick */
    public push(tick: number, bits: number): void {
        if (this.first_tick < 0) this.first_tick = tick;
        if (this.count === this.bits.length) {
            const grown = new Uint16Array(this.bits.length * 2);
            grown.set(this.bits);
            this.bits = grown;
        }
        this.bits[this.count++] = bits;
    }

    /** The last tick recorded */
    public get last_tick(): number {
        return this.first_tick + this.count - 1;
    }

    /** The bits of a tick; 0 for a tick that is not recorded */
    public at(tick: number): number {
        const index = tick - this.first_tick;
        return this.first_tick < 0 || index < 0 || index >= this.count ? 0 : this.bits[index];
    }

    public has(tick: number, condition: HandCondition): boolean {
        const bits = this.at(tick);
        return (bits & CONDITION_BITS[condition]) !== 0 || (condition === "item_there" && (bits & TOOK) !== 0);
    }

    public windowOpen(tick: number): boolean {
        return (this.at(tick) & WINDOW) !== 0;
    }

    /** Whether the hand took items in the tick, and from which lane: null where it took none, 0 where no lane says so */
    public tookFrom(tick: number): 0 | 1 | 2 | null {
        const bits = this.at(tick);
        if ((bits & TOOK) === 0) return null;
        return (bits & TOOK_FROM_LANE[0]) !== 0 ? 1 : (bits & TOOK_FROM_LANE[1]) !== 0 ? 2 : 0;
    }

    /** Whether an empty hand took its first items in the tick */
    public startsIn(tick: number): boolean {
        return (this.at(tick) & START) !== 0;
    }

    /** Whether the reach on the lane moved in the tick, which is read only while the window is open */
    public movedAt(tick: number, lane: 1 | 2): boolean {
        return (this.at(tick) & MOVED_AT_LANE[lane - 1]) !== 0;
    }

    /** Whether the reach on the lane held a stack the hand can take in the tick */
    public itemOn(tick: number, lane: 1 | 2): boolean {
        return (this.at(tick) & ITEM_ON_LANE[lane - 1]) !== 0;
    }

    /** Whether the hand holds what it swings: a full hand, or a part hand of an inserter that swings part hands */
    public onItsWay(tick: number): boolean {
        return (this.at(tick) & ON_ITS_WAY) !== 0;
    }
}

/** Whether an inserter of the config takes the lane's item, by its filters */
function takesItem(inserter: Config["inserters"][number], item: string): boolean {
    return inserter.filters === undefined || inserter.filters.length === 0
        || (inserter.filter_mode === "blacklist" ? !inserter.filters.includes(item) : inserter.filters.includes(item));
}

/** How many recorders were put into runs, for a test that the log off puts none in */
export const handConditionRecorders = { made: 0 };

/** The bits of one tick from what the recorder reads of one taker */
interface Watched {
    record: TakerConditions;
    inserter: InserterArchetype;
    lanes: { lane: 1 | 2; item: string; stock: BeltPickupStock; positions: Set<number> | null; read_at: number }[];
    held: number;
}

const ARM_AWAY: ReadonlySet<InserterPhase> = new Set([InserterPhase.SWING, InserterPhase.DROP, InserterPhase.TARGET_FULL]);

/**
 * Puts the recorder of the four conditions into a run's context before its first tick, after the run's lanes are in
 * place: one record for each inserter of each copy named in `takers` ("copy|inserter:n") that takes from a belt. It reads,
 * in each tick after the inserters' update and before the machines' update:
 * - the window from the control asked for this tick (`enabledIn(0)`), only for a control that answers for ticks ahead,
 *   which asking does not move on; for any other control every tick counts as open (`window_read` false);
 * - the hand's phase, and what it holds;
 * - the sink through the hand's drop port: what the inserters left of it in this tick, before the machines' update;
 * - each reach through its pickup stock (`peek`, `snapshot`), which the inserters have brought to this tick already, and
 *   whether the hand took from it in this tick (`hasTakenAt`).
 * A hand reads its sink and its reach at its own update, before the inserters updated after it in the tick: the record
 * can differ from what the hand saw by what those inserters did.
 */
export function recordHandConditions(context: SimulationContext, config: Config, takers: ReadonlySet<string>): () => TakerConditions[] {
    handConditionRecorders.made++;
    const now = () => context.tick_provider.getCurrentTick();
    const watched: Watched[] = [];
    for (const archetype of context.inserters) {
        const number = archetype.entity_id.number;
        const copy = Math.floor(number / COPY_NUMBER_STRIDE);
        const inserter_id = EntityId.forInserter(number % COPY_NUMBER_STRIDE).id;
        if (!takers.has(`${copy}|${inserter_id}`)) continue;
        const inserter = archetype.inserter_state.inserter;
        const source = context.state_registry.getStateByEntityIdOrThrow(inserter.source.entity_id);
        if (!EntityState.isBelt(source)) continue;
        const belt = config.belts.find(it => it.id === inserter.source.entity_id.number % COPY_NUMBER_STRIDE);
        const of_config = config.inserters.find((it, index) => EntityId.forInserter(it.id ?? index + 1).id === inserter_id);
        const lanes: Watched["lanes"] = [];
        (source.pickupsOf(archetype.entity_id.id) ?? []).forEach((stock, index) => {
            const item = belt?.lanes[index]?.ingredient;
            if (stock === undefined || item === undefined || item === "" || (of_config !== undefined && !takesItem(of_config, item))) return;
            lanes.push({ lane: (index + 1) as 1 | 2, item, stock, positions: null, read_at: -1 });
        });
        const record = new TakerConditions(copy, inserter_id, archetype.control.looks_ahead, lanes.map(it => it.lane));
        watched.push({ record, inserter: archetype, lanes, held: archetype.inserter_state.held_item?.quantity ?? 0 });
    }
    context.after_inserters.push({ tick() {
        const tick = now();
        for (const it of watched) it.record.push(tick, bitsOf(it, tick));
    } });
    return () => watched.map(it => it.record);
}

function bitsOf(it: Watched, tick: number): number {
    const archetype = it.inserter;
    const state = archetype.inserter_state;
    const hand = archetype.hand;
    const control = archetype.control;
    let bits = 0;
    const open = control.looks_ahead ? control.enabledIn(0) : true;
    if (open) bits |= WINDOW;
    if (!ARM_AWAY.has(hand.phase)) bits |= AT_SOURCE;
    const held = state.held_item;
    const quantity = held?.quantity ?? 0;
    if (held !== null && quantity > it.held) {
        bits |= TOOK;
        if (it.held === 0) bits |= START;
    }
    it.held = quantity;
    if (held !== null && quantity > 0 && (quantity >= handSizeFor(state.inserter, held.item_name) || hand.swings_part_hands)) bits |= ON_ITS_WAY;
    if (held !== null && quantity > 0 ? hand.drop.takes(held.item_name) : hand.drop.acceptsHand()) bits |= ROOM;
    for (const lane of it.lanes) {
        const index = lane.lane - 1;
        const took = lane.stock.hasTakenAt(tick);
        if (took) bits |= TOOK_FROM_LANE[index];
        const of_hand = held === null || quantity === 0 || held.item_name === lane.item;
        if (of_hand && (took || lane.stock.peek(tick) !== undefined)) bits |= ITEM | ITEM_ON_LANE[index];
        if (open) {
            // the reach moved where a stack stands where none stood in the tick before; a stack taken is no move
            const positions = new Set(lane.stock.snapshot(tick).map(([position]) => position));
            if (lane.positions !== null && lane.read_at === tick - 1 && [...positions].some(position => !lane.positions!.has(position))) bits |= MOVED_AT_LANE[index];
            lane.positions = positions;
            lane.read_at = tick;
        }
    }
    return bits;
}

/** What held at the last open tick of an opening: the condition the hand waited for there, or that it was on its way, or neither */
export type AtClose = HandCondition | "on_its_way" | "left_over";

/** One opening of a taker's window, from its first open tick to its last */
export interface ConditionOpening {
    opens: number;
    closes: number;
    at_close: AtClose;
}

/**
 * What the hand waited for at a tick: the arm away (`hand_at_source`); a hand it swings (`on_its_way`); else the first of
 * room and item that did not hold; else, where it took items, the window (the close cut a hand it was filling); else
 * nothing of the four (`left_over`: the hand could have taken and did not, as on the tick it decides its first stack)
 */
export function waitedFor(record: TakerConditions, tick: number): AtClose {
    if (!record.has(tick, "hand_at_source")) return "hand_at_source";
    if (record.onItsWay(tick)) return "on_its_way";
    if (!record.has(tick, "room_at_sink")) return "room_at_sink";
    if (!record.has(tick, "item_there")) return "item_there";
    return record.tookFrom(tick) !== null ? "window_open" : "left_over";
}

/**
 * The openings of a taker's window from tick `from` up to, not including, `to`: each run of open ticks that starts and ends
 * inside the record, with what the hand waited for at its last open tick
 */
export function openingsOf(record: TakerConditions, from: number, to: number): ConditionOpening[] {
    const openings: ConditionOpening[] = [];
    const first = Math.max(from, record.first_tick + 1), last = Math.min(to, record.last_tick);
    let opens: number | null = null;
    for (let tick = first; tick < last; tick++) {
        const open = record.windowOpen(tick);
        if (open && opens === null && !record.windowOpen(tick - 1)) opens = tick;
        if (open && opens !== null && !record.windowOpen(tick + 1)) {
            openings.push({ opens, closes: tick, at_close: waitedFor(record, tick) });
            opens = null;
        }
    }
    return openings;
}

/** A hand start: an empty hand took its first items; the condition that came last before it, and the lane it took from */
export interface HandStart {
    tick: number;
    /** The lane it took from: 0 where no lane says so */
    lane: 0 | 1 | 2;
    last: HandCondition;
    /** Whether another condition came in the same tick as `last` */
    tied: boolean;
}

/**
 * The tick a condition came for the hand start at `tick`: the first tick of the run of ticks up to `tick` in which it held
 * without a break. A condition that does not hold at the start counts as coming at the start.
 */
function cameAt(record: TakerConditions, condition: HandCondition, tick: number): number {
    if (!record.has(tick, condition)) return tick;
    let came = tick;
    while (came - 1 >= record.first_tick && record.has(came - 1, condition)) came--;
    return came;
}

/** The hand starts of a taker from tick `from` up to, not including, `to`, each with its last condition (ties in `HAND_CONDITIONS` order) */
export function handStartsOf(record: TakerConditions, from: number, to: number): HandStart[] {
    const starts: HandStart[] = [];
    for (let tick = Math.max(from, record.first_tick); tick < Math.min(to, record.last_tick + 1); tick++) {
        if (!record.startsIn(tick)) continue;
        const came = HAND_CONDITIONS.map(condition => cameAt(record, condition, tick));
        const latest = Math.max(...came);
        const index = came.indexOf(latest);
        starts.push({ tick, lane: record.tookFrom(tick) ?? 0, last: HAND_CONDITIONS[index], tied: came.filter(it => it === latest).length > 1 });
    }
    return starts;
}
