import { FactorioBlueprint } from "../blueprints/blueprint";
import { Config } from "../config";
import { Entity, EntityId, handSizeFor, Inserter } from "../entities";
import { FactorioInserterState } from "../state/factorio-entity-state";
import { StockRecording } from "./machine-stock";
import { createEntityRegistryFromConfig } from "./sequence/simulation-context";
import { armAwayOf, InserterEnds, returnTicksOf, WakeUps, WATCHED_END, wakeUpsOfStock } from "./wake-ups";

/**
 * Per-inserter counters of a clock, reported beside its wake-ups (`as_built.counters`, next to `as_built.wake_ups`).
 *
 * They count, from the same recording and over the same ticks as the wake-ups, what an inserter does and what it costs
 * the game besides being woken: the grabs and swings of its hand, the states it waits in and at which end, the edges of
 * its clock, and the crafts that joined a grab instead of waking it. The selection ranks the clocks by the cost priced
 * from them (`clockCost`, rank.ts: the wake-ups by list, the belt pickups' waits, the switch-ons, the wired inserters,
 * the deciders and the craft starts of the machines that wake them); no verdict or window reads them.
 *
 * Every count is a minute (3600 ticks) over the ticks counted, as `wakeUps` gives its own.
 */

/** What is at one end of an inserter, by the entity it takes from or puts into */
export type EndKind = "belt" | "machine" | "chest";

/** Ticks a minute an enabled inserter waited at one end of it, and what that end is */
export interface WaitAtEnd {
    /** The end it waits at: the source for items, the sink for space */
    end: "source" | "sink";
    /** What is at that end */
    kind: EndKind;
    ticks_per_minute: number;
}

export interface InserterCount {
    inserter_id: string;
    /** What it takes from: the type of its source entity */
    pickup_kind: EndKind;
    /** For a pickup from a belt: whether the config's belts move (`overrides.backed_up_belts` not set) or are backed up */
    belt_supply?: "moving" | "backed-up";
    /** What it puts into: the type of its sink entity */
    drop_kind: EndKind;

    /** Wake-ups from the list of the machine it puts into, a minute (as `InserterWakeUps.input_wake_ups_per_minute`) */
    input_wake_ups_per_minute: number;
    /** Wake-ups from the list of the machine it takes from, or of the machine placing into its chest, a minute */
    output_wake_ups_per_minute: number;

    /** Ticks a minute the game shows it working (any of its swing) */
    working_ticks_per_minute: number;
    /** Ticks a minute it was enabled and waiting for items ("waiting for source items" or "for more items"), at its source */
    waiting_for_items: WaitAtEnd;
    /** Ticks a minute it was enabled and waiting for space in its destination, at its sink */
    waiting_for_space: WaitAtEnd;

    /** Ticks a minute in which its hand grew */
    grabs_per_minute: number;
    /**
     * Times a minute its hand fell to empty: one drop that empties the hand is one swing (a part hand dropped, which
     * stays above empty, is not yet the end of one)
     */
    swings_per_minute: number;
    /** Swings a minute that left with fewer items than its hand holds (the largest `handSizeFor` of the items it carries) */
    part_hand_swings_per_minute: number;
    /** Grabs a minute beyond the first of each swing that ended */
    extra_grabs_per_minute: number;

    /** Times a minute its clock switched it on (the game shows it as not disabled after a tick it was) */
    switch_ons_per_minute: number;
    /** Times a minute its clock switched it off */
    switch_offs_per_minute: number;
    /** Of the switch-ons, those that found its arm at rest: hand empty and the arm not away (`armAwayOf`), a minute */
    switch_ons_at_rest_per_minute: number;
    /** Of the switch-ons, those that found its arm still moving (a hand, or the turn back from a drop), a minute */
    switch_ons_moving_per_minute: number;
    /**
     * The inserters wired to the window decider that switches this one, times the copies of the build, each of which has
     * a decider-wired copy of it; 0 for an inserter nothing switches. The widest decider of the inserter where it is
     * wired to more than one. Null until the blueprint of the clock is known (`withNetwork`, filled by the alternative).
     */
    network_width: number | null;

