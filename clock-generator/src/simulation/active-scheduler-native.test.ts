import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {expect, test} from "vitest";
import {GameFixturePaths} from "../../tests/game/helpers/fixture-paths";
import {ActiveScheduler, SchedulingEvent} from "./active-scheduler";

interface NativeEvent {
    event: string;
    role: string;
    tick: number;
    game_tick: number;
    sequence: number;
    source_event: number;
    cause: string;
    scheduling_state: {self_linked: boolean; low_state_bits: number; next: string};
}

interface Projection {
    source_fixture: {name: string; sha256: string};
    tick_mapping: {raw_game_tick_minus_probe_start: number};
    projection: {first_tick: number; last_tick: number; initial_active_order: string[]};
    events: NativeEvent[];
    transitions: {event: string; evidence: string; role: string; from_event: number; through_event: number}[];
    reference_equality: {differences: number};
    handshake: {ticks: number; paused: boolean; remaining_budget: number};
}

const seals = new Map(fs.readFileSync(path.join(GameFixturePaths.ACTIVATION_ORDER, "SHA256SUMS"), "utf8")
    .trim().split("\n").map(line => {
        const [digest, filename] = line.split(/\s+/);
        return [filename, digest];
    }));

function loadProjection(name: string): Projection {
    const raw = fs.readFileSync(path.join(GameFixturePaths.ACTIVATION_ORDER, name));
    expect(crypto.createHash("sha256").update(raw).digest("hex")).toBe(seals.get(name));
    return JSON.parse(raw.toString("utf8"));
}

/** Feed observed notifications and bounded membership outcomes, not guessed hand-physics causes. */
function replay(fixture: Projection): SchedulingEvent[] {
    const emitted: SchedulingEvent[] = [];
    const scheduler = new ActiveScheduler({
        active_order: fixture.projection.initial_active_order, remaining_updates: null, pending_next_phase: [],
    }, event => emitted.push(event));
    for (let tick = fixture.projection.first_tick; tick <= fixture.projection.last_tick; tick++) {
        scheduler.beginUpdates();
        const events = fixture.events.filter(event => event.tick === tick);
        let previous_sequence = 0;
        for (const event of events) {
            expect(event.sequence).toBeGreaterThan(previous_sequence);
            previous_sequence = event.sequence;
            expect(event.game_tick).toBe(tick + fixture.tick_mapping.raw_game_tick_minus_probe_start);
            if (event.event === "Alarm") {
                const inactive = event.scheduling_state.self_linked && event.scheduling_state.low_state_bits === 0;
                if (inactive && scheduler.isActive(event.role)) {
                    const interval = fixture.transitions.find(transition => transition.event === "Deactivation"
                        && transition.role === event.role && transition.through_event === event.source_event);
                    expect(interval?.evidence).toBe("inferred-transition-between-observations-not-intercepted-detach");
                    // Apply at the observed interval's final bound, without asserting an exact native detach call/time.
                    scheduler.deactivate(event.role, "bounded-native-membership-interval");
                }
                expect(scheduler.isActive(event.role)).toBe(!inactive);
                const activation = fixture.transitions.find(transition => transition.event === "Activation"
                    && transition.role === event.role && transition.from_event === event.source_event);
                if (activation !== undefined) {
                    expect(activation.evidence).toBe("observed-state-change-across-intercepted-attach");
                    const returned = fixture.events.find(candidate => candidate.source_event === activation.through_event);
                    expect(returned?.event).toBe("NativeAttachReturn");
                    expect(returned?.scheduling_state.self_linked).toBe(false);
                    expect(fixture.events.some(candidate => candidate.event === "NativeAttachEntry"
                        && candidate.role === event.role && candidate.source_event > activation.from_event
                        && candidate.source_event < activation.through_event)).toBe(true);
                }
                scheduler.deliverAlarm(event.role, event.cause, activation !== undefined || !inactive);
            } else if (event.event === "Update") {
                expect(scheduler.nextUpdate()).toBe(event.role);
                expect(event.scheduling_state.self_linked).toBe(false);
            } else if (event.event === "NativeAttachReturn") {
                expect(scheduler.isActive(event.role)).toBe(true);
                const order = scheduler.state().active_order;
                if (order.includes(event.scheduling_state.next)) {
                    expect(order[order.indexOf(event.role) + 1]).toBe(event.scheduling_state.next);
                }
            }
        }
        expect(scheduler.nextUpdate()).toBeNull();
        scheduler.endUpdates();
    }
    return emitted;
}

test.each(["agricultural.json", "agricultural-belt.json", "lds-diagnostic.json"])(
    "Mechanics: local scheduler reproduces observed Update order in %s", name => {
        const fixture = loadProjection(name);
        expect(fixture.source_fixture.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(fixture.reference_equality.differences).toBe(0);
        expect(fixture.handshake).toMatchObject({ticks: 20, paused: true, remaining_budget: 0});
        const emitted = replay(fixture);
        for (const event of ["Alarm", "Update"] as const) {
            expect(emitted.filter(it => it.event === event).map(it => it.entity))
                .toEqual(fixture.events.filter(it => it.event === event).map(it => it.role));
        }
        expect(emitted.filter(it => it.event === "Activation").map(it => it.entity))
            .toEqual(fixture.transitions.filter(it => it.event === "Activation").map(it => it.role));
    });

test("a false claim of Activation without intercepted attach is rejected", () => {
    const fixture = loadProjection("agricultural.json");
    fixture.events = fixture.events.filter(it => it.event !== "NativeAttachEntry");
    expect(() => replay(fixture)).toThrow();
});
