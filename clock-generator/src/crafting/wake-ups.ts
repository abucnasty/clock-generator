import { FactorioInserterState } from "../state/factorio-entity-state";
import type { StockRecording } from "./machine-stock";

/**
 * The wake-up lists of the game, and what they cost a build (GOALS.md, goal 2).
 *
 * An inserter with nothing to move goes to sleep on the wake-up list of the machine it waits on. A machine wakes the
 * inserters that put into it when it starts a craft, and the inserters that take from it when it finishes a craft or
 * pays out a productivity bar (`wakeUps` below). A woken inserter looks for something to move, finds nothing or a
 * little, and goes back to sleep: with the debug option `show-wakeup-lists` the yellow line from the
 * inserter to the machine flickers. An inserter its clock has disabled is on no list and is never woken, once it has
 * been updated disabled (one switched off while asleep stays on its list until woken: the rule "kept-lists", `countKeptLists`). A wake-up
 * is one such waking, and what a clock is there to spare a build.
 *
 * The game does not let a mod read its wake-up lists, so they are worked out here from what it does show: the state
 * of each inserter, which names what it waits for, and the products each machine has finished. The same working out
 * serves a simulated run and a recording of the game.
 */

/** The end of an inserter whose machine wakes it */
export type WatchedEnd = "source" | "sink";

/**
 * The list an inserter sleeps on, by the state the game shows for it while it waits: on the machine it takes from
 * while it waits for items, on the machine it puts into while it waits for space. Any other state is on no list.
 *
 * The rule "kept-lists" (`countKeptLists`) also counts the input list of a machine an inserter waiting for items puts
 * into, which wakes it in the game (agricultural science, Factorio 2.1.24).
 */
export const WATCHED_END: Readonly<Record<string, WatchedEnd | undefined>> = {
    [FactorioInserterState.WAITING_FOR_SOURCE_ITEMS]: "source",
    [FactorioInserterState.WAITING_FOR_MORE_ITEMS]: "source",
    [FactorioInserterState.WAITING_FOR_SPACE_IN_DESTINATION]: "sink",
};

/** An inserter of a run, with the machines at its ends */
export interface WatchingInserter {
    inserter_id: string;
    /** The machine it takes from; null when it takes from a belt or a chest */
    source_machine_id: string | null;
    /** The machine it puts into; null when it puts onto a belt or into a chest */
    sink_machine_id: string | null;
    /**
     * The machine that places its results itself into the chest it takes from (that chest is the machine's result
     * target): its placings wake it while it waits there for items. Null or absent for any other source.
     */
    source_placer_id?: string | null;
    /** The state the game shows for it after each tick (`defines.entity_status`) */
    states: readonly string[];
    /**
     * Items in its hand after each tick, and the ticks its arm is away swinging back after a drop that empties the hand
     * (`returnTicksOf`): with both, it is not on a list in those ticks, whatever state the game shows (see `armAway`).
     * Without them every waiting state counts, as before 0.26.0.
     */
    held?: readonly number[];
    return_ticks?: number;
    /**
     * The item in its hand after each tick, "" while empty, and the most its hand holds of an item: with `held` and the
     * outputs of the machine it takes from (`WatchedMachine.outputs`), what the rule "kept-lists" reads a sleep inside a
     * tick from (`countKeptLists`).
     */
    held_item?: readonly string[];
    hand_size_of?: (item_name: string) => number;
    /**
     * For an inserter that drops on a belt: per tick, whether the lane had room for a stack at its drop spot when it was
     * updated in the tick. A part hand goes to sleep only with room there, and stays on the update list without (Factorio
     * 2.1.24: 80 of 80 such takes of a stack inserter with room, none of 50 without). Absent: room.
     */
    drop_room?: readonly boolean[];
    /**
     * For an inserter that takes from the side of a straight belt: the belt lines it takes from, with the inserters whose
     * takes move each (`BeltLineTakers`). Under the rule "kept-lists" an empty hand shown waiting for items that its
     * machine refuses goes to sleep only while every one of them is still. Absent: as before, on a list nothing wakes.
     */
    belt_lines?: readonly BeltLineTakers[];
}

/**
 * A belt line an inserter takes from, and the inserters whose takes move it. A take that empties a stack leaves a gap of
 * one stack (64 units of 1/256 tile) that the line closes at its speed: the line is moving from the take on, and stops in
 * the first tick after the gap is closed (simulation `BeltLineMotion`; 9,658 of 9,658 ticks of line movement on a
 * backed-up turbo belt in Factorio 2.1.24). Worked out from the takers' recorded hands: a rise of the hand by a whole
 * stack or more in a tick is that many stacks emptied (a rise of less than a stack is taken as none).
 */
