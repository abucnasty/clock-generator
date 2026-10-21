import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClockAlternativeContext, ConfigValidation, DebugSteps } from 'clock-generator/browser';
import type { ClockAlternativeView, RepeatedUnitsRecovery, WorkerRequest, WorkerResponse } from '../worker/types';
import { afterCheck, CHECK_TEXT, decideGenerate, PendingChecks } from '../utils/checkThenGenerate';
import { formDataToConfig } from '../utils/configForm/configMapping';
import { createDefaultConfig } from '../utils/configForm/formData';
import { useSimulationWorker } from './useSimulationWorker';

const runner = await vi.hoisted(async () => {
    const { createHookRunner } = await import('../test/hookRunner');
    return { ...createHookRunner(), createWorker: vi.fn<() => Worker>(), loadData: vi.fn<() => Promise<string>>() };
});
vi.mock('react', () => runner.react);
vi.mock('../worker/engineClient', () => ({
    createSimulationWorker: () => runner.createWorker(), loadFactorioData: () => runner.loadData(),
    askEngine: async () => ({ recipeNames: [], hiddenRecipes: [], itemNames: [], resourceNames: [], names: {}, recipes: new Map() }),
}));
vi.mock('../utils/resultsStore', () => ({
    openResultsStore: async () => ({ entries: () => [], put: async () => {}, setPick: async () => {} }),
    readShownMarker: () => null, writeShownMarker: () => {},
}));

class WorkerTransport {
    messages: WorkerRequest[] = [];
    onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminate = vi.fn();
    postMessage(message: WorkerRequest) { this.messages.push(message); }
    send(data: WorkerResponse) { this.onmessage?.({ data } as MessageEvent<WorkerResponse>); }
    crash() { this.onerror?.({ message: 'module script failed to load' } as ErrorEvent); }
    requests<T extends WorkerRequest['type']>(type: T) { return this.messages.filter((m): m is Extract<WorkerRequest, { type: T }> => m.type === type); }
}
let workers: WorkerTransport[];
/** A plan as the planning worker sends it: the tasks first, then the primary alternative once it is assessed */
function sendPlanned(planner: WorkerTransport, planned: Omit<Extract<WorkerResponse, { type: 'planned' }>, 'type' | 'primarySignature'>,
    primary: Extract<WorkerResponse, { type: 'primary-completed' }>['primary']) {
    planner.send({ type: 'planned', primarySignature: primary?.signature ?? 'primary', ...planned });
    planner.send({ type: 'primary-completed', runId: planned.runId, primary });
}
const config = formDataToConfig(createDefaultConfig());
const debug = {} as DebugSteps, validation = {} as ConfigValidation;
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const Render = () => { runner.begin(); const hook = useSimulationWorker(); runner.commit(); return hook; };
async function initialize() {
    const initializing = Render().initialize();
    await flush();
    workers.forEach(w => w.send({ type: 'initialized' }));
    await initializing;
    expect(Render().isInitialized).toBe(true);
}
function passCheck(worker: WorkerTransport) {
    worker.send({ type: 'validated', requestId: worker.requests('validate').at(-1)!.requestId, validation });
}
function plan(planner: WorkerTransport) {
    const { runId } = planner.requests('plan').at(-1)!;
    sendPlanned(planner, { runId, context: {} as ClockAlternativeContext, assumptions: { startDependenceRequested: false },
        tasks: [{ id: 'one', label: 'One', only_when_needed: false }, { id: 'two', label: 'Two', only_when_needed: false }] }, null);
    return runId;
}
function finishGeneration(planner: WorkerTransport) {
    const runId = plan(planner);
    const busy = workers.filter(w => w.requests('task').some(m => m.runId === runId));
    expect(busy).toHaveLength(2);
    busy.forEach(w => {
        const request = w.requests('task').find(m => m.runId === runId)!;
        w.send({ type: 'task-completed', runId, taskId: request.taskId, run: null });
    });
    expect(Render().isRunning).toBe(false);
    expect(Render().error).toBeNull();
}