    /**
     * For an inserter that takes from a machine: crafts a minute of that machine that finished in the tick after one
     * that woke this inserter, while it was still at its pickup, so that they joined the grab it was making and did not
     * wake it again. Counted at each tick t of a wake-up on its source list when the machine's `products_finished` rose
     * at t + 1, the state shown after t was not a waiting one (it was then on no list at t + 1, so no wake-up was counted
     * there) and its phase after t was still the pickup (`InserterHandSeries.at_pickup`: it has grabbed in t and begins
     * the swing in t + 1; the simulator does not take the craft of t + 1 into that hand, the game's count of alarms
     * counts it). Those crafts are what a count of every alarm has more than the wake-ups here. Absent for any other
     * pickup; 0 where the stock has no `at_pickup` series.
     */
    merged_crafts_per_minute?: number;

    /**
     * For an inserter woken from the list of the machine it takes from (or of the machine placing into its chest): the
     * crafts that machine started a tick, on average over the ticks counted (the simulator's true starts,
     * `crafts_started`). What the priced cost reads to tell a busy machine's output wake-ups (`clockCost`, rank.ts).
     * Absent for any other pickup, and where the stock has no `crafts_started` series.
     */
    source_craft_starts_per_tick?: number;
}

export interface InserterCounters {
    /** Ticks the counts cover (as `WakeUps.ticks`) */
    ticks: number;
    /** Inserters with a window: disabled in at least one counted tick */
    wired_inserters: number;
    /** Inserters never disabled: no decider switches them */
    unwired_inserters: number;
    /** Copies of the build the clock is made for (`target_output.copies`) */
    copies: number;
    /** Window deciders of the clock's blueprint (`windowDeciderCount`); null until the blueprint is known (`withNetwork`) */
    deciders: number | null;
    inserters: InserterCount[];
}

/*
 * Left out: `stacks_ahead` of an inserter that takes from a belt (the stacks on the belt before its pickup). The stock
 * of a run records no per-tick series of a belt, and none is recorded for this: the figure would need the lanes of
 * every belt a tick for the length of a long run.
 */

const TICKS_PER_MINUTE = 3600;

/** What an entity type is at the end of an inserter */
function endKindOf(entity_id: EntityId): EndKind {
    return EntityId.isBelt(entity_id) ? "belt" : EntityId.isChest(entity_id) ? "chest" : "machine";
}

/** The inserters of a config: the machines at their ends (as the stock of a run names them) and what else the counters need of them */
export interface CountedInserter extends InserterEnds {
    pickup_kind: EndKind;
    drop_kind: EndKind;
    /** Items in a full hand: the largest of the items it carries */
    hand_size: number;
}

/** The machines at the ends of every inserter of the config, and what is at each of their ends */
export function countedInserters(config: Config): CountedInserter[] {
    const machineId = (entity_id: EntityId) => EntityId.isMachine(entity_id) ? entity_id.id : null;
    const registry = createEntityRegistryFromConfig(config);
    // a chest a machine places its results into is watched through that machine
    const placers = new Map(registry.getAll().filter(Entity.isMachine).flatMap(machine =>
        machine.result_target === undefined ? [] : [[machine.result_target.id, machine.entity_id.id] as const]));
    // a hand of the largest size of the items it carries: the stock does not record which item is in the hand
    const handSize = (inserter: Inserter) => inserter.filtered_items.size === 0 ? inserter.metadata.stack_size
        : Math.max(...Array.from(inserter.filtered_items, item_name => handSizeFor(inserter, item_name)));
    return registry.getAll().filter(Entity.isInserter).map(inserter => ({
        inserter_id: inserter.entity_id.id,
        source_machine_id: machineId(inserter.source.entity_id),
        sink_machine_id: machineId(inserter.sink.entity_id),
        ...(placers.has(inserter.source.entity_id.id) && { source_placer_id: placers.get(inserter.source.entity_id.id)! }),
        return_ticks: returnTicksOf(inserter.animation.rotation.ticks),
        pickup_kind: endKindOf(inserter.source.entity_id),
        drop_kind: endKindOf(inserter.sink.entity_id),
        hand_size: handSize(inserter),
    }));
}

/** The machines at the ends of every inserter of the config (the wake-ups read these) */
export function inserterEnds(config: Config): InserterEnds[] {
    return countedInserters(config).map(({ pickup_kind, drop_kind, hand_size, ...ends }) => ends);
}

