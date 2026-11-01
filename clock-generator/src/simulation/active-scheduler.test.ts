import {expect, test} from "vitest";
import {ActiveScheduler, SchedulingEvent} from "./active-scheduler";

function scheduler(active_order: string[], events: SchedulingEvent[] = []): ActiveScheduler {
    return new ActiveScheduler({active_order, remaining_updates: null, pending_next_phase: []}, event => events.push(event));
}

test("Alarm delivery does not imply Activation or move an already-active entity", () => {
    const events: SchedulingEvent[] = [];
    const active = scheduler(["output", "input"], events);
    active.deliverAlarm("input", "consumption", true);
    active.deliverAlarm("input", "consumption", true);
    active.deliverAlarm("disabled", "control", false);
    expect(active.state().active_order).toEqual(["output", "input"]);
    expect(events.map(it => it.event)).toEqual(["Alarm", "Alarm", "Alarm"]);
});

test("an output-take reattachment waits for the following phase rather than updating twice", () => {
    const active = scheduler(["input", "output"]);
    active.beginUpdates();
    expect(active.nextUpdate()).toBe("input");
    active.deactivate("input", "blocked");
    expect(active.nextUpdate()).toBe("output");
    active.deliverAlarm("input", "output-take", true);
    expect(active.nextUpdate()).toBeNull();
    active.endUpdates();
    active.beginUpdates();
    expect(active.nextUpdate()).toBe("input");
    expect(active.nextUpdate()).toBe("output");
    expect(active.nextUpdate()).toBeNull();
    active.endUpdates();
});

test("a member reattached before its old snapshot turn also waits for the next phase", () => {
    const active = scheduler(["output", "input"]);
    active.beginUpdates();
    expect(active.nextUpdate()).toBe("output");
    active.deactivate("input", "explicit-outcome");
    active.activate("input", "notification");
    expect(active.nextUpdate()).toBeNull();
    active.endUpdates();
    active.beginUpdates();
    expect(active.nextUpdate()).toBe("input");
});

test("later control activation puts output ahead of an earlier activated input", () => {
    const active = scheduler([]);
    active.deliverAlarm("input", "consumption", true);
    active.deliverAlarm("output", "control", true);
    active.beginUpdates();
    expect([active.nextUpdate(), active.nextUpdate(), active.nextUpdate()]).toEqual(["output", "input", null]);
});

test("state keys distinguish active order, phase cursor and pending eligibility, excluding diagnostics", () => {
    const first = scheduler(["output", "input"]);
    const second = scheduler(["input", "output"]);
    expect(first.key()).not.toBe(second.key());
    const key = first.key();
    first.deliverAlarm("output", "repeated-delivery", true);
    expect(first.key()).toBe(key);
    first.beginUpdates();
    const before_update = first.key();
    first.nextUpdate();
    expect(first.key()).not.toBe(before_update);
    const before_reattach = first.key();
    first.deactivate("input", "explicit-outcome");
    first.activate("input", "notification");
    const same_order_without_pending = new ActiveScheduler({...first.state(), pending_next_phase: []});
    expect(first.key()).not.toBe(before_reattach);
    expect(first.key()).not.toBe(same_order_without_pending.key());
});

test("cloning carries pending eligibility and phase position without sharing mutable state or events", () => {
    const events: SchedulingEvent[] = [];
    const original = scheduler(["output", "input"], events);
    original.beginUpdates();
    original.nextUpdate();
    original.deactivate("input", "explicit-outcome");
    original.activate("input", "notification");
    const copy = original.clone();
    expect(copy.key()).toBe(original.key());
    expect(copy.nextUpdate()).toBeNull();
    expect(original.state().remaining_updates).toEqual(["input"]);
    copy.endUpdates();
    copy.beginUpdates();
    expect(copy.nextUpdate()).toBe("input");
    expect(events.filter(it => it.event === "Update")).toHaveLength(1);
    const saved = original.state();
    original.deactivate("input", "later-outcome");
    expect(saved.active_order).toEqual(["input", "output"]);
});

test("rejects malformed hydration and an overlapping or prematurely ended phase", () => {
    expect(() => scheduler(["input", "input"])).toThrow("Duplicate active member");
    expect(() => new ActiveScheduler({active_order: [], remaining_updates: null, pending_next_phase: ["input"]}))
        .toThrow("Pending member is inactive");
    const active = scheduler(["input"]);
    expect(() => active.nextUpdate()).toThrow("No Update phase");
    active.beginUpdates();
    expect(() => active.beginUpdates()).toThrow("already open");
    expect(() => active.endUpdates()).toThrow("not exhausted");
});