export interface BeltLineTakers {
    line_id: string;
    /** Units of 1/256 tile the line moves a tick: 8, 16, 24 or 32 */
    speed: number;
    /** Items in a stack on the line */
    stack_size: number;
    /** The inserters that take from this line */
    takers: readonly string[];
}

export interface WatchedMachine {
    machine_id: string;
    /** Crafts finished and productivity bars paid out so far, after each tick: what alarms the inserters that take from it */
    products_finished: readonly number[];
    /**
     * The machine truly started a craft in the tick (consumed its ingredients), per tick: what alarms the inserters that
     * put into it (docs/mechanics D7 a1: a payout wakes no input). From the simulator's own count, or worked out from a
     * recording. Absent when it cannot be known: the rises of `products_finished` then stand in, as they did before
     * 0.13.0, and the machine is named in `true_starts_unknown`.
     */
    true_starts?: readonly boolean[];
    /**
     * Results placed so far where inserters take them, after each tick, for a machine that places its results itself
     * (rule 18): into its result target, else into its own output. What alarms the inserters that take them, in place of
     * `products_finished`: a craft that gives no result wakes none of them (recorded on a recycler on scrap). Absent for
     * any other machine.
     */
    results_placed?: readonly number[];
    /** Items of each result in its output after each tick: read by the rule "kept-lists" (see `countKeptLists`) */
    outputs?: Readonly<Record<string, readonly number[]>>;
    /**
     * Per tick, whether its burner took a fuel item from its fuel slot: alarms the inserters that put into it, under the
     * rule "kept-lists" (`countKeptLists`). Absent for a machine that burns no fuel, or where it is not known.
     */
    fuel_taken?: readonly boolean[];
    /**
     * Per tick, whether an inserter put fuel into its fuel slot: alarms the inserters that take from it, under the rule
     * "kept-lists". Absent where it is not known.
     */
    fuel_put_in?: readonly boolean[];
}

/**
 * Why a machine's alarm, in a tick the game shows the inserter waiting on its list, is not counted as a wake-up: the
 * arm is still swinging back from a drop that emptied its hand ("arm away"), so it is not asleep on the list
 */
export type UncountedWake = "arm away";

export interface InserterWakeUps {
    inserter_id: string;
    /** Times a machine it slept on woke it, a minute: `input_wake_ups_per_minute` and `output_wake_ups_per_minute` */
    wake_ups_per_minute: number;
    /** The wake-ups from the list of the machine it puts into (it was woken as an input of that machine), a minute */
    input_wake_ups_per_minute: number;
    /** The wake-ups from the list of the machine it takes from, or of the machine that places into the chest it takes from, a minute */
    output_wake_ups_per_minute: number;
    /** Alarms in ticks it showed a waiting state that are not counted as wake-ups, a minute, by why (see UncountedWake) */
    uncounted_per_minute: Record<UncountedWake, number>;
    /** Times the machines at its ends woke their lists, a minute: the most it could be woken */
    alarms_per_minute: number;
    /** Share of the ticks the game shows it as enabled */
    enabled_share: number;
    /** Share of the ticks it was enabled and asleep on a list */
    waiting_share: number;
}

export interface WakeUps {
    /** Ticks the count covers */
    ticks: number;
    /** Sum over the inserters, a minute */
    wake_ups_per_minute: number;
    /** Sum over the inserters of the alarms not counted, a minute, by why */
    uncounted_per_minute: Record<UncountedWake, number>;
    inserters: InserterWakeUps[];
    /** Machines without `true_starts`, whose finishes and payouts alarmed their sink lists instead */
    true_starts_unknown: string[];
}

const TICKS_PER_MINUTE = 3600;

/**
 * The ticks, from the one in which a drop empties its hand, after which an inserter's arm is still away: the drop tick
 * and the turn back, `rotation_ticks` (the simulator's ticks a turn, inserter-spec.ts) and one, which is
 * ceil(0.5 / rotation speed) - 1 of the game data: 4 for the legendary stack inserter, which drops in tick d, turns
 * back in d + 1 to d + 3 and picks up again from d + 4. The game shows "waiting for space" on such an arm when the
 * machine it dropped into is full, and it is on no list (cell 02's takers in the game read W W W W F F F W).
 */
export function returnTicksOf(rotation_ticks: number): number {
    return rotation_ticks + 1;
}

/**
 * Whether the arm is away after `tick`: within `return_ticks` of the latest tick at or before it in which the hand fell
 * to empty. A hand that falls but stays above empty (a part hand dropped) waits where it is, and is not away.
 */
