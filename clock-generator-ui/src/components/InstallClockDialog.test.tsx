// @vitest-environment happy-dom
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClockAlternativeView } from '../worker/types';
import { show } from '../test/fixtures';
import { MILITARY_240, viewsOf } from '../test/checkedLanesFixtures';
import { fullClockName } from '../utils/strategyNames';
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

describe('the install dialog\'s caption and warning', () => {
    const clock = viewsOf(MILITARY_240)[MILITARY_240.selected_index];
    const open = (selected: ClockAlternativeView) => show(<InstallClockDialog open onClose={() => {}} selected={{ ...selected, install: { book: false, wiring: [], drills: [], lines: {} }, stateTransitionHistory: { entities: [], reasons: [], total_duration_ticks: 0 }, clockWindows: {} } as unknown as ClockAlternativeView}
        blueprintString={null} staleFor={null} copyLabel="Copy blueprint" copied={false} onCopy={() => {}} />);

    it('names the clock in full with its chips, and leaves the Factorio version to the import step', () => {
        open(clock);
        expect(screen.getByText(fullClockName(clock)).textContent).toBe(fullClockName(clock));
        expect(document.body.textContent).not.toContain('The blueprint needs Factorio 2.1 or later.');
    });

    it('says a deadlock risk with the inserters and the machine it names, and not how a deadlock comes about', () => {
        const what = 'Inserters 1 and 2 both bring iron plate to the machine 3 that makes gears; inserter 1 also brings coal.';
        const note = `Deadlock risk: ${what} An inserter that starts picking up an item the other has already filled the machine with holds its hand until the machine has room.`;
        open({ ...clock, deadlockRisk: note, insights: [...clock.insights, { id: 'deadlock-risk', scope: 'build', title: 'This build has a deadlock risk: two inserters bring the same item', what, why: 'Why.', explanation: 'Explanation.' }] });
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain(`Deadlock risk: ${what}`);
        expect(alert.textContent).not.toContain('An inserter that starts picking up');
    });
});
