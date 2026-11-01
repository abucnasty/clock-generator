import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {expect, test} from "vitest";
import {GameFixturePaths} from "../../tests/game/helpers/fixture-paths";
import {nativeCallCounts, normalizeProbeOrigin, roleSequences} from "./probe-observations";

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

interface CircuitEvent {tick: number; kind: string; event: string; role: string; condition_index?: number; bool_result?: boolean; callers?: (string | null)[]; membership?: {byte: number; self_linked: boolean}}

test("RI6: per-role repeat semantics preserve indexed short circuit and exclude Lua reads", () => {
    const fixture = load<{events: CircuitEvent[]}>(GameFixturePaths.CIRCUIT_EVALUATION, "events.json");
    const events = fixture.events;
    const attributed = events.map(event => ({...event,
        origin: event.callers?.some(c => c?.includes("luaReadCircuitCondition")) ? "probe" as const : "native" as const}));
    const counts = nativeCallCounts(attributed);
    expect(counts.changing_arithmetic_zero["ArithmeticThunk::update"]).toBe(1);
    expect(counts.changing_arithmetic_zero["Arithmetic::computeOutput"]).toBe(1);
    expect(counts.fixed_arithmetic_zero["ArithmeticThunk::update"]).toBe(1);
    expect(counts.fixed_arithmetic_zero["Arithmetic::computeOutput"]).toBeUndefined();
    for (const [role, indices] of Object.entries({changing_and_true: [1,2,3], changing_and_false_first: [1],
        changing_and_false_last: [1,2,3], changing_or_true_first: [1], changing_or_true_last: [1,2,3]})) {
        expect(events.filter(e => e.role === role && e.kind === "call" && e.event === "Condition::isFulfilled").map(e => e.condition_index)).toEqual(indices);
    }
    const expectedResults: Record<string, boolean[]> = {changing_and_true: [true,true,true], changing_and_false_first: [false],
        changing_and_false_last: [true,true,false], changing_or_true_first: [true], changing_or_true_last: [false,false,true]};
    for (const [role, results] of Object.entries(expectedResults)) {
        expect(events.filter(e => e.role === role && e.kind === "return" && e.event === "Condition::isFulfilled").map(e => e.bool_result)).toEqual(results);
    }
    const validation = load<{per_role: Record<string, {calls: Record<string, number>}>}>(GameFixturePaths.CIRCUIT_EVALUATION, "validation.json");
    const mapping = load<{controls: {role: string; type: number; conditions: number; typed_getter_and_native_type_verified: boolean}[];
        arithmetic_update: {receiver_adjustment: number}}>(GameFixturePaths.CIRCUIT_EVALUATION, "native-mapping.json");
    expect(mapping.controls).toHaveLength(18);
    expect(mapping.arithmetic_update.receiver_adjustment).toBe(24);
    for (const c of mapping.controls.filter(c => c.role.startsWith("fixed_") || c.role.startsWith("changing_"))) {
        expect(c.typed_getter_and_native_type_verified).toBe(true);
        const calls = validation.per_role[c.role].calls;
        expect(calls[c.type === 10 ? "ArithmeticThunk::update" : "Decider::update"]).toBe(20);
        const evaluations = c.type === 10 ? "Arithmetic::computeOutput" : "Condition::isFulfilled";
        expect(calls[evaluations] ?? 0).toBe(c.role.startsWith("fixed_") ? 0 : 20 * (expectedResults[c.role]?.length ?? 1));
    }
    expect(events.filter(e => e.role === "hand" && e.kind === "call" && e.event === "Inserter::alarm").map(e => e.tick)).toEqual([8,16,24]);
    expect(events.filter(e => e.role === "hand" && e.kind === "call" && e.event === "Inserter::update").map(e => e.tick)).toEqual([9,17]);
    const deactivated = events.filter(e => e.event === "UpdatableEntity::deactivate");
    expect(deactivated.filter(e => e.kind === "call").map(e => e.membership)).toEqual(Array(2).fill({byte: 1, self_linked: false}));
    expect(deactivated.filter(e => e.kind === "return").map(e => e.membership)).toEqual(Array(2).fill({byte: 0, self_linked: true}));
    const groups = roleSequences(events);
    const reordered = Object.values(groups).reverse().flat();
    expect(reordered).not.toEqual(events);
    expect(roleSequences(reordered)).toEqual(groups);
    const role = "changing_and_true";
    const changed = events.map(e => ({...e}));
    const index = changed.findIndex(e => e.role === role && e.condition_index === 2);
    changed[index].condition_index = 3;
    expect(roleSequences(changed)).not.toEqual(groups);
    const generic = attributed.filter(e => e.kind === "call" && e.event === "CircuitCondition::fulfilled");
    expect(generic.filter(e => e.origin === "native")).toHaveLength(20);
    expect(generic.filter(e => e.origin === "probe")).toHaveLength(19);
});

test("RI3: bounded busy-input comparisons keep Updates, alarms, attachments and observer calls distinct", () => {
    interface BusyEvent {tick: number; kind: string; function: string; unit: number; update_owner?: number; bool_result?: boolean}
    interface Case {events: BusyEvent[]; selected_inputs: number[]; stats: {ticks: number; input_calls: Record<string, number>;
        owned_checks: Record<string, number>; actual_activations: number; actual_deactivations: number;
        probe_fullness_excluded: number; fullness_results: Record<string, number>; can_insert_results: Record<string, number>}}
    const fixture = load<{cases: Record<string, Case>}>(path.dirname(GameFixturePaths.BUSY_INPUT_OBSERVATIONS), "observations.json");
    for (const c of Object.values(fixture.cases)) {
        expect(c.stats.ticks).toBe(2);
        expect(c.stats.input_calls["Inserter::update"]).toBe(c.selected_inputs.length * 2);
        expect(c.stats.actual_activations).toBe(8);
        expect(c.stats.actual_deactivations).toBe(8);
        expect(c.stats.probe_fullness_excluded).toBe(12);
    }
    for (const [name, c] of Object.entries(fixture.cases)) {
        for (const gate of c.events.filter(e => e.kind === "return" && e.function === "AssemblingMachine::isFullForInserters" && e.update_owner)) {
            const owned = c.events.filter(e => e.tick === gate.tick && e.update_owner === gate.update_owner);
            const calls = owned.filter(e => e.kind === "call").map(e => e.function);
            expect(calls.indexOf("AssemblingMachine::isFullForInserters")).toBeGreaterThan(calls.indexOf("Inserter::update"));
            if (name === "real") {
                expect(gate.bool_result).toBe(true);
                expect(calls).not.toContain("Inserter::matchesFilter");
                expect(calls).not.toContain("AssemblingMachine::canInsert");
            } else {
                expect(gate.bool_result).toBe(false);
                expect(calls.indexOf("Inserter::matchesFilter")).toBeGreaterThan(calls.indexOf("AssemblingMachine::isFullForInserters"));
                expect(calls.indexOf("AssemblingMachine::canInsert")).toBeGreaterThan(calls.indexOf("Inserter::matchesFilter"));
            }
        }
    }
    expect(fixture.cases.real.stats.input_calls["Inserter::alarm"]).toBe(8);
    expect(fixture.cases.control.stats.input_calls["Inserter::alarm"]).toBe(16);
    expect(fixture.cases.real.stats.fullness_results).toEqual({True: 8});
    expect(fixture.cases.control.stats.fullness_results).toEqual({False: 8});
    expect(fixture.cases.real.stats.owned_checks["Inserter::matchesFilter"]).toBeUndefined();
    expect(fixture.cases.control.stats.can_insert_results).toEqual({False: 8});
});
