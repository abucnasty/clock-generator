import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { generateClockAlternatives, type GenerateClockOptions } from "./generate-blueprint";
import { quiet } from "./generate-blueprint-test-helpers";
import { SimulationTick } from "./runner/simulation-tick";
import { TICK_LOOPS, withTickLedger, type TickLedgerCount } from "./tick-ledger";

const total = (count: TickLedgerCount) => count.rows.reduce((sum, row) => sum + row.ticks, 0);

/**
 * One generation of the small build, with a ledger open. The ticks of the generation are counted apart, at the tick itself:
 * every call of `SimulationTick.executeForTick`, whichever loop makes it.
 */
async function generatedCounted(options: Partial<GenerateClockOptions> = {}, overrides: Config["overrides"] = {}): Promise<{ count: TickLedgerCount; calls: number }> {
    const loaded = await loadConfigFromFile(ConfigPaths.ACCUMULATOR_320);
    const config = { ...loaded, overrides: { ...loaded.overrides, ...overrides } };
    const executeForTick = SimulationTick.prototype.executeForTick;
    let calls = 0;
    SimulationTick.prototype.executeForTick = function (this: SimulationTick) {
        calls++;
        executeForTick.call(this);
    };
    try {
        let count: TickLedgerCount | undefined;
        withTickLedger(counted => { count = counted; }, () => generateClockAlternatives(config, { logger: quiet, ...options }));
        return { count: count!, calls };
    } finally {
        SimulationTick.prototype.executeForTick = executeForTick;
    }
}

/** The ticks simulated with no ledger asked for are the ticks simulated with one: the ledger asks for no run and changes none */
async function callsWithNoLedger(): Promise<number> {
    const config = await loadConfigFromFile(ConfigPaths.ACCUMULATOR_320);
    const executeForTick = SimulationTick.prototype.executeForTick;
    let calls = 0;
    SimulationTick.prototype.executeForTick = function (this: SimulationTick) {
        calls++;
        executeForTick.call(this);
    };
    try {
        withTickLedger(undefined, () => generateClockAlternatives(config, { logger: quiet }));
        return calls;
    } finally {
        SimulationTick.prototype.executeForTick = executeForTick;
    }
}

describe("the tick ledger of a generation", () => {
    let generation: Awaited<ReturnType<typeof generatedCounted>>;
    let calls_with_no_ledger: number;

    beforeAll(async () => {
        generation = await generatedCounted();
        calls_with_no_ledger = await callsWithNoLedger();
    }, 600_000);

    it("counts every tick the generation simulates: the ledger's ticks are the calls of executeForTick", () => {
        expect(generation.calls).toBeGreaterThan(0);
        expect(total(generation.count)).toBe(generation.calls);
    });

    it("leaves no tick without a purpose", () => {
        expect(generation.count.rows.filter(row => row.purpose === "no_purpose")).toEqual([]);
    });

    it("tells the loops apart: the prepare, the warm-up and the recorded run, and the loss trials of one copy", () => {
        const loops = new Set(generation.count.rows.map(row => row.loop));
        for (const loop of ["prepare_step", "warmup_step", "simulate_step", "loss_trials"] as const) expect(loops.has(loop), loop).toBe(true);
        expect(TICK_LOOPS.filter(loop => loops.has(loop)).length).toBeGreaterThanOrEqual(4);
        expect(generation.count.rows.filter(row => row.loop === "loss_trials").every(row => row.purpose === "trial_one_copy")).toBe(true);
    });

    it("simulates the same ticks with no ledger asked for", () => {
        expect(calls_with_no_ledger).toBe(generation.calls);
    });
});

// the maker log and its repeat check run a clock again, only where the log asks for them
describe("the tick ledger of a generation with the maker log and its repeat check", () => {
    let generation: Awaited<ReturnType<typeof generatedCounted>>;

    beforeAll(async () => {
        generation = await generatedCounted({ maker_log: () => { }, maker_log_repeat_check: true });
    }, 600_000);

    it("counts every tick, and the repeat check's runs to their own purpose", () => {
        expect(total(generation.count)).toBe(generation.calls);
        expect(generation.count.rows.filter(row => row.purpose === "no_purpose")).toEqual([]);
        expect(generation.count.rows.some(row => row.purpose === "repeat_check" && row.ticks > 0)).toBe(true);
    });
});

// the proof of every start phase runs in the loop of its own, and only where CLOCK_PROOF_PHASES asks for it
describe("the tick ledger of a generation that proves every start phase", () => {
    let generation: Awaited<ReturnType<typeof generatedCounted>>;
    const proof = process.env.CLOCK_PROOF_PHASES;

    beforeAll(async () => {
        process.env.CLOCK_PROOF_PHASES = "1";
        generation = await generatedCounted();
    }, 900_000);

    afterAll(() => {
        if (proof === undefined) delete process.env.CLOCK_PROOF_PHASES;
        else process.env.CLOCK_PROOF_PHASES = proof;
    });

    it("counts every tick, and the proofs to the loop of the phases", () => {
        expect(total(generation.count)).toBe(generation.calls);
        expect(generation.count.rows.filter(row => row.purpose === "no_purpose")).toEqual([]);
        expect(generation.count.rows.some(row => row.loop === "phase_proof" && row.purpose === "start_phase" && row.ticks > 0)).toBe(true);
    });
});

// a clock tried from the other starts, only where the config asks for it
describe("the tick ledger of a generation that checks start dependence", () => {
    let generation: Awaited<ReturnType<typeof generatedCounted>>;

    beforeAll(async () => {
        generation = await generatedCounted({}, { check_start_dependence: true });
    }, 600_000);

    it("counts every tick, and the runs from the other starts to their own purposes", () => {
        expect(total(generation.count)).toBe(generation.calls);
        expect(generation.count.rows.filter(row => row.purpose === "no_purpose")).toEqual([]);
        expect(generation.count.rows.some(row => row.purpose === "start_dependence" && row.ticks > 0)).toBe(true);
    });
});
