import { describe, expect, it } from 'vitest';
import { pendingStartupStep, startupFailureText, startupTimeoutText, type StartupProgress } from './startupSteps';

const ALL_DONE: StartupProgress = { dataLoaded: true, engineReady: true, workersReady: true, configLoaded: true, storeOpened: true, resultsRestored: true };

describe('pendingStartupStep', () => {
    it('names the first step not done, in the order the page takes them', () => {
        expect(pendingStartupStep({ ...ALL_DONE, dataLoaded: false, storeOpened: false })).toBe('loading the game data');
        expect(pendingStartupStep({ ...ALL_DONE, engineReady: false, resultsRestored: false })).toBe('starting the engine');
        expect(pendingStartupStep({ ...ALL_DONE, storeOpened: false, resultsRestored: false })).toBe('opening the kept clocks');
        expect(pendingStartupStep({ ...ALL_DONE, resultsRestored: false })).toBe('restoring the kept clocks');
    });

    it('is null once every step is done', () => {
        expect(pendingStartupStep(ALL_DONE)).toBeNull();
    });

    it('reads only the steps it is given', () => {
        expect(pendingStartupStep({ dataLoaded: true, engineReady: true, workersReady: false })).toBe('starting the simulator workers');
        expect(pendingStartupStep({ dataLoaded: true, engineReady: true, workersReady: true })).toBeNull();
    });
});

describe('the startup alert texts', () => {
    it('says what failed and in which step', () => {
        expect(startupFailureText('The simulator stopped unexpectedly', 'starting the simulator workers'))
            .toBe('The simulator stopped unexpectedly (while starting the simulator workers)');
        expect(startupFailureText('Failed to initialize', null)).toBe('Failed to initialize');
    });

    it('names the step that did not answer, and the time waited', () => {
        expect(startupTimeoutText('starting the engine', 60_000)).toBe('starting the engine did not finish in 60 seconds');
    });
});
