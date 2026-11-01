import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {expect, test} from "vitest";
import {GameFixturePaths} from "../../tests/game/helpers/fixture-paths";
import {ActiveScheduler, SchedulingEvent} from "./active-scheduler";

interface NativeNotification {
    event: SchedulingEvent["event"];
    role: string;
    probe_tick: number;
    seq: number;
    return_seq: number;
    caller: string;
    before: {active: boolean; self_linked: boolean};
    after: {active: boolean; self_linked: boolean};
    evidence: string;
}

interface Notifications {
    initial_active_order: string[];
    window: {first_tick: number; last_tick: number};
    events: NativeNotification[];
}

function load(folder: string): Notifications {
    for (const line of fs.readFileSync(path.join(folder, "SHA256SUMS"), "utf8").trim().split("\n")) {
        const [hash, filename] = line.split(/\s+/);
        expect(crypto.createHash("sha256").update(fs.readFileSync(path.join(folder, filename))).digest("hex")).toBe(hash);
    }
    return JSON.parse(fs.readFileSync(path.join(folder, "observations.json"), "utf8"));
}

function replay(fixture: Notifications): SchedulingEvent[] {
    const emitted: SchedulingEvent[] = [];
    const scheduler = new ActiveScheduler({active_order: fixture.initial_active_order,
        remaining_updates: null, pending_next_phase: []}, event => emitted.push(event));
    for (let tick = fixture.window.first_tick; tick <= fixture.window.last_tick; tick++) {
        let phase_open = false;
        for (const event of fixture.events.filter(it => it.probe_tick === tick)) {
            expect(event.evidence).toBe("intercepted selected call and return");
            if (event.event === "Update") {
                if (!phase_open) {
                    // Native callback Alarms preceding the first Update are eligible in that phase;
                    // later finish-dispatch/source Alarms are supplied while this observed phase remains open.
                    scheduler.beginUpdates();
                    phase_open = true;
                }
                expect(event.before.active).toBe(true);
                expect(scheduler.nextUpdate()).toBe(event.role);
            } else if (event.event === "Alarm") {
                expect(scheduler.isActive(event.role)).toBe(event.before.active);
                const attaches = fixture.events.some(it => it.event === "Activation" && it.role === event.role
                    && it.seq > event.seq && it.seq < event.return_seq);
                scheduler.deliverAlarm(event.role, event.caller, attaches);
            } else if (event.event === "Activation") {
                expect(event.before).toEqual({active: false, self_linked: true});
                expect(event.after).toEqual({active: true, self_linked: false});
                expect(scheduler.isActive(event.role)).toBe(true);
            } else {
                expect(event.before).toEqual({active: true, self_linked: false});
                expect(event.after).toEqual({active: false, self_linked: true});
                expect(scheduler.isActive(event.role)).toBe(true);
                scheduler.deactivate(event.role, event.caller);
            }
        }
        if (phase_open) {
            expect(scheduler.nextUpdate()).toBeNull();
            scheduler.endUpdates();
        }
    }
    return emitted;
}

test.each([
    {name: "partial source hands", folder: GameFixturePaths.PARTIAL_HAND_NOTIFICATIONS,
        counts: {Alarm: 14, Activation: 6, Deactivation: 6, Update: 20}},
    {name: "condition assignments", folder: GameFixturePaths.CONDITION_WRITE_NOTIFICATIONS,
        counts: {Alarm: 26, Activation: 15, Deactivation: 21, Update: 42}},
])("Mechanics: observed notifications and actual membership changes for $name", ({folder, counts}) => {
    const fixture = load(folder);
    const emitted = replay(fixture);
    expect(emitted.map(it => [it.event, it.entity])).toEqual(fixture.events.map(it => [it.event, it.role]));
    for (const event of ["Alarm", "Activation", "Deactivation", "Update"] as const) {
        expect(emitted.filter(it => it.event === event)).toHaveLength(counts[event]);
    }
});
