import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { planClockAlternatives, runClockAlternativeTask, runCoordinatedSourcesTask, type ClockAlternativeRun } from "./alternatives";
import { combineClockAlternativeRuns } from "./rank";
import { coordinatedSourcesInputOf, type CoordinatedSourcesInput, type CoordinatedSourcesPart } from "./candidates/coordinated-sources-parts";
import type { NotMadeClock } from "./why-not-stable";
import { quiet } from "./generate-blueprint-test-helpers";
import { currentRunMemo, withRunMemo } from "./plan/run-memo";
import { disturbanceTrialKey } from "./trial";
import type { MakerLogEvent, MakerReason } from "./maker-log";
import { generateClockAlternatives } from "./generate-blueprint";

const options = { logger: quiet };
/** The strategy of a part that is not a listed clock, as the input gives a way of the grouped hands construction */
const WAY = { id: "round_robin_polling", tuning_method: "calculated" } as const;

/**
 * The input of the per-branch clock as a generation makes it, from the clocks made before it (the searches and the clocks for
 * another belt left out), and the signatures of those clocks
 */
async function inputOf(key: keyof typeof ConfigPaths): Promise<{ config: Config; input: CoordinatedSourcesInput; signatures: string[] }> {
    const config = await loadConfigFromFile(ConfigPaths[key]);
    let primary = "";
    const plan = planClockAlternatives(config, options, (_context, _tasks, signature) => { primary = signature; });
    const runs = [plan.primary, ...plan.tasks.filter(task => !task.only_when_needed && task.coordinated_sources !== true && task.explored !== true)
        .map(task => runClockAlternativeTask(config, plan.context, task.id, options, [primary]))];
    const combined = combineClockAlternativeRuns(runs, it => it.ranking);
    const signatures: string[] = [];
    const walk = (run: ClockAlternativeRun) => { signatures.push(run.signature); run.also?.forEach(walk); };
    runs.forEach(run => { if (run !== null) walk(run); });
    return { config, input: coordinatedSourcesInputOf(runs, combined.order.map(index => combined.alternatives[index].id)), signatures };
}

/** The per-branch clock made from an input, and what it wrote to not_made */
function composed(config: Config, input: CoordinatedSourcesInput, signatures: readonly string[]) {
    const not_made: NotMadeClock[] = [];
    const run = runCoordinatedSourcesTask(config, input, { ...options, on_not_made: clock => { not_made.push(clock); } }, signatures);
    return { run, not_made };
}

// ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED: the recycler's inserters are outside the plan, and the recommended clock is planned on
// cycles of its own (`overrides.lcm`), which set their clocks
describe("the per-branch clock of a build with inserters outside the shared plan", () => {
    it("is tried on one copy under one key by the maker and the listing: the listing's trials of the clock made are the maker's", async () => {
        const made = await inputOf("ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED");
        const recommended = made.input.parts.find(part => part.alternative_id === made.input.recommended_id)!;
        expect(recommended.plan?.lcm).toBeDefined();
        let hits = 0;
        const { run } = withRunMemo(() => {
            const composed_here = composed(made.config, made.input, made.signatures);
            hits = currentRunMemo()!.loss_hits;
            return composed_here;
        });
        expect(run?.alternatives.map(it => it.id)).toEqual(["coordinated_sources"]);
        // the maker tried every composition once and the listing asked again for the one it lists
        expect(hits).toBe(1);
        // on the plan's config, with its cycles, the key of the clock made is another
        const clock = run!.alternatives[0].result;
        const on_plan = { ...made.config, overrides: { ...made.config.overrides, lcm: recommended.plan!.lcm } };
        expect(disturbanceTrialKey(on_plan, clock)).not.toBe(disturbanceTrialKey(made.config, clock));
    });
});

