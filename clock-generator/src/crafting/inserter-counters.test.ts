import { describe, expect, it } from "vitest";
import { CountedInserter, countersOfStock, withNetwork } from "./inserter-counters";
import { StockRecording } from "./machine-stock";
import { FactorioBlueprint } from "../blueprints/blueprint";

const WORKING = "working";
const SOURCE = "waiting_for_source_items";
const SPACE = "waiting_for_space_in_destination";
const OFF = "disabled_by_control_behavior";

/** A stock of one inserter and one machine, `machine:1`, that finishes a craft in each of `crafts_at` */
function stockOf(states: string[], held: number[], crafts_at: number[] = [], inserter_id = "inserter:1", at_pickup_in: number[] = []): StockRecording {
    let finished = 0;
    const products_finished = states.map((_, tick) => finished += crafts_at.filter(it => it === tick).length);
    return {
        ticks: states.length,
        machines: [{ machine_id: "machine:1", products_finished, crafts_started: states.map(() => 0) }],
        inserters: [{ inserter_id, held, factorio_state: states, at_pickup: states.map((_, tick) => at_pickup_in.includes(tick)) }],
    } as unknown as StockRecording;
}

function inserter(ends: Partial<CountedInserter> = {}): CountedInserter {
    return { inserter_id: "inserter:1", source_machine_id: "machine:1", sink_machine_id: null, return_ticks: 3,
        pickup_kind: "machine", drop_kind: "belt", hand_size: 4, ...ends };
}

const BUILD = { copies: 1, backed_up_belts: false };
const of = (stock: StockRecording, ends?: Partial<CountedInserter>, build = BUILD) => countersOfStock(stock, [inserter(ends)], 0, build);
/** Counts a minute for a count over `ticks` ticks */
const perMinute = (count: number, ticks: number) => count * 3600 / ticks;

