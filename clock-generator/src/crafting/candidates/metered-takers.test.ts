import { describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import { ConfigPaths } from "../../config/config-paths";
import { CodedError, MAKER_REASON_CODES, reasonOfError } from "../maker-log";
import { meteredTakersClock } from "./metered-takers";

const quiet = { log() {}, warn() {}, error() {}, debug() {} };

/** The maker's refusal, as the error it throws */
function refusalOf(make: () => unknown): Error {
    try {
        make();
    } catch (error) {
        return error as Error;
    }
    throw new Error("the maker made a clock");
}

// Called directly, as the generation calls it where no clock made before it is stable
describe("the metered takers maker", () => {
    it("makes nothing where no machine hands an ingredient to two or more of the machines that make the target, and gives a code with numbers", async () => {
        // MILITARY_SCIENCE_240: two machines make the target, and no machine feeds both
        const config = await loadConfigFromFile(ConfigPaths.MILITARY_SCIENCE_240);
        const error = refusalOf(() => meteredTakersClock(config, quiet));
        expect(error).toBeInstanceOf(CodedError);
        expect(error.message).toBe("no machine hands an ingredient to two or more of the machines that make the target");
        expect(reasonOfError(error)).toEqual({ code: "no_metered_takers", target_machines: 2 });
        expect(MAKER_REASON_CODES.no_metered_takers).toEqual(["target_machines"]);
    });

    it("refuses a count whose windows fail the as-built check and tries the next count with whole hands and crafts", async () => {
        // LDS_240: the cryogenic plant's takers move whole hands and crafts on 3, 6, 9 and 12 output swings, and no windows hold
        const config = await loadConfigFromFile(ConfigPaths.LDS_240);
        const lines: string[] = [];
        const error = refusalOf(() => meteredTakersClock(config, { ...quiet, log: (line: string) => { lines.push(line); } }));
        expect(lines.filter(line => line.startsWith("Metered takers on"))).toEqual([3, 6, 9, 12].map(swings =>
            `Metered takers on ${swings} output swings (${swings * 16} ticks): refused, the as-built check does not hold`));
        expect(error.message).toBe(`no metered takers clock holds: ${[3, 6, 9, 12].map(swings =>
            `${swings} output swings (${swings * 16} ticks): the as-built check does not hold`).join("; ")}`);
        expect(reasonOfError(error)).toEqual({ code: "no_count_holds", swings_max: 12, whole_counts: 4, as_built_refusals: 4, margin_refusals: 0 });
        expect(MAKER_REASON_CODES.no_count_holds).toEqual(["swings_max", "whole_counts", "as_built_refusals", "margin_refusals"]);
    });

    it("makes a clock on the first count whose windows hold, where the generation would ask it", async () => {
        // ADVANCED_CIRCUIT_240: a job of the record whose clock made before the fallbacks is stable, so the generation never asks it
        const config = await loadConfigFromFile(ConfigPaths.ADVANCED_CIRCUIT_240);
        const clock = meteredTakersClock(config, quiet);
        expect([clock.used_terminal_swing_count, clock.simulation_duration.ticks, clock.stability_check.as_built?.holds]).toEqual([11, 264, true]);
    });
});