/** The wake-ups and the counters of a simulated run, from the tick `from_tick` to its end, of the clock's build */
export function wakeUpsAndCountersOfStock(stock: StockRecording, config: Config, from_tick: number): { wake_ups: WakeUps; counters: InserterCounters } {
    return countersOfStock(stock, countedInserters(config), from_tick,
        { copies: config.target_output.copies ?? 1, backed_up_belts: config.overrides?.backed_up_belts === true });
}

/** `wakeUpsAndCountersOfStock` for inserters already read from the config */
export function countersOfStock(stock: StockRecording, counted: readonly CountedInserter[], from_tick: number,
    build: { copies: number; backed_up_belts: boolean }): { wake_ups: WakeUps; counters: InserterCounters } {
    const recorded = new Map(stock.inserters.map(series => [series.inserter_id, series]));
    const machines = new Map(stock.machines.map(machine => [machine.machine_id, machine]));
    const by_id = new Map(counted.map(inserter => [inserter.inserter_id, inserter]));
    const merged = new Map<string, number>();
    const first = Math.max(1, from_tick);
    const wake_ups = wakeUpsOfStock(stock, counted, from_tick, (inserter_id, tick, end) => {
        if (end !== "source") {
            return;
        }
        const source = machines.get(by_id.get(inserter_id)?.source_machine_id ?? "");
        const series = recorded.get(inserter_id);
        if (source === undefined || series === undefined || tick + 1 >= stock.ticks) {
            return;
        }
        // a craft at t + 1 right after the wake-up at t, while the inserter is at its pickup: it was on no list after t
        // (a hand that waits for more items is on one) and its phase after t is still the pickup
        if (source.products_finished[tick + 1] > source.products_finished[tick]
            && WATCHED_END[series.factorio_state[tick]] === undefined
            && series.factorio_state[tick] !== FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR
            && series.at_pickup?.[tick] === true) {
            merged.set(inserter_id, (merged.get(inserter_id) ?? 0) + 1);
        }
    });
    const woken = new Map(wake_ups.inserters.map(it => [it.inserter_id, it]));
    const ticks = wake_ups.ticks;
    const per_minute = (count: number) => ticks === 0 ? 0 : count * TICKS_PER_MINUTE / ticks;
    const backed_up = build.backed_up_belts;
    // the crafts a tick the machine whose list wakes an inserter at its source started over the ticks counted
    const startsOf = (machine_id: string | null): { source_craft_starts_per_tick?: number } => {
        const started = machine_id === null ? undefined : machines.get(machine_id)?.crafts_started;
        const last = stock.ticks - 1;
        if (started === undefined || started.length < stock.ticks || last < first) {
            return {};
        }
        return { source_craft_starts_per_tick: (started[last] - started[first - 1]) / (last - first + 1) };
    };

    const inserters: InserterCount[] = counted.flatMap(inserter => {
        const series = recorded.get(inserter.inserter_id);
        const wakes = woken.get(inserter.inserter_id);
        if (series === undefined || wakes === undefined) {
            return [];
        }
        const { factorio_state: states, held } = series;
        const armAway = armAwayOf(held, inserter.return_ticks);
        let working = 0;
        let waiting_for_items = 0;
        let waiting_for_space = 0;
        let disabled = 0;
        let switch_ons = 0;
        let switch_offs = 0;
        let ons_at_rest = 0;
        let grabs = 0;
        let swings = 0;
        let part_hand_swings = 0;
        let extra_grabs = 0;
        // the hand of the swing under way: the most it held, and the grabs that filled it
        let peak = held[first - 1] ?? 0;
        let swing_grabs = peak > 0 ? 1 : 0;
        for (let tick = first; tick < stock.ticks; tick++) {
            const state = states[tick];
            const before = states[tick - 1];
            if (state === FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR) {
                disabled++;
                if (before !== FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR) {
                    switch_offs++;
                }
            } else {
                if (before === FactorioInserterState.DISABLED_BY_CONTROL_BEHAVIOR) {
                    switch_ons++;
                    // it finds the arm as the tick before left it
                    if (held[tick - 1] === 0 && !armAway(tick - 1)) {
                        ons_at_rest++;
                    }
                }
                if (state === FactorioInserterState.WORKING) {
                    working++;
                } else if (WATCHED_END[state] === "sink") {
                    waiting_for_space++;
                } else if (WATCHED_END[state] === "source") {
                    waiting_for_items++;
                }
            }
            if (held[tick] > held[tick - 1]) {
                grabs++;
                swing_grabs++;
                peak = Math.max(peak, held[tick]);
            } else if (held[tick] === 0 && held[tick - 1] > 0) {
                swings++;
                if (peak < inserter.hand_size) {
                    part_hand_swings++;
                }
                extra_grabs += Math.max(0, swing_grabs - 1);
                peak = 0;
                swing_grabs = 0;
            }
        }
        return [{
            inserter_id: inserter.inserter_id,
            pickup_kind: inserter.pickup_kind,
            ...(inserter.pickup_kind === "belt" && { belt_supply: backed_up ? "backed-up" as const : "moving" as const }),
            drop_kind: inserter.drop_kind,
            input_wake_ups_per_minute: wakes.input_wake_ups_per_minute,
            output_wake_ups_per_minute: wakes.output_wake_ups_per_minute,
            working_ticks_per_minute: per_minute(working),
            waiting_for_items: { end: "source" as const, kind: inserter.pickup_kind, ticks_per_minute: per_minute(waiting_for_items) },
            waiting_for_space: { end: "sink" as const, kind: inserter.drop_kind, ticks_per_minute: per_minute(waiting_for_space) },
            grabs_per_minute: per_minute(grabs),
            swings_per_minute: per_minute(swings),
            part_hand_swings_per_minute: per_minute(part_hand_swings),
            extra_grabs_per_minute: per_minute(extra_grabs),
            switch_ons_per_minute: per_minute(switch_ons),
            switch_offs_per_minute: per_minute(switch_offs),
            switch_ons_at_rest_per_minute: per_minute(ons_at_rest),
            switch_ons_moving_per_minute: per_minute(switch_ons - ons_at_rest),
            network_width: disabled > 0 ? null : 0,
            ...(inserter.pickup_kind === "machine" && { merged_crafts_per_minute: per_minute(merged.get(inserter.inserter_id) ?? 0) }),
            ...startsOf(inserter.source_machine_id ?? inserter.source_placer_id ?? null),
        }];
    });
    const wired = inserters.filter(it => it.network_width === null).length;
    return {
        wake_ups,
        counters: { ticks, wired_inserters: wired, unwired_inserters: inserters.length - wired, copies: build.copies, deciders: null, inserters },
    };
}

