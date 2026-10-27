import { describe, expect, it } from "vitest";
import { reasonId } from "../../control-logic/mode/reason-table";
import { factorioStateCode, statusCode } from "../../state/status-codes";
import { CompactStateTransitionHistory, expandStateTransitionHistory, factorioStatesOf, toPortable, transitionsOf } from "./compact-history";
import { EntityTransitionColumns } from "./transition-columns";

const columnsOf = (transitions: [number, string, string, string][], states: [number, string][] = []) => {
    const columns = new EntityTransitionColumns();
    transitions.forEach(([tick, from, to, reason]) => columns.push(tick, statusCode(from), statusCode(to), reasonId(reason)));
    states.forEach(([tick, state]) => columns.pushState(tick, factorioStateCode(state)));
    return columns.seal();
};

const history: CompactStateTransitionHistory = {
    total_duration_ticks: 100,
    entities: [
        {
            entity_id: "machine:1", entity_type: "machine", label: "Machine 1 (gear)", source: undefined, sink: undefined, items: ["gear"],
            initial_status: "WORKING", initial_factorio_state: "working",
            columns: columnsOf([[10, "WORKING", "OUTPUT_FULL", "compact history: output full"], [40, "OUTPUT_FULL", "WORKING", "compact history: taken"]],
                [[0, "working"], [10, "full_output"], [40, "working"]]),
        },
        {
            entity_id: "inserter:2", entity_type: "inserter", label: "Inserter 2",
            source: { entity_id: "machine:1", entity_type: "machine", label: "Machine 1 (gear)" },
            sink: { entity_id: "chest:1", entity_type: "chest", label: "Chest 1" }, items: ["gear"],
            initial_status: "IDLE", initial_factorio_state: "unknown",
            // two transitions in one tick, and one recorded past the end of the run
            columns: columnsOf([[20, "IDLE", "PICKUP", "compact history: output full"], [20, "PICKUP", "SWING", "compact history: hand full"],
                [101, "SWING", "DROP", "compact history: arrived"]]),
        },
        {
            entity_id: "drill:3", entity_type: "drill", label: "Drill 3 (iron-ore)", source: undefined,
            sink: { entity_id: "chest:1", entity_type: "chest", label: "Chest 1" }, items: ["iron-ore"],
            initial_status: "UNKNOWN", initial_factorio_state: "working",
            columns: columnsOf([], [[0, "working"]]),
        },
    ],
};

describe("a compact history, read", () => {
    it("gives each transition and state with how long it lasts, up to the end of the run and never below 0", () => {
        expect(transitionsOf(history, history.entities[1])).toEqual([
            { tick: 20, from_status: "IDLE", to_status: "PICKUP", reason: "compact history: output full", duration_ticks: 0 },
            { tick: 20, from_status: "PICKUP", to_status: "SWING", reason: "compact history: hand full", duration_ticks: 81 },
            { tick: 101, from_status: "SWING", to_status: "DROP", reason: "compact history: arrived", duration_ticks: 0 },
        ]);
        expect(factorioStatesOf(history, history.entities[0])).toEqual([
            { tick: 0, state: "working", duration_ticks: 10 },
            { tick: 10, state: "full_output", duration_ticks: 30 },
            { tick: 40, state: "working", duration_ticks: 60 },
        ]);
    });

    it("expands to the serializable form, entity by entity, an entity without transitions included", () => {
        const expanded = expandStateTransitionHistory(history);
        expect(expanded.total_duration_ticks).toBe(100);
        expect(expanded.entities.map(it => it.entity_id)).toEqual(["machine:1", "inserter:2", "drill:3"]);
        expect(expanded.entities[2]).toEqual({
            entity_id: "drill:3", entity_type: "drill", label: "Drill 3 (iron-ore)", source: undefined,
            sink: { entity_id: "chest:1", entity_type: "chest", label: "Chest 1" }, items: ["iron-ore"],
            initial_status: "UNKNOWN", transitions: [], initial_factorio_state: "working",
            factorio_states: [{ tick: 0, state: "working", duration_ticks: 100 }],
        });
        expect(expanded.entities[0].transitions.map(it => it.reason)).toEqual(["compact history: output full", "compact history: taken"]);
    });

    it("reads the same made portable, and after a structured clone, with a table of only its own reasons", () => {
        const portable = toPortable(history);
        expect(portable.reasons).toEqual(["compact history: output full", "compact history: taken", "compact history: hand full", "compact history: arrived"]);
        expect(Array.from(portable.entities[1].columns.reason)).toEqual([0, 2, 3]);
        // the other columns are the history's own
        expect(portable.entities[1].columns.tick).toBe(history.entities[1].columns.tick);
        expect(toPortable(portable)).toBe(portable);
        expect(expandStateTransitionHistory(portable)).toEqual(expandStateTransitionHistory(history));
        expect(expandStateTransitionHistory(structuredClone(portable))).toEqual(expandStateTransitionHistory(history));
    });
});