export function armAwayOf(held: readonly number[] | undefined, return_ticks: number | undefined): (tick: number) => boolean {
    if (held === undefined || held.length === 0 || return_ticks === undefined || return_ticks <= 0) {
        return () => false;
    }
    let emptied = -Infinity;
    let scanned = 0;
    // called with ticks in rising order
    return tick => {
        for (; scanned <= tick && scanned < held.length; scanned++) {
            if (scanned > 0 && held[scanned] === 0 && held[scanned - 1] > 0) {
                emptied = scanned;
            }
        }
        return tick - emptied < return_ticks;
    };
}

/** The lists an inserter sleeps on under the rule "kept-lists", as bits */
const ON_SOURCE = 1;
const ON_SINK = 2;
/** A list nothing here alarms: a belt's or a chest's (the inserter is asleep, and no machine wakes it) */
const ON_OTHER = 4;

/** What alarms each machine's two lists in a tick, under the rule "kept-lists" (`keptListsAlarms`) */
interface KeptListsAlarms {
    /** Alarms of the machine's input list in the machine's part of the tick: a craft start, a fuel item taken */
    readonly input: ReadonlyMap<string, (tick: number) => boolean>;
    /** Alarms of the machine's input list by an inserter's take from its output, the inserter that took it apart */
    readonly taken: ReadonlyMap<string, readonly { inserter_id: string; held: readonly number[] }[]>;
    /** Alarms of the machine's output list in the machine's part of the tick: a result placed (a finish or a payout) */
    readonly output: ReadonlyMap<string, (tick: number) => boolean>;
    /** Alarms of the machine's output list by an inserter putting fuel in */
    readonly fuel_put_in: ReadonlyMap<string, readonly boolean[]>;
    /** The inserters that put into each machine: a fall of a hand in a tick fuel was put in is the one that put it */
    readonly feeders: ReadonlyMap<string, readonly { inserter_id: string; held: readonly number[] }[]>;
    /** Items in each machine's output after each tick */
    readonly outputs: ReadonlyMap<string, Readonly<Record<string, readonly number[]>>>;
    /**
     * Per inserter, the tick it last joined the update list, after each tick (a first pass of the rule): the game updates
     * the latest joined first, so a take by an inserter that joined before another is made after that one's update
     */
    joined?: ReadonlyMap<string, Int32Array>;
    /** Every inserter's hand after each tick: the takes that move the belt lines (`BeltLineTakers`) */
    readonly hands: ReadonlyMap<string, readonly number[]>;
    /** Per belt line, whether it is moving in each tick after the belt's part of it (`lineMovingOf`), worked out once */
    readonly line_moving: Map<string, Uint8Array>;
}

/**
 * Whether a belt line is moving in each tick after the belt's part of it, before the inserters: a moving line closes its
 * gap by its speed, and stops in the first tick no gap is left; the takes of a tick then add a stack of gap each
 */
function lineMovingOf(line: BeltLineTakers, hands: ReadonlyMap<string, readonly number[]>, to_tick: number): Uint8Array {
    const moving = new Uint8Array(Math.max(1, to_tick));
    const held = line.takers.flatMap(id => { const hand = hands.get(id); return hand === undefined ? [] : [hand]; });
    let gap = 0, linked = false;
    for (let tick = 1; tick < to_tick; tick++) {
        if (linked) {
            if (gap > 0) gap = Math.max(0, gap - line.speed);
            else linked = false;
        }
        moving[tick] = linked ? 1 : 0;
        for (const hand of held) {
            const stacks = Math.floor((hand[tick] - hand[tick - 1]) / line.stack_size);
            if (stacks > 0) {
                gap += 64 * stacks;
                linked = true;
            }
        }
    }
    return moving;
}

