import type { RecordTimelineRequest, TimelineRecording } from 'clock-generator/browser';
import type { WorkerRequest, WorkerResponse } from './types';
import { createSimulationWorker, loadFactorioData } from './engineClient';

const MAX_CACHE_BYTES = 20_000_000;
const cache = new Map<string, { value: TimelineRecording; bytes: number }>();
let cachedBytes = 0;

/** All reproduction inputs, including the saved build and fuel clocks, are part of the identity. */
export const timelineRecordingKey = (request: RecordTimelineRequest) => JSON.stringify(request);

function keep(key: string, value: TimelineRecording): void {
    const bytes = value.entities.reduce((sum, entity) => sum + entity.signals.reduce((n, signal) => n + signal.ticks.length * 32, 0), 0) + value.events.length * 128;
    if (bytes > MAX_CACHE_BYTES) return;
    const previous = cache.get(key);
    cachedBytes -= previous?.bytes ?? 0;
    cache.delete(key);
    while (cache.size && (cachedBytes + bytes > MAX_CACHE_BYTES || cache.size >= 4)) {
        const oldest = cache.keys().next().value!;
        cachedBytes -= cache.get(oldest)!.bytes;
        cache.delete(oldest);
    }
    cache.set(key, { value, bytes });
    cachedBytes += bytes;
}

/** Dedicated, cancellable worker: recording cannot hold up form validation or generation. */
export function requestTimelineRecording(request: RecordTimelineRequest, signal: AbortSignal): Promise<TimelineRecording> {
    if (signal.aborted) return Promise.reject(new DOMException('Recording cancelled', 'AbortError'));
    const key = timelineRecordingKey(request);
    const found = cache.get(key);
    if (found) {
        cache.delete(key);
        cache.set(key, found);
        return Promise.resolve(found.value);
    }
    return new Promise((resolve, reject) => {
        const worker = createSimulationWorker();
        let ended = false;
        const finish = (error?: Error, result?: TimelineRecording) => {
            if (ended) return;
            ended = true;
            signal.removeEventListener('abort', abort);
            worker.terminate();
            if (error) reject(error);
            else if (result) { keep(key, result); resolve(result); }
        };
        const abort = () => finish(new DOMException('Recording cancelled', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const message = event.data;
            if (message.type === 'initialized') worker.postMessage({ type: 'query', requestId: 1, query: { kind: 'timeline-recording', request } } satisfies WorkerRequest);
            else if (message.type === 'answer' && message.requestId === 1) finish(undefined, message.answer as TimelineRecording);
            else if (message.type === 'error' || message.type === 'query-failed') finish(new Error(message.message));
        };
        worker.onerror = event => finish(new Error(event.message || 'Timeline recording worker stopped.'));
        loadFactorioData().then(data => {
            if (!ended) worker.postMessage({ type: 'initialize', factorioData: data } satisfies WorkerRequest);
        }, error => finish(error instanceof Error ? error : new Error(String(error))));
    });
}

export function clearTimelineRecordingCache(): void { cache.clear(); cachedBytes = 0; }
