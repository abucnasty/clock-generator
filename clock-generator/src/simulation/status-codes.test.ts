import { describe, expect, it } from "vitest";
import { DrillStatus, InserterStatus, MachineStatus } from "../state/entity-status";
import { FACTORIO_MACHINE_STATE, factorioDrillState } from "../state/factorio-entity-state";
import { DrillState } from "../state/drill-state";
import { MiningDrill } from "../entities";
import {
    CRAFTING_STATUS_DEFINES, CraftingStatus, craftingStatusOf, DRILL_STATUS_DEFINES, DrillStatusCode, drillStatusCodeOf,
    drillStatusOf, InserterPhase, inserterPhaseOf, inserterStatusOf, machineStatusOf,
} from "./status-codes";

/** The codes of a table are 0, 1, 2, ... in the order of its keys */
function expectDense(codes: Record<string, number>): void {
    expect(Object.values(codes)).toEqual(Object.values(codes).map((_, index) => index));
}

describe("status codes", () => {
    it("map every machine status to a crafting status and back, the code named after the define the game shows", () => {
        expectDense(CraftingStatus);
        const statuses = Object.values(MachineStatus);
        expect(new Set(statuses.map(craftingStatusOf)).size).toBe(Object.values(CraftingStatus).length);
        for (const status of statuses) {
            expect(machineStatusOf(craftingStatusOf(status))).toBe(status);
            expect(CRAFTING_STATUS_DEFINES[craftingStatusOf(status)]).toBe(FACTORIO_MACHINE_STATE[status]);
        }
        for (const code of Object.values(CraftingStatus)) {
            expect(craftingStatusOf(machineStatusOf(code))).toBe(code);
        }
        for (const [name, code] of Object.entries(CraftingStatus)) {
            expect(CRAFTING_STATUS_DEFINES[code]).toBe(name.toLowerCase());
        }
    });

    it("map every drill status to a code and back, the code named after the define the game shows", () => {
        expectDense(DrillStatusCode);
        const statuses = Object.values(DrillStatus);
        expect(new Set(statuses.map(drillStatusCodeOf)).size).toBe(Object.values(DrillStatusCode).length);
        for (const status of statuses) {
            expect(drillStatusOf(drillStatusCodeOf(status))).toBe(status);
            const drill_state = DrillState.fromEntity(MiningDrill.fromConfig(
                { id: 1, type: "big-mining-drill", mined_item_name: "iron-ore", speed_bonus: 0, productivity: 0, target: { type: "chest", id: 1 } }));
            drill_state.status = status;
            expect(DRILL_STATUS_DEFINES[drillStatusCodeOf(status)]).toBe(factorioDrillState(drill_state));
        }
        for (const code of Object.values(DrillStatusCode)) {
            expect(drillStatusCodeOf(drillStatusOf(code))).toBe(code);
        }
        for (const [name, code] of Object.entries(DrillStatusCode)) {
            expect(DRILL_STATUS_DEFINES[code]).toBe(name.toLowerCase());
        }
    });

    it("map every inserter status to a phase and back, the phase named after the status string", () => {
        expectDense(InserterPhase);
        const statuses = Object.values(InserterStatus);
        expect(new Set(statuses.map(inserterPhaseOf)).size).toBe(Object.values(InserterPhase).length);
        for (const status of statuses) {
            expect(inserterStatusOf(inserterPhaseOf(status))).toBe(status);
        }
        for (const [name, phase] of Object.entries(InserterPhase)) {
            expect(inserterPhaseOf(inserterStatusOf(phase))).toBe(phase);
            expect(inserterStatusOf(phase)).toBe(name);
        }
    });
});