function keptListsAlarms(inserters: readonly WatchingInserter[], machines: readonly WatchedMachine[]): KeptListsAlarms {
    const input = new Map<string, (tick: number) => boolean>();
    const output = new Map<string, (tick: number) => boolean>();
    const fuel_put_in = new Map<string, readonly boolean[]>();
    for (const machine of machines) {
        const id = machine.machine_id;
        const starts = machine.true_starts;
        const fuel = machine.fuel_taken;
        // without true starts its finishes and payouts stand in
        const results = machine.products_finished;
        const start: (tick: number) => boolean = starts !== undefined ? tick => starts[tick] : tick => results[tick] > results[tick - 1];
        input.set(id, fuel === undefined ? start : tick => start(tick) || fuel[tick]);
        const placings = machine.results_placed ?? results;
        output.set(id, tick => placings[tick] > placings[tick - 1]);
        if (machine.fuel_put_in !== undefined) {
            fuel_put_in.set(id, machine.fuel_put_in);
        }
    }
    const taken = new Map<string, { inserter_id: string; held: readonly number[] }[]>();
    for (const inserter of inserters) {
        if (inserter.source_machine_id !== null && inserter.held !== undefined) {
            const list = taken.get(inserter.source_machine_id) ?? [];
            list.push({ inserter_id: inserter.inserter_id, held: inserter.held });
            taken.set(inserter.source_machine_id, list);
        }
    }
    const feeders = new Map<string, { inserter_id: string; held: readonly number[] }[]>();
    for (const inserter of inserters) {
        if (inserter.sink_machine_id !== null && inserter.held !== undefined) {
            const list = feeders.get(inserter.sink_machine_id) ?? [];
            list.push({ inserter_id: inserter.inserter_id, held: inserter.held });
            feeders.set(inserter.sink_machine_id, list);
        }
    }
    const outputs = new Map(machines.flatMap(machine => machine.outputs === undefined ? [] : [[machine.machine_id, machine.outputs] as const]));
    const hands = new Map(inserters.flatMap(inserter => inserter.held === undefined ? [] : [[inserter.inserter_id, inserter.held] as const]));
    return { input, taken, output, fuel_put_in, feeders, outputs, hands, line_moving: new Map() };
}

/** The part of a tick an inserter joins the update list in: by another inserter's alarm, a machine's, its clock's switch-on */
const JOIN_INSERTERS = 0;
const JOIN_MACHINES = 1;
const JOIN_SWITCH_ON = 2;
/** When an inserter joined the update list, ordered: a later key is updated earlier in the next ticks */
function joinKey(tick: number, part: number): number {
    return tick * 4 + part;
}

/** `keptListsAlarms` with the ticks each inserter joined the update list, from a first pass that has every take after */
function keptListsAlarmsInOrder(inserters: readonly WatchingInserter[], machines: readonly WatchedMachine[], to_tick: number): KeptListsAlarms {
    const first_pass = keptListsAlarms(inserters, machines);
    const joined = new Map(inserters.map(inserter => {
        const joins = new Int32Array(Math.max(1, to_tick)).fill(-1);
        countKeptLists(inserter, first_pass, to_tick, to_tick, undefined, (tick, _lists, _awake, last_join) => { joins[tick] = last_join; });
        return [inserter.inserter_id, joins] as const;
    }));
    return { ...first_pass, joined };
}

/**
 * The rule "kept-lists" for one inserter: the lists it is on, worked out tick by tick from the start of the run, from
 * what was read in the running game (Factorio 2.1.24, three builds:
 * a stack inserter taking from an electromagnetic plant onto a belt, the sample electromagnetic science build, the
 * sample agricultural science build; it gives the game's wake-ups by a machine tick for tick on the first two, and on
 * the third all of them and 7 more in ten periods, `wake-ups.test.ts`):
 * - **A sleep.** An inserter on the update list goes to sleep in its own update when it finds nothing to do: waiting
 *   for room in a machine, on that machine's input list; waiting for items, on the list of the machine it takes from,
 *   and, from a machine into a machine, also on the input list of the one it puts into when its hand took part of a
 *   hand in that update, or is empty while there were items to take (the machine it puts into refused them). What it waits for is read off the state
 *   it shows after the tick before, where that was a wait and its hand has not changed, else after the tick (that is
 *   read after the machines' part of the tick). A taker that shows working read off its hand (on the update list when
 *   the tick began, its arm at home, its hand not fallen and not full, room at a belt it drops on: `drop_room`). An
 *   arm still away from a drop, or a hand waiting for room on a belt or in a chest, stays on the update list.
 * - **What wakes a list.** A machine's input list: a craft start, its burner taking a fuel item, another inserter
 *   taking from its output. Its output list: a result (a finish or a payout; a placing for a machine that places its
 *   results itself), an inserter putting fuel in. The first alarm on any of its lists wakes it, also later in the tick
 *   it went to sleep in: always by a machine, and by another inserter's take or fuel when that one is updated after it.
 *   The game updates first the inserter that joined the update list last (`joinKey`): by an inserter's alarm, then by
 *   a machine's, then by its clock's switch-on; of two switched on in one tick the other first, of two woken in one
 *   part of a tick this one first (the 7 above are of this kind: the game updates its machines in an order a
 *   recording does not hold).
 * - **A switch-off sends no alarm.** An inserter switched off while asleep keeps its lists, input or output side,
 *   until an alarm wakes it; the update that brings finds it disabled and leaves it on no list, once a full hand is
 *   dropped and its arm is back.
 * A clock's switch-on wakes an inserter too, and is left out here by design (the clock is there to make it).
 *
 * Run from the first tick of the run, so that a list kept from before `first` counts; counted from `first`.
 */
