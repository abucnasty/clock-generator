// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { show } from '../test/fixtures';
import { FORCE_TEXT } from '../utils/targetCounts';
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

describe.each(['made', 'destroyed'] as const)('the two number fields, counting items %s', (counts) => {
    const fieldsOf = () => {
        show(<OverridesForm counts={counts} onUpdate={vi.fn()} expanded onExpandedChange={vi.fn()} setCount={0} />);
        const lcm = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'LCM Override' });
        const force = screen.getByRole<HTMLInputElement>('spinbutton', { name: FORCE_TEXT[counts].label });
        return { lcm, force };
    };

    it('each has its name from a visible label', () => {
        const { lcm, force } = fieldsOf();
        expect(lcm.labels).toHaveLength(1);
        expect(force.labels).toHaveLength(1);
    });

    it('both labels are of one kind: above the box, not inside it', () => {
        const { lcm, force } = fieldsOf();
        const [lcmLabel, forceLabel] = [lcm.labels![0], force.labels![0]];
        // a floating label sits inside the box's form control, an outside one does not
        expect(lcmLabel.closest('.MuiFormControl-root')).toBeNull();
        expect(forceLabel.closest('.MuiFormControl-root')).toBeNull();
        expect(lcmLabel.className).toBe(forceLabel.className);
    });

    it('each help text is tied to its input', () => {
        const { lcm, force } = fieldsOf();
        for (const input of [lcm, force]) {
            const described = input.getAttribute('aria-describedby');
            expect(described).toBeTruthy();
            expect(document.getElementById(described!)?.textContent?.length).toBeGreaterThan(0);
        }
        expect(document.getElementById(force.getAttribute('aria-describedby')!)?.textContent).toBe(FORCE_TEXT[counts].field);
        expect(document.getElementById(lcm.getAttribute('aria-describedby')!)?.textContent).toMatch(/output cycles per window cycle/i);
    });

    it('both keep their help text, and the force field its help button', () => {
        fieldsOf();
        expect(screen.getByRole('button', { name: FORCE_TEXT[counts].helpLabel })).toBeTruthy();
    });
});
