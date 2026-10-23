import { describe, expect, it } from 'vitest';
import { generateClockAlternatives } from './alternatives';
import { steelHub } from './container-output.fixture';

const quiet = { log() { }, info() { }, warn() { }, error() { }, debug() { } };

describe('a product that leaves through a container', () => {
    it('generates a clock that holds the target, the takers out of the wagon being the output', () => {
        const { alternatives, selected_index } = generateClockAlternatives(steelHub(), { logger: quiet });
        const selected = alternatives[selected_index];
        expect(selected.assessment.holds).toBe(true);
        expect(selected.verdict).toBe('stable');
        expect(selected.assessment.items_per_second).toBeCloseTo(26, 6);
        expect(Object.keys(selected.result.clock_windows)).toContain('inserter:3');
    });
});