function countKeptLists(inserter: WatchingInserter, alarms: KeptListsAlarms, first: number, to_tick: number, on_wake?: WakeListener,
    trace?: (tick: number, lists: number, awake: boolean, last_join: number) => void):
    { woken_at_sink: number; woken_at_source: number; woken: number; away: number; alarms: number; enabled: number; waiting: number } {
    const OFF = FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR;
    const { states, source_machine_id: source, sink_machine_id: sink } = inserter;
    const held = inserter.held ?? [];
    const held_item = inserter.held_item;
    const hand_size = inserter.hand_size_of;
    const armAway = armAwayOf(inserter.held, inserter.return_ticks);
    const source_output = source === null ? undefined : alarms.outputs.get(source);
    const source_items = source_output === undefined ? [] : Object.values(source_output);
    // what alarms its two lists in a tick, in the machines' part of the tick and by another inserter
    const sink_alarm = sink === null ? undefined : alarms.input.get(sink);
    const sink_takers = sink === null ? [] : (alarms.taken.get(sink) ?? []).filter(it => it.inserter_id !== inserter.inserter_id);
    const source_alarm = source === null
        ? (inserter.source_placer_id ? alarms.output.get(inserter.source_placer_id) : undefined)
        : alarms.output.get(source);
    const source_fuel = source === null ? undefined : alarms.fuel_put_in.get(source);
    const takenBy = (tick: number) => sink_takers.some(it => it.held[tick] > it.held[tick - 1]);
    const sinkAlarmed = (tick: number) => sink_alarm !== undefined && (sink_alarm(tick) || takenBy(tick));
    const sourceAlarmed = (tick: number) => source_alarm !== undefined && (source_alarm(tick) || source_fuel?.[tick] === true);
    // after its own update in the tick: the machines' part of the tick, and a take by an inserter updated after it: the
    // game updates the inserter that joined the update list last first (`joinKey`); of two switched on in one tick, the
    // other first (agricultural science: 81 of 81), of two woken in one part of a tick, this one first (5 of 5)
    const joined = alarms.joined;
    const taker_joins = sink_takers.map(it => joined?.get(it.inserter_id));
    let last_join = -1;
    const updatedAfter = (join: number) => join < last_join || join === last_join && last_join % 4 !== JOIN_SWITCH_ON;
    const takenAfter = (tick: number) => sink_takers.some((it, index) => it.held[tick] > it.held[tick - 1]
        && (taker_joins[index] === undefined || updatedAfter(taker_joins[index]![tick - 1])));
    const source_feeders = source === null ? [] : (alarms.feeders.get(source) ?? []).filter(it => it.inserter_id !== inserter.inserter_id);
    const feeder_joins = source_feeders.map(it => joined?.get(it.inserter_id));
    const fuelPutInAfter = (tick: number) => source_fuel?.[tick] === true && source_feeders.some((it, index) => it.held[tick] < it.held[tick - 1]
        && (feeder_joins[index] === undefined || updatedAfter(feeder_joins[index]![tick - 1])));
    // the other takers of its source, and what those updated before it took in the tick
    const source_takers = source === null ? [] : (alarms.taken.get(source) ?? []).filter(it => it.inserter_id !== inserter.inserter_id);
    const source_taker_joins = source_takers.map(it => joined?.get(it.inserter_id));
    const takenBefore = (tick: number) => {
        let items = 0;
        for (let index = 0; index < source_takers.length; index++) {
            const it = source_takers[index], join = source_taker_joins[index];
            if (it.held[tick] > it.held[tick - 1] && join !== undefined && !updatedAfter(join[tick - 1])) items += it.held[tick] - it.held[tick - 1];
        }
        return items;
    };
    const placedAfter = (tick: number) => held_item === undefined || held_item[tick] === "" ? source_items.some(series => series[tick] > 0)
        : (source_output?.[held_item[tick]]?.[tick] ?? 0) > 0;
    // when it was updated: what the tick before left, less what the takers updated before it took
    const sourceHadItems = (tick: number) => source_items.reduce((sum, series) => sum + series[tick - 1], 0) > takenBefore(tick);
    const full = (tick: number) => held_item !== undefined && hand_size !== undefined && held_item[tick] !== "" && held[tick] >= hand_size(held_item[tick]);

    // the belt lines it takes from, each moving after the belt's part of a tick, and their takers updated before it
    const belt_lines = (inserter.belt_lines ?? []).map(line => {
        let moving = alarms.line_moving.get(line.line_id);
        if (moving === undefined) alarms.line_moving.set(line.line_id, moving = lineMovingOf(line, alarms.hands, to_tick));
        const takers = line.takers.filter(id => id !== inserter.inserter_id).flatMap(id => {
            const hand = alarms.hands.get(id);
            return hand === undefined ? [] : [{ hand, join: joined?.get(id) }];
        });
        return { moving, takers, stack_size: line.stack_size };
    });
    /** Whether a belt line it takes from is moving when it is updated in the tick: after the belt's part, or set moving by a take before it */
    const lineMovingAt = (tick: number): boolean => belt_lines.some(line => line.moving[tick] === 1 || line.takers.some(({ hand, join }) =>
        hand[tick] - hand[tick - 1] >= line.stack_size && join !== undefined && !updatedAfter(join[tick - 1])));

    /** The lists of a sleep in its own update in the tick, waiting for items at its source (bits) */
    const waitingForItems = (tick: number): number => {
        // an empty hand from a belt into a machine that refuses what it would take: asleep on the machine's input list (and
        // the belt lines', which nothing here wakes) only while every line is still; else it stays on the update list
        if (belt_lines.length > 0 && source === null && sink !== null && held[tick] === 0) {
            return lineMovingAt(tick) ? 0 : ON_SINK | ON_OTHER;
        }
        const picked = held[tick] > held[tick - 1];
        let lists = source !== null || inserter.source_placer_id ? ON_SOURCE : 0;
        // with a machine at both ends (agricultural science); from a belt or a chest the rule cannot tell what is there
        if (sink !== null && source !== null && (held[tick] === 0 ? sourceHadItems(tick) : picked)) {
            lists |= ON_SINK;
        }
        return lists === 0 ? ON_OTHER : lists;
    };
    /** The lists it went to sleep on in its own update in the tick, 0 when it stays on the update list */
    const sleepOf = (tick: number): number => {
        if (armAway(tick)) {
            return 0;
        }
        // what it waits for when it is updated: its state after the tick before where that was a wait and its hand has not
        // changed since (the state after this tick is read after the machines', whose results change what it shows)
        const shown = states[tick] === OFF || WATCHED_END[states[tick - 1]] !== undefined && held[tick] === held[tick - 1]
            ? states[tick - 1] : states[tick];
        const end = WATCHED_END[shown];
        if (end === "sink") {
            // waiting for room on a belt or in a chest: it stays on the update list (a hand that drops on a belt goes on
            // dropping as the belt makes room; front-exit build, 2.1.24)
            return sink !== null ? ON_SINK : 0;
        }
        if (end === "source") {
            // a hand that fell or is full is on its way to the drop
            return held[tick] < held[tick - 1] || full(tick) ? 0 : waitingForItems(tick);
        }
        return 0;
    };
    /** The lists of a sleep in its own update read off its hand, for an inserter that takes from a machine (or 0) */
    const takerSleep = (tick: number): number =>
        source === null || inserter.held === undefined || held_item === undefined || hand_size === undefined || held[tick] < held[tick - 1] || full(tick) || inserter.drop_room?.[tick] === false || armAway(tick) ? 0 : waitingForItems(tick);
    /** The list alarmed after its own update in the tick, of those it went to sleep on in it, and the part of the tick */
    let woke_in = JOIN_MACHINES;
    const alarmedAfter = (slept: number, tick: number): WatchedEnd | null => {
        if ((slept & ON_SINK) !== 0 && takenAfter(tick)) {
            woke_in = JOIN_INSERTERS;
            return "sink";
        }
        if ((slept & ON_SOURCE) !== 0 && fuelPutInAfter(tick)) {
            woke_in = JOIN_INSERTERS;
            return "source";
        }
        woke_in = JOIN_MACHINES;
        if ((slept & ON_SOURCE) !== 0 && source_alarm !== undefined && source_alarm(tick) && placedAfter(tick)) {
            return "source";
        }
        if ((slept & ON_SINK) !== 0 && sink_alarm !== undefined && sink_alarm(tick)) {
            return "sink";
        }
        return null;
    };

    let lists = 0;
    let awake = states[0] !== OFF;
    let woken_at_sink = 0, woken_at_source = 0, away = 0, alarm_count = 0, enabled = 0, waiting = 0;
    for (let tick = 1; tick < to_tick; tick++) {
        const counting = tick >= first;
        const updated_off = states[tick - 1] === OFF;
        let woke: WatchedEnd | null = null;
        if (lists !== 0) {
            // asleep when the tick began: the first alarm on one of its lists wakes it, an inserter's before a machine's
            woke_in = JOIN_INSERTERS;
            if ((lists & ON_SINK) !== 0 && takenBy(tick)) {
                woke = "sink";
            } else if ((lists & ON_SOURCE) !== 0 && source_fuel?.[tick] === true) {
                woke = "source";
            } else {
                woke_in = JOIN_MACHINES;
                if ((lists & ON_SINK) !== 0 && sink_alarm !== undefined && sink_alarm(tick)) {
                    woke = "sink";
                } else if ((lists & ON_SOURCE) !== 0 && source_alarm !== undefined && source_alarm(tick)) {
                    woke = "source";
                }
            }
            if (woke !== null || held[tick] !== held[tick - 1]) {
                // woken, or its hand moved: on the update list again (a list nothing here reads, a belt's, woke it)
                lists = 0;
                awake = true;
            }
        } else if (awake) {
            if (updated_off) {
                // an update that finds it disabled leaves it on no list, once a full hand is dropped and the arm is back
                awake = armAway(tick) || full(tick);
            } else if (WATCHED_END[states[tick]] !== undefined) {
                // shown waiting after its update: asleep, unless its arm is still away, and woken again by an alarm later in
                // the tick
                const slept = sleepOf(tick);
                if (slept !== 0) {
                    woke = alarmedAfter(slept, tick);
                    if (woke === null) {
                        lists = slept;
                        awake = false;
                    }
                }
            } else {
                // shown working, or switched off at the end of the tick: a sleep in its own update is read off the state
                // before (switched off) or its hand (a taker); a machine's alarm later in the tick wakes it again
                let slept = states[tick] === OFF ? sleepOf(tick) : 0;
                if (slept === 0) {
                    slept = takerSleep(tick);
                }
                if (slept !== 0) {
                    woke = alarmedAfter(slept, tick);
                    if (woke === null && states[tick] === OFF) {
                        // switched off asleep: a switch-off alarms nobody, so it keeps its lists
                        lists = slept;
                        awake = false;
                    }
                }
            }
        }
        if (updated_off && states[tick] !== OFF) {
            // switched on: the switch-on wakes it, and is left out (the clock's doing)
            lists = 0;
            awake = true;
            last_join = joinKey(tick, JOIN_SWITCH_ON);
        } else if (woke !== null) {
            last_join = joinKey(tick, woke_in);
        }
        trace?.(tick, lists, awake, last_join);
        if (counting) {
            // an alarm in a tick it showed a wait with its arm away after the tick before: not on a list, kept apart
            const shown_end = WATCHED_END[states[tick - 1]];
            if (shown_end !== undefined && armAway(tick - 1) && (shown_end === "sink" ? sinkAlarmed(tick) : sourceAlarmed(tick))) away++;
            if (woke === "sink") woken_at_sink++;
            if (woke === "source") woken_at_source++;
            if (woke !== null) on_wake?.(inserter.inserter_id, tick, woke);
            alarm_count += (sourceAlarmed(tick) ? 1 : 0) + (sinkAlarmed(tick) ? 1 : 0);
            if (states[tick] !== OFF) {
                enabled++;
                if (WATCHED_END[states[tick]] !== undefined) waiting++;
            }
        }
    }
    return { woken_at_sink, woken_at_source, woken: woken_at_sink + woken_at_source, away, alarms: alarm_count, enabled, waiting };
}