function selectionClock(id: string, wakeUps: number): ClockAlternativeView {
    return { id, label: id, verdict: 'stable', ranking: { meets_target_rate: true, rate_off_target: 0,
        holds_expected_output: true, matches_belt_choice: true, wake_ups_per_minute: wakeUps, window_count: 1 },
        assessment: { holds: true, items_per_second: 1, wake_ups_per_minute: wakeUps,
            backpressure_loss: { survives: true, broken_by: [], recovered_after_periods: 1 }, start_dependence: null },
        deadlockRisk: null, beltLabel: '', assumptions: { loopSeeds: [], outputDrops: [], machineFuel: [], overrides: undefined },
    } as unknown as ClockAlternativeView;
}

function planSelection(clocks: ClockAlternativeView[], pending = false) {
    const request = workers[0].requests('plan').at(-1)!;
    sendPlanned(workers[0], { runId: request.runId,
        context: {} as ClockAlternativeContext, assumptions: { startDependenceRequested: false },
        tasks: pending ? [{ id: 'remaining', label: 'Remaining', only_when_needed: false }] : [] }, { signature: `run-${request.runId}`, alternatives: clocks });
    return request.runId;
}

describe('selection after generation', () => {
    it('keeps the clocks that could not be made in the order of their tasks, whichever finishes first', async () => {
        await initialize();
        Render().runSimulation(config, debug, false);
        const planner = workers[0];
        const runId = plan(planner);
        const finish = (taskId: string) => {
            const worker = workers.find(worker => worker.requests('task').some(request => request.taskId === taskId && request.runId === runId))!;
            worker.send({ type: 'task-completed', runId, taskId, run: null,
                notMade: [{ id: taskId, label: taskId === 'one' ? 'One' : 'Two', reason: `no ${taskId} passes the clock-only check` }] });
        };
        finish('two');
        finish('one');
        expect(Render().isRunning).toBe(false);
        expect(Render().notMade.map(clock => clock.label)).toEqual(['One', 'Two']);
        // a new run starts without them
        Render().runSimulation(config, debug, false);
        expect(Render().notMade).toEqual([]);
    });
    it.each([false, true])('keeps the first display alias when duplicate workers finish in either order (later first: %s)', async laterFirst => {
        await initialize();
        Render().runSimulation(config, debug, false);
        const planner = workers[0];
        const {runId} = planner.requests('plan').at(-1)!;
        sendPlanned(planner, {runId, context: {} as ClockAlternativeContext, assumptions: {startDependenceRequested: false},
            tasks: [{id: 'first', label: 'First', only_when_needed: false},
                {id: 'second', label: 'Second', only_when_needed: false}]}, null);
        const finish = (taskId: string) => {
            const worker = workers.find(worker => worker.requests('task').some(request => request.taskId === taskId))!;
            worker.send({type: 'task-completed', runId, taskId,
                run: {signature: 'same-clock', alternatives: [selectionClock(taskId, 1)]}});
        };
        finish(laterFirst ? 'second' : 'first');
        expect(Render().isRunning).toBe(true);
        finish(laterFirst ? 'first' : 'second');
        expect(Render().isRunning).toBe(false);
        expect(Render().alternatives.map(alternative => alternative.id)).toEqual(['first']);
    });
    it.each([false, true])('shares completed assessments without hiding an earlier display alias (later task first: %s)', async laterFirst => {
        vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
        await initialize();
        Render().runSimulation(config, debug, false);
        const planner = workers[0];
        const {runId} = planner.requests('plan').at(-1)!;
        const laterId = laterFirst ? 'fractional' : 'second';
        sendPlanned(planner, {runId, context: {} as ClockAlternativeContext, assumptions: {startDependenceRequested: false},
            tasks: [{id: 'first', label: 'First', only_when_needed: false},
                {id: laterId, label: 'Later', only_when_needed: false}]}, null);
        const firstRequest = planner.requests('task').at(-1)!;
        expect(firstRequest.taskId).toBe(laterFirst ? laterId : 'first');
        planner.send({type: 'task-completed', runId, taskId: firstRequest.taskId,
            run: {signature: 'same-clock', alternatives: [selectionClock(firstRequest.taskId, 1)]}});
        const nextRequest = planner.requests('task').at(-1)!;
        if (laterFirst) expect(nextRequest.assessedSignatures).not.toContain('same-clock');
        else expect(nextRequest.assessedSignatures).toContain('same-clock');
        planner.send({type: 'task-completed', runId, taskId: nextRequest.taskId,
            run: {signature: 'same-clock', alternatives: laterFirst ? [selectionClock('first', 1)] : []}});
        expect(Render().isRunning).toBe(false);
        expect(Render().alternatives.map(alternative => alternative.id)).toEqual(['first']);
    });
    it.each(['same build', 'different build', 'deeper search'])('selects the new recommendation instead of a reused clock id for %s', async kind => {
        await initialize();
        const recommended = selectionClock('recommended', 1), other = selectionClock('other', 10);
        Render().runSimulation(config, debug, false);
        planSelection([recommended, other]);
        Render().selectAlternative(1);
        expect(Render().selectedAlternativeIndex).toBe(1);
        const nextConfig = kind === 'different build' ? { ...config, target_output: { ...config.target_output, items_per_second: 99 } } : config;
        Render().runSimulation(nextConfig, debug, false, kind === 'deeper search');
        // Reverse the list so choosing index 0 blindly would also fail.
        planSelection([other, recommended]);
        expect(Render().isRunning).toBe(false);
        expect(Render().recommendedIndex).toBe(1);
        expect(Render().selectedAlternativeIndex).toBe(Render().recommendedIndex);
        expect(Render().pickGone).toBeNull();
    });

    it('selects the final recommendation even after inspecting another clock during generation', async () => {
        await initialize();
        Render().runSimulation(config, debug, false);
        const runId = planSelection([selectionClock('early-best', 5), selectionClock('inspected', 10)], true);
        expect(Render().isRunning).toBe(true);
        Render().selectAlternative(1);
        const worker = workers.find(w => w.requests('task').some(request => request.runId === runId))!;
        worker.send({ type: 'task-completed', runId, taskId: 'remaining', run: { signature: 'better', alternatives: [selectionClock('final-best', 1)] } });
        const finished = Render();
        expect(finished.isRunning).toBe(false);
        expect(finished.selectedAlternativeIndex).toBe(finished.recommendedIndex);
        expect(finished.alternatives[finished.selectedAlternativeIndex].id).toBe('final-best');
    });

    it('keeps the manual choice through consecutive intermediate publications before another render', async () => {
        await initialize();
        Render().runSimulation(config, debug, false);
        const request = workers[0].requests('plan').at(-1)!;
        sendPlanned(workers[0], { runId: request.runId,
            context: {} as ClockAlternativeContext, assumptions: { startDependenceRequested: false },
            tasks: [
                { id: 'one', label: 'One', only_when_needed: false },
                { id: 'two', label: 'Two', only_when_needed: false },
                { id: 'three', label: 'Three', only_when_needed: false },
            ] }, { signature: 'primary', alternatives: [selectionClock('initial-best', 5), selectionClock('inspected', 10)] });
        Render().selectAlternative(1);
        const busy = workers.filter(worker => worker.requests('task').some(task => task.runId === request.runId));
        busy.forEach((worker, index) => {
            const task = worker.requests('task').find(task => task.runId === request.runId)!;
            worker.send({ type: 'task-completed', runId: request.runId, taskId: task.taskId,
                run: { signature: `arrival-${index}`, alternatives: [selectionClock(`better-${index}`, index + 1)] } });
        });
        const running = Render();
        expect(running.isRunning).toBe(true);
        expect(running.alternatives[running.selectedAlternativeIndex].id).toBe('inspected');
        expect(running.pendingAlternatives).toEqual(['Three']);
        expect(running.generationAssumptions?.complete).toBe(false);
    });

    it('uses the latest published recommendation when the click precedes the next render', async () => {
        await initialize();
        Render().runSimulation(config, debug, false);
        planSelection([selectionClock('initial-best', 5), selectionClock('inspected', 10)], true);
        Render().selectAlternative(1);
        const beforePublication = Render();
        const request = workers[0].requests('plan').at(-1)!;
        const worker = workers.find(worker => worker.requests('task').some(task => task.runId === request.runId))!;
        worker.send({ type: 'task-completed', runId: request.runId, taskId: 'remaining',
            run: { signature: 'better', alternatives: [selectionClock('new-best', 1)] } });
        beforePublication.selectRecommended();
        const finished = Render();
        expect(finished.alternatives[finished.selectedAlternativeIndex].id).toBe('new-best');
        expect(finished.generationAssumptions?.complete).toBe(true);
        expect(finished.pendingAlternatives).toEqual([]);
    });

    it('clears the entire result view and starts the next generation with fresh metadata', async () => {
        await initialize();
        Render().runSimulation(config, debug, false, true);
        planSelection([selectionClock('partial', 1)], true);
        Render().cancel();
        expect(Render()).toMatchObject({ stoppedEarly: true, searchedDeeper: true });
        Render().clearResults();
        expect(Render()).toMatchObject({ generationAssumptions: null, alternatives: [], selectedAlternativeIndex: 0,
            pendingAlternatives: [], skippedSearches: [], searchedDeeper: false, pickRule: null,
            generatedFor: null, stoppedEarly: false, pickGone: null });
        Render().runSimulation(config, debug, false);
        expect(Render()).toMatchObject({ generationAssumptions: null, alternatives: [], selectedAlternativeIndex: 0,
            pendingAlternatives: [], skippedSearches: [], searchedDeeper: false, stoppedEarly: false, pickGone: null });
        expect(Render().generatedFor).not.toBeNull();
        expect(Render().pickRule).not.toBeNull();
    });

    it.each([false, true])('restores the previous manual pick when cancelling (partial results: %s)', async partial => {
        await initialize();
        const clocks = [selectionClock('recommended', 1), selectionClock('other', 10)];
        Render().runSimulation(config, debug, false);
        planSelection(clocks);
        Render().selectAlternative(1);
        Render().runSimulation(config, debug, false);
        if (partial) planSelection(clocks, true);
        Render().cancel();
        expect(Render().selectedAlternativeIndex).toBe(1);
        expect(Render().alternatives[1].id).toBe('other');
        expect(Render().lastStop?.kept).toBe('previous');
    });
});
beforeEach(() => {
    runner.reset(); workers = [];
    runner.createWorker.mockImplementation(() => {
        const worker = new WorkerTransport(); workers.push(worker); return worker as unknown as Worker;
    });
    runner.loadData.mockResolvedValue('{}');
    vi.stubGlobal('navigator', { hardwareConcurrency: 3 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { runner.unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function failReplacement() {
    // Pending check overlaps a generation; Cancel replaces worker0 and resends that same check once.
    Render().runSimulation(config, debug, false);
    const pending = Render().validate(config);
    Render().cancel();
    const replacement = workers[2];
    expect(replacement.requests('validate')).toHaveLength(1);
    replacement.crash(); await flush();
    expect(await pending).toEqual({ kind: 'invalid', message: CHECK_TEXT.crashText });
    expect(Render().validation).toMatchObject({ status: 'invalid', crashed: true });
    return replacement;
}

describe('tasks alongside the primary alternative', () => {
    it('offers a checked one-swing clock early on one worker and keeps the remaining verification and final ranking', async () => {
        vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
        await initialize();
        expect(workers).toHaveLength(1);
        Render().runSimulation(config, debug, false);
        const worker = workers[0];
        const { runId } = worker.requests('plan').at(-1)!;
        sendPlanned(worker, { runId, context: {} as ClockAlternativeContext,
            assumptions: { startDependenceRequested: false }, tasks: [
                { id: 'fractional', label: 'Fractional', only_when_needed: false },
                { id: 'swings-2', label: 'Two swings', only_when_needed: false },
                { id: 'swings-1', label: 'One swing', only_when_needed: false },
            ] }, null);
        expect(worker.requests('task').at(-1)?.taskId).toBe('swings-1');
        expect(Render().alternatives).toEqual([]);

        worker.send({ type: 'task-completed', runId, taskId: 'swings-1',
            run: { signature: 'one', alternatives: [selectionClock('swings-1', 10)] } });
        expect(Render().alternatives.map(a => a.id)).toEqual(['swings-1']);
        expect(Render().isRunning).toBe(true);
        expect(Render().generationAssumptions?.complete).toBe(false);
        expect(Render().pendingAlternatives).toEqual(['Fractional', 'Two swings']);
        expect(worker.requests('task').at(-1)?.taskId).toBe('fractional');

        worker.send({ type: 'task-completed', runId, taskId: 'fractional',
            run: { signature: 'fractional', alternatives: [selectionClock('fractional', 1)] } });
        worker.send({ type: 'task-completed', runId, taskId: 'swings-2',
            run: { signature: 'two', alternatives: [selectionClock('swings-2', 5)] } });
        const complete = Render();
        expect(complete.isRunning).toBe(false);
        expect(complete.pendingAlternatives).toEqual([]);
        expect(complete.alternatives.map(a => a.id)).toEqual(['fractional', 'swings-2', 'swings-1']);
        expect(complete.alternatives[complete.selectedAlternativeIndex].id).toBe('fractional');
        expect(complete.generationAssumptions?.complete).toBe(true);
    });

    it.each(['task', 'primary'] as const)('reports both kinds of work and finishes after both (%s completes first)', async first => {
        await initialize();
        Render().runSimulation(config, debug, false);
        const planner = workers[0];
        const { runId } = planner.requests('plan').at(-1)!;
        planner.send({ type: 'planned', runId, primarySignature: 'primary-clock', context: {} as ClockAlternativeContext,
            assumptions: { startDependenceRequested: false }, tasks: [{ id: 'one', label: 'One', only_when_needed: false }] });
        // the planning worker is still busy: the task goes to another one, told which clock the primary assesses
        expect(planner.requests('task')).toHaveLength(0);
        const runner = workers.find(w => w.requests('task').some(task => task.runId === runId))!;
        const task = runner.requests('task').find(it => it.runId === runId)!;
        expect(task.assessedSignatures).toEqual(['primary-clock']);
        expect(Render().progressStore.get()?.step).toBe('Batched swings, One');
        const finishTask = () => runner.send({ type: 'task-completed', runId, taskId: task.taskId, run: null });
        const finishPrimary = () => planner.send({ type: 'primary-completed', runId,
            primary: { signature: 'primary-clock', alternatives: [selectionClock('primary', 1)] } });
        const [finishFirst, finishLast] = first === 'task' ? [finishTask, finishPrimary] : [finishPrimary, finishTask];
        finishFirst();
        expect(Render().isRunning).toBe(true);
        expect(Render().progressStore.get()?.step).toBe(first === 'task' ? 'Batched swings' : 'One');
        finishLast();
        const done = Render();
        expect(done.isRunning).toBe(false);
        expect(done.alternatives.map(it => it.id)).toEqual(['primary']);
    });

    describe('a fallback, a clock for another belt than the config\'s', () => {
        const unstable = (id: string) => {
            const clock = selectionClock(id, 1);
            return { ...clock, verdict: 'unstable', ranking: { ...clock.ranking, meets_target_rate: false } } as ClockAlternativeView;
        };
        const start = () => {
            Render().runSimulation(config, debug, false);
            const planner = workers[0];
            const { runId } = planner.requests('plan').at(-1)!;
            sendPlanned(planner, { runId, context: {} as ClockAlternativeContext, assumptions: { startDependenceRequested: false },
                tasks: [{ id: 'one', label: 'One', only_when_needed: false },
                    { id: 'derived', label: 'Observed windows', only_when_needed: true },
                    { id: 'planned-moving-belt', label: 'Batched swings, moving belt', only_when_needed: true, fallback: true }] }, null);
            const requested = (taskId: string) => workers.flatMap(w => w.requests('task')).some(m => m.runId === runId && m.taskId === taskId);
            const finish = (taskId: string, clock: ClockAlternativeView | null) => {
                const worker = workers.find(w => w.requests('task').some(m => m.runId === runId && m.taskId === taskId))!;
                worker.send({ type: 'task-completed', runId, taskId, run: clock && { signature: taskId, alternatives: [clock] } });
            };
            return { requested, finish };
        };

        it('runs after the searches, while no clock made before it can be selected as stable', async () => {
            await initialize();
            const { requested, finish } = start();
            expect(requested('derived')).toBe(false);
            finish('one', unstable('one'));
            expect(requested('derived')).toBe(true);
            expect(requested('planned-moving-belt')).toBe(false);
            finish('derived', null);
            expect(requested('planned-moving-belt')).toBe(true);
            finish('planned-moving-belt', selectionClock('planned-moving-belt', 1));
            const done = Render();
            expect(done.isRunning).toBe(false);
            expect(done.skippedSearches).toEqual([]);
            expect(done.alternatives[done.selectedAlternativeIndex].id).toBe('planned-moving-belt');
        });

        it('is left out with the searches, and not listed among them, when a clock made before it is stable', async () => {
            await initialize();
            const { requested, finish } = start();
            finish('one', selectionClock('one', 1));
            const done = Render();
            expect(requested('derived')).toBe(false);
            expect(requested('planned-moving-belt')).toBe(false);
            expect(done.isRunning).toBe(false);
            expect(done.pendingAlternatives).toEqual([]);
            expect(done.skippedSearches).toEqual(['Observed windows']);
        });

        it('waits for the searches the config runs on every build, and is left out when one of them is stable', async () => {
            await initialize();
            Render().runSimulation(config, debug, false);
            const planner = workers[0];
            const { runId } = planner.requests('plan').at(-1)!;
            sendPlanned(planner, { runId, context: {} as ClockAlternativeContext, assumptions: { startDependenceRequested: false },
                tasks: [{ id: 'derived', label: 'Observed windows', only_when_needed: false },
                    { id: 'planned-moving-belt', label: 'Batched swings, moving belt', only_when_needed: true, fallback: true }] }, null);
            const all = () => workers.flatMap(w => w.requests('task')).filter(m => m.runId === runId).map(m => m.taskId);
            expect(all()).toEqual(['derived']);
            const worker = workers.find(w => w.requests('task').some(m => m.runId === runId && m.taskId === 'derived'))!;
            worker.send({ type: 'task-completed', runId, taskId: 'derived', run: { signature: 'derived', alternatives: [selectionClock('derived', 1)] } });
            expect(all()).toEqual(['derived']);
            expect(Render().isRunning).toBe(false);
            expect(Render().skippedSearches).toEqual([]);
        });
    });
});

describe('worker startup failure recovery through the hook', () => {
    it('carries typed repeated-unit recovery only for the matching Check/run and retires it on Cancel, crash and replacement', async () => {
        await initialize();
        const recovery: RepeatedUnitsRecovery = { kind: 'repeated-units', sourceConfigKey: JSON.stringify(config),
            detectedCopies: 8, configuredCopies: 0.5, units: [{ machine_ids: [1] }], conversion: { kind: 'available', multiplicity: 8, copies: 4 } };
        const pending = Render().validate(config);
        const requestId = workers[0].requests('validate').at(-1)!.requestId;
        const diagnostics = [{ kind: 'field' as const, path: ['target_output', 'copies'], message: 'Actual Copies refusal' }];
        workers[0].send({ type: 'validation-failed', requestId, message: 'Actual Copies refusal', recovery, diagnostics });
        expect(await pending).toEqual({ kind: 'invalid', message: 'Actual Copies refusal', recovery });
        expect(Render().validation).toMatchObject({ status: 'invalid', recovery, diagnostics });
        const replacement = Render().validate(config);
        workers[0].send({ type: 'validation-failed', requestId, message: 'Old refusal', recovery });
        expect(Render().validation.status).toBe('running');
        Render().clearResults();
        expect(await replacement).toEqual({ kind: 'dropped' });
        Render().runSimulation(config, debug, false);
        const firstRun = workers[0].requests('plan').at(-1)!.runId;
        workers[0].send({ type: 'error', runId: firstRun, message: 'Actual generation Copies refusal', recovery });
        expect(Render().errorRecovery).toEqual(recovery);
        Render().cancel();
        expect(Render().errorRecovery).toBeNull();
        Render().runSimulation(config, debug, false);
        workers[0].send({ type: 'error', runId: firstRun, message: 'Old generation', recovery });
        expect(Render().errorRecovery).toBeNull();
        workers[0].crash();
        expect(Render().errorRecovery).toBeNull();
        expect(Render().error).toBe(CHECK_TEXT.generationCrashed);
    });
    it('keeps worker-owned assumptions with complete, cancelled and restored results instead of later config flags', async () => {
        await initialize();
        const candidate = {
            id: 'a', label: 'A', verdict: 'stable', ranking: { meets_target_rate: true, rate_off_target: 0,
                holds_expected_output: true, matches_belt_choice: true, wake_ups_per_minute: 1, window_count: 1 },
            assessment: { holds: true, items_per_second: 1, wake_ups_per_minute: 1,
                backpressure_loss: { survives: true, broken_by: [], recovered_after_periods: 1 }, start_dependence: null },
            deadlockRisk: null, beltLabel: '', assumptions: { loopSeeds: [], outputDrops: [], machineFuel: [], overrides: undefined },
        } as unknown as ClockAlternativeView;
        const sendPlan = (planner: WorkerTransport, requested: boolean, complete: boolean) => {
            const request = planner.requests('plan').at(-1)!;
            sendPlanned(planner, { runId: request.runId,
                context: {} as ClockAlternativeContext, assumptions: { startDependenceRequested: requested },
                tasks: complete ? [] : [{ id: 'remaining', label: 'Remaining', only_when_needed: false }] }, { signature: 'a', alternatives: [candidate] });
        };
        Render().runSimulation(config, debug, false);
        sendPlan(workers[0], false, true);
        expect(Render().generationAssumptions).toEqual({ startDependenceRequested: false, complete: true });
        const requestedConfig = { ...config, overrides: { check_start_dependence: true } };
        Render().runSimulation(requestedConfig, debug, false);
        expect(Render().generationAssumptions).toBeNull();
        Render().cancel();
        expect(Render().generationAssumptions).toEqual({ startDependenceRequested: false, complete: true });
        const planner = workers.at(-1)!;
        planner.send({ type: 'initialized' });
        Render().runSimulation(requestedConfig, debug, false);
        sendPlan(planner, true, false);
        expect(Render().generationAssumptions).toEqual({ startDependenceRequested: true, complete: false });
        Render().cancel();
        expect(Render().stoppedEarly).toBe(true);
        expect(Render().generationAssumptions).toEqual({ startDependenceRequested: true, complete: false });
        const key = Render().generatedFor!.key;
        Render().clearResults({ formKey: key });
        expect(Render().generationAssumptions).toBeNull();
        expect(await Render().restoreResultsFor(key, 'replace')).toBe(true);
        expect(Render().generationAssumptions).toEqual({ startDependenceRequested: true, complete: false });
        expect(Render().alternatives[0].assessment.start_dependence).toBeNull();
    });
    it('settles the first check, then repairs once for the next Check only and completes Generate', async () => {
        await initialize();
        const failed = await failReplacement();
        expect(failed.terminate).toHaveBeenCalledOnce();
        expect(workers).toHaveLength(3);
        const pending = Render().validate(config), repaired = workers[3];
        expect(workers).toHaveLength(4);
        expect(repaired.requests('validate')).toHaveLength(1);
        expect(failed.requests('validate')).toHaveLength(1);
        repaired.send({ type: 'initialized' }); passCheck(repaired);
        expect(await pending).toEqual({ kind: 'valid', validation });
        expect(Render().validation.status).toBe('valid');
        Render().runSimulation(config, debug, false); finishGeneration(repaired);
    });
    it('Generate retries the crashed check on a fresh worker, then completes its generation', async () => {
        await initialize(); await failReplacement();
        const hook = Render();
        expect(decideGenerate({ initialized: hook.isInitialized, generating: hook.isRunning,
            checkStatus: hook.validation.status, problems: [], lastCheckCrashed: hook.validation.status === 'invalid' && hook.validation.crashed })).toEqual({ kind: 'check-first' });
        const pending = hook.validate(config), repaired = workers[3];
        repaired.send({ type: 'initialized' }); passCheck(repaired);
        expect(afterCheck(await pending)).toBe('generate');
        Render().runSimulation(config, debug, false); finishGeneration(repaired);
    });
    it('does not automatically retry repeated startup failures or settle twice from stale callbacks', async () => {
        await initialize();
        const settle = vi.spyOn(PendingChecks.prototype, 'settle'), failed = await failReplacement();
        const pending = Render().validate(config), again = workers[3];
        again.crash(); await flush();
        expect(await pending).toMatchObject({ kind: 'invalid' });
        expect(workers).toHaveLength(4);
        for (const stale of [failed, again]) {
            stale.send({ type: 'initialized' }); passCheck(stale);
            stale.send({ type: 'validation-failed', requestId: stale.requests('validate')[0].requestId, message: 'late gate failure' });
            stale.crash();
        }
        await flush();
        expect(settle).toHaveBeenCalledTimes(2);
        expect(Render().validation).toMatchObject({ status: 'invalid', crashed: true, message: CHECK_TEXT.crashText });
        expect(workers).toHaveLength(4);
        const retry = Render().validate(config);
        workers[4].send({ type: 'initialized' }); passCheck(workers[4]);
        expect(await retry).toMatchObject({ kind: 'valid' });
        expect(settle).toHaveBeenCalledTimes(3);
    });
    it.each(['initialize-error', 'data-load'] as const)('handles %s rejection and ignores late failed-gate responses', async (failure) => {
        await initialize();
        Render().runSimulation(config, debug, false);
        const pending = Render().validate(config);
        if (failure === 'data-load') runner.loadData.mockRejectedValueOnce(new Error('data unavailable'));
        Render().cancel();
        const replacement = workers[2];
        if (failure === 'initialize-error') replacement.send({ type: 'error', message: 'initialization failed' });
        await flush();
        expect(await pending).toMatchObject({ kind: 'invalid' });
        replacement.send({ type: 'validation-failed', requestId: 1, message: 'late gate failure' });
        expect(Render().validation).toMatchObject({ status: 'invalid', crashed: true, message: CHECK_TEXT.crashText });
        const retry = Render().validate(config);
        workers[3].send({ type: 'initialized' }); passCheck(workers[3]);
        expect(await retry).toMatchObject({ kind: 'valid' });
    });
    it('ends a generation on nonzero startup failure, resends its pending check once, and repairs that slot for Generate', async () => {
        await initialize();
        Render().runSimulation(config, debug, false); plan(workers[0]);
        Render().cancel(); // replaces both busy slots
        const [checkWorker, otherWorker] = workers.slice(2);
        checkWorker.send({ type: 'initialized' });
        Render().runSimulation(config, debug, false);
        const pending = Render().validate(config);
        otherWorker.crash(); await flush();
        expect(Render().isRunning).toBe(false);
        expect(Render().error).toBe(CHECK_TEXT.generationCrashed);
        const resent = workers[4];
        expect(resent.requests('validate')).toHaveLength(1);
        resent.send({ type: 'initialized' }); passCheck(resent);
        expect(await pending).toMatchObject({ kind: 'valid' });
        expect(workers).toHaveLength(5); // no automatic retry of failed nonzero slot
        Render().runSimulation(config, debug, false);
        const repairedOther = workers[5];
        repairedOther.send({ type: 'initialized' });
        expect(otherWorker.terminate).toHaveBeenCalled();
        finishGeneration(resent);
        expect(repairedOther.requests('task')).toHaveLength(1);
        expect(otherWorker.requests('task')).toHaveLength(0);
    });
    it.each(['cancel', 'engine-error', 'other-worker-crash'] as const)('retains one resend and one settlement after ordinary %s', async (action) => {
        await initialize();
        Render().runSimulation(config, debug, false);
        const settled = vi.spyOn(PendingChecks.prototype, 'settle'), pending = Render().validate(config);
        if (action === 'cancel') Render().cancel();
        else if (action === 'engine-error') workers[1].send({ type: 'error', runId: 1, message: 'engine failure' });
        else workers[1].crash();
        const replacement = workers[2];
        expect(replacement.requests('validate')).toHaveLength(1);
        workers[0].send({ type: 'validated', requestId: 1, validation });
        expect(settled).not.toHaveBeenCalled();
        replacement.send({ type: 'initialized' }); passCheck(replacement);
        expect(await pending).toMatchObject({ kind: 'valid' });
        expect(settled).toHaveBeenCalledOnce();
    });
});
