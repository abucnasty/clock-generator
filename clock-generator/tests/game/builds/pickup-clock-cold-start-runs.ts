import {expect} from "vitest";
import {ClockAlternative} from "../../../src/crafting/generate-blueprint";
import {clockHash, readControls} from "./clock-controls";
import {reversedDeciders} from "./reversed-deciders";

interface ColdStartRuns {
    clocks: Record<string, {clock_sha256: string}>;
    runs: Record<string, {case: string; clock: string; rotate: number; decider_order: "built" | "reversed"}>;
}
const coldStart = readControls<{cold_start: ColdStartRuns}>("pickup-clock-start-controls.json").cold_start;

/**
 * The name of the belt-pickup-clock.generation.test.ts variant (`electromagnetic-<tier>-<geometry>-<supply>`) whose
 * generation a cold-start run names its clock from, or undefined where it does not share one. A run of a side pickup
 * fixture on near lane 1 that the generator's selection was recorded on (`rotate` 0) is the selection for exactly the
 * config that variant is generated from.
 */
export function beltPickupVariantOf(run: {case: string; rotate: number}): string | undefined {
    const fixture = run.rotate === 0 ? /^(\w+)-(.+)-(moving|backed)-l1$/.exec(run.case) : null;
    return fixture ? `electromagnetic-${fixture[1]}-${fixture[2]}-${fixture[3]}` : undefined;
}

/**
 * Checks the cold-start runs that name `variant`'s selection as the clock they were recorded on, on the generation
 * belt-pickup-clock.generation.test.ts made of it: the same checks as pickup-clock-cold-start.generation.test.ts makes of
 * the other runs, without generating the fixture again.
 */
export function expectColdStartRunsOnSelection(variant: string, selected: ClockAlternative) {
    for (const [name, run] of Object.entries(coldStart.runs)) {
        if (beltPickupVariantOf(run) !== variant) continue;
        let exported: {blueprint: any; schedule: any} = selected.result.subtick ?? selected.result;
        if (run.decider_order === "reversed") exported = reversedDeciders(exported.blueprint, exported.schedule);
        expect(clockHash(exported), `${name}: the selection (or the pinned windows) no longer make the clock these runs were recorded on`)
            .toBe(coldStart.clocks[run.clock].clock_sha256);
    }
}