/** Called once for each wake-up counted, with the tick it happens in and the end whose machine woke the inserter */
export type WakeListener = (inserter_id: string, tick: number, end: WatchedEnd) => void;

/**
 * Wake-ups of every inserter over the ticks `from_tick` (inclusive) to `to_tick` (exclusive) of a run.
 *
 * A machine wakes the inserters that were asleep on its list when the tick began, so the state of an inserter after
 * the tick before decides whether it is woken, and once in that tick at most. What wakes which list (factorio-benchmarks
 * docs/mechanics, machines.md D7): the inserters that take from a machine are woken when it finishes a craft or pays
 * out a productivity bar (D7 b, part hands); the inserters that put into a machine are woken when it starts a craft,
 * consuming its ingredients, and not by a payout (D7 a1, confirmed on two designs of one machine type, the advanced
 * circuit electromagnetic plant; other machine types untested). Before 0.13.0 both lists were woken by finishes and
 * payouts. A machine that places its results itself wakes the inserters that take them when it places one, into its own
 * output or into its result target (a chest), and not when a craft gives none (rule 18; recorded on a recycler on scrap,
 * 2.1.21: a stack inserter waiting with a part hand showed working in each of 1,708 ticks a result of another item came,
 * and in none of 1,198 in which a craft gave nothing). Any other belt and chest finishes no crafts and wakes no one here.
 * An inserter whose arm is away, swinging back from a drop that emptied its hand, is on no list whatever state it shows
 * (since 0.26.0, where the hand and the turn are given): those alarms are kept apart (`uncounted_per_minute`).
 * The rule "kept-lists" (`countKeptLists`) works out the lists each inserter is on.
 */
