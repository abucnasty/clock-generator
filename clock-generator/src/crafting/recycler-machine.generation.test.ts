import {beforeAll, describe, expect, it} from 'vitest';
import {ConfigPaths} from '../config/config-paths';
import {loadConfigFromFile} from '../config/loader';
import {generateClockAlternatives} from './alternatives';

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

describe('electromagnetic science with recycler direct insertion', () => {
    let generated: ReturnType<typeof generateClockAlternatives>;
    beforeAll(async () => { generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_RECYCLER), {logger: quiet}); });
    // The simulator serves the takers of one machine in a single fixed order and a clock is kept only if it holds under
    // every order; the game recovers this build from its losses, the simulator under one order does not: verdict
    // "no recovery" (taker order, docs/simulator.md).
    it('has a 40-tick clock at 240 science packs per second across five copies that the taker order leaves with no recovery', () => {
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.verdict).toBe('no recovery');
        expect(selected.assessment.items_per_second).toBe(240);
        expect(selected.result.simulation_duration.ticks).toBe(40);
        expect(selected.assessment.backpressure_loss?.survives).toBe(false);
    });
    it('ends a chest output window before the returning inserter can start another hand', () => {
        const selected = generated.alternatives[generated.selected_index];
        for (const id of ['inserter:4', 'inserter:7']) {
            const windows = selected.result.clock_windows[id];
            expect(windows).toHaveLength(1);
            expect(windows[0].end - windows[0].start + 1).toBeLessThan(8);
        }
    });
});
