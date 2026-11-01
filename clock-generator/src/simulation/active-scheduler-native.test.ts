import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {expect, test} from "vitest";
import {GameFixturePaths} from "../../tests/game/helpers/fixture-paths";
import {ActiveScheduler, SchedulingEvent} from "./active-scheduler";

interface Bound {tick: number; order: number; event: string; stage?: string}
interface ObservedEvent extends Bound {id: number; role: string; game_tick: number; awake: boolean; cause: string}
interface Projection {
    game_tick_origin: number;
    projection: {first_tick: number; last_tick: number; initial_active_order: string[]};
    events: ObservedEvent[];
    transitions: {event: string; evidence: string; role: string; from: Bound; through: Bound}[];
    comparison: {visible_reference_differences: number; observed_ticks: number};
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
const sameBound = (a: Bound, b: Bound) => a.tick === b.tick && a.order === b.order;

/** Replay observed notifications and bounded outcomes without guessing hand-physics causes. */
function replay(fixture: Projection): SchedulingEvent[] {
    const emitted: SchedulingEvent[] = [];
    const scheduler = new ActiveScheduler({
        active_order: fixture.projection.initial_active_order, remaining_updates: null, pending_next_phase: [],
    }, event => emitted.push(event));
    for (let tick = fixture.projection.first_tick; tick <= fixture.projection.last_tick; tick++) {
        scheduler.beginUpdates();
        const events = fixture.events.filter(event => event.tick === tick);
        let previous_order = 0;
        for (const event of events) {
            expect(event.order).toBeGreaterThan(previous_order);
            previous_order = event.order;
            expect(event.game_tick).toBe(tick + fixture.game_tick_origin);
            if (event.event === "alarm") {
                if (!event.awake && scheduler.isActive(event.role)) {
                    const interval = fixture.transitions.find(transition => transition.event === "sleep"
                        && transition.role === event.role && sameBound(transition.through, event));
                    expect(interval?.evidence).toBe("inferred-between-observations");
                    // Apply only at the interval's final bound, without asserting an exact sleep time.
                    scheduler.deactivate(event.role, "bounded-sleep-interval");
                }
                expect(scheduler.isActive(event.role)).toBe(event.awake);
                const wake = fixture.transitions.find(transition => transition.event === "wake"
                    && transition.role === event.role && sameBound(transition.from, event));
                if (wake !== undefined) {
                    expect(wake.evidence).toBe("observed");
                    const completion = fixture.events.find(candidate => sameBound(candidate, wake.through));
                    expect(completion).toMatchObject({event: "wake", stage: "end", awake: true});
                    expect(fixture.events.some(candidate => candidate.event === "wake" && candidate.stage === "begin"
                        && candidate.role === event.role && candidate.order > wake.from.order
                        && candidate.order < wake.through.order && candidate.tick === wake.through.tick)).toBe(true);
                }
                scheduler.deliverAlarm(event.role, event.cause, wake !== undefined || event.awake);
            } else if (event.event === "update") {
                expect(scheduler.nextUpdate()).toBe(event.role);
                expect(event.awake).toBe(true);
            } else if (event.event === "wake" && event.stage === "end") {
                expect(scheduler.isActive(event.role)).toBe(true);
            }
        }
        expect(scheduler.nextUpdate()).toBeNull();
        scheduler.endUpdates();
    }
    return emitted;
}

test.each(["agricultural.json", "agricultural-belt.json", "lds-diagnostic.json"])(
    "Mechanics: local scheduler reproduces observed update order in %s", name => {
        const fixture = loadProjection(name);
        expect(fixture.comparison).toEqual({visible_reference_differences: 0, observed_ticks: 20});
        const emitted = replay(fixture);
        for (const [actual, observed] of [["Alarm", "alarm"], ["Update", "update"]]) {
            expect(emitted.filter(it => it.event === actual).map(it => it.entity))
                .toEqual(fixture.events.filter(it => it.event === observed).map(it => it.role));
        }
        expect(emitted.filter(it => it.event === "Activation").map(it => it.entity))
            .toEqual(fixture.transitions.filter(it => it.event === "wake").map(it => it.role));
    });

test("a false wake claim without an observed wake is rejected", () => {
    const fixture = loadProjection("agricultural.json");
    fixture.events = fixture.events.filter(it => !(it.event === "wake" && it.stage === "begin"));
    expect(() => replay(fixture)).toThrow();
});
