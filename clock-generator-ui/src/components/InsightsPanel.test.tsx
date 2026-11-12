// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { show } from '../test/fixtures';
import { InsightsPanel } from './InsightsPanel';

describe('an insight with no reason', () => {
    // the insight of a clock above the expected output, as the engine gives it
    const overproduces = {
        id: 'unstable', scope: 'clock' as const, title: 'This clock overproduces',
        what: 'Driven only by its enable windows, the build moved 352 of 336 items in a window cycle.', why: '', explanation: 'Use a clock marked Stable.',
    };

    it('shows what was measured and what to do, with no Why part', async () => {
        const { user } = show(<InsightsPanel insights={[overproduces]} />);
        await user.click(screen.getByRole('button', { name: 'Why?' }));
        expect(screen.getByText(overproduces.what)).toBeTruthy();
        expect(screen.getByText('Use a clock marked Stable.')).toBeTruthy();
        expect(screen.getByText('Explanation')).toBeTruthy();
        expect(screen.queryByText('Why')).toBeNull();
    });
});