// AUTOMATION_SCIENCE_240: on one copy the local choice ends on a clock of 0 wakeups a minute, whose copies lose swings on the lanes they
// share; with the copies it ends on another clock, which holds with them
describe("the per-branch clock of the automation science build", () => {
    it("is never the clock of 0 wakeups that loses swings with the copies, but the one that holds with them", async () => {
        const events: MakerLogEvent[] = [];
        const generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE_240),
            { logger: quiet, maker_log: event => { events.push(event); } });
        const compositions = events.filter(event => event.event === "composition");
        // the local choice on one copy ends on the clock of 0 wakeups; with the copies it is dropped, and never made
        const zero = compositions.filter(event => event.wake_ups === 0);
        expect(zero.map(event => [event.outcome, (event.reason as MakerReason | null)?.code ?? null])).toContainEqual(["dropped", "does_not_hold_with_copies"]);
        expect(zero.filter(event => event.outcome === "listed")).toEqual([]);
        const selected = generated.alternatives[generated.selected_index];
        expect([selected.id, selected.verdict]).toEqual(["coordinated_sources", "stable"]);
        // 72 ticks with the waits at the lanes' underground entrances (#737); 70.065 on a 216-tick clock before them
        expect(selected.ranking.wake_ups_per_minute).toBeCloseTo(70.195, 3);
        expect(selected.result.coordinated_sources!.parts).toEqual({ "belt:1": "takt_batches_observed_swings_2", "machine:1": "euclidean_swings" });
    });
});

// The per-branch clock of the lithium plate build (LITHIUM_PLATE_80_SILO_CHEST) is a check of that job in the record
// (tests/game/builds/job-checks/samples.ts): the record's generation is the same one

// ELECTROMAGNETIC_SCIENCE_330: the local choice keeps the recommended clock, which the maker judges with the copies before it refuses
describe("the per-branch clock of a build where the local choice keeps the recommended clock", () => {
    it("judges the recommended clock with the copies under the listing's keys: the listing's judgement is a hit", async () => {
        const config = await loadConfigFromFile(ConfigPaths.ELECTROMAGNETIC_SCIENCE_330);
        const hits = withRunMemo(() => {
            generateClockAlternatives(config, { logger: quiet });
            const memo = currentRunMemo()!;
            return [memo.shared_lane_check_hits, memo.copies_trial_hits];
        });
        expect(hits).toEqual([1, 1]);
    });
});