describe("inserter counters", () => {
    it("counts grabs, swings, part hand swings and the grabs beyond one a swing from the hand", () => {
        //              0  1  2  3  4  5  6  7  8  9 10 11 12
        const held =   [0, 0, 2, 2, 4, 4, 4, 0, 0, 0, 3, 0, 0];
        const { counters } = of(stockOf(held.map(() => WORKING), held));
        const count = counters.inserters[0];
        // grabs in ticks 2, 4 and 10; the hand falls to empty in ticks 7 and 11
        expect(count.grabs_per_minute).toBe(perMinute(3, 12));
        expect(count.swings_per_minute).toBe(perMinute(2, 12));
        // the swing of the grab to 3 left with fewer than the hand of 4; the first filled it in two grabs
        expect(count.part_hand_swings_per_minute).toBe(perMinute(1, 12));
        expect(count.extra_grabs_per_minute).toBe(perMinute(1, 12));
    });

    it("does not end a swing at a part hand dropped that stays above empty", () => {
        const held = [0, 0, 4, 4, 2, 2, 0, 0];
        const { counters } = of(stockOf(held.map(() => WORKING), held));
        expect(counters.inserters[0].swings_per_minute).toBe(perMinute(1, 7));
        expect(counters.inserters[0].part_hand_swings_per_minute).toBe(0);
    });

    it("tells a switch-on that finds the arm at rest from one that finds it moving", () => {
        //          0    1    2    3  4  5    6    7  8  9    10 11 12   13   14
        const states = [OFF, OFF, OFF, WORKING, WORKING, OFF, OFF, WORKING, WORKING, OFF, WORKING, WORKING, OFF, OFF, WORKING];
        const held =   [0,   0,   0,   0,       2,       2,   2,   2,       0,       0,   0,       0,       0,   0,   0];
        const { counters } = of(stockOf(states, held));
        const count = counters.inserters[0];
        // on in ticks 3 (hand empty, nothing before: at rest), 7 (a hand), 10 (the hand emptied in tick 8, the arm is still
        // away) and 14 (the arm has been home since tick 11: at rest)
        expect(count.switch_ons_per_minute).toBe(perMinute(4, 14));
        expect(count.switch_ons_at_rest_per_minute).toBe(perMinute(2, 14));
        expect(count.switch_ons_moving_per_minute).toBe(perMinute(2, 14));
        expect(count.switch_offs_per_minute).toBe(perMinute(3, 14));
        expect(counters.wired_inserters).toBe(1);
        expect(counters.unwired_inserters).toBe(0);
        expect(count.network_width).toBeNull();
    });

    it("gives an inserter that is never disabled no edges and no network", () => {
        const { counters } = of(stockOf([SOURCE, WORKING, WORKING, SOURCE], [0, 0, 1, 0]));
        const count = counters.inserters[0];
        expect(count.switch_ons_per_minute + count.switch_offs_per_minute).toBe(0);
        expect(count.network_width).toBe(0);
        expect(counters.wired_inserters).toBe(0);
        expect(counters.unwired_inserters).toBe(1);
    });

    it("counts the crafts the tick after a wake-up, while the inserter is still at its pickup, and no other", () => {
        //          0       1       2       3        4        5       6       7       8       9        10       11
        const states = [SOURCE, SOURCE, SOURCE, WORKING, WORKING, SOURCE, SOURCE, SOURCE, SOURCE, WORKING, WORKING, SOURCE];
        const held =   [0,      0,      0,      2,       2,       0,      0,      0,      0,      2,       2,       0];
        // it is woken in ticks 3 and 9; after the grab of tick 3 it is at its pickup when the craft of tick 4 finishes, after the
        // one of tick 9 it has begun the swing when the craft of tick 10 does
        const { counters, wake_ups } = of(stockOf(states, held, [3, 4, 9, 10], "inserter:1", [3]));
        expect(wake_ups.wake_ups_per_minute).toBe(perMinute(2, 11));
        expect(counters.inserters[0].merged_crafts_per_minute).toBe(perMinute(1, 11));
    });

    it("does not count a craft for a hand that waits for more items: that inserter is woken again", () => {
        const states = [SOURCE, SOURCE, "waiting_for_more_items", "waiting_for_more_items", SOURCE];
        const { counters, wake_ups } = of(stockOf(states, [0, 0, 1, 1, 0], [1, 2, 3], "inserter:1", [1, 2, 3]));
        expect(wake_ups.wake_ups_per_minute).toBe(perMinute(3, 4));
        expect(counters.inserters[0].merged_crafts_per_minute).toBe(0);
    });

    it("keys the waits by the end they wait at and what is there, and reports no merged crafts for a belt pickup", () => {
        const states = [WORKING, SOURCE, SOURCE, SPACE, WORKING];
        const { counters } = of(stockOf(states, [0, 0, 0, 1, 1]), { pickup_kind: "belt", drop_kind: "chest", source_machine_id: null }, { copies: 2, backed_up_belts: true });
        const count = counters.inserters[0];
        expect(count.waiting_for_items).toEqual({ end: "source", kind: "belt", ticks_per_minute: perMinute(2, 4) });
        expect(count.waiting_for_space).toEqual({ end: "sink", kind: "chest", ticks_per_minute: perMinute(1, 4) });
        expect(count.working_ticks_per_minute).toBe(perMinute(1, 4));
        expect(count.belt_supply).toBe("backed-up");
        expect(count.merged_crafts_per_minute).toBeUndefined();
        expect(counters.copies).toBe(2);
    });

    it("splits the wake-ups by the list that woke the inserter, and the parts add up to the wake-ups", () => {
        const stock = {
            ticks: 6,
            machines: [1, 2].map(number => ({ machine_id: `machine:${number}`, crafts_started: [0, 1, 1, 2, 2, 3], products_finished: [0, 0, 1, 1, 2, 2] })),
            inserters: [{ inserter_id: "inserter:1", held: [0, 0, 0, 0, 0, 0], factorio_state: [SPACE, SPACE, SOURCE, SOURCE, SOURCE, SOURCE] }],
        } as unknown as StockRecording;
        const { wake_ups, counters } = countersOfStock(stock, [inserter({ sink_machine_id: "machine:2", drop_kind: "machine" })], 0, BUILD);
        // asleep on the sink list after ticks 0 and 1: machine 2 starts a craft in tick 1; on the source list after ticks 2 to 4: machine 1 finishes in tick 4
        const [wakes] = wake_ups.inserters;
        expect(wakes.input_wake_ups_per_minute).toBe(perMinute(1, 5));
        expect(wakes.output_wake_ups_per_minute).toBe(perMinute(1, 5));
        expect(wakes.input_wake_ups_per_minute + wakes.output_wake_ups_per_minute).toBe(wakes.wake_ups_per_minute);
        expect(counters.inserters[0].input_wake_ups_per_minute).toBe(wakes.input_wake_ups_per_minute);
        expect(counters.inserters[0].output_wake_ups_per_minute).toBe(wakes.output_wake_ups_per_minute);
        // machine 1, whose list wakes it at its source, started crafts in ticks 1, 3 and 5 of the five counted
        expect(counters.inserters[0].source_craft_starts_per_tick).toBe(3 / 5);
    });

    it("gives no craft starts for an inserter no machine wakes at its source", () => {
        const { counters } = of(stockOf([WORKING, WORKING], [0, 0]), { pickup_kind: "belt", source_machine_id: null });
        expect(counters.inserters[0].source_craft_starts_per_tick).toBeUndefined();
    });
});

describe("withNetwork", () => {
    const decider = (inserters: number[]) => ({ name: "decider-combinator", tags: { clock_generator: { inserters } } });
    const blueprint = { entities: [decider([1, 2, 3]), decider([3]), { name: "decider-combinator" }, { name: "inserter" }] } as unknown as FactorioBlueprint;

    it("gives each wired inserter the width of its widest decider times the copies, and leaves the original as it was", () => {
        const stock = stockOf([OFF, WORKING, OFF, WORKING], [0, 0, 0, 0], [], "inserter:3");
        const { counters } = of(stock, { inserter_id: "inserter:3" }, { copies: 2, backed_up_belts: false });
        const filled = withNetwork(counters, blueprint, 2);
        expect(filled.deciders).toBe(2);
        expect(filled.inserters[0].network_width).toBe(3 * 2);
        expect(counters.inserters[0].network_width).toBeNull();
    });
});
