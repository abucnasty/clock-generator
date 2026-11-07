// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../hooks/useSimulationWorker';
import { StrategyHelp } from './ClockAlternativesPanel';

const clockOf = (id: string) => ({
    label: 'Engine label',
    strategy: { id, tuning_method: 'calculated', settings: { output_count: { kind: 'output_swings', count: 2 }, window_cycle: [], belt_pickups: [] },
        output_swings: 2, routing: { router: 'direct' } },
}) as unknown as ClockAlternativeView;

describe('StrategyHelp', () => {
    it('breaks a long word at the popover edge, for the strategies that name a source address', () => {
        for (const id of ['takt_batches', 'time_division_windows', 'phase_shifted_batch']) {
            const { container, unmount } = render(<StrategyHelp clock={clockOf(id)} />);
            expect(screen.getAllByText(/Source:|Wikipedia|Lean|FHWA/).length).toBeGreaterThan(0);
            expect(getComputedStyle(container.firstElementChild as Element).overflowWrap).toBe('anywhere');
            unmount();
        }
    });
});
