import { useEffect, useState } from 'react';
import type { RecordTimelineRequest, TimelineRecording } from 'clock-generator/browser';
import { requestTimelineRecording, timelineRecordingKey } from '../worker/timelineClient';

export interface TimelineRecordingState { status: 'idle' | 'loading' | 'ready' | 'error'; data: TimelineRecording | null; error: string | null }

/** A changed clock cancels the old replay; a late answer can never be shown as the new clock's data. */
export function useTimelineRecording(request: RecordTimelineRequest | null, retry = 0): TimelineRecordingState {
    const key = request ? timelineRecordingKey(request) : null;
    const [result, setResult] = useState<{ key: string; retry: number; data: TimelineRecording | null; error: string | null } | null>(null);
    useEffect(() => {
        if (!key) return;
        const controller = new AbortController();
        const input = JSON.parse(key) as RecordTimelineRequest;
        requestTimelineRecording(input, controller.signal).then(data => {
            if (!controller.signal.aborted) setResult({ key, retry, data, error: null });
        }, error => {
            if (!controller.signal.aborted) setResult({ key, retry, data: null, error: error instanceof Error ? error.message : String(error) });
        });
        return () => controller.abort();
    }, [key, retry]);
    if (!key) return { status: 'idle', data: null, error: null };
    if (result?.key !== key || result.retry !== retry) return { status: 'loading', data: null, error: null };
    return { status: result.error ? 'error' : 'ready', data: result.data, error: result.error };
}