// MILITARY_SCIENCE_240: the per-branch clock is made from the clocks before it and listed
describe("the per-branch clock of the military science build", () => {
    let made: Awaited<ReturnType<typeof inputOf>>;
    let recommended: CoordinatedSourcesPart;
    beforeAll(async () => {
        made = await inputOf("MILITARY_SCIENCE_240");
        recommended = made.input.parts.find(part => part.alternative_id === made.input.recommended_id)!;
    });

    it("is listed where it is another clock than those made before it", () => {
        const { run, not_made } = composed(made.config, made.input, made.signatures);
        expect(run?.alternatives.map(it => it.id)).toEqual(["coordinated_sources"]);
        expect(not_made).toEqual([]);
    });

    it("is judged with the copies once a window cycle: the listing's judgement of the clock made is the maker's", () => {
        expect(made.input.window_cycle_ids?.length).toBe(2);
        const hitsOf = (input: CoordinatedSourcesInput) => withRunMemo(() => {
            const { run } = composed(made.config, input, made.signatures);
            expect(run?.alternatives.map(it => it.id)).toEqual(["coordinated_sources"]);
            const memo = currentRunMemo()!;
            return [memo.shared_lane_check_hits, memo.copies_trial_hits];
        });
        expect(hitsOf({ ...made.input, window_cycle_ids: undefined })).toEqual([1, 1]);
        // a clock made on each of the two window cycles, each judged by the maker and then by the listing
        expect(hitsOf(made.input)).toEqual([2, 2]);
    });

    it("is in not_made where it is the same clock as one made before it", () => {
        const one_cycle = { ...made.input, window_cycle_ids: undefined };
        const first = composed(made.config, one_cycle, made.signatures).run!;
        const { run, not_made } = composed(made.config, one_cycle, [...made.signatures, first.signature]);
        expect(run).toBeNull();
        expect(not_made.map(it => [it.id, it.label])).toEqual([["per-branch", "Coordinated Sources"]]);
        expect(not_made[0].reason).toMatch(/^Made, and the same clock as one made before it, which is listed\./);
        // on every window cycle, the clock of another window cycle is listed in its place, and nothing is in not_made
        const others = composed(made.config, made.input, [...made.signatures, first.signature]);
        expect(others.run!.alternatives[0].result.simulation_duration.ticks).not.toBe(first.alternatives[0].result.simulation_duration.ticks);
        expect(others.not_made).toEqual([]);
    });

    it("is in not_made where it is refused, with the parts it takes no windows from and why", () => {
        // a window cycle that does not divide the recommended clock's, and windows of one tick a window cycle for every inserter
        const uneven: CoordinatedSourcesPart = { ...recommended, name: "uneven", alternative_id: undefined, verdict: undefined, window_cycle_ticks: 7 };
        const starved: CoordinatedSourcesPart = { name: "starved", window_cycle_ticks: recommended.window_cycle_ticks, counted: undefined,
            windows: Object.fromEntries(Object.keys(recommended.windows).map(id => [id, [{ start: 0, end: 0 }]])) };
        const { run, not_made } = composed(made.config, { ...made.input, parts: [recommended, uneven, starved] }, made.signatures);
        expect(run).toBeNull();
        expect(not_made.map(it => it.id)).toEqual(["per-branch"]);
        const ticks = recommended.window_cycle_ticks;
        expect(not_made[0].reason).toContain("no source has another choice than the recommended clock's. Not taken: "
            + `uneven (its window cycle of 7 ticks does not divide the shared one of ${ticks}); starved (its clock does not hold its first window cycle on ${ticks} ticks: `);
    });

    it("takes no source's windows from a part where the recommended clock with only those windows does not hold to the long run, and says so", () => {
        const starved: CoordinatedSourcesPart = { name: "starved", window_cycle_ticks: recommended.window_cycle_ticks, counted: undefined,
            windows: Object.fromEntries(Object.keys(recommended.windows).map(id => [id, [{ start: 0, end: 0 }]])) };
        const { run, not_made } = composed(made.config, { ...made.input, parts: [recommended, starved] }, made.signatures);
        expect(run).toBeNull();
        const reason = not_made[0].reason;
        // every source the starved part gives other windows is tried alone, and named with what its check found
        const sources = [...reason.matchAll(/with only its windows for ([a-z]+:\d+), the recommended clock does not hold /g)].map(it => it[1]);
        expect(sources.length).toBeGreaterThan(0);
        expect(new Set(sources).size).toBe(sources.length);
        expect(reason).not.toContain("taken for");
    });

    it("takes one source's windows from a part whose clock does not hold as a whole, where the recommended clock with only those windows holds", () => {
        const listed = composed(made.config, made.input, made.signatures).run!.alternatives[0];
        const { parts, sources } = listed.result.coordinated_sources!;
        // a source the listed clock takes from another clock than the recommended one, with windows for each of its inserters
        const source = sources.find(it => parts[it.source] !== made.input.recommended_id && Object.values(it.entities).every(entity => entity.kind === "strategy"))!;
        const ids = Object.keys(source.entities);
        // its windows from the listed clock, and windows of one tick a window cycle for every other inserter
        const one_source: CoordinatedSourcesPart = { name: "one source", strategy: WAY, window_cycle_ticks: recommended.window_cycle_ticks, counted: undefined,
            windows: Object.fromEntries(Object.keys(recommended.windows).map(id => [id, ids.includes(id) ? listed.result.clock_windows[id] : [{ start: 0, end: 0 }]])) };
        const { run } = composed(made.config, { ...made.input, parts: [recommended, one_source] }, made.signatures);
        expect(run?.alternatives.map(it => [it.id, it.verdict])).toEqual([["coordinated_sources", "stable"]]);
        const taken = run!.alternatives[0].result.coordinated_sources!.parts;
        expect(Object.entries(taken).filter(([, part]) => part === "one source").map(([it]) => it)).toEqual([source.source]);
    });
});
