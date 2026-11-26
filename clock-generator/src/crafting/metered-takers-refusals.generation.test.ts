import { createHash } from "crypto";
import path from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import type { Config } from "../config/schema";
import { runClockAlternativeTask } from "./alternatives";
import { quiet } from "./generate-blueprint-test-helpers";
import { combineClockAlternativeRuns, coordinatedSourcesInputOf, planClockAlternatives, runCoordinatedSourcesTask, type BlueprintGenerationResult, type ClockAlternativeRun } from "./generate-blueprint";

// The refusals of the input and stagger steps on the fixture of metered-takers.generation.test.ts. They need only the worker's runs
// before the composition, not a whole generation, and are in a file of their own so that each file fits a CI shard.
describe("Round-Robin Polling with metered takers on a build whose foundries each feed three assemblers: refused input windows and staggers", () => {
    let configuration: Config;
    beforeAll(async () => {
        configuration = await loadConfigFromFile(path.join(__dirname, "fixtures", "utility-science-320-metered-takers.json"));
    });

    // The worker's runs before the composition, made once for the tests below
    let worker: { runs: (ClockAlternativeRun | null)[]; input: ReturnType<typeof coordinatedSourcesInputOf> } | undefined;
    function workerRuns(): NonNullable<typeof worker> {
        if (worker === undefined) {
            const plan = planClockAlternatives(configuration, { logger: quiet });
            const runs = [plan.primary, ...plan.tasks.filter(task => !task.coordinated_sources && !task.explored)
                .map(task => runClockAlternativeTask(configuration, plan.context, task.id, { logger: quiet }))];
            const before = combineClockAlternativeRuns(runs, alternative => alternative.ranking);
            const ids = before.order.map(index => before.alternatives[index].id);
            worker = { runs, input: coordinatedSourcesInputOf(runs, ids) };
        }
        return worker;
    }
    function compose() {
        const { runs, input } = workerRuns();
        const composed = runCoordinatedSourcesTask(configuration, structuredClone(input), { logger: quiet });
        const final = combineClockAlternativeRuns([...runs, composed], alternative => alternative.ranking);
        return final.alternatives[final.selected_index];
    }

    // The copy step after the stagger, silenced (its candidates emptied) where a case tests the refusals of an earlier step. The
    // generation project loads the CommonJS build: replace the copy step's proposal where the composition reads it.
    function composeWithoutCopies() {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const owner: typeof import("./candidates/region-copies") = require("../../dist/crafting/candidates/region-copies");
        const propose = owner.regionCopies;
        const spy = vi.spyOn(owner, "regionCopies").mockImplementation((...args) => {
            const proposed = propose(...args);
            return proposed && { orbits: proposed.orbits.map(orbit => ({ ...orbit, proposals: { ...orbit.proposals, candidates: [], unmade: [] } })) };
        });
        try {
            return compose();
        } finally {
            spy.mockRestore();
        }
    }

    // The belt-fed inputs of the assemblers the second foundry's takers feed: PU and FRF from turbo belt 2
    const BELT_INPUTS = [12, 20, 21];

    // Replace what the input step proposes where the composition reads it (the CommonJS build, as above)
    function composeWithInputs(alter: (proposed: { proposals: { form: string; changes: Record<string, { start: number; end: number }[]> }[] }) => unknown) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const owner = require("../../dist/crafting/candidates/metered-input-windows");
        const propose = owner.meteredInputWindows;
        const proposals: string[][] = [];
        const spy = vi.spyOn(owner, "meteredInputWindows").mockImplementation((...args: unknown[]) => {
            const proposed = propose(...args);
            proposals.push(proposed.proposals.flatMap((proposal: { changes: object }) => Object.keys(proposal.changes)));
            return alter(proposed);
        });
        try {
            return { selected: composeWithoutCopies(), proposals };
        } finally {
            spy.mockRestore();
        }
    }
    const exportedOf = (clock: BlueprintGenerationResult) => createHash("sha256")
        .update(JSON.stringify([clock.clock_windows, clock.blueprint, clock.schedule, clock.modulo_blueprint, clock.modulo_schedule])).digest("hex");
    // the run with no input proposal, made once for the two refusals below
    let without: ReturnType<typeof composeWithInputs> | undefined;
    const withoutProposal = () => without ??= composeWithInputs(proposed => ({ ...proposed, proposals: [] }));

    function expectRefused(refused: ReturnType<typeof composeWithInputs>, stage: string) {
        const unchanged = withoutProposal().selected;
        const kept = refused.selected;
        // the real step proposed windows for all three inputs
        expect(refused.proposals.some(ids => BELT_INPUTS.every(id => ids.includes(`inserter:${id}`)))).toBe(true);
        expect([kept.id, kept.verdict, kept.assessment.items_per_second.toFixed(2)]).toEqual([unchanged.id, unchanged.verdict, "320.00"]);
        expect(kept.result.clock_windows).toEqual(unchanged.result.clock_windows);
        expect(exportedOf(kept.result)).toBe(exportedOf(unchanged.result));
        for (const id of BELT_INPUTS) {
            expect(kept.result.clock_windows[`inserter:${id}`], `inserter ${id}`).toEqual([{ start: 0, end: 323 }]);
            expect((kept.result as { metered_input_windows?: Record<string, unknown> }).metered_input_windows?.[`inserter:${id}`], `inserter ${id}`)
                .toEqual({ kind: "retained", reason: "joint_check_failed", stage });
        }
    }

    it("keeps the selected and exported controls when the clock refuses 12-tick input windows", () => {
        // each proposed window cut to 12 ticks from one tick after its start: two hands' picks do not fit, and the clock falls
        // short in its first window cycle
        const refused = composeWithInputs(proposed => ({ ...proposed, proposals: proposed.proposals.slice(0, 1).map(proposal => ({ ...proposal,
            changes: Object.fromEntries(Object.entries(proposal.changes).map(([id, ranges]) => [id, ranges.map(range => ({ start: range.start + 1, end: range.start + 12 }))])) })) }));
        expectRefused(refused, "first_window_cycle");
    });

    it("keeps the selected and exported controls when the clock refuses input windows cut to one run's pick clusters", () => {
        // the pick clusters of one run of the inputs on the clock without input windows, each once a window cycle, not each service interval
        const clusters: Record<string, { start: number; end: number }[]> = {
            "inserter:12": [{ start: 42, end: 57 }, { start: 229, end: 233 }],
            "inserter:20": [{ start: 78, end: 93 }, { start: 265, end: 269 }],
            "inserter:21": [{ start: 6, end: 21 }, { start: 193, end: 197 }],
        };
        const refused = composeWithInputs(proposed => ({ ...proposed, proposals: proposed.proposals.slice(0, 1).map(proposal => ({ ...proposal, changes: clusters })) }));
        // it holds to the long run and fails the whole check, which starts the clock from its other start phases
        expectRefused(refused, "whole_check");
    });

    // The belt-fed inputs of the assemblers the first foundry's takers feed (PU and FRF from belt 5)
    const SHARED_INPUTS = [2, 3, 10];

    type StaggerProposals = { groups: { belt: string; proposals: { reference: string; changes: Record<string, unknown>; staggered: Record<string, { role: string }> }[] }[] };
    // Replace what the stagger step proposes where the composition reads it (the CommonJS build, as above)
    function composeWithStaggers(alter: (proposed: StaggerProposals) => unknown) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const owner = require("../../dist/crafting/candidates/staggered-input-windows");
        const propose = owner.staggeredInputWindows;
        const proposals: string[] = [];
        const spy = vi.spyOn(owner, "staggeredInputWindows").mockImplementation((...args: unknown[]) => {
            const proposed = propose(...args);
            proposals.push(...proposed.groups.flatMap((group: StaggerProposals["groups"][number]) => group.proposals.map(it => it.reference)));
            return alter(proposed);
        });
        try {
            return { selected: composeWithoutCopies(), proposals };
        } finally {
            spy.mockRestore();
        }
    }
    const withoutProposals = (proposed: StaggerProposals) => ({ ...proposed, groups: proposed.groups.map(group => ({ ...group, proposals: [] })) });
    // the run with no stagger proposal, made once for the two refusals below
    let unstaggered: ReturnType<typeof composeWithStaggers> | undefined;
    const withoutStagger = () => unstaggered ??= composeWithStaggers(withoutProposals);

    function expectStaggerRefused(refused: ReturnType<typeof composeWithStaggers>, decision: object) {
        const unchanged = withoutStagger().selected;
        const kept = refused.selected;
        // the real step proposed the three references of the shared window
        expect(refused.proposals).toEqual(["inserter:2", "inserter:10", "inserter:3"]);
        expect([kept.id, kept.verdict, kept.assessment.items_per_second.toFixed(2)]).toEqual([unchanged.id, unchanged.verdict, "320.00"]);
        expect(kept.result.clock_windows).toEqual(unchanged.result.clock_windows);
        expect(exportedOf(kept.result)).toBe(exportedOf(unchanged.result));
        // the clock the input step leaves: the three inputs on one shared window
        for (const id of SHARED_INPUTS) expect(kept.result.clock_windows[`inserter:${id}`], `inserter ${id}`).toEqual(kept.result.clock_windows["inserter:2"]);
        const decisions = (kept.result as { staggered_input_windows?: Record<string, unknown> }).staggered_input_windows;
        for (const id of SHARED_INPUTS) expect(decisions?.[`inserter:${id}`], `inserter ${id}`).toEqual(decision);
    }

    it("keeps the selected and exported controls when the clock refuses a stagger that keeps the shared window on another arm", () => {
        // arm 3 keeps the shared window: the clock falls short in its first window cycle from the cold start
        const refused = composeWithStaggers(proposed => ({ ...proposed, groups: proposed.groups.map(group => ({ ...group,
            proposals: group.proposals.filter(proposal => proposal.reference === "inserter:3") })) }));
        expectStaggerRefused(refused, { kind: "retained", reason: "joint_check_failed", stage: "first_window_cycle" });
    });

    it("keeps the selected and exported controls when the clock refuses the stagger without the outputs", () => {
        // the inputs moved, the outputs as the output step left them: more wake-ups than the clock
        const refused = composeWithStaggers(proposed => ({ ...proposed, groups: proposed.groups.map(group => ({ ...group,
            proposals: group.proposals.slice(0, 1).map(proposal => ({ ...proposal, changes: Object.fromEntries(Object.entries(proposal.changes)
                .filter(([id]) => proposal.staggered[id]?.role === "input")) })) })) }));
        expectStaggerRefused(refused, { kind: "retained", reason: "no_fewer_wake_ups" });
    });
});
