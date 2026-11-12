// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { show } from '../test/fixtures';
import { MILITARY_240, viewsOf } from '../test/checkedLanesFixtures';
import { InstallClockDialog } from './InstallClockDialog';

describe('the install dialog\'s line', () => {
    const clock = viewsOf(MILITARY_240)[MILITARY_240.selected_index];
    /** The dialog open on `selected`: the line under its title */
    const lineOf = (selected: ClockAlternativeView) => {
        show(<InstallClockDialog open onClose={() => {}} selected={{ ...selected, install: { book: false, wiring: [], drills: [], lines: {} }, stateTransitionHistory: { entities: [], reasons: [], total_duration_ticks: 0 }, clockWindows: {} } as unknown as ClockAlternativeView}
            blueprintString={null} staleFor={null} copyLabel="Copy blueprint" copied={false} onCopy={() => {}} />);
        return screen.getByText(/ wakeups\/min/).textContent;
    };

    it('says swings and wakeups of a clock made for a belt, and no belt word', () => {
        expect(clock.beltLabel).toBe('backed-up');
        expect(lineOf(clock)).toBe('2 swings · 634 wakeups/min');
    });

    it('says the same of a clock where no clocked inserter picks up from a belt', () => {
        expect(lineOf({ ...clock, beltLabel: '', belt: undefined } as ClockAlternativeView)).toBe('2 swings · 634 wakeups/min');
    });
});