export function wakeUps(
    inserters: readonly WatchingInserter[],
    machines: readonly WatchedMachine[],
    from_tick: number,
    to_tick: number,
    on_wake?: WakeListener,
): WakeUps {
    const first = Math.max(1, from_tick);
    const ticks = Math.max(0, to_tick - first);
    const true_starts_unknown = machines.filter(machine => machine.true_starts === undefined).map(machine => machine.machine_id);
    const per_minute = (count: number) => ticks === 0 ? 0 : count * TICKS_PER_MINUTE / ticks;
    const share = (count: number) => ticks === 0 ? 0 : count / ticks;

    const kept_alarms = keptListsAlarmsInOrder(inserters, machines, to_tick);
    const counted = inserters.map(inserter =>
        ({ inserter_id: inserter.inserter_id, ...countKeptLists(inserter, kept_alarms, first, to_tick, on_wake) }));

    return {
        ticks,
        wake_ups_per_minute: per_minute(counted.reduce((sum, it) => sum + it.woken, 0)),
        uncounted_per_minute: { "arm away": per_minute(counted.reduce((sum, it) => sum + it.away, 0)) },
        inserters: counted.map(it => ({
            inserter_id: it.inserter_id,
            wake_ups_per_minute: per_minute(it.woken),
            input_wake_ups_per_minute: per_minute(it.woken_at_sink),
            output_wake_ups_per_minute: per_minute(it.woken_at_source),
            uncounted_per_minute: { "arm away": per_minute(it.away) },
            alarms_per_minute: per_minute(it.alarms),
            enabled_share: share(it.enabled),
            waiting_share: share(it.waiting),
        })),
        true_starts_unknown,
    };
}

