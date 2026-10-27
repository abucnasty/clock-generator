import { describe, expect, it } from "vitest";
import { DrillStatus, InserterStatus, MachineStatus } from "../../state/entity-status";
import { FactorioDrillState, FactorioInserterState, FactorioMachineState } from "../../state/factorio-state-names";
import { FACTORIO_STATE_NAMES, STATUS_NAMES, factorioStateCode, statusCode } from "../../state/status-codes";
import { EntityTransitionColumns } from "./transition-columns";

describe("EntityTransitionColumns", () => {
    it("keeps every transition past many growths, and seals them at their exact length", () => {
        const columns = new EntityTransitionColumns();
        const n = (1 << 16) + 3;
        for (let i = 0; i < n; i++) {
            columns.push(i * 3, i % 11, (i + 1) % 11, i * 7);
        }
        for (let i = 0; i < 5; i++) {
            columns.pushState(i * 2, i % 8);
        }
        const sealed = columns.seal();
        expect(sealed.tick.length).toBe(n);
        expect(sealed.tick.buffer.byteLength).toBe(n * 4);
        expect(sealed.from.buffer.byteLength).toBe(n);
        expect(sealed.reason.buffer.byteLength).toBe(n * 4);
        expect(sealed.state_tick.buffer.byteLength).toBe(5 * 4);
        expect(sealed.state.buffer.byteLength).toBe(5);
        expect([sealed.tick[n - 1], sealed.from[n - 1], sealed.to[n - 1], sealed.reason[n - 1]])
            .toEqual([(n - 1) * 3, (n - 1) % 11, n % 11, (n - 1) * 7]);
        expect(Array.from(sealed.state_tick)).toEqual([0, 2, 4, 6, 8]);
        expect(Array.from(sealed.state)).toEqual([0, 1, 2, 3, 4]);
    });

    it("seals nothing as empty columns", () => {
        const sealed = new EntityTransitionColumns().seal();
        expect([sealed.tick.length, sealed.from.length, sealed.to.length, sealed.reason.length, sealed.state_tick.length, sealed.state.length])
            .toEqual([0, 0, 0, 0, 0, 0]);
    });

    it("leaves a seal as it was when the columns are cleared, released or written again", () => {
        const columns = new EntityTransitionColumns();
        columns.push(5, 1, 2, 3);
        columns.pushState(5, 1);
        const sealed = columns.seal();
        columns.clear();
        columns.push(9, 4, 5, 6);
        columns.pushState(9, 2);
        columns.release();
        columns.push(11, 7, 8, 9);
        expect([Array.from(sealed.tick), Array.from(sealed.from), Array.from(sealed.to), Array.from(sealed.reason)]).toEqual([[5], [1], [2], [3]]);
        expect([Array.from(sealed.state_tick), Array.from(sealed.state)]).toEqual([[5], [1]]);
        expect(Array.from(columns.seal().tick)).toEqual([11]);
    });
});

describe("the status codes", () => {
    it("code every status and every Factorio state, each to its own name", () => {
        for (const status of [...Object.values(InserterStatus), ...Object.values(MachineStatus), ...Object.values(DrillStatus)]) {
            expect(STATUS_NAMES[statusCode(status)]).toBe(status);
        }
        for (const state of [...Object.values(FactorioInserterState), ...Object.values(FactorioMachineState), ...Object.values(FactorioDrillState)]) {
            expect(FACTORIO_STATE_NAMES[factorioStateCode(state)]).toBe(state);
        }
        expect(STATUS_NAMES.length).toBeLessThan(256);
        expect(FACTORIO_STATE_NAMES.length).toBeLessThan(256);
    });

    it("refuse a name they do not know", () => {
        expect(() => statusCode("SLEEPING")).toThrow();
        expect(() => factorioStateCode("sleeping")).toThrow();
    });
});
