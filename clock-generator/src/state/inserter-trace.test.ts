import {expect, test} from "vitest";
import {InserterTrace, InserterTraceEvent} from "./inserter-trace";

test("a selected tick window bounds retention without treating excluded events as truncation", () => {
    let tick = 0;
    const trace = new InserterTrace(() => tick, {start_tick: 2, end_tick: 4, max_events: 2});
    const record = () => trace.record({type: "pickup", item: "iron-plate", quantity: 4});
    record();
    tick = 2; record();
    tick = 3; record();
    tick = 5; record();
    expect(trace.truncated).toBe(false);
    tick = 4; record();
    expect(trace.truncated).toBe(true);
    const events: readonly InserterTraceEvent[] = trace.events;
    expect(events).toEqual([
        {tick: 2, type: "pickup", item: "iron-plate", quantity: 4},
        {tick: 3, type: "pickup", item: "iron-plate", quantity: 4},
    ]);
    expect(Object.isFrozen(events[0])).toBe(true);
    (events as InserterTraceEvent[]).pop();
    expect(trace.events).toHaveLength(2);
});

test.each([0, -1, 1.5, Number.POSITIVE_INFINITY])("rejects an unbounded or invalid event limit %s", max_events => {
    expect(() => new InserterTrace(() => 0, {max_events})).toThrow("positive safe integer");
});

test("rejects reversed and NaN tick windows", () => {
    expect(() => new InserterTrace(() => 0, {start_tick: 2, end_tick: 1})).toThrow("ordered tick window");
    expect(() => new InserterTrace(() => 0, {start_tick: Number.NaN})).toThrow("ordered tick window");
});
