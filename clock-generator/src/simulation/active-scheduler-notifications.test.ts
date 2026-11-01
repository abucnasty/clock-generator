import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {expect, test} from "vitest";
import {GameFixturePaths} from "../../tests/game/helpers/fixture-paths";
import {ActiveScheduler, SchedulingEvent} from "./active-scheduler";

interface NativeNotification {
    event: "alarm" | "wake" | "sleep" | "update";
    role: string;
    probe_tick: number;
    order: number;
    end_order: number;
    cause: string;
    before: {awake: boolean};
    after: {awake: boolean};
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
            expect(event.evidence).toBe("observed");
            if (event.event === "update") {
                if (!phase_open) {
                    // Native callback Alarms preceding the first Update are eligible in that phase;
                    // later finish-dispatch/source Alarms are supplied while this observed phase remains open.
                    scheduler.beginUpdates();
                    phase_open = true;
                }
                expect(event.before.awake).toBe(true);
                expect(scheduler.nextUpdate()).toBe(event.role);
            } else if (event.event === "alarm") {
                expect(scheduler.isActive(event.role)).toBe(event.before.awake);
                const attaches = fixture.events.some(it => it.event === "wake" && it.role === event.role
                    && it.order > event.order && it.order < event.end_order);
                scheduler.deliverAlarm(event.role, event.cause, attaches);
            } else if (event.event === "wake") {
                expect(event.before).toEqual({awake: false});
                expect(event.after).toEqual({awake: true});
                expect(scheduler.isActive(event.role)).toBe(true);
            } else {
                expect(event.before).toEqual({awake: true});
                expect(event.after).toEqual({awake: false});
                expect(scheduler.isActive(event.role)).toBe(true);
                scheduler.deactivate(event.role, event.cause);
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
    expect(emitted.map(it => [it.event, it.entity])).toEqual(fixture.events.map(it => [({alarm: "Alarm", wake: "Activation", sleep: "Deactivation", update: "Update"} as const)[it.event], it.role]));
    for (const event of ["Alarm", "Activation", "Deactivation", "Update"] as const) {
        expect(emitted.filter(it => it.event === event)).toHaveLength(counts[event]);
    }
});
