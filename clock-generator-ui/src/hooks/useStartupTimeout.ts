import { useEffect, useRef, useState } from 'react';
import { pendingStartupStep, STARTUP_TIMEOUT_MS, startupTimeoutText, type StartupProgress } from '../utils/startupSteps';

/**
 * Null while the page starts, and the text for the startup alert once `timeoutMs` has passed after mounting with a step
 * not done: the first such step. Once every step is done it stays null.
 */
export function useStartupTimeout(progress: StartupProgress, timeoutMs: number = STARTUP_TIMEOUT_MS): string | null {
    const [timedOut, setTimedOut] = useState<string | null>(null);
    const pending = pendingStartupStep(progress);
    // the timer reads the step as last rendered, not as it was when it was set
    const pendingRef = useRef(pending);
    useEffect(() => {
        pendingRef.current = pending;
    }, [pending]);
    const started = pending === null;
    useEffect(() => {
        if (started) return;
        const timer = setTimeout(() => {
            const step = pendingRef.current;
            if (step !== null) {
                console.error(`The page could not start: ${step} did not answer`);
                setTimedOut(startupTimeoutText(step, timeoutMs));
            }
        }, timeoutMs);
        return () => clearTimeout(timer);
    }, [started, timeoutMs]);
    return started ? null : timedOut;
}
