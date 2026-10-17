import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClockAlternativeContext, ConfigValidation, DebugSteps } from 'clock-generator/browser';
import type { ClockAlternativeView, RepeatedUnitsRecovery, WorkerRequest, WorkerResponse } from '../worker/types';
import { afterCheck, CHECK_TEXT, decideGenerate, PendingChecks } from '../utils/checkThenGenerate';
import { formDataToConfig } from '../utils/configForm/configMapping';
import { createDefaultConfig } from '../utils/configForm/formData';
import { useSimulationWorker } from './useSimulationWorker';

// Node-only runner: actual hook/pool/check logic, controlled React state and Worker transport. Retains effects and
// callback dependencies across renders (including unmount teardown), so these tests need neither a DOM nor new deps.
const runner = vi.hoisted(() => {
    let states: unknown[] = [], refs: { current: unknown }[] = [];
    let memos: { deps: readonly unknown[]; value: unknown }[] = [];
    let effects: { deps: readonly unknown[]; cleanup?: () => void }[] = [];
    let queued: (() => void)[] = [];
    let si = 0, ri = 0, mi = 0, ei = 0;
    const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    const memo = (create: () => unknown, deps: readonly unknown[]) => {
        const i = mi++;
        if (!memos[i] || !same(memos[i].deps, deps)) memos[i] = { deps, value: create() };
        return memos[i].value;
    };
    return {
        createWorker: vi.fn<() => Worker>(), loadData: vi.fn<() => Promise<string>>(),
        reset() { states = []; refs = []; memos = []; effects = []; queued = []; },
        begin() { si = ri = mi = ei = 0; queued = []; },
        commit() { queued.forEach(f => f()); },
        unmount() { effects.forEach(e => e.cleanup?.()); },
        react: {
            useState(initial: unknown) {
                const i = si++;
                if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
                return [states[i], (value: unknown) => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
            },
            useRef(value: unknown) { return refs[ri++] ??= { current: value }; },
            useMemo: memo,
            useCallback: (fn: unknown, deps: readonly unknown[]) => memo(() => fn, deps),
            useEffect(effect: () => (() => void) | void, deps: readonly unknown[]) {
                const i = ei++;
                if (!effects[i] || !same(effects[i].deps, deps)) queued.push(() => {
                    effects[i]?.cleanup?.();
                    effects[i] = { deps, cleanup: effect() || undefined };
                });
            },
            useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
        },
    };
});
vi.mock('react', () => runner.react);
vi.mock('../worker/engineClient', () => ({
    createSimulationWorker: () => runner.createWorker(), loadFactorioData: () => runner.loadData(),
    askEngine: async () => ({ recipeNames: [], hiddenRecipes: [], itemNames: [], resourceNames: [], names: {}, recipes: new Map() }),
}));
vi.mock('../utils/resultsStore', () => ({
    openResultsStore: async () => ({ entries: () => [], put: async () => {} }),
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
    planner.send({ type: 'planned', runId, primary: null, context: {} as ClockAlternativeContext, assumptions: { startDependenceRequested: false },
        tasks: [{ id: 'one', label: 'One', only_when_needed: false }, { id: 'two', label: 'Two', only_when_needed: false }] });
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
            planner.send({ type: 'planned', runId: request.runId, primary: { signature: 'a', alternatives: [candidate] },
                context: {} as ClockAlternativeContext, assumptions: { startDependenceRequested: requested },
                tasks: complete ? [] : [{ id: 'remaining', label: 'Remaining', only_when_needed: false }] });
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
