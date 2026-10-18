import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordTimelineRequest, TimelineRecording } from 'clock-generator/browser';
import type { WorkerRequest, WorkerResponse } from './types';
import { clearTimelineRecordingCache, requestTimelineRecording } from './timelineClient';
const mocks = vi.hoisted(() => ({ create: vi.fn(), load: vi.fn() }));
vi.mock('./engineClient', () => ({ createSimulationWorker: mocks.create, loadFactorioData: mocks.load }));
class Worker {
    onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
    onerror: ((event: { message: string }) => void) | null = null;
    postMessage = vi.fn<(request: WorkerRequest) => void>();
    terminate = vi.fn();
    answer(data: WorkerResponse) { this.onmessage?.({ data }); }
}
const request = { config: {}, mode: 'clock', period_ticks: 100, terminal_swing_count: 1, windows: {} } as RecordTimelineRequest;
const recording: TimelineRecording = { version: 1, mode: 'clock', start_tick: 0, end_tick: 100, period_ticks: 100, requested_ticks: 100, ticks_before_recording: 1000, ticks_per_second: 60, copies: 1, truncated: false, entities: [], events: [] };
const settle = () => Promise.resolve();
let workers: Worker[];
beforeEach(() => { workers = []; clearTimelineRecordingCache(); mocks.load.mockResolvedValue('{}'); mocks.create.mockImplementation(() => { const worker = new Worker(); workers.push(worker); return worker; }); });
afterEach(() => vi.clearAllMocks());

describe('on-demand recording worker', () => {
    it('initializes, records, terminates, and reuses identical data for later scrubbing/views', async () => {
        const answer = requestTimelineRecording(request, new AbortController().signal);
        await settle(); expect(workers[0].postMessage).toHaveBeenCalledWith({ type: 'initialize', factorioData: '{}' });
        workers[0].answer({ type: 'initialized' });
        expect(workers[0].postMessage).toHaveBeenLastCalledWith({ type: 'query', requestId: 1, query: { kind: 'timeline-recording', request } });
        workers[0].answer({ type: 'answer', requestId: 1, answer: recording });
        expect(await answer).toBe(recording); expect(workers[0].terminate).toHaveBeenCalledOnce();
        expect(await requestTimelineRecording(structuredClone(request), new AbortController().signal)).toBe(recording);
        expect(workers).toHaveLength(1);
    });
    it('aborts a replaced clock and ignores its late response without poisoning the cache', async () => {
        const controller = new AbortController();
        const answer = requestTimelineRecording(request, controller.signal);
        controller.abort(); await expect(answer).rejects.toMatchObject({ name: 'AbortError' });
        workers[0].answer({ type: 'answer', requestId: 1, answer: recording });
        const nextController = new AbortController();
        const next = requestTimelineRecording(request, nextController.signal);
        expect(workers).toHaveLength(2);
        nextController.abort(); await expect(next).rejects.toMatchObject({ name: 'AbortError' });
        expect(workers.every(worker => worker.terminate.mock.calls.length === 1)).toBe(true);
    });
    it('keys the saved build, domain, period, windows and independent fuel clocks', async () => {
        const first = requestTimelineRecording(request, new AbortController().signal);
        workers[0].answer({ type: 'answer', requestId: 1, answer: recording }); await first;
        for (const change of [{ mode: 'plan' }, { period_ticks: 90 }, { config: { overrides: { backed_up_belts: true } } }, { windows: { 'inserter:1': [{ start: 1, end: 8 }] } }, { inserter_clocks: { 'inserter:1': { modulus: 30 } } }]) {
            const controller = new AbortController(); const pending = requestTimelineRecording({ ...request, ...change } as RecordTimelineRequest, controller.signal);
            controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        }
        expect(workers).toHaveLength(6);
    });
    it('terminates on query or initialization failure and allows a retry', async () => {
        const first = requestTimelineRecording(request, new AbortController().signal);
        workers[0].answer({ type: 'query-failed', requestId: 1, message: 'bad build' });
        await expect(first).rejects.toThrow('bad build'); expect(workers[0].terminate).toHaveBeenCalledOnce();
        mocks.load.mockRejectedValueOnce(new Error('missing data'));
        const next = requestTimelineRecording(request, new AbortController().signal);
        await expect(next).rejects.toThrow('missing data'); expect(workers[1].terminate).toHaveBeenCalledOnce();
    });
});
