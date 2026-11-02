import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {expect, test} from "vitest";
import {GameFixturePaths} from "../../tests/game/helpers/fixture-paths";
import {observedEventCounts, normalizeProbeOrigin, roleSequences} from "./probe-observations";

function load<T>(folder: string, name: string): T {
    for (const line of fs.readFileSync(path.join(folder, "SHA256SUMS"), "utf8").trim().split("\n")) {
        const [hash, file] = line.split(/\s+/);
        expect(crypto.createHash("sha256").update(fs.readFileSync(path.join(folder, file))).digest("hex")).toBe(hash);
    }
    return JSON.parse(fs.readFileSync(path.join(folder, name), "utf8"));
}

test("probe origin normalization preserves phase and every unrelated field", () => {
    const report = {started: 100, samples: [{tick: 5, game_tick: 105, held: 16, enabled: false}],
        interventions: [{tick: 1, game_tick: 101, stock: 4800}]};
    const normalized = normalizeProbeOrigin(report);
    expect(normalized).toEqual({started: 0, samples: [{tick: 5, game_tick: 5, held: 16, enabled: false}],
        interventions: [{tick: 1, game_tick: 1, stock: 4800}]});
    expect(report.started).toBe(100);
    expect(normalizeProbeOrigin({...report, started: 101})).not.toEqual(normalized);
});

interface CircuitEvent {tick: number; phase: string; event: string; stage: string; role: string;
    condition?: number; result?: boolean; awake?: boolean; origin: "game" | "observation"}

test("per-role circuit observations preserve short circuit and exclude observation-induced checks", () => {
    const fixture = load<{events: CircuitEvent[]}>(GameFixturePaths.CIRCUIT_EVALUATION, "events.json");
    const events = fixture.events;
    const pending = new Map<string, CircuitEvent[]>();
    for (const event of events) {
        const key = `${event.role}:${event.event}:${event.stage}`;
        const starts = pending.get(key) ?? [];
        if (event.phase === "begin") {
            starts.push(event);
            pending.set(key, starts);
        } else if (event.phase === "end") {
            // A result inherits its observed action's origin even when its row has no separate attribution.
            expect(starts.pop()?.origin).toBe(event.origin);
        }
    }
    const counts = observedEventCounts(events);
    expect(counts.changing_arithmetic_zero["update:entity"]).toBe(1);
    expect(counts.changing_arithmetic_zero["update:output"]).toBe(1);
    expect(counts.fixed_arithmetic_zero["update:entity"]).toBe(1);
    expect(counts.fixed_arithmetic_zero["update:output"]).toBeUndefined();
    for (const [role, indices] of Object.entries({changing_and_true: [1,2,3], changing_and_false_first: [1],
        changing_and_false_last: [1,2,3], changing_or_true_first: [1], changing_or_true_last: [1,2,3]})) {
        expect(events.filter(e => e.role === role && e.phase === "begin" && e.stage === "condition").map(e => e.condition)).toEqual(indices);
    }
    const expectedResults: Record<string, boolean[]> = {changing_and_true: [true,true,true], changing_and_false_first: [false],
        changing_and_false_last: [true,true,false], changing_or_true_first: [true], changing_or_true_last: [false,false,true]};
    for (const [role, results] of Object.entries(expectedResults)) {
        expect(events.filter(e => e.role === role && e.phase === "end" && e.stage === "condition").map(e => e.result)).toEqual(results);
    }
    const validation = load<{controls: {role: string; prototype: string; updates: number; condition_checks: number; output_computations: number}[]}>(
        GameFixturePaths.CIRCUIT_EVALUATION, "validation.json");
    expect(validation.controls).toHaveLength(18);
    for (const c of validation.controls.filter(c => c.role.startsWith("fixed_") || c.role.startsWith("changing_"))) {
        expect(c.updates).toBe(20);
        const evaluations = c.prototype === "arithmetic-combinator" ? c.output_computations : c.condition_checks;
        expect(evaluations).toBe(c.role.startsWith("fixed_") ? 0 : 20 * (expectedResults[c.role]?.length ?? 1));
    }
    expect(events.filter(e => e.role === "hand" && e.phase === "begin" && e.event === "alarm").map(e => e.tick)).toEqual([8,16,24]);
    expect(events.filter(e => e.role === "hand" && e.phase === "begin" && e.event === "update" && e.stage === "entity").map(e => e.tick)).toEqual([9,17]);
    const slept = events.filter(e => e.event === "sleep" && e.stage === "transition");
    expect(slept.filter(e => e.phase === "begin").map(e => e.awake)).toEqual([true, true]);
    expect(slept.filter(e => e.phase === "end").map(e => e.awake)).toEqual([false, false]);
    const groups = roleSequences(events);
    const reordered = Object.values(groups).reverse().flat();
    expect(reordered).not.toEqual(events);
    expect(roleSequences(reordered)).toEqual(groups);
    const changed = events.map(e => ({...e}));
    const index = changed.findIndex(e => e.role === "changing_and_true" && e.condition === 2);
    changed[index].condition = 3;
    expect(roleSequences(changed)).not.toEqual(groups);
    const generic = events.filter(e => e.phase === "begin" && e.stage === "enable-condition");
    expect(generic.filter(e => e.origin === "game")).toHaveLength(20);
    expect(generic.filter(e => e.origin === "observation")).toHaveLength(19);
});