/** Per tick, whether a running total rose in it */
function rises(totals: readonly number[]): boolean[] {
    return totals.map((total, tick) => tick > 0 && total > totals[tick - 1]);
}

/** The machine ids at the ends of an inserter, as the stock of a run names its machines */
export interface InserterEnds {
    inserter_id: string;
    source_machine_id: string | null;
    sink_machine_id: string | null;
    /** The machine whose result target the inserter takes from (see WatchingInserter) */
    source_placer_id?: string | null;
    /** The ticks its arm is away after a drop that empties its hand (see WatchingInserter, returnTicksOf) */
    return_ticks?: number;
    /** The most its hand holds of an item (see WatchingInserter) */
    hand_size_of?: (item_name: string) => number;
    /** The belt lines it takes from (see WatchingInserter) */
    belt_lines?: readonly BeltLineTakers[];
}

/**
 * Wake-ups of a simulated run, from the tick `from_tick` to its end. The rule "kept-lists" reads the items in the hands
 * and in the machines' outputs where the stock recorded them (`StockRecorder`, "wake-ups").
 */
export function wakeUpsOfStock(stock: StockRecording, ends: readonly InserterEnds[], from_tick: number, on_wake?: WakeListener): WakeUps {
    const recorded = new Map(stock.inserters.map(series => [series.inserter_id, series]));
    const inserters = ends.flatMap(end => {
        const series = recorded.get(end.inserter_id);
        return series === undefined ? [] : [{
            ...end, states: series.factorio_state, held: series.held,
            ...(series.held_item.length > 0 && { held_item: series.held_item }),
            ...(series.drop_room !== undefined && { drop_room: series.drop_room }),
        }];
    });
    const machines: WatchedMachine[] = stock.machines.map(machine => ({
        machine_id: machine.machine_id,
        products_finished: machine.products_finished,
        true_starts: machine.crafts_started.map((started, tick) => tick > 0 && started > machine.crafts_started[tick - 1]),
        ...(machine.results_placed !== undefined && { results_placed: machine.results_placed }),
        ...(Object.keys(machine.outputs).length > 0 && { outputs: machine.outputs }),
        ...(machine.fuel_taken !== undefined && { fuel_taken: rises(machine.fuel_taken) }),
        ...(machine.fuel_put_in !== undefined && { fuel_put_in: rises(machine.fuel_put_in) }),
    }));
    return wakeUps(inserters, machines, from_tick, stock.ticks, on_wake);
}