/** The decider combinators of a clock's blueprint that switch inserters and drills on and off */
export function windowDeciderCount(blueprint: FactorioBlueprint): number {
    return blueprint.entities.filter(entity => entity.name === "decider-combinator"
        && ((entity.tags as { clock_generator?: { inserters?: unknown; drills?: unknown } } | undefined)?.clock_generator?.inserters !== undefined
            || (entity.tags as { clock_generator?: { drills?: unknown } } | undefined)?.clock_generator?.drills !== undefined)).length;
}

/**
 * The counters with the network of the window deciders filled in from the blueprint of the clock: each decider the
 * generator makes names the inserters it switches in its tags (`clock_generator.inserters`, ids of the config), and the
 * width of an inserter is the number of inserters its decider switches, times the copies (every copy of the build is
 * wired to its own decider). `deciders` is the count of the alternative (`windowDeciderCount`). Another counters object, the
 * one given is left as it is.
 */
export function withNetwork(counters: InserterCounters, blueprint: FactorioBlueprint, deciders: number): InserterCounters {
    const widest = new Map<string, number>();
    for (const entity of blueprint.entities) {
        const named = entity.name === "decider-combinator"
            ? (entity.tags as { clock_generator?: { inserters?: number[]; drills?: unknown } } | undefined)?.clock_generator : undefined;
        if (named === undefined || (named.inserters === undefined && named.drills === undefined)) {
            continue;
        }
        for (const number of named.inserters ?? []) {
            const id = EntityId.forInserter(number).id;
            widest.set(id, Math.max(widest.get(id) ?? 0, named.inserters!.length));
        }
    }
    return {
        ...counters,
        deciders,
        inserters: counters.inserters.map(it => it.network_width === null ? { ...it, network_width: (widest.get(it.inserter_id) ?? 0) * counters.copies } : it),
    };
}