test("bounded busy-input comparisons keep updates, alarms, wakes, sleeps and observation effects distinct", () => {
    interface BusyEvent {tick: number; phase: string; event: string; stage: string; role: string; target: string; result?: boolean}
    interface Case {events: BusyEvent[]; selected_inputs: string[]; stats: {ticks: number; updates: number; alarms: number; wakes: number; sleeps: number;
        observation_target_full_checks_excluded: number; target_full_results: Record<string, number>; pickup_filter_checks: number; pickup_accept_results: Record<string, number>}}
    const fixture = load<{cases: Record<string, Case>}>(path.dirname(GameFixturePaths.BUSY_INPUT_OBSERVATIONS), "observations.json");
    for (const c of Object.values(fixture.cases)) {
        expect(c.stats.ticks).toBe(2);
        expect(c.stats.updates).toBe(c.selected_inputs.length * 2);
        expect(c.stats.wakes).toBe(8);
        expect(c.stats.sleeps).toBe(8);
        expect(c.stats.observation_target_full_checks_excluded).toBe(12);
    }
    for (const [name, c] of Object.entries(fixture.cases)) {
        for (const gate of c.events.filter(e => e.phase === "end" && e.event === "target-full")) {
            const owned = c.events.filter(e => e.tick === gate.tick && e.role === gate.role);
            const starts = owned.filter(e => e.phase === "begin").map(e => `${e.event}:${e.stage}`);
            expect(starts.indexOf("target-full:check")).toBeGreaterThan(starts.indexOf("update:entity"));
            if (name === "real") {
                expect(gate.result).toBe(true);
                expect(starts).not.toContain("pickup:filter");
                expect(starts).not.toContain("pickup:accept");
            } else {
                expect(gate.result).toBe(false);
                expect(starts.indexOf("pickup:filter")).toBeGreaterThan(starts.indexOf("target-full:check"));
                expect(starts.indexOf("pickup:accept")).toBeGreaterThan(starts.indexOf("pickup:filter"));
            }
        }
    }
    expect(fixture.cases.real.stats.alarms).toBe(8);
    expect(fixture.cases.control.stats.alarms).toBe(16);
    expect(fixture.cases.real.stats.target_full_results).toEqual({True: 8});
    expect(fixture.cases.control.stats.target_full_results).toEqual({False: 8});
    expect(fixture.cases.real.stats.pickup_filter_checks).toBe(0);
    expect(fixture.cases.control.stats.pickup_accept_results).toEqual({False: 8});
});
