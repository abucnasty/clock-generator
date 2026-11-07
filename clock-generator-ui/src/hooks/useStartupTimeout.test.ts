// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTUP_TIMEOUT_MS, type StartupProgress } from '../utils/startupSteps';
import { useStartupTimeout } from './useStartupTimeout';

const ALL_DONE: StartupProgress = { dataLoaded: true, engineReady: true, workersReady: true, configLoaded: true, storeOpened: true, resultsRestored: true };
// the report of 2026-11-07: on WebKit the engine's worker loaded the data and never answered its first question
const ENGINE_SILENT: StartupProgress = { ...ALL_DONE, engineReady: false, workersReady: false, configLoaded: false, storeOpened: false, resultsRestored: false };

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const render = (progress: StartupProgress) => renderHook((props: { progress: StartupProgress }) => useStartupTimeout(props.progress), { initialProps: { progress } });
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('useStartupTimeout', () => {
    it('names the step that has not answered once the time limit has passed, and not before', () => {
        const { result } = render(ENGINE_SILENT);
        wait(STARTUP_TIMEOUT_MS - 1);
        expect(result.current).toBeNull();
        wait(1);
        expect(result.current).toBe('starting the engine did not finish in 60 seconds');
    });

    it('names the step pending when the time is up, not the one pending at the start', () => {
        const { result, rerender } = render(ENGINE_SILENT);
        wait(1000);
        rerender({ progress: { ...ALL_DONE, storeOpened: false, resultsRestored: false } });
        wait(STARTUP_TIMEOUT_MS);
        expect(result.current).toBe('opening the kept clocks did not finish in 60 seconds');
    });

    it('says nothing when every step finishes in time', () => {
        const { result, rerender } = render(ENGINE_SILENT);
        wait(1000);
        rerender({ progress: ALL_DONE });
        wait(STARTUP_TIMEOUT_MS * 2);
        expect(result.current).toBeNull();
    });

    it('lets a start that finishes late through', () => {
        const { result, rerender } = render(ENGINE_SILENT);
        wait(STARTUP_TIMEOUT_MS);
        expect(result.current).not.toBeNull();
        rerender({ progress: ALL_DONE });
        expect(result.current).toBeNull();
    });
});
