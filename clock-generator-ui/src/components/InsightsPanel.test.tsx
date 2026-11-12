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

    it('shows what was measured and, under it, what to do: no "Why?" button and no Why part', () => {
        const { container } = show(<InsightsPanel insights={[overproduces]} />);
        expect(screen.queryByRole('button', { name: 'Why?' })).toBeNull();
        expect(screen.getByText(overproduces.what)).toBeTruthy();
        expect(screen.getByText('Use a clock marked Stable.')).toBeTruthy();
        expect(screen.getByText('Explanation')).toBeTruthy();
        expect(screen.queryByText('Why')).toBeNull();
        const text = container.querySelector('[data-insight="unstable"]')!.textContent!;
        expect(text.indexOf(overproduces.what)).toBeLessThan(text.indexOf('ExplanationUse a clock marked Stable.'));
    });
});

describe('an insight with a reason', () => {
    const underproduces = {
        id: 'unstable', scope: 'clock' as const, title: 'This clock underproduces',
        what: 'Driven only by its enable windows, the build moved 320 of 336 items in a window cycle.',
        why: 'A clock has to work from wherever the machines happen to be when it starts.', explanation: 'Use a clock marked Stable.',
    };

    it('keeps its Why and Explanation behind "Why?", as before', async () => {
        const { user } = show(<InsightsPanel insights={[underproduces]} />);
        const why = screen.getByRole('button', { name: 'Why?' });
        expect(why.getAttribute('aria-expanded')).toBe('false');
        await user.click(why);
        expect(why.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText(underproduces.why)).toBeTruthy();
        expect(screen.getByText('Why')).toBeTruthy();
        expect(screen.getByText('Explanation')).toBeTruthy();
    });
});
