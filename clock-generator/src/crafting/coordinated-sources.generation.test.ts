import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";
import type { Config } from "../config/schema";
import { planClockAlternatives, runClockAlternativeTask, runCoordinatedSourcesTask, type ClockAlternativeRun } from "./alternatives";
import { combineClockAlternativeRuns } from "./rank";
import { coordinatedSourcesInputOf, type CoordinatedSourcesInput, type CoordinatedSourcesPart } from "./candidates/coordinated-sources-parts";
import type { NotMadeClock } from "./why-not-stable";
import { quiet } from "./generate-blueprint-test-helpers";

const options = { logger: quiet };

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
    return { config, input: coordinatedSourcesInputOf(runs, combined.alternatives[combined.selected_index].id), signatures };
}

/** The per-branch clock made from an input, and what it wrote to not_made */
function composed(config: Config, input: CoordinatedSourcesInput, signatures: readonly string[]) {
    const not_made: NotMadeClock[] = [];
    const run = runCoordinatedSourcesTask(config, input, { ...options, on_not_made: clock => { not_made.push(clock); } }, signatures);
    return { run, not_made };
}

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

    it("is in not_made where it is the same clock as one made before it", () => {
        const first = composed(made.config, made.input, made.signatures).run!;
        const { run, not_made } = composed(made.config, made.input, [...made.signatures, first.signature]);
        expect(run).toBeNull();
        expect(not_made.map(it => [it.id, it.label])).toEqual([["per-branch", "Coordinated Sources"]]);
        expect(not_made[0].reason).toMatch(/^Made, and the same clock as one made before it, which is listed\./);
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
});
