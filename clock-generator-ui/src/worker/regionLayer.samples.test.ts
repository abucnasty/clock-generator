import { describe, expect, it } from 'vitest';
import {
    generateClockAlternatives, planClockAlternatives, regionLayerTaskOf, runClockAlternativeTask, runCoordinatedSourcesTask, runRegionLayerTask, withoutOutsideSupply,
    type ClockAlternative, type ClockAlternativeRun,
} from 'clock-generator';
import { combineClockAlternativeRuns, coordinatedSourcesInputOf, searchesAreNeeded, searchesToRun } from 'clock-generator/light';
import { ConfigPaths } from '../../../clock-generator/dist/config/config-paths.js';
import { loadConfigFromFile } from '../../../clock-generator/dist/config/loader.js';

const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
const rank = (clock: ClockAlternative) => clock.ranking;
/** What a message to a worker carries: plain data only */
const posted = <T,>(value: T): T => structuredClone(value);
/** The signatures of a run and of the runs listed after it, which the per-branch clock and the region step do not list again */
const signaturesOf = (run: ClockAlternativeRun): string[] => [run.signature, ...(run.also ?? []).flatMap(signaturesOf)];
const signaturesOfAll = (runs: (ClockAlternativeRun | null)[]) => runs.flatMap(run => run === null ? [] : signaturesOf(run));

/** The generation of a build as the page runs it: the plan, each task in a worker of its own, the searches that wait and the per-branch
 * clock after them, then the region step, ranked as the page ranks them (useSimulationWorker.ts). Gives the page's ranking and the engine's own */
async function pageAndEngine(file: string) {
    const config = withoutOutsideSupply(await loadConfigFromFile(file));
    let context: Parameters<typeof runClockAlternativeTask>[1] | undefined;
    const plan = planClockAlternatives(config, { logger: quiet }, given => { context = posted(given); });
    const task = (id: string, assessed: string[]) => runClockAlternativeTask(config, context!, id, { logger: quiet }, assessed);
    const runs: (ClockAlternativeRun | null)[] = [plan.primary];
    const primary = plan.primary === null ? [] : [plan.primary.signature];
    const tasks = plan.tasks.filter(it => !it.coordinated_sources && !it.explored);
    for (const it of tasks.filter(it => !it.only_when_needed)) runs.push(task(it.id, primary));
    const waiting = tasks.filter(it => it.only_when_needed);
    const searches = waiting.filter(it => !it.fallback);
    const fallbacks = waiting.filter(it => it.fallback);
    for (const it of searchesToRun(runs, rank, searches, context!.window_cycle_ticks)) runs.push(task(it.id, primary));
    if (searchesAreNeeded(runs, rank)) for (const it of fallbacks) runs.push(task(it.id, primary));
    if (plan.tasks.some(it => it.coordinated_sources)) {
        const ranked = combineClockAlternativeRuns(runs, rank);
        runs.push(runCoordinatedSourcesTask(config, posted(coordinatedSourcesInputOf(runs, ranked.order.map(index => ranked.alternatives[index].id))),
            { logger: quiet }, signaturesOfAll(runs)));
    }
    // the worker plans the region step last; it is made from the clock every run before it recommends, read as the page reads a listed clock
    expect(regionLayerTaskOf(context!)).toMatchObject({ id: 'region-layer', region_layer: true });
    const so_far = combineClockAlternativeRuns(runs, rank);
    const clock = so_far.alternatives[so_far.selected_index];
    const input = { regions: context!.regions!, recommended: { id: clock.id, wake_ups: clock.assessment.wake_ups_per_minute,
        window_cycle_ticks: clock.result.simulation_duration.ticks, windows: clock.result.clock_windows } };
    runs.push(runRegionLayerTask(config, posted(input), { logger: quiet }, signaturesOfAll(runs)));
    const page = combineClockAlternativeRuns(runs, rank);
    const engine = generateClockAlternatives(config, { logger: quiet });
    return { page: page.alternatives[page.selected_index], engine: engine.alternatives[engine.selected_index] };
}

describe('the page\'s generation of a build with repeated groups of machines', () => {
    it('utility science 320: lists one group\'s clock on both groups and recommends it, as the engine\'s own generation does', async () => {
        const { page, engine } = await pageAndEngine(ConfigPaths.UTILITY_SCIENCE_320_METERED_TAKERS);
        expect([page.maker, page.verdict]).toEqual(['region-layer', 'stable']);
        expect([page.id, page.assessment.wake_ups_per_minute, page.deciders]).toEqual([engine.id, engine.assessment.wake_ups_per_minute, engine.deciders]);
        expect(page.result.clock_windows).toEqual(engine.result.clock_windows);
    }, 600_000);

    it('grenade 240: moves the other group by the offset of the clock the page recommends before, as the engine\'s own generation does', async () => {
        const { page, engine } = await pageAndEngine(ConfigPaths.GRENADE_240_FILLS_BELT_EXACTLY);
        expect([page.maker, page.verdict, page.result.region_layer?.shift]).toEqual(['region-layer', 'stable', { 'machine:3/region:2': -56 }]);
        expect([page.id, page.assessment.wake_ups_per_minute, page.deciders]).toEqual([engine.id, engine.assessment.wake_ups_per_minute, engine.deciders]);
        expect(page.result.clock_windows).toEqual(engine.result.clock_windows);
    }, 600_000);
});
