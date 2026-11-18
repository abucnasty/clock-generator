// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { show } from '../test/fixtures';
import { OverridesForm } from './OverridesForm';

function showForm(judgedStart?: 'cold' | 'backpressure') {
    const onUpdate = vi.fn();
    const view = show(<OverridesForm judgedStart={judgedStart} onUpdate={onUpdate} expanded onExpandedChange={vi.fn()} setCount={0} />);
    return { ...view, onUpdate, toggle: () => screen.getByRole<HTMLInputElement>('switch', { name: 'Judge from the cold start' }) };
}

describe('the cold start switch', () => {
    it('is off on a build that names no start: the backpressure start is the default', () => {
        const { toggle } = showForm();
        expect(toggle().checked).toBe(false);
    });

    it('is off on a build that names the backpressure start', () => {
        const { toggle } = showForm('backpressure');
        expect(toggle().checked).toBe(false);
    });

    it('is on on a build that names the cold start', () => {
        const { toggle } = showForm('cold');
        expect(toggle().checked).toBe(true);
    });

    it('writes the cold start when it is turned on', async () => {
        const { toggle, onUpdate, user } = showForm();
        await user.click(toggle());
        expect(onUpdate).toHaveBeenCalledWith('judged_start', 'cold');
    });

    it('takes the field away, back to the default, when it is turned off', async () => {
        const { toggle, onUpdate, user } = showForm('cold');
        await user.click(toggle());
        expect(onUpdate).toHaveBeenCalledWith('judged_start', undefined);
    });

    it('says in one line what it changes, tied to the switch', () => {
        const { toggle } = showForm();
        const described = toggle().getAttribute('aria-describedby');
        expect(described).toBeTruthy();
        expect(document.getElementById(described!)?.textContent).toMatch(/cold start/i);
    });
});
