import {beforeAll, describe, expect, it} from 'vitest';
import {ConfigPaths} from '../config/config-paths';
import {loadConfigFromFile} from '../config/loader';
import {generateClockAlternatives} from './alternatives';

const quiet = {log() {}, info() {}, warn() {}, error() {}, debug() {}};

describe('original electromagnetic science with curved inputs and belt disposal', () => {
    let generated: ReturnType<typeof generateClockAlternatives>;
    beforeAll(async () => { generated = generateClockAlternatives(await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_ORIGINAL), {logger: quiet}); });
    // The manual control of the game test (recycler-original-clock): in the game it gets back from all seven losses.
    // The simulator serves the takers of one machine in a single fixed order and a clock is kept only if it holds under
    // every order, so under one order the superconductor and holmium-plate losses fail: verdict "no recovery" (taker
    // order, docs/simulator.md). The public sample gets the automatic turns clock before release.
    it('generates a 40-tick clock at 240/s across five repeated cells that the taker order leaves with no recovery', () => {
        const selected = generated.alternatives[generated.selected_index];
        expect(selected.verdict).toBe('no recovery');
        expect(selected.assessment.items_per_second).toBe(240);
        expect(selected.result.simulation_duration.ticks).toBe(40);
        expect(selected.assessment.backpressure_loss?.survives).toBe(false);
    });
    it('uses the original curved pickup and sends advanced circuits onto a belt', async () => {
        const config = await loadConfigFromFile(ConfigPaths.REAL_OWNER_PINK_SCIENCE_ORIGINAL);
        expect(config.inserters.find(inserter => inserter.source.type === 'belt' && inserter.source.pickup_layout === 'bend-right-upstream')?.source)
            .toMatchObject({pickup_capture: {status: 'supported', model_version: 3}});
        const byproduct = config.inserters.find(inserter => inserter.filters?.includes('advanced-circuit'))!;
        expect(byproduct.sink.type).toBe('belt');
    });
});
